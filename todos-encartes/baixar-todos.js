#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const { REDES } = require("../lib/redes");

const ROOT = path.join(__dirname, "..");

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function dateFolderName(date) {
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}-${MESES[date.getMonth()]}`;
}

async function lerManifestSeExistir(destino) {
  try {
    const raw = await fs.readFile(path.join(destino, "manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rodarScript(scriptPath, args) {
  return new Promise((resolve) => {
    let erroSpawn = null;
    let saida = "";
    const proc = spawn("node", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    // Acumula a saída da rede para imprimir o bloco inteiro quando ela terminar;
    // com stdio: "inherit" as redes em paralelo intercalariam as linhas.
    proc.stdout.on("data", (chunk) => { saida += chunk; });
    proc.stderr.on("data", (chunk) => { saida += chunk; });
    proc.on("error", (err) => { erroSpawn = err; });
    proc.on("close", (code) => resolve({ code, erroSpawn, saida }));
  });
}

// ─── pré-checagem ─────────────────────────────────────────────────────────────

function checarPoppler() {
  const faltando = [];
  for (const bin of ["pdfinfo", "pdftoppm"]) {
    try {
      execFileSync("which", [bin], { stdio: "ignore" });
    } catch {
      faltando.push(bin);
    }
  }
  return faltando;
}

async function checarPlaywright(pasta) {
  try {
    await fs.access(path.join(ROOT, pasta, "node_modules", "playwright"));
    return true;
  } catch {
    return false;
  }
}

async function preChecagem() {
  const problemas = [];

  const usamPoppler = REDES.filter((r) => r.deps.poppler);
  if (usamPoppler.length > 0) {
    const faltando = checarPoppler();
    if (faltando.length > 0) {
      problemas.push(
        `Dependência(s) ausente(s): ${faltando.join(", ")} (usado por ${usamPoppler.map((r) => r.nome).join(", ")}).\n` +
        `Instale com: brew install poppler`
      );
    }
  }

  for (const rede of REDES) {
    if (!rede.deps.playwright) continue;
    const ok = await checarPlaywright(rede.pasta);
    if (!ok) {
      problemas.push(
        `Playwright ausente para ${rede.nome}.\n` +
        `Instale com: cd ${rede.pasta} && npm install`
      );
    }
  }

  if (problemas.length > 0) {
    throw new Error(problemas.join("\n\n"));
  }
}

// ─── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    dpi: null,
    onlyNewest: false,
    semReuso: false,
    all: false,
    paralelo: 1,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--dpi") args.dpi = argv[++i];
    else if (arg === "--only-newest") args.onlyNewest = true;
    else if (arg === "--sem-reuso") args.semReuso = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--paralelo") args.paralelo = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--output") {
      throw new Error(
        `--output não é suportado aqui: as ${REDES.length} redes se sobrescreveriam na mesma pasta.\n` +
        "Use --base para mudar só a raiz, ou rode a skill de cada rede individualmente com --output."
      );
    }
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Uso:
  node todos-encartes/baixar-todos.js [opções]

Dispara ${REDES.map((r) => r.nome).join(", ")} em sequência (ou em paralelo com --paralelo N).

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --dpi           Resolução de rasterização (Cometa, SuperDoPovo e Atacadão). Padrão: 200
  --only-newest   Baixa apenas o encarte mais recente de cada rede (não se aplica ao Mercadão)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --all           Inclui encartes já vencidos (só SuperDoPovo)
  --paralelo      Nº de redes baixando ao mesmo tempo (máx. 3). Padrão: 1 (sequencial)
  --json          Imprime, como última linha, o resultado estruturado da rodada
  --help          Exibe esta mensagem

Saída padrão:
  <base>/<Rede>/DD-Mês/ (uma pasta por rede, formato idêntico ao das skills individuais)

Com --json, a última linha é:
  {"redes":[{"rede":"cometa","ok":true,"pasta_download":"...","erro":null}]}
`);
}

// Converte camelCase para kebab-case: onlyNewest -> --only-newest
function kebab(flag) {
  return "--" + flag.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function argsPorRede(rede, args) {
  const out = ["--base", args.base];
  for (const flag of rede.flags) {
    if (flag === "dpi") {
      if (args.dpi) out.push("--dpi", args.dpi);
    } else if (args[flag]) {
      out.push(kebab(flag));
    }
  }
  return out;
}

// ─── resumo ───────────────────────────────────────────────────────────────────

// A pasta da rodada é reportada pelo próprio script da rede (linha
// "Destino: <caminho>"). Nunca inferimos por busca recursiva: o pai confia
// apenas na pasta que esta execução realmente criou/localizou.
function pastaDoResumo(saida) {
  const m = /^Destino: (.+)$/m.exec(saida);
  return m ? m[1].trim() : null;
}

function montarResultadoJson(resultados) {
  return {
    redes: resultados.map((r) => ({
      rede: r.slug,
      ok: Boolean(r.ok),
      pasta_download: r.pasta_download ?? null,
      erro: r.erro ?? null,
    })),
  };
}

function imprimirResumoJson(resultados) {
  console.log(JSON.stringify(montarResultadoJson(resultados)));
}

function formatarContagem(manifest) {
  const paginasReaproveitadas = (manifest.encartes || [])
    .filter((e) => e.reaproveitado)
    .reduce((soma, e) => soma + (e.paginas || 0), 0);
  const paginasNovas = (manifest.totalPaginas || 0) - paginasReaproveitadas;

  const partes = [`${paginasNovas} novas`];
  if (paginasReaproveitadas > 0) partes.push(`${paginasReaproveitadas} reaproveitadas`);
  return partes.join(", ");
}

function imprimirResumo(base, resultados) {
  const nomeCol = Math.max(...resultados.map((r) => r.nome.length)) + 4;

  console.log("Resumo:\n");

  let totalPaginas = 0;
  let ok = 0;

  for (const r of resultados) {
    const nome = r.nome.padEnd(nomeCol);
    if (r.ok && r.manifest) {
      totalPaginas += r.manifest.totalPaginas || 0;
      ok += 1;
      console.log(`  ${nome}${r.manifest.totalEncartes} encartes | ${r.manifest.totalPaginas} páginas (${formatarContagem(r.manifest)})`);
    } else if (r.ok) {
      ok += 1;
      console.log(`  ${nome}OK (sem manifest.json pra detalhar)`);
    } else {
      console.log(`  ${nome}FALHOU: ${r.erro}`);
    }
  }

  console.log("");
  console.log(`  ${ok} de ${resultados.length} redes OK | ${totalPaginas} páginas | ${base}`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await preChecagem();

  const dateLabel = dateFolderName(new Date());
  console.log(`Rodada ${dateLabel}\n`);

  // Pool simples: no máximo `limite` rodarScript em voo. Cap em 3 (8 Chromiums
  // simultâneos seriam ~3GB e contenda de CPU).
  const limite = Math.min(3, Number(args.paralelo) || 1);
  const resultados = new Array(REDES.length); // preserva a ordem de REDES no resumo
  let proxima = 0;

  async function rodarRede(idx) {
    const rede = REDES[idx];
    const scriptPath = path.join(ROOT, rede.pasta, rede.script);
    const { code, erroSpawn, saida } = await rodarScript(scriptPath, argsPorRede(rede, args));
    console.log(`─── ${rede.nome} ───\n${saida}\n`);

    if (erroSpawn || code !== 0) {
      resultados[idx] = {
        nome: rede.nome,
        slug: rede.slug,
        ok: false,
        pasta_download: null,
        erro: erroSpawn ? erroSpawn.message : `saiu com código ${code}`,
        manifest: null,
      };
      return;
    }

    const destino = pastaDoResumo(saida);
    if (!destino) {
      resultados[idx] = {
        nome: rede.nome,
        slug: rede.slug,
        ok: false,
        pasta_download: null,
        erro: "não consegui identificar a pasta desta execução (linha Destino ausente)",
        manifest: null,
      };
      return;
    }

    const manifest = await lerManifestSeExistir(destino);
    resultados[idx] = { nome: rede.nome, slug: rede.slug, ok: true, pasta_download: destino, erro: null, manifest };
  }

  async function pool() {
    while (proxima < REDES.length) {
      const idx = proxima;
      proxima += 1;
      await rodarRede(idx);
    }
  }

  const rodadas = [];
  for (let i = 0; i < limite; i += 1) rodadas.push(pool());
  await Promise.all(rodadas);

  imprimirResumo(args.base, resultados);

  if (args.json) imprimirResumoJson(resultados);

  const falhou = resultados.some((r) => !r.ok);
  process.exit(falhou ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error(mensagem);
    // Mesmo abortando antes de baixar qualquer coisa (pré-checagem, args), o
    // resultado estruturado sai completo para o pai não inventar a lista.
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({
        redes: REDES.map((rede) => ({
          rede: rede.slug,
          ok: false,
          pasta_download: null,
          erro: mensagem,
        })),
      }));
    }
    process.exit(1);
  });
}

module.exports = { montarResultadoJson, pastaDoResumo, REDES };

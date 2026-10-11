"use strict";

// Contrato do resultado estruturado que o enviar-todos.mjs consome. A pasta
// tem que vir do próprio script da rede (linha "Destino:"), nunca de uma
// varredura da pasta mais recente: se a extração falhar, é melhor a rede
// aparecer como erro do que o pai adivinhar uma rodada antiga.

const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const { montarResultadoJson, pastaDoResumo, REDES } = require("./baixar-todos");

test("cada rede do registry tem slug para casar com o enviar-todos.mjs", () => {
  for (const rede of REDES) {
    assert.ok(typeof rede.slug === "string" && rede.slug.length > 0, `${rede.nome} sem slug`);
  }
  const slugs = REDES.map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slug repetido");
});

test("dry-run lista todas as redes sem iniciar downloads", () => {
  const saida = execFileSync("node", [__filename.replace(/\.test\.js$/, ".js"), "--dry-run"], {
    encoding: "utf8",
  });
  assert.match(saida, /Dry-run: nenhum download será executado/);
  assert.match(saida, /Uniforca: .*uniforca-encartes.*download-encartes\.js/);
});

test("pastaDoResumo lê só a linha Destino do filho", () => {
  assert.equal(
    pastaDoResumo("Cometa | 22-Setembro\nEncartes: 1 | Páginas: 3 (3 novas)\nDestino: /tmp/Encartes/Cometa/22-Setembro"),
    "/tmp/Encartes/Cometa/22-Setembro",
  );
  assert.equal(pastaDoResumo("sem linha de destino"), null);
});

test("resultado estruturado é completo mesmo com falha parcial", () => {
  const json = montarResultadoJson([
    { nome: "Cometa", slug: "cometa", ok: true, pasta_download: "/a", erro: null },
    { nome: "SuperDoPovo", slug: "superdopovo", ok: false, pasta_download: null, erro: "sem PDF e sem páginas" },
  ]);

  assert.deepEqual(json, {
    redes: [
      { rede: "cometa", ok: true, pasta_download: "/a", erro: null },
      { rede: "superdopovo", ok: false, pasta_download: null, erro: "sem PDF e sem páginas" },
    ],
  });
});

// ─── eventos de progresso (F0) ────────────────────────────────────────────────
// Redes falsas via MMB_REDES_JSON (seam interno só para testes). Os scripts
// falsos usam o baixarEncartes real com deps injetados: sem rede e sem poppler.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { lerEvento, sanitizarErro } = require("../lib/eventos");

const BAIXAR_TODOS = path.join(__dirname, "baixar-todos.js");
const PIPELINE = path.join(__dirname, "..", "lib", "pipeline.js");
const SENTINELA = "sentinela-f0-nao-pode-vazar-123";

function scriptRedeFalsa({ nome, pdf, liberarArquivo = null, falhar = false }) {
  return `"use strict";
const fs = require("fs/promises");
const { baixarEncartes } = require(${JSON.stringify(PIPELINE)});
const liberar = ${JSON.stringify(liberarArquivo)};
async function esperarLiberacao() {
  if (!liberar) return;
  for (let i = 0; i < 400; i += 1) {
    try { await fs.access(liberar); return; } catch { await new Promise((r) => setTimeout(r, 25)); }
  }
  throw new Error("liberação não veio");
}
async function main() {
  if (${falhar}) {
    console.error("falhou em https://exemplo.test/x?token=" + process.env.SEGREDO_TESTE);
    process.exit(1);
  }
  const base = process.argv[process.argv.indexOf("--base") + 1];
  await baixarEncartes({
    rede: ${JSON.stringify(nome)},
    descobrir: async () => [${pdf
      ? `{ slug: "e", pdf: { url: "https://exemplo.test/e.pdf", manter: true }, meta: {} }`
      : `{ slug: "e", paginas: [{ url: "https://exemplo.test/1.jpg" }, { url: "https://exemplo.test/2.jpg" }], meta: {} }`}],
    args: { base, output: null, semReuso: true, dpi: 150 },
    deps: {
      async baixarArquivo(_u, caminho) { await fs.writeFile(caminho, "x"); return true; },
      async contarPaginasPdf() { return 2; },
      async rasterizarPagina(_p, outBase) {
        await esperarLiberacao();
        await new Promise((r) => setTimeout(r, 15));
        await fs.writeFile(outBase + ".jpg", "jpg");
      },
      checarPoppler() {},
    },
  });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
`;
}

async function montarRegistro(redes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "baixar-todos-falso-"));
  const registro = { root, redes: [] };
  for (const rede of redes) {
    await fs.mkdir(path.join(root, rede.slug), { recursive: true });
    await fs.writeFile(path.join(root, rede.slug, "rede.js"), scriptRedeFalsa(rede));
    registro.redes.push({
      nome: rede.nome, slug: rede.slug, pasta: rede.slug, script: "rede.js",
      flags: ["semReuso"], deps: { poppler: false, playwright: false },
    });
  }
  const arquivo = path.join(root, "redes.json");
  await fs.writeFile(arquivo, JSON.stringify(registro));
  return { root, arquivo };
}

function rodarBaixarTodos(registro, base, { eventos = true, aoStderr } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, MMB_REDES_JSON: registro, SEGREDO_TESTE: SENTINELA };
    if (eventos) env.MMB_EVENTOS = "1";
    else delete env.MMB_EVENTOS;
    const proc = spawn(process.execPath, [BAIXAR_TODOS, "--json", "--paralelo", "3", "--base", base], {
      env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { stdout += c; });
    proc.stderr.on("data", (c) => { stderr += c; if (aoStderr) aoStderr(stderr); });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function eventosDe(stderr) {
  return stderr.split("\n").map(lerEvento).filter(Boolean);
}

function resumoJson(stdout) {
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

const REDES_FALSAS = [
  { nome: "ComPdf", slug: "compdf", pdf: true },
  { nome: "SoImagens", slug: "soimagens", pdf: false },
  { nome: "Quebrada", slug: "quebrada", falhar: true },
];

test("eventos por rede chegam no stderr com rede, conversão e falha sanitizada", async () => {
  const { root, arquivo } = await montarRegistro(REDES_FALSAS);
  const base = path.join(root, "base");
  const { code, stdout, stderr } = await rodarBaixarTodos(arquivo, base);

  assert.equal(code, 1, "falha parcial continua saindo com 1");
  assert.equal(stdout.includes("@@mmb-evento"), false, "eventos nunca vão para o stdout");
  const json = resumoJson(stdout);
  assert.deepEqual(json.redes.map((r) => [r.rede, r.ok]), [["compdf", true], ["soimagens", true], ["quebrada", false]]);

  const eventos = eventosDe(stderr);
  const de = (slug) => eventos.filter((e) => e.rede === slug).map((e) => e.evento);
  assert.deepEqual(de("compdf"), ["download_iniciado", "conversao_iniciada", "conversao_ok", "download_ok"]);
  assert.deepEqual(de("soimagens"), ["download_iniciado", "download_ok"]);
  assert.deepEqual(de("quebrada"), ["download_iniciado", "download_falhou"]);

  for (const e of eventos) {
    if (e.evento === "download_iniciado") assert.ok(e.espera_ms >= 0);
    if (e.evento !== "download_iniciado" && e.evento !== "conversao_iniciada") assert.ok(e.ms >= 0);
  }
  const convOk = eventos.find((e) => e.rede === "compdf" && e.evento === "conversao_ok");
  const dlOk = eventos.find((e) => e.rede === "compdf" && e.evento === "download_ok");
  // 2 páginas de 15 ms; com F4 podem rodar juntas (tempo de parede >= 15 ms).
  assert.ok(convOk.ms >= 12 && convOk.ms <= dlOk.ms, `conversao ${convOk.ms} vs download ${dlOk.ms}`);

  // O texto bruto do filho continua no bloco do stdout (como antes), mas
  // nenhum evento carrega URL ou o token sentinela.
  const linhasEvento = stderr.split("\n").filter((l) => l.startsWith("@@mmb-evento"));
  assert.equal(linhasEvento.join("\n").includes(SENTINELA), false);
  assert.equal(/https?:\/\//.test(linhasEvento.join("\n")), false);

  await fs.rm(root, { recursive: true, force: true });
});

test("sem MMB_EVENTOS o stderr não tem eventos e o resultado estruturado é o mesmo", async () => {
  const { root, arquivo } = await montarRegistro(REDES_FALSAS);
  const comEventos = await rodarBaixarTodos(arquivo, path.join(root, "a"));
  const semEventos = await rodarBaixarTodos(arquivo, path.join(root, "b"), { eventos: false });

  assert.equal(semEventos.stderr.includes("@@mmb-evento"), false);
  assert.equal(comEventos.code, semEventos.code);
  const normalizar = (json, base) => JSON.stringify(json).split(base).join("<base>");
  assert.equal(
    normalizar(resumoJson(comEventos.stdout), path.join(root, "a")),
    normalizar(resumoJson(semEventos.stdout), path.join(root, "b")),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("progresso da conversão chega antes de o filho lento terminar", async () => {
  const root0 = await fs.mkdtemp(path.join(os.tmpdir(), "baixar-todos-lento-"));
  const liberar = path.join(root0, "liberar");
  const { root, arquivo } = await montarRegistro([
    { nome: "Lenta", slug: "lenta", pdf: true, liberarArquivo: liberar },
  ]);
  let viuAntes = false;
  const resultado = await rodarBaixarTodos(arquivo, path.join(root, "base"), {
    aoStderr: (stderr) => {
      // O filho só termina depois que a liberação existir; se o progresso
      // estivesse retido até o fim, isto nunca aconteceria.
      if (!viuAntes && eventosDe(stderr).some((e) => e.rede === "lenta" && e.evento === "conversao_iniciada")) {
        viuAntes = !fsSync.existsSync(liberar);
        fsSync.writeFileSync(liberar, "ok");
      }
    },
  });
  assert.equal(viuAntes, true, "conversao_iniciada deveria chegar com o filho ainda rodando");
  assert.equal(resultado.code, 0);
  assert.ok(eventosDe(resultado.stderr).some((e) => e.rede === "lenta" && e.evento === "download_ok"));
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(root0, { recursive: true, force: true });
});

test("sanitizarErro remove URL, credencial e quebras de linha", () => {
  const texto = sanitizarErro(`falhou\nem https://x.test/a?token=${SENTINELA}\nAuthorization: Bearer abc`);
  assert.equal(texto.includes(SENTINELA), false);
  assert.equal(texto.includes("https://"), false);
  assert.equal(texto.includes("\n"), false);
  assert.equal(texto.includes("abc"), false);
});

// ─── F2: resultado de cada rede disponível ao pai assim que ela termina ──────

test("download_ok leva a pasta da rede antes de a rede lenta terminar, igual ao JSON final", async () => {
  const root0 = await fs.mkdtemp(path.join(os.tmpdir(), "baixar-todos-f2-"));
  const liberar = path.join(root0, "liberar");
  const { root, arquivo } = await montarRegistro([
    { nome: "Lenta", slug: "lenta", pdf: true, liberarArquivo: liberar },
    { nome: "Rapida", slug: "rapida", pdf: false },
    { nome: "Quebrada", slug: "quebrada", falhar: true },
  ]);
  let pastaAntes = null;
  const resultado = await rodarBaixarTodos(arquivo, path.join(root, "base"), {
    aoStderr: (stderr) => {
      if (pastaAntes !== null) return;
      const ok = eventosDe(stderr).find((e) => e.rede === "rapida" && e.evento === "download_ok");
      if (!ok) return;
      // A lenta só termina depois de `liberar`: o evento chegou com ela rodando.
      pastaAntes = fsSync.existsSync(liberar) ? false : ok.pasta_download;
      fsSync.writeFileSync(liberar, "ok");
    },
  });
  assert.equal(resultado.code, 1);
  assert.ok(typeof pastaAntes === "string" && pastaAntes.length > 0, "pasta da rápida deveria chegar antes da lenta terminar");

  const json = resumoJson(resultado.stdout);
  assert.deepEqual(json.redes.map((r) => r.rede), ["lenta", "rapida", "quebrada"], "JSON final na ordem de configuração");
  const final = Object.fromEntries(json.redes.map((r) => [r.rede, r]));
  assert.equal(pastaAntes, final.rapida.pasta_download);

  const eventos = eventosDe(resultado.stderr);
  const lentaOk = eventos.find((e) => e.rede === "lenta" && e.evento === "download_ok");
  assert.equal(lentaOk.pasta_download, final.lenta.pasta_download);
  const falhou = eventos.find((e) => e.rede === "quebrada" && e.evento === "download_falhou");
  assert.equal("pasta_download" in falhou, false, "falha nunca leva pasta");
  assert.equal(resultado.stderr.includes(SENTINELA), false);

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(root0, { recursive: true, force: true });
});

test("evento só aceita pasta local em download_ok", () => {
  const { formatarEvento } = require("../lib/eventos");
  const ok = lerEvento(formatarEvento({ rede: "x", evento: "download_ok", ms: 1, pasta_download: "/tmp/Encartes/X/11-Outubro" }));
  assert.equal(ok.pasta_download, "/tmp/Encartes/X/11-Outubro");
  const url = lerEvento(formatarEvento({ rede: "x", evento: "download_ok", ms: 1, pasta_download: `https://x.test/?t=${SENTINELA}` }));
  assert.equal("pasta_download" in url, false);
  const controle = lerEvento(formatarEvento({ rede: "x", evento: "download_ok", ms: 1, pasta_download: "/tmp/a\nb" }));
  assert.equal("pasta_download" in controle, false);
  const falha = lerEvento(formatarEvento({ rede: "x", evento: "download_falhou", erro: "e", pasta_download: "/tmp/a" }));
  assert.equal("pasta_download" in falha, false);
});

// ─── F1: --paralelo validado e encaminhado ao pool existente ─────────────────
// Redes falsas mínimas: dormem o tempo pedido, gravam início/fim num log e
// devolvem a linha Destino. Sem rede real e sem poppler/Chromium.

function scriptRedeLenta({ nome, ms, log, marcador = null }) {
  return `"use strict";
const fs = require("fs");
const path = require("path");
const log = ${JSON.stringify(log)};
const marcador = ${JSON.stringify(marcador)};
if (marcador) fs.writeFileSync(marcador, "rodou");
fs.appendFileSync(log, JSON.stringify({ rede: ${JSON.stringify(nome)}, evento: "inicio", t: Date.now() }) + "\\n");
setTimeout(() => {
  const base = process.argv[process.argv.indexOf("--base") + 1];
  const pasta = path.join(base, ${JSON.stringify(nome)}, "11-Outubro");
  fs.mkdirSync(path.join(pasta, "JPG"), { recursive: true });
  fs.writeFileSync(path.join(pasta, "JPG", "e-pagina-01.jpg"), "jpg");
  fs.appendFileSync(log, JSON.stringify({ rede: ${JSON.stringify(nome)}, evento: "fim", t: Date.now() }) + "\\n");
  console.log("Destino: " + pasta);
}, ${Number(ms)});
`;
}

async function registroLento(redes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "baixar-todos-f1-"));
  const log = path.join(root, "pool.log");
  const registro = { root, redes: [] };
  for (const rede of redes) {
    await fs.mkdir(path.join(root, rede.slug), { recursive: true });
    await fs.writeFile(path.join(root, rede.slug, "rede.js"), scriptRedeLenta({ ...rede, log }));
    registro.redes.push({
      nome: rede.nome, slug: rede.slug, pasta: rede.slug, script: "rede.js",
      flags: [], deps: { poppler: false, playwright: false },
    });
  }
  const arquivo = path.join(root, "redes.json");
  await fs.writeFile(arquivo, JSON.stringify(registro));
  return { root, arquivo, log };
}

function rodarComParalelo(arquivo, base, paralelo) {
  return new Promise((resolve) => {
    const env = { ...process.env, MMB_REDES_JSON: arquivo };
    delete env.MMB_EVENTOS;
    const argumentos = [BAIXAR_TODOS, "--json", "--base", base];
    if (paralelo !== undefined) argumentos.push("--paralelo", paralelo);
    const inicio = performance.now();
    const proc = spawn(process.execPath, argumentos, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { stdout += c; });
    proc.stderr.on("data", (c) => { stderr += c; });
    proc.on("close", (code) => resolve({ code, stdout, stderr, ms: performance.now() - inicio }));
  });
}

function lerPool(log) {
  if (!fsSync.existsSync(log)) return [];
  return fsSync.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function pico(eventos) {
  const ordenados = [...eventos].sort((a, b) => a.t - b.t || (a.evento === "fim" ? -1 : 1));
  let ativos = 0;
  let maior = 0;
  for (const e of ordenados) {
    ativos += e.evento === "inicio" ? 1 : -1;
    maior = Math.max(maior, ativos);
  }
  return maior;
}

test("lerConcorrencia aceita só inteiro positivo", () => {
  const { lerConcorrencia } = require("./baixar-todos");
  assert.equal(lerConcorrencia("1"), 1);
  assert.equal(lerConcorrencia("4"), 4);
  assert.equal(lerConcorrencia("12"), 12);
  for (const invalido of ["0", "-1", "1.5", "abc", "", " 3", "3 ", "1e1", "0x4", "03", "Infinity", undefined, "99999999999999999999"]) {
    assert.throws(() => lerConcorrencia(invalido), /inteiro positivo/, `deveria rejeitar ${JSON.stringify(invalido)}`);
  }
});

test("--paralelo inválido falha antes de iniciar qualquer rede", async () => {
  const root0 = await fs.mkdtemp(path.join(os.tmpdir(), "baixar-todos-f1-invalido-"));
  const marcador = path.join(root0, "rodou");
  const { root, arquivo, log } = await registroLento([{ nome: "Cometa", slug: "cometa", ms: 10, marcador }]);
  for (const invalido of ["0", "-1", "1.5", "abc", ""]) {
    const r = await rodarComParalelo(arquivo, path.join(root, "base"), invalido);
    assert.equal(r.code, 1, `--paralelo ${invalido}`);
    assert.match(r.stderr, /--paralelo espera um inteiro positivo/);
    assert.equal(fsSync.existsSync(marcador), false, `--paralelo ${invalido} não pode rodar rede`);
    assert.deepEqual(lerPool(log), []);
    // O resultado estruturado continua completo para o pai.
    assert.deepEqual(resumoJson(r.stdout).redes.map((x) => [x.rede, x.ok]), [["cometa", false]]);
  }
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(root0, { recursive: true, force: true });
});

test("--paralelo 4 roda quatro redes juntas; 3 continua no máximo três; ordem fixa", async () => {
  // Durações diferentes fazem a ordem de término diferir da de configuração.
  const redes = [
    { nome: "Cometa", slug: "cometa", ms: 1500 },
    { nome: "SaoLuiz", slug: "saoluiz", ms: 900 },
    { nome: "MercadaoSaoLuiz", slug: "mercadao", ms: 1200 },
    { nome: "SuperDoPovo", slug: "superdopovo", ms: 600 },
  ];
  const quatro = await registroLento(redes);
  const r4 = await rodarComParalelo(quatro.arquivo, path.join(quatro.root, "base"), "4");
  assert.equal(r4.code, 0, r4.stderr);
  const eventos4 = lerPool(quatro.log);
  assert.equal(pico(eventos4), 4);
  assert.ok(r4.ms < 1500 * 1.5, `quatro redes em paralelo levaram ${Math.round(r4.ms)} ms`);
  const termino = eventos4.filter((e) => e.evento === "fim").sort((a, b) => a.t - b.t).map((e) => e.rede);
  assert.notDeepEqual(termino, redes.map((r) => r.nome));

  const tres = await registroLento(redes);
  const r3 = await rodarComParalelo(tres.arquivo, path.join(tres.root, "base"), "3");
  assert.equal(r3.code, 0, r3.stderr);
  assert.equal(pico(lerPool(tres.log)), 3, "padrão do enviar-todos (3) não muda");

  const ordem = redes.map((r) => r.slug);
  assert.deepEqual(resumoJson(r4.stdout).redes.map((r) => r.rede), ordem);
  assert.deepEqual(resumoJson(r3.stdout).redes.map((r) => r.rede), ordem);
  const normalizar = (stdout, root) => JSON.stringify(resumoJson(stdout)).split(root).join("<root>");
  assert.equal(normalizar(r4.stdout, quatro.root), normalizar(r3.stdout, tres.root));

  await fs.rm(quatro.root, { recursive: true, force: true });
  await fs.rm(tres.root, { recursive: true, force: true });
});

test("sem --paralelo o baixar-todos continua sequencial", async () => {
  const { root, arquivo, log } = await registroLento([
    { nome: "Cometa", slug: "cometa", ms: 100 },
    { nome: "SaoLuiz", slug: "saoluiz", ms: 100 },
  ]);
  const r = await rodarComParalelo(arquivo, path.join(root, "base"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(pico(lerPool(log)), 1);
  await fs.rm(root, { recursive: true, force: true });
});

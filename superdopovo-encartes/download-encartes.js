#!/usr/bin/env node

// Skill Super do Povo: espera a resposta da API de booklets via Playwright
// (o site nunca fica em networkidle por causa dos pixels de analytics) e
// devolve cada encarte como PDF (rasteriza e descarta) ou como folhas
// soltas em imagem, conforme o payload trouxer.
//
// Reserva: toda descoberta pela API grava o payload bruto em fonte.json na
// pasta da rodada. Se a API não responder nas duas tentativas, usa o fonte.json
// mais recente com até 7 dias, só com encartes ainda vigentes (as páginas são
// públicas no GCS e não dependem da API).

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { baixarEncartes, dateFolderName, parsearArgs, todayISO, vigenciaSlug } = require("../lib/pipeline");
const log = require("../lib/log-requisicoes");

const BOOKLETS_URL = "https://loja.superdopovo.com.br/booklets";
const API_PATH = "/api/v1/booklets"; // shop id 24 vai embutido na URL, ex: /api/v1/booklets/24

// A API só responde depois que o JS do site obtém o JWT; com muitas redes
// baixando em paralelo isso passou de 30 s (12/11/2026). Tenta duas vezes,
// cada uma com navegador novo e 90 s de espera.
const TENTATIVAS_PAYLOAD = 2;
const ESPERA_API_MS = 90000;

const REDE = "SuperDoPovo";
const ARQUIVO_FONTE = "fonte.json";
const VALIDADE_RESERVA_MS = 7 * 24 * 60 * 60 * 1000;

async function lerBookletsPayloadUmaVez(tentativa = 1) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes(API_PATH),
      { timeout: ESPERA_API_MS }
    );
    responsePromise.catch(() => {}); // evita rejeição solta se o goto falhar antes
    const inicio = performance.now();
    const resposta = await page.goto(BOOKLETS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    log.registrar({ etapa: "descoberta", url: BOOKLETS_URL, status: resposta?.status() ?? null, ms: performance.now() - inicio, tentativa });
    const res = await responsePromise;
    const corpo = await res.body();
    // Status, bytes e ms (desde o goto) da resposta da API de encartes.
    log.registrar({ etapa: "descoberta", url: res.url(), status: res.status(), bytes: corpo.length, ms: performance.now() - inicio, tentativa });
    return JSON.parse(corpo.toString("utf8"));
  } finally {
    await browser.close();
  }
}

async function fetchBookletsPayload() {
  let ultimoErro;
  for (let i = 1; i <= TENTATIVAS_PAYLOAD; i++) {
    try {
      return await lerBookletsPayloadUmaVez(i);
    } catch (error) {
      ultimoErro = error;
      log.registrar({ etapa: "descoberta", url: BOOKLETS_URL, tentativa: i, erro: error.message.split("\n")[0] });
      if (i < TENTATIVAS_PAYLOAD) console.error(`superdopovo: tentativa ${i} falhou (${error.message.split("\n")[0]}); tentando de novo`);
    }
  }
  throw ultimoErro;
}

function folhasDoEncarte(encarte) {
  const sheets = Array.isArray(encarte?.sheets)
    ? encarte.sheets.map((sheet) => sheet?.link).filter(Boolean)
    : [];
  if (sheets.length > 0) return sheets;

  const links = Array.isArray(encarte?.links) ? encarte.links.filter(Boolean) : [];
  if (links.length > 0) return links;

  return encarte?.link ? [encarte.link] : [];
}

function pastaDaRodada(args, agora) {
  return args.output ?? path.join(args.base, REDE, dateFolderName(agora));
}

// Grava o payload bruto da API; falha de escrita não derruba a coleta.
async function gravarFonte(destino, payload) {
  try {
    await fs.mkdir(destino, { recursive: true });
    await fs.writeFile(path.join(destino, ARQUIVO_FONTE), JSON.stringify(payload));
  } catch (erro) {
    console.error(`superdopovo: não consegui gravar ${ARQUIVO_FONTE} (${erro.message})`);
  }
}

// fonte.json mais recente (por mtime) entre as pastas datadas da rede, com até
// 7 dias. Devolve { payload, pasta } ou null.
async function lerReserva(args, agora) {
  const redeDir = path.join(args.base, REDE);
  let pastas;
  try {
    pastas = await fs.readdir(redeDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidatas = [];
  for (const entrada of pastas) {
    if (!entrada.isDirectory()) continue;
    try {
      const caminho = path.join(redeDir, entrada.name, ARQUIVO_FONTE);
      const { mtimeMs } = await fs.stat(caminho);
      if (agora.getTime() - mtimeMs > VALIDADE_RESERVA_MS) continue;
      candidatas.push({ caminho, pasta: entrada.name, mtimeMs });
    } catch { /* pasta sem fonte.json */ }
  }
  candidatas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { caminho, pasta } of candidatas) {
    try {
      const payload = JSON.parse(await fs.readFile(caminho, "utf8"));
      if (Array.isArray(payload)) return { payload, pasta };
    } catch { /* ilegível: tenta a próxima */ }
  }
  return null;
}

// deps é seam para testes: agora (relógio) e lerPayload (a API).
async function descobrir(args, { agora = new Date(), lerPayload = fetchBookletsPayload } = {}) {
  let payload;
  let fonteDescoberta = "api";
  try {
    payload = await lerPayload();
    if (Array.isArray(payload)) await gravarFonte(pastaDaRodada(args, agora), payload);
  } catch (erroApi) {
    const reserva = await lerReserva(args, agora);
    // Encarte vencido nunca é reaproveitado, nem com --all.
    const hoje = todayISO(agora);
    const vigentes = reserva ? reserva.payload.filter((e) => e.end >= hoje) : [];
    if (vigentes.length === 0) {
      console.error(`superdopovo: API falhou e não há reserva vigente em ${ARQUIVO_FONTE} (até 7 dias)`);
      throw erroApi;
    }
    fonteDescoberta = `reserva:${reserva.pasta}`;
    const motivo = erroApi.message.split("\n")[0];
    console.error(`superdopovo: API falhou (${motivo}); usando ${fonteDescoberta} com ${vigentes.length} encarte(s) vigente(s)`);
    log.registrar({ etapa: "descoberta", url: BOOKLETS_URL, erro: `${fonteDescoberta}: API falhou (${motivo})` });
    payload = vigentes;
  }
  if (!Array.isArray(payload)) return [];

  let encartes = payload;

  if (!args.all) {
    const hoje = todayISO(agora);
    encartes = encartes.filter((e) => e.end >= hoje);
  }

  if (args.onlyNewest && encartes.length > 0) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  return encartes.flatMap((e) => {
    const vigencia = { de: e.start, ate: e.end };
    const slug = `${e.id}-${vigenciaSlug(e.start, e.end)}`;

    if (e.pdf) {
      return [{
        slug,
        pdf: { url: e.pdf },
        meta: { id: e.id, name: e.name, vigencia, fonte: "pdf", fonte_descoberta: fonteDescoberta },
      }];
    }

    const folhas = folhasDoEncarte(e);

    if (folhas.length === 0) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem PDF e sem páginas — ignorado.`);
      return [];
    }

    return [{
      slug,
      paginas: folhas.map((url) => ({ url })),
      meta: { id: e.id, name: e.name, vigencia, fonte: "sheets", fonte_descoberta: fonteDescoberta },
    }];
  });
}

function ajuda() {
  return `
Uso:
  node superdopovo-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização do PDF. Padrão: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte com maior id (útil para teste)
  --all           Inclui encartes já vencidos (padrão: só vigentes + futuros)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/SuperDoPovo/DD-Mês/JPG/<id>-<vigencia>-pagina-NN.jpg
  <base>/SuperDoPovo/DD-Mês/manifest.json
  <base>/SuperDoPovo/DD-Mês/fonte.json         payload bruto da API (reserva por até 7 dias)
  <base>/SuperDoPovo/DD-Mês/downloads.jsonl    uma linha por requisição (log local)

Requer: poppler (brew install poppler) e npm install (playwright) na pasta da ferramenta
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["dpi", "only-newest", "sem-reuso", "all"], ajuda });
  await baixarEncartes({ rede: REDE, source: BOOKLETS_URL, descobrir, args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, folhasDoEncarte, lerReserva };

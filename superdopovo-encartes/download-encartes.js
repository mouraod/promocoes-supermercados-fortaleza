#!/usr/bin/env node

// Skill Super do Povo: espera a resposta da API de booklets via Playwright
// (o site nunca fica em networkidle por causa dos pixels de analytics) e
// devolve cada encarte como PDF (rasteriza e descarta) ou como folhas
// soltas em imagem, conforme o payload trouxer.

const { chromium } = require("playwright");
const { baixarEncartes, parsearArgs, todayISO, vigenciaSlug } = require("../lib/pipeline");

const BOOKLETS_URL = "https://loja.superdopovo.com.br/booklets";
const API_PATH = "/api/v1/booklets"; // shop id 24 vai embutido na URL, ex: /api/v1/booklets/24

async function fetchBookletsPayload() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes(API_PATH),
    { timeout: 30000 }
  );

  await page.goto(BOOKLETS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  let payload = null;
  try {
    const res = await responsePromise;
    payload = await res.json();
  } finally {
    await browser.close();
  }

  return payload;
}

async function descobrir(args) {
  const payload = await fetchBookletsPayload();
  if (!Array.isArray(payload)) return [];

  let encartes = payload;

  if (!args.all) {
    const hoje = todayISO();
    encartes = encartes.filter((e) => e.end >= hoje);
  }

  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  return encartes.flatMap((e) => {
    const vigencia = { de: e.start, ate: e.end };
    const slug = `${e.id}-${vigenciaSlug(e.start, e.end)}`;

    if (e.pdf) {
      return [{
        slug,
        pdf: { url: e.pdf },
        meta: { id: e.id, name: e.name, vigencia, fonte: "pdf" },
      }];
    }

    const sheets = Array.isArray(e.sheets) && e.sheets.length > 0
      ? e.sheets.map((s) => s.link)
      : (Array.isArray(e.links) ? e.links : []);

    if (sheets.length === 0) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem PDF e sem páginas — ignorado.`);
      return [];
    }

    return [{
      slug,
      paginas: sheets.map((url) => ({ url })),
      meta: { id: e.id, name: e.name, vigencia, fonte: "sheets" },
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

Requer: poppler (brew install poppler) e npm install (playwright) na pasta da ferramenta
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["dpi", "only-newest", "sem-reuso", "all"], ajuda });
  await baixarEncartes({ rede: "SuperDoPovo", source: BOOKLETS_URL, descobrir, args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir };

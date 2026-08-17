#!/usr/bin/env node

// Skill Guará: lê os cards de folhetos do DOM via Playwright e descobre as
// URLs das páginas sondando o padrão -1.webp, -2.webp, ... O resto
// (download, reuso, manifest) é com o pipeline.

const { chromium } = require("playwright");
const { baixarEncartes, parsearArgs, slugify } = require("../lib/pipeline");

const FOLHETOS_URL = "https://supermercadoguara.com.br/folhetos";
const MAX_PAGINAS_POR_ENCARTE = 50;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function probePageCount(capaUrl) {
  const match = capaUrl.match(/^(.+)-1(\.webp)$/);
  if (!match) return 1;

  const [, stem, ext] = match;
  let count = 1;
  for (let p = 2; p <= MAX_PAGINAS_POR_ENCARTE; p += 1) {
    const url = `${stem}-${p}${ext}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Range: "bytes=0-0" },
      });
      if (res.ok || res.status === 206) {
        count = p;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return count;
}

function pageUrl(capaUrl, page) {
  const match = capaUrl.match(/^(.+)-1(\.webp)$/);
  if (!match) return capaUrl;
  const [, stem, ext] = match;
  return `${stem}-${page}${ext}`;
}

async function fetchEncartesDoDOM() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(FOLHETOS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".card-folheto img[src]", { state: "attached", timeout: 30000 });

  const encartes = await page.evaluate(() => {
    const cards = document.querySelectorAll(".card-folheto");
    return Array.from(cards).map((card) => {
      const titulo = card.querySelector(".titulo")?.textContent?.trim() || "";
      const subtitulo = card.querySelector(".subtitulo")?.textContent?.trim() || "";
      const img = card.querySelector(".imagem-capa img");
      const capaUrl = img?.src || "";
      return { titulo, subtitulo, capaUrl };
    }).filter((e) => e.capaUrl);
  });

  await browser.close();
  return encartes;
}

async function descobrir(args) {
  let encartesDoDOM = await fetchEncartesDoDOM();
  if (args.onlyNewest) encartesDoDOM = encartesDoDOM.slice(0, 1);

  const saida = [];
  for (const e of encartesDoDOM) {
    const numPaginas = await probePageCount(e.capaUrl);
    const urls = [];
    for (let p = 1; p <= numPaginas; p += 1) {
      urls.push(pageUrl(e.capaUrl, p));
    }
    saida.push({
      slug: slugify(e.titulo),
      paginas: urls.map((url) => ({ url })),
      meta: { titulo: e.titulo, subtitulo: e.subtitulo, urls },
    });
  }
  return saida;
}

function ajuda() {
  return `
Uso:
  node guara-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --only-newest   Baixa apenas o encarte mais recente (útil para teste)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/Guara/DD-Mês/JPG/<slug>-pagina-NN.webp
  <base>/Guara/DD-Mês/manifest.json

Requer: npm install playwright (na pasta da ferramenta)
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["only-newest", "sem-reuso"], ajuda });
  await baixarEncartes({ rede: "Guara", source: FOLHETOS_URL, descobrir, args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir };

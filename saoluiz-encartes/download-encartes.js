#!/usr/bin/env node

// Skill São Luiz: descobre os encartes interceptando o payload de flipbooks
// que o site da loja carrega, e deixa o pipeline cuidar de download, pastas,
// reuso e manifest.

const { chromium } = require("playwright");
const { baixarEncartes, parsearArgs, slugify } = require("../lib/pipeline");

const STORE_URL = "https://mercadinhossaoluiz.com.br/loja/355/encartes";

async function descobrir(args) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let flipbooksPayload = null;
  page.on("response", async (res) => {
    if (res.url().includes("/flipbooks") && !flipbooksPayload) {
      try { flipbooksPayload = await res.json(); } catch { /* ignorar */ }
    }
  });

  await page.goto(STORE_URL, { waitUntil: "networkidle", timeout: 60000 });
  await browser.close();

  if (!flipbooksPayload || !Array.isArray(flipbooksPayload.flipbooks)) return [];

  let encartes = flipbooksPayload.flipbooks;
  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  return encartes.flatMap((e) => {
    const urls = Array.isArray(e.images_urls) ? e.images_urls : [];
    if (urls.length === 0) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem imagens — ignorado.`);
      return [];
    }
    return [{
      slug: slugify(`${e.id}-${e.name}`),
      paginas: urls.map((url) => ({ url })),
      meta: { id: e.id, name: e.name, urls },
    }];
  });
}

function ajuda() {
  return `
Uso:
  node saoluiz-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --only-newest   Baixa apenas o encarte com maior id (útil para teste)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/SaoLuiz/DD-Mês/JPG/<slug>-pagina-NN.jpg
  <base>/SaoLuiz/DD-Mês/manifest.json

Requer: npm install playwright (na pasta da ferramenta)
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["only-newest", "sem-reuso"], ajuda });
  await baixarEncartes({ rede: "SaoLuiz", source: STORE_URL, descobrir, args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir };

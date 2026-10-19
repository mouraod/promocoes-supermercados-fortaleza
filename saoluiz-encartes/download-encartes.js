#!/usr/bin/env node

// Skill São Luiz: descobre os encartes interceptando o payload de flipbooks
// que o site da loja carrega, e deixa o pipeline cuidar de download, pastas,
// reuso e manifest.

const path = require("node:path");
const { chromium } = require("playwright");
const { baixarEncartes, dateFolderName, parsearArgs, slugify } = require("../lib/pipeline");
const { gravarListaDeOfertas, montarDados, normalizar } = require("../lib/ofertas-lista");
const { coletar, LOJA, URL_LOJA } = require("./ofertas");

const STORE_URL = "https://mercadinhossaoluiz.com.br/loja/355/encartes";

// A plataforma zera os flipbooks entre a semana que acabou e a que vai começar.
// Nesse estado não há imagem para baixar, mas a página /ofertas continua
// publicando a lista com preço e validade: isso é o fallback de baixarLista.
let flipbooksVazios = false;

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

  if (!flipbooksPayload || !Array.isArray(flipbooksPayload.flipbooks)) {
    throw new Error(`Payload de /flipbooks não interceptado em ${STORE_URL}.`);
  }
  if (flipbooksPayload.flipbooks.length === 0) {
    flipbooksVazios = true;
    return [];
  }

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

/** Sem encarte em imagem, a rodada vira uma pasta só com a lista de ofertas da
 *  loja: mesmo layout (ofertas.json + manifest.json com 0 páginas), então o
 *  orquestrador trata igual e o envio usa a rota sem página. */
async function baixarLista(args, agora = new Date()) {
  const ofertas = normalizar(await coletar());
  if (ofertas.length === 0) {
    throw new Error("Loja sem encartes em imagem e sem ofertas na lista: nada para baixar.");
  }
  const destino = args.output ?? path.join(args.base, "SaoLuiz", dateFolderName(agora));
  const { destino: pasta } = await gravarListaDeOfertas({
    destino,
    dados: montarDados({ ofertas, rede: "saoluiz", loja: LOJA, source: URL_LOJA }),
    manifest: { rede: "SaoLuiz", mercado: "saoluiz", cidade: "fortaleza-ce", source: URL_LOJA },
    agora,
  });

  console.log(`SaoLuiz | ${dateFolderName(agora)}`);
  console.log(`Encartes: 0 | Páginas: 0 | Ofertas: ${ofertas.length} (lista da loja, sem imagem)`);
  console.log(`Destino: ${pasta}`);
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["only-newest", "sem-reuso"], ajuda });
  flipbooksVazios = false;
  try {
    await baixarEncartes({ rede: "SaoLuiz", source: STORE_URL, descobrir, args });
  } catch (erro) {
    if (!flipbooksVazios) throw erro;
    console.error("[saoluiz] sem encartes em imagem: caindo na lista de ofertas da loja");
    await baixarLista(args);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, baixarLista };

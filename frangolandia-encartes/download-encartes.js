#!/usr/bin/env node

// Skill Frangolandia: lê o HTML da listagem de encartes e de cada página de
// encarte (WordPress + Elementor), e devolve as imagens da galeria para o
// pipeline baixar. Sem Playwright, sem npm install, sem poppler.
// O botão "Download" (PDF) é ignorado: a galeria já tem todas as páginas em JPG.

const { baixarEncartes, parsearArgs, slugify } = require("../lib/pipeline");

const LISTAGEM = "https://frangolandia.com/encartes/";
const HOST = "frangolandia.com";

async function baixarHtml(url) {
  const resposta = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });
  if (!resposta.ok) throw new Error(`Falha ${resposta.status} em ${url}`);
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.includes("text/html")) throw new Error(`${url}: resposta não é HTML (${tipo || "sem tipo"})`);
  return resposta.text();
}

// ─── parsers puros (testados em download-encartes.test.js) ────────────────────

function extrairLinksEncarte(html) {
  const vistos = new Set();
  const contagem = new Map();
  const encartes = [];
  for (const [, url, slugCodificado] of html.matchAll(
    /href="(https:\/\/frangolandia\.com\/encarte\/([^"/]+)\/)"/g
  )) {
    if (vistos.has(url)) continue;
    vistos.add(url);

    // slugify descarta emoji, então "horti-🍅" e "horti-🍓" colidiriam em
    // "horti"; numera a partir da segunda ocorrência pra não mesclar páginas.
    let slug = slugify(decodeURIComponent(slugCodificado));
    const n = (contagem.get(slug) ?? 0) + 1;
    contagem.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;

    encartes.push({ url, slug });
  }
  return encartes;
}

function extrairGaleria(html) {
  return [...html.matchAll(/<a[^>]*class="[^"]*e-gallery-item[^"]*"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => /^https:\/\/frangolandia\.com\/wp-content\/uploads\/.+\.(jpe?g|png|webp)(\?|$)/i.test(url));
}

// ─── adapter para o pipeline ──────────────────────────────────────────────────

async function descobrir() {
  const encartes = extrairLinksEncarte(await baixarHtml(LISTAGEM));
  if (encartes.length === 0) {
    throw new Error(`Nenhum encarte listado em ${LISTAGEM}. O HTML pode ter mudado.`);
  }

  const paginas = await Promise.all(encartes.map((e) => baixarHtml(e.url)));
  return encartes.flatMap((encarte, indice) => {
    const imagens = extrairGaleria(paginas[indice]);
    if (imagens.length === 0) {
      console.warn(`  [aviso] ${encarte.slug} sem galeria de imagens — ignorado.`);
      return [];
    }
    return [{
      slug: encarte.slug,
      paginas: imagens.map((url) => ({ url })),
      meta: { url: encarte.url, imagens },
    }];
  });
}

function ajuda() {
  return `
Uso:
  node frangolandia-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/Frangolandia/DD-Mês/JPG/<slug>-pagina-NN.jpg
  <base>/Frangolandia/DD-Mês/manifest.json
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["sem-reuso"], ajuda });
  await baixarEncartes({
    rede: "Frangolandia",
    source: LISTAGEM,
    descobrir,
    args,
    hostsPermitidos: [HOST],
    concorrencia: 4,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, extrairGaleria, extrairLinksEncarte };

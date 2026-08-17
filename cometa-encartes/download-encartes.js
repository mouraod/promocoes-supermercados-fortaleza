#!/usr/bin/env node

// Skill Cometa: lê a API de encartes do site e devolve PDFs para o pipeline
// baixar, rasterizar (poppler) e manter em PDF/.

const { baixarEncartes, parsearArgs, slugify } = require("../lib/pipeline");

const API = "https://cometasupermercados.com.br/api/encartes";
const IMG_BASE = "https://adminx.cometasupermercados.com.br";

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function descobrir(args) {
  const { data } = await fetchJson(API);
  let encartes = Array.isArray(data) ? data : [];

  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  return encartes.flatMap((e) => {
    const pdfRel = e.pdf?.url;
    if (!pdfRel) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem PDF — ignorado.`);
      return [];
    }
    return [{
      slug: slugify(`${e.id}-${e.name}`),
      pdf: {
        url: /^https?:\/\//.test(pdfRel) ? pdfRel : IMG_BASE + pdfRel,
        manter: true,
      },
      meta: {
        id: e.id,
        name: e.name,
        descricao: e.description || "",
        validade: { de: e.createdAt || null, ate: e.updatedAt || null },
      },
    }];
  });
}

function ajuda() {
  return `
Uso:
  node cometa-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização. Padrão: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte com maior id (útil para teste)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/Cometa/DD-Mês/PDF/<slug>.pdf
  <base>/Cometa/DD-Mês/JPG/<slug>-pagina-NN.jpg

Requer poppler: brew install poppler
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["dpi", "only-newest", "sem-reuso"], ajuda });
  await baixarEncartes({ rede: "Cometa", source: API, descobrir, args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir };

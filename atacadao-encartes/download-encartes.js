#!/usr/bin/env node

// Skill Atacadão: raspa o __NEXT_DATA__ da página da loja e devolve os
// flyers vigentes como PDFs para o pipeline (manter em PDF/ + rasterizar).

const { baixarEncartes, parsearArgs, slugify, todayISO, vigenciaSlug } = require("../lib/pipeline");

const LOJA_BASE = "https://www.atacadao.com.br/loja";

const LOJAS_FORTALEZA = [
  "fortaleza-barra-do-ceara",
  "fortaleza-br-116",
  "fortaleza-aeroporto",
  "fortaleza-fatima",
  "fortaleza-maraponga-24hrs",
  "fortaleza-vila-peri",
  "fortaleza-osorio",
];

async function fetchFlyers(slug) {
  const url = `${LOJA_BASE}/${slug}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }

  const html = await response.text();

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error(`__NEXT_DATA__ não encontrado no HTML de ${url}`);
  }

  const nextData = JSON.parse(nextDataMatch[1]);
  const storeInfo = nextData?.props?.pageProps?.storeInfo;
  if (!storeInfo || !Array.isArray(storeInfo.flyers)) {
    throw new Error(`Estrutura de flyers não encontrada no __NEXT_DATA__ de ${url}`);
  }

  const hoje = todayISO();
  return storeInfo.flyers.filter((f) => {
    if (f.exclude === true) return false;
    if (!f.validity?.initial || !f.validity?.final) return false;
    return f.validity.final.slice(0, 10) >= hoje;
  });
}

async function descobrir(args) {
  const flyers = await fetchFlyers(args.loja);

  let encartes = flyers;
  if (args.onlyNewest) {
    encartes = [flyers.reduce((a, b) => (a.validity.final > b.validity.final ? a : b))];
  }

  return encartes.map((f) => {
    const name = f.name || "encarte";
    return {
      slug: `${slugify(name)}-${vigenciaSlug(f.validity.initial, f.validity.final)}`,
      pdf: { url: f.urlFinalDocument, manter: true },
      meta: {
        name,
        vigencia: {
          de: f.validity.initial.slice(0, 10),
          ate: f.validity.final.slice(0, 10),
        },
      },
    };
  });
}

function ajuda() {
  return `
Uso:
  node atacadao-encartes/download-encartes.js [opções]

Opções:
  --loja          Slug da loja. Padrão: fortaleza-aeroporto
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização. Padrão: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte mais recente (útil para teste)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Lojas Fortaleza disponíveis:
  ${LOJAS_FORTALEZA.join("\n  ")}

Saída padrão:
  <base>/Atacadao/DD-Mês/PDF/<slug>.pdf
  <base>/Atacadao/DD-Mês/JPG/<slug>-pagina-NN.jpg

Requer poppler: brew install poppler
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), {
    aceitas: ["loja", "dpi", "only-newest", "sem-reuso"],
    padroes: { loja: "fortaleza-aeroporto" },
    ajuda,
  });
  await baixarEncartes({
    rede: "Atacadao",
    source: `${LOJA_BASE}/${args.loja}`,
    descobrir,
    args,
    extra: { loja: args.loja },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, fetchFlyers };

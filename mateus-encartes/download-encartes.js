#!/usr/bin/env node

// Skill Mix Mateus: a página é só casca, o JS chama uma API JSON aberta via
// proxy. Baixa os encartes vigentes como PDFs para o pipeline (mesmo formato
// do Atacadão: manter em PDF/ + rasterizar).

const { baixarEncartes, parsearArgs, slugify, todayISO, vigenciaSlug } = require("../lib/pipeline");

const HOST = "ofertasmateus.com";
const PROXY = `https://${HOST}/api-proxy.php`;

const LOJAS_FORTALEZA = ["mix-henrique-jorge", "mix-jose-walter", "mix-messejana"];

async function listarEncartes(loja) {
  const endpoint = `/encartes/ce/fortaleza/${loja}?marca=MA`;
  const url = `${PROXY}?endpoint=${encodeURIComponent(endpoint)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.status !== "success" || !Array.isArray(data.data)) {
    throw new Error(`Resposta inesperada da API de encartes em ${url}`);
  }
  return data.data;
}

function mapearEncartes(data, hoje) {
  const encartes = [];
  for (const item of data) {
    const validade = item.validade?.slice(0, 10);
    if (!validade || validade < hoje) continue;

    const arquivo = item.arquivo;
    if (!arquivo || !arquivo.toLowerCase().endsWith(".pdf")) {
      console.warn(`  [aviso] encarte "${item.descricao}" sem PDF (${arquivo ?? "sem arquivo"}) — ignorado.`);
      continue;
    }

    encartes.push({
      slug: `${slugify(item.descricao)}-${vigenciaSlug(item.inicio, item.validade)}`,
      pdf: { url: `${PROXY}?file=${encodeURIComponent(arquivo)}`, manter: true },
      meta: {
        name: item.descricao,
        id_encarte: item.id_encarte,
        vigencia: { de: item.inicio.slice(0, 10), ate: validade },
      },
    });
  }
  return encartes;
}

async function descobrir(args) {
  const data = await listarEncartes(args.loja);
  return mapearEncartes(data, todayISO());
}

function ajuda() {
  return `
Uso:
  node mateus-encartes/download-encartes.js [opções]

Opções:
  --loja          Slug da loja. Padrão: mix-henrique-jorge
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização. Padrão: 200 (~2205x3150 px)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Lojas Fortaleza disponíveis:
  ${LOJAS_FORTALEZA.join("\n  ")}

Saída padrão:
  <base>/Mateus/DD-Mês/PDF/<slug>.pdf
  <base>/Mateus/DD-Mês/JPG/<slug>-pagina-NN.jpg

Requer poppler: brew install poppler
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), {
    aceitas: ["loja", "dpi", "sem-reuso"],
    padroes: { loja: "mix-henrique-jorge" },
    ajuda,
  });
  await baixarEncartes({
    rede: "Mateus",
    source: PROXY,
    descobrir,
    args,
    hostsPermitidos: [HOST],
    extra: { loja: args.loja },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, listarEncartes, mapearEncartes };

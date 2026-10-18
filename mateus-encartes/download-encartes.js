#!/usr/bin/env node

// Skill Mix Mateus: a página é só casca, o JS chama uma API JSON aberta via
// proxy. Baixa os encartes vigentes como PDFs para o pipeline (mesmo formato
// do Atacadão: manter em PDF/ + rasterizar).

const { baixarEncartes, parsearArgs, slugify, todayISO, vigenciaSlug } = require("../lib/pipeline");

const HOST = "ofertasmateus.com";
const PROXY = `https://${HOST}/api-proxy.php`;

const LOJAS_FORTALEZA = ["mix-henrique-jorge", "mix-jose-walter", "mix-messejana"];

async function consultar(endpoint, buscar = fetch) {
  const url = `${PROXY}?endpoint=${encodeURIComponent(endpoint)}`;
  const response = await buscar(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.status !== "success") {
    throw new Error(`Resposta inesperada da API em ${url}`);
  }
  return data.data;
}

// Cidade e marca vêm do cadastro oficial da loja; a UF não vem, por isso é
// argumento (padrão ce). Ex.: Salvador aparece como "salvador-" na API.
async function listarEncartes(loja, uf = "ce", buscar = fetch) {
  if (!/^[a-z0-9-]+$/i.test(loja)) throw new Error("Slug de loja Mateus inválido");
  if (!/^[a-z]{2}$/.test(uf)) throw new Error("--uf deve ter 2 letras minúsculas");
  const dadosLoja = await consultar(`/lojas/${loja}`, buscar);
  if (dadosLoja?.idloja !== loja || !dadosLoja.cidade || !dadosLoja.marca) {
    throw new Error(`Mateus: loja ${loja} sem cidade/marca no cadastro`);
  }
  const itens = await consultar(
    `/encartes/${uf}/${dadosLoja.cidade}/${loja}?marca=${encodeURIComponent(dadosLoja.marca)}`,
    buscar,
  );
  if (!Array.isArray(itens)) throw new Error("Mateus: lista de encartes inválida");
  return itens;
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

async function descobrir(args, { fetch: buscar = fetch } = {}) {
  const data = await listarEncartes(args.loja, args.uf ?? "ce", buscar);
  return mapearEncartes(data, todayISO());
}

function ajuda() {
  return `
Uso:
  node mateus-encartes/download-encartes.js [opções]

Opções:
  --loja          Slug da loja. Padrão: mix-henrique-jorge
  --uf            UF da loja, minúscula. Padrão: ce (ex.: ma, ba)
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
    aceitas: ["loja", "uf", "dpi", "sem-reuso"],
    padroes: { loja: "mix-henrique-jorge", uf: "ce" },
    ajuda,
  });
  await baixarEncartes({
    rede: "Mateus",
    source: PROXY,
    descobrir,
    args,
    hostsPermitidos: [HOST],
    extra: { loja: args.loja, uf: args.uf },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, listarEncartes, mapearEncartes };

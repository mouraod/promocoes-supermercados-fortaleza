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

/** Identidade que a própria página devolve; o chamador confere contra a configuração. */
function identidadeDaLoja(storeInfo) {
  return {
    storeId: storeInfo.storeId,
    slug: storeInfo.slug,
    cidade: storeInfo.cidade,
    estado: storeInfo.estado,
  };
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data de calendário real: 2026-02-30 não existe. */
function dataReal(iso) {
  if (!DATA_ISO.test(iso ?? "")) return false;
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

/** Semana completa só quando `de`/`ate` são datas reais e ordenadas. */
function vigenciaDe(validity) {
  const de = validity?.initial?.slice(0, 10) ?? null;
  const ate = validity?.final?.slice(0, 10) ?? null;
  if (!dataReal(de) || !dataReal(ate) || de > ate) return null;
  return { de, ate };
}

async function fetchLoja(
  slug,
  { fetch: buscar = fetch, hoje = todayISO(), reterInvalidas = false } = {},
) {
  const url = `${LOJA_BASE}/${slug}`;
  const response = await buscar(url, {
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

  const loja = identidadeDaLoja(storeInfo);

  // A loja lista teasers de campanha futura sem PDF (urlFinalDocument vazia).
  // Fora do caminho de revisão, mantém o filtro legado (só semana completa).
  const flyers = storeInfo.flyers.filter((f) => {
    if (f.exclude === true) return false;
    if (!f.urlFinalDocument) return false;
    if (reterInvalidas) {
      const vigencia = vigenciaDe(f.validity);
      if (!vigencia) return true;
      return vigencia.ate >= hoje;
    }
    // Legado: data completa vale pela comparação da data final, como antes da revisão.
    if (!f.validity?.initial || !f.validity?.final) return false;
    return f.validity.final.slice(0, 10) >= hoje;
  });
  // Quantidade bruta na fonte: o coletor só aceita "sem campanha" com ela igual a 0.
  return { loja, flyers, quantidadeFlyersNaFonte: storeInfo.flyers.length };
}

/** Chamada legada: continua devolvendo só os flyers. */
async function fetchFlyers(slug, deps = {}) {
  return (await fetchLoja(slug, deps)).flyers;
}

async function descobrirComEvidencia(args, deps = {}) {
  const { loja, flyers, quantidadeFlyersNaFonte } = await fetchLoja(args.loja, {
    ...deps,
    hoje: args.hoje ?? deps.hoje ?? todayISO(),
    reterInvalidas: args.revisao === true,
  });

  let encartes = flyers;
  if (args.onlyNewest) {
    // Lista vazia (fonte sem campanha) devolve vazio: o chamador decide pela evidência.
    encartes = flyers.length
      ? [
          flyers.reduce((a, b) =>
            (a.validity?.final ?? "") > (b.validity?.final ?? "") ? a : b,
          ),
        ]
      : [];
  }

  const lista = encartes.map((f) => {
    const name = f.name || "encarte";
    const de = f.validity?.initial?.slice(0, 10) || "semdata";
    const ate = f.validity?.final?.slice(0, 10) || "semdata";
    return {
      slug: `${slugify(name)}-${vigenciaSlug(de, ate)}`,
      pdf: { url: f.urlFinalDocument, manter: true },
      meta: {
        name,
        vigencia:
          f.validity?.initial || f.validity?.final
            ? {
                de: f.validity?.initial?.slice(0, 10) ?? null,
                ate: f.validity?.final?.slice(0, 10) ?? null,
              }
            : null,
        loja,
      },
    };
  });
  return { encartes: lista, evidenciaFonte: { loja, quantidadeFlyersNaFonte } };
}

async function descobrir(args, deps = {}) {
  return (await descobrirComEvidencia(args, deps)).encartes;
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

module.exports = { descobrir, descobrirComEvidencia, fetchFlyers, fetchLoja };

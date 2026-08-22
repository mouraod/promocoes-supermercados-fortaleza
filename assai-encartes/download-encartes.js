#!/usr/bin/env node

// Skill Assaí: abre a página da loja apenas para interceptar o payload de
// ofertas e identificar a dupla eid/nid. O pipeline baixa as imagens diretas.

const { baixarEncartes, parsearArgs } = require("../lib/pipeline");

const OFERTAS_URL = "https://www.assai.com.br/ofertas/ceara/assai-bezerra-m-fortaleza";
const CAMINHO_PAYLOAD = "/sites/default/files/static/ofertas_assai.json";
const HOST_IMAGENS = "d2q57q7k4hzryv.cloudfront.net";
const CONTEXTO_CHROME = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  locale: "pt-BR",
  timezoneId: "America/Fortaleza",
  viewport: { width: 1440, height: 932 },
};

function normalizarData(data) {
  const [dia, mes, ano] = String(data ?? "").split("/");
  if (!dia || !mes || !ano) throw new Error(`Data de vigência inválida: ${data}`);
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function vigenciaSlugCompleta(vigencia) {
  return `${vigencia.de.slice(8, 10)}-${vigencia.de.slice(5, 7)}-a-${vigencia.ate.slice(8, 10)}-${vigencia.ate.slice(5, 7)}`;
}

function mesmoIdentificador(a, b) {
  return String(a) === String(b);
}

function prepararOfertas(payload, lojaPagina, args = {}, avisar = console.warn) {
  const lojas = Array.isArray(payload?.lojas) ? payload.lojas : [];
  const loja = lojas.find((candidata) =>
    mesmoIdentificador(candidata.eid, lojaPagina.eid) &&
    mesmoIdentificador(candidata.nid, lojaPagina.nid)
  );
  if (!loja) {
    throw new Error(`Loja eid=${lojaPagina.eid} nid=${lojaPagina.nid} não encontrada no payload.`);
  }

  const ofertas = (Array.isArray(payload?.ofertas) ? payload.ofertas : [])
    .filter((oferta) => Array.isArray(oferta.lojas) && oferta.lojas.some((lojaOferta) =>
      mesmoIdentificador(lojaOferta.eid, loja.eid) && mesmoIdentificador(lojaOferta.nid, loja.nid)
    ))
    .sort((a, b) => Number(b.destaque || 0) - Number(a.destaque || 0));

  const encartes = ofertas.flatMap((oferta) => {
    const id = Number(oferta.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      avisar(`  [aviso] Oferta com ID inválido ${JSON.stringify(oferta.id)} - ignorada.`);
      return [];
    }

    const urls = Array.isArray(oferta.images)
      ? oferta.images.map((imagem) => imagem?.url).filter(Boolean)
      : [];
    if (urls.length === 0) {
      avisar(`  [aviso] Encarte ${id} (${oferta.title}) sem imagens - ignorado.`);
      return [];
    }

    const vigencia = {
      de: normalizarData(oferta.start_date),
      ate: normalizarData(oferta.end_date),
    };
    return [{
      slug: `${id}-${vigenciaSlugCompleta(vigencia)}`,
      paginas: urls.map((url) => ({ url })),
      meta: {
        id,
        titulo: oferta.title,
        vigencia,
        loja: { eid: loja.eid, nid: loja.nid, nome: loja.name },
      },
    }];
  });

  return args.onlyNewest ? encartes.slice(0, 1) : encartes;
}

async function buscarDados({ chromium } = require("playwright")) {
  const browser = await chromium.launch({ headless: true });
  try {
    const contexto = await browser.newContext(CONTEXTO_CHROME);
    const page = await contexto.newPage();
    const respostaPayload = page.waitForResponse((resposta) => {
      const tipoConteudo = resposta.headers()["content-type"]
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      return resposta.url().includes(CAMINHO_PAYLOAD) && tipoConteudo === "application/json";
    }, { timeout: 60000 });

    await page.goto(OFERTAS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    const lojaPagina = await page.locator(".bloco-ofertas-tabloide").evaluate((elemento) => ({
      eid: elemento.getAttribute("data-eid"),
      nid: elemento.getAttribute("data-nid"),
    }));
    if (!lojaPagina.eid || !lojaPagina.nid) {
      throw new Error("eid/nid não encontrados em .bloco-ofertas-tabloide.");
    }

    const resposta = await respostaPayload;
    return { payload: await resposta.json(), lojaPagina };
  } finally {
    await browser.close();
  }
}

async function descobrir(args, deps) {
  const { payload, lojaPagina } = await buscarDados(deps);
  return prepararOfertas(payload, lojaPagina, args);
}

function ajuda() {
  return `
Uso:
  node assai-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --only-newest   Baixa apenas o primeiro encarte exibido pelo site
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/Assai/DD-Mês/JPG/<slug>-pagina-NN.jpg
  <base>/Assai/DD-Mês/manifest.json

Requer: cd assai-encartes && npm install && npx playwright install chromium
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["only-newest", "sem-reuso"], ajuda });
  await baixarEncartes({
    rede: "Assai",
    source: OFERTAS_URL,
    descobrir,
    args,
    hostsPermitidos: [HOST_IMAGENS],
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { descobrir, normalizarData, prepararOfertas };

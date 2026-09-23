#!/usr/bin/env node

// Skill Center Box (Grupo Centerbox): a página /ofertas/ é HTML estático de
// WordPress e publica as imagens do encarte da semana como JPEG direto de
// wp-content/uploads. Sem Playwright, sem npm install, sem poppler e sem PDF:
// as imagens originais já vêm em boa resolução.
// A seção "Ofertas anteriores" é descartada — só o que está vigente interessa.

const { baixarEncartes, parsearArgs } = require("../lib/pipeline");

const OFERTAS_URL = "https://www.grupocenterbox.com.br/ofertas/";
const HOST = "www.grupocenterbox.com.br";

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

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Os títulos vêm escapados pelo WordPress ("Carnes &#8211; Frente"), então
// decodifica entidades numéricas (decimais e hexadecimais) e as nomeadas
// usadas na página.
function decodificarEntidades(texto) {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (bruto, corpo) => {
    if (corpo[0] === "#") {
      const hexadecimal = corpo[1] === "x" || corpo[1] === "X";
      const codigo = parseInt(hexadecimal ? corpo.slice(2) : corpo.slice(1), hexadecimal ? 16 : 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : bruto;
    }
    return ENTIDADES[corpo.toLowerCase()] ?? bruto;
  });
}

/**
 * Recebe o HTML completo da página /ofertas/ e devolve só as imagens da seção
 * "Ofertas da semana", ignorando tudo a partir de "Ofertas anteriores".
 *
 * Estratégia: cortar o HTML entre os dois títulos de seção e, dentro do
 * recorte, ler cada `<div class="offers__item">` (um `<h3>` de título + um
 * `<img>` em wp-content/uploads/).
 *
 * Retorna: [{ titulo, url }]
 */
function extrairOfertasDaSemana(html) {
  const inicio = html.indexOf("Ofertas da semana");
  if (inicio === -1) throw new Error("Seção 'Ofertas da semana' não encontrada no HTML");
  const fim = html.indexOf("Ofertas anteriores", inicio);
  const secao = fim === -1 ? html.slice(inicio) : html.slice(inicio, fim);

  const ofertas = [];
  for (const [, bloco] of secao.matchAll(/<div class="offers__item">([\s\S]*?)<\/div>/g)) {
    const src = bloco.match(/<img[^>]*\bsrc="([^"]+)"/);
    if (!src) continue;

    const url = decodificarEntidades(src[1]);
    if (!/^https:\/\/www\.grupocenterbox\.com\.br\/wp-content\/uploads\/.+\.(jpe?g|png|webp)(\?|#|$)/i.test(url)) continue;

    const titulo = bloco.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    ofertas.push({
      titulo: titulo ? decodificarEntidades(titulo[1]).replace(/\s+/g, " ").trim() : "",
      url,
    });
  }
  return ofertas;
}

// ─── adapter para o pipeline ──────────────────────────────────────────────────

async function descobrir() {
  const ofertas = extrairOfertasDaSemana(await baixarHtml(OFERTAS_URL));

  if (ofertas.length === 0) {
    throw new Error(`Nenhuma oferta da semana encontrada em ${OFERTAS_URL}. A seção está vazia ou o HTML mudou.`);
  }

  // O Center Box não separa por encarte individual: tudo que está entre
  // "Ofertas da semana" e "Ofertas anteriores" é a rodada corrente, então o
  // pipeline recebe um único encarte com todas as páginas na ordem do site.
  return [{
    slug: "ofertas-da-semana",
    paginas: ofertas.map((oferta) => ({ url: oferta.url })),
    meta: { url: OFERTAS_URL, titulos: ofertas.map((oferta) => oferta.titulo) },
  }];
}

function ajuda() {
  return `
Uso:
  node centerbox-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/CenterBox/DD-Mês/JPG/ofertas-da-semana-pagina-NN.jpeg
  <base>/CenterBox/DD-Mês/manifest.json
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), { aceitas: ["sem-reuso"], ajuda });
  await baixarEncartes({
    rede: "CenterBox",
    source: OFERTAS_URL,
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

module.exports = { descobrir, extrairOfertasDaSemana, decodificarEntidades };

#!/usr/bin/env node

const { baixarEncartes, parsearArgs, slugify } = require("../lib/pipeline");

const OFERTAS_URL = "https://www.redeuniforca.com.br/ofertas/";
const HOST = "www.redeuniforca.com.br";

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

function encontrarAbertura(html, tag, classe, desde = 0) {
  const aberturas = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  aberturas.lastIndex = desde;
  let match;
  while ((match = aberturas.exec(html))) {
    const atributoClasse = match[0].match(/\sclass\s*=\s*(["'])(.*?)\1/i);
    const classes = atributoClasse ? atributoClasse[2].split(/\s+/) : [];
    if (classes.includes(classe)) {
      return { inicio: match.index, fimAbertura: aberturas.lastIndex };
    }
  }
  return null;
}

function extrairBloco(html, tag, abertura) {
  if (tag === "section") {
    const fechamento = new RegExp(`</${tag}\\s*>`, "ig");
    fechamento.lastIndex = abertura.fimAbertura;
    const match = fechamento.exec(html);
    if (!match) return { inicio: abertura.inicio, fim: html.length, conteudo: html.slice(abertura.fimAbertura) };
    return { inicio: abertura.inicio, fim: fechamento.lastIndex, conteudo: html.slice(abertura.fimAbertura, match.index) };
  }

  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = abertura.fimAbertura;
  let profundidade = 1;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<\//.test(match[0])) profundidade -= 1;
    else if (!/\/\s*>$/.test(match[0])) profundidade += 1;
    if (profundidade === 0) {
      return { inicio: abertura.inicio, fim: tags.lastIndex, conteudo: html.slice(abertura.fimAbertura, match.index) };
    }
  }
  return { inicio: abertura.inicio, fim: html.length, conteudo: html.slice(abertura.fimAbertura) };
}

function textoSemTags(texto) {
  return decodificarEntidades(texto.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Extrai encartes vigentes da seção promotions no HTML estático do WordPress. */
function extrairEncartes(html) {
  const promotions = encontrarAbertura(html, "section", "promotions");
  const raiz = promotions ?? encontrarAbertura(html, "div", "promotions__items");
  if (!raiz) {
    throw new Error("Seção 'promotions' (ou 'promotions__items') não encontrada no HTML da Uniforça.");
  }

  const bloco = extrairBloco(html, promotions ? "section" : "div", raiz);
  const marcador = /(?:Ofertas|Encartes)\s+anteriores/i.exec(bloco.conteudo);
  const conteudo = marcador ? bloco.conteudo.slice(0, marcador.index) : bloco.conteudo;
  const encartes = [];
  let cursor = 0;

  while (true) {
    const aberturaItem = encontrarAbertura(conteudo, "div", "promotions__item", cursor);
    if (!aberturaItem) break;
    const item = extrairBloco(conteudo, "div", aberturaItem);
    cursor = item.fim;

    const tituloMatch = item.conteudo.match(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/i);
    const linkMatch = item.conteudo.match(/<a\b[^>]*\shref\s*=\s*(["'])(.*?)\1/i);
    if (!linkMatch) continue;

    const titulo = tituloMatch ? textoSemTags(tituloMatch[1]) : "";
    let url;
    try {
      url = new URL(decodificarEntidades(linkMatch[2].trim()), OFERTAS_URL);
    } catch {
      continue;
    }

    if (url.hostname.toLowerCase() !== HOST) continue;
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") continue;

    const extensao = url.pathname.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase();
    let tipo;
    if (extensao === "pdf") tipo = "pdf";
    else if (["jpg", "jpeg", "png", "webp"].includes(extensao)) tipo = "imagem";
    else {
      console.warn(`Uniforça: formato de encarte não suportado; ignorando ${url.href}`);
      continue;
    }

    encartes.push({ titulo, url: url.href, tipo });
  }

  if (encartes.length === 0) {
    throw new Error("Nenhum encarte encontrado na seção 'promotions' da Uniforça.");
  }
  return encartes;
}

async function descobrir() {
  const itens = extrairEncartes(await baixarHtml(OFERTAS_URL));
  return itens.map((item) => {
    const slug = slugify(item.titulo);
    if (item.tipo === "pdf") {
      return {
        slug,
        pdf: { url: item.url, manter: true },
        meta: { titulo: item.titulo, url: OFERTAS_URL },
      };
    }
    return {
      slug,
      paginas: [{ url: item.url }],
      meta: { titulo: item.titulo, url: OFERTAS_URL },
    };
  });
}

function ajuda() {
  return `
Uso:
  node uniforca-encartes/download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização do PDF (padrão: 200)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem
`;
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), {
    aceitas: ["sem-reuso", "dpi"],
    ajuda,
  });
  await baixarEncartes({
    rede: "Uniforca",
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

module.exports = { descobrir, extrairEncartes, decodificarEntidades };

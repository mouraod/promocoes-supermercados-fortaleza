#!/usr/bin/env node

// Skill Mercadão São Luiz: baixa o HTML da home e de /ofertas, extrai os
// encartes das imagens Wix (srcSet, área mínima e proporção de encarte) e
// devolve páginas em resolução original para o pipeline baixar em pool.
// Os parsers de HTML são funções puras, testadas em download-encartes.test.js.

const { baixarEncartes, parsearArgs, slugify } = require("../../lib/pipeline");

const FONTES = [
  { nome: "home", url: "https://www.mercadaosaoluiz.com.br/" },
  { nome: "ofertas", url: "https://www.mercadaosaoluiz.com.br/ofertas" },
];
const HOST_WIX = "static.wixstatic.com";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const CONCORRENCIA_DOWNLOADS = 4;
const AREA_MINIMA_ENCARTE = 2_000_000;
const PROPORCAO_MINIMA = 1.30;
const PROPORCAO_MAXIMA = 1.55;

// ─── parsers puros do HTML Wix ────────────────────────────────────────────────

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodificarHtml(texto) {
  return texto
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u0026", "&");
}

function atributo(tag, nome) {
  const padrao = new RegExp(`\\b${escaparRegex(nome)}=(?:"([^"]*)"|'([^']*)')`, "i");
  const achado = tag.match(padrao);
  return achado ? decodificarHtml(achado[1] ?? achado[2] ?? "") : "";
}

function candidatosSrcSet(srcSet) {
  return srcSet
    .split(/,\s*(?=https?:\/\/)/)
    .map((item) => item.trim().split(/\s+/)[0])
    .filter((item) => item.startsWith("https://"));
}

function analisarUrlWix(url) {
  const achado = url.match(
    /^https:\/\/static\.wixstatic\.com\/media\/([^/]+)\/v1\/fill\/w_(\d+),h_(\d+)[^\s"'<>]*$/i
  );
  if (!achado) return null;

  const [, mediaId, larguraTexto, alturaTexto] = achado;
  const extensao = mediaId.match(/\.(jpe?g|png)$/i)?.[1].toLowerCase();
  if (!extensao) return null;

  const largura = Number(larguraTexto);
  const altura = Number(alturaTexto);
  const proporcao = altura / largura;
  const area = largura * altura;
  if (
    !Number.isFinite(proporcao) ||
    area < AREA_MINIMA_ENCARTE ||
    proporcao < PROPORCAO_MINIMA ||
    proporcao > PROPORCAO_MAXIMA
  ) return null;

  const caminho = new URL(url).pathname;
  const nomeOriginal = decodeURIComponent(caminho.slice(caminho.lastIndexOf("/") + 1));
  return {
    mediaId,
    largura,
    altura,
    area,
    extensao: extensao === "jpeg" ? "jpg" : extensao,
    nomeOriginal,
    urlOriginal: `https://${HOST_WIX}/media/${mediaId}`,
  };
}

function metadadosPagina(alt, nomeOriginal, mediaId) {
  const nome = (alt || nomeOriginal || mediaId).replace(/\.[^.]+$/, "").trim();
  const paginaPadrao = { nome, pagina: 1 };

  const paginaWix = nome.match(/^(.*?)[_-]page[-_](\d+)$/i);
  if (paginaWix) {
    return { nome: paginaWix[1], pagina: Number(paginaWix[2]) };
  }

  const imagemWix = nome.match(/^(.*?)-imagens?-(\d+)$/i);
  if (imagemWix) {
    return { nome: imagemWix[1], pagina: Number(imagemWix[2]) + 1 };
  }

  return paginaPadrao;
}

function extrairEncartes(html, fonte) {
  const porMidia = new Map();
  const tags = decodificarHtml(html).match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const srcSet = atributo(tag, "srcSet");
    const alt = atributo(tag, "alt");
    for (const url of candidatosSrcSet(srcSet)) {
      const candidato = analisarUrlWix(url);
      if (!candidato) continue;
      const anterior = porMidia.get(candidato.mediaId);
      if (!anterior || candidato.area > anterior.area) {
        porMidia.set(candidato.mediaId, { ...candidato, alt, fontes: [fonte] });
      }
    }
  }
  return [...porMidia.values()];
}

function descobrirEncartes(respostas) {
  const porMidia = new Map();
  for (const { fonte, html } of respostas) {
    for (const candidato of extrairEncartes(html, fonte)) {
      const anterior = porMidia.get(candidato.mediaId);
      if (!anterior) {
        porMidia.set(candidato.mediaId, candidato);
      } else {
        anterior.fontes = [...new Set([...anterior.fontes, ...candidato.fontes])];
        if (candidato.area > anterior.area) {
          anterior.largura = candidato.largura;
          anterior.altura = candidato.altura;
          anterior.area = candidato.area;
          anterior.nomeOriginal = candidato.nomeOriginal;
          anterior.alt = candidato.alt;
        }
      }
    }
  }

  const grupos = new Map();
  for (const item of porMidia.values()) {
    const dados = metadadosPagina(item.alt, item.nomeOriginal, item.mediaId);
    const slug = slugify(dados.nome);
    const chave = slug;
    if (!grupos.has(chave)) grupos.set(chave, { nome: dados.nome, slug, paginas: [] });
    grupos.get(chave).paginas.push({ ...item, numero: dados.pagina });
  }

  const encartes = [...grupos.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const encarte of encartes) {
    encarte.paginas.sort((a, b) => a.numero - b.numero || a.mediaId.localeCompare(b.mediaId));
  }
  return encartes;
}

function atribuirArquivos(encartes) {
  const ocupados = new Set();
  for (const encarte of encartes) {
    for (const pagina of encarte.paginas) {
      const base = `${encarte.slug}-pagina-${String(pagina.numero).padStart(2, "0")}`;
      let nome = `${base}.${pagina.extensao}`;
      if (ocupados.has(nome)) {
        const hash = pagina.mediaId.match(/_([a-f0-9]{8,})~mv2\./i)?.[1].slice(0, 8) ?? "midia";
        nome = `${base}-${hash}.${pagina.extensao}`;
      }
      ocupados.add(nome);
      pagina.arquivo = nome;
    }
  }
  return encartes;
}

// ─── rede ─────────────────────────────────────────────────────────────────────

async function buscarHtml(fonte) {
  const controlador = new AbortController();
  const tempo = setTimeout(() => controlador.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const resposta = await fetch(fonte.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`${fonte.nome}: falha ${resposta.status} ao abrir ${fonte.url}`);
    const tipo = resposta.headers.get("content-type") ?? "";
    if (!tipo.includes("text/html")) throw new Error(`${fonte.nome}: resposta não é HTML (${tipo || "sem tipo"})`);
    return { fonte: fonte.nome, html: await resposta.text() };
  } finally {
    clearTimeout(tempo);
  }
}

// Adapter para o pipeline: mapeia os encartes do Wix para o contrato
// { slug, paginas: [{url, ext, arquivo}], meta }.
async function descobrir(_args) {
  const respostas = await Promise.all(FONTES.map(buscarHtml));
  const porFonte = new Map(respostas.map((resposta) => [resposta.fonte, extrairEncartes(resposta.html, resposta.fonte).length]));
  for (const fonte of FONTES) {
    if ((porFonte.get(fonte.nome) ?? 0) === 0) console.warn(`[aviso] Nenhum encarte encontrado em ${fonte.nome}.`);
  }

  const encartes = atribuirArquivos(descobrirEncartes(respostas));
  if (encartes.length === 0) {
    throw new Error("Nenhuma imagem de encarte encontrada. O HTML do Wix pode ter mudado.");
  }

  return encartes.map((encarte) => ({
    slug: encarte.slug,
    paginas: encarte.paginas.map((pagina) => ({
      url: pagina.urlOriginal,
      ext: pagina.extensao,
      arquivo: pagina.arquivo,
      numero: pagina.numero,
      fontes: pagina.fontes,
    })),
    meta: {
      nome: encarte.nome,
      paginasDetalhadas: encarte.paginas.map((pagina) => ({
        numero: pagina.numero,
        arquivo: pagina.arquivo,
        mediaId: pagina.mediaId,
        urlOriginal: pagina.urlOriginal,
        fontes: pagina.fontes,
      })),
    },
  }));
}

function resumo(encartes) {
  return encartes.flatMap((encarte) => encarte.paginas.map((pagina) =>
    `${encarte.slug} | página ${pagina.numero} | ${pagina.fontes.join(", ")} | ${pagina.url}`
  ));
}

function ajuda() {
  return `
Uso:
  node mercadao-encartes/scripts/download-encartes.js [opções]

Opções:
  --base     Pasta raiz. Padrão: ~/Downloads/Encartes
  --output   Substitui base+rede+data por um caminho completo
  --sem-reuso  Não reaproveita páginas de rodadas anteriores
  --dry-run  Descobre os encartes sem baixar arquivos
  --help     Exibe esta mensagem

Saída padrão:
  <base>/MercadaoSaoLuiz/DD-Mês/JPG/<encarte>-pagina-NN.jpg
  <base>/MercadaoSaoLuiz/DD-Mês/manifest.json
`;
}

async function executar(argv = process.argv.slice(2)) {
  const args = await parsearArgs(argv, { aceitas: ["sem-reuso", "dry-run"], ajuda });

  if (args.dryRun) {
    const encartes = await descobrir(args);
    const totalPaginas = encartes.reduce((total, encarte) => total + encarte.paginas.length, 0);
    console.log(`Mercadão São Luiz | ${encartes.length} encarte(s) | ${totalPaginas} página(s)`);
    for (const linha of resumo(encartes)) console.log(linha);
    return { encartes, totalPaginas, seco: true };
  }

  return baixarEncartes({
    rede: "MercadaoSaoLuiz",
    source: FONTES,
    descobrir,
    args,
    extra: { mercado: "mercadao_sao_luiz" },
    hostsPermitidos: [HOST_WIX],
    concorrencia: CONCORRENCIA_DOWNLOADS,
  });
}

if (require.main === module) {
  executar().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}

module.exports = {
  analisarUrlWix,
  atribuirArquivos,
  descobrir,
  descobrirEncartes,
  executar,
  extrairEncartes,
  metadadosPagina,
};

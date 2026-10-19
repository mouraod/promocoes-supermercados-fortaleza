"use strict";

// Adapters de aquisição. Nenhuma data é deduzida de nome de arquivo.
const { createHash } = require("node:crypto");

const FONTES = {
  dona: "https://donafazbem.com.br/folheto/ofertas/",
  guanabara: "https://www.supermercadosguanabara.com.br/encarte",
  violeta: "https://supermercadovioleta.com.br/tabloide/",
};
const limpar = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
function entidades(texto) {
  return texto.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function atributo(tag, nome) {
  return entidades(tag.match(new RegExp(`\\b${nome}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "");
}
function urlOficial(valor, base, prefixo) {
  const url = new URL(entidades(valor), base);
  if (url.protocol !== "https:" || url.hostname !== new URL(base).hostname || url.username || url.password || !url.pathname.startsWith(prefixo))
    throw new Error("URL fora da origem oficial do encarte");
  return url.href;
}
function campanha(dados) { return createHash("sha256").update(JSON.stringify(dados)).digest("hex"); }
function iso(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!m) throw new Error("Validade sem ano explícito");
  const valor = `${m[3]}-${m[2]}-${m[1]}`;
  const data = new Date(`${valor}T12:00:00Z`);
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== valor)
    throw new Error("Data inválida na fonte oficial");
  return valor;
}
function periodo(de, ate) {
  const vigencia = { de: iso(de), ate: iso(ate) };
  if (vigencia.de > vigencia.ate) throw new Error("Período de validade invertido");
  return vigencia;
}
async function html(url, buscar = fetch) {
  const r = await buscar(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!r.ok) throw new Error(`Fonte indisponível: HTTP ${r.status}`);
  if (!/text\/html/i.test(r.headers.get("content-type") ?? "")) throw new Error("Fonte não retornou HTML");
  return limpar(await r.text());
}

function parsearDona(conteudo) {
  const links = [...limpar(conteudo).matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag)
    .filter((tag) => atributo(tag, "id") === "btn-baixar-folheto");
  if (links.length !== 1) throw new Error("Dona: esperado um botão de PDF; revisar mudança da fonte");
  const url = urlOficial(atributo(links[0], "href"), FONTES.dona, "/wp-content/uploads/");
  if (!/\.pdf$/i.test(new URL(url).pathname)) throw new Error("Dona: botão não aponta para PDF");
  const id = campanha(url);
  return [{ slug: `dona-${id}`, pdf: { url, manter: true }, meta: {
    titulo: "Folheto Dona", campanha: id, vigencia: null, validade_evidencia: null,
    origem: FONTES.dona, revisao_loja_obrigatoria: true,
  } }];
}

function parsearGuanabara(conteudo) {
  const limpo = limpar(conteudo);
  const texto = entidades(limpo.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const datas = [...texto.matchAll(/Promoção válida de (\d{2}\/\d{2}\/\d{4}) até (\d{2}\/\d{2}\/\d{4})/gi)];
  if (datas.length !== 1) throw new Error("Guanabara: validade ausente ou ambígua");
  const vigencia = periodo(datas[0][1], datas[0][2]);
  const links = [...limpo.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => atributo(tag, "href"));
  const url = links.map((href) => { try { return new URL(href, FONTES.guanabara); } catch { return null; } })
    .find((u) => u?.pathname === "/encarte/baixe");
  if (!url) throw new Error("Guanabara: link de download ausente");
  const pdf = urlOficial(url.href, FONTES.guanabara, "/encarte/baixe");
  const id = campanha([pdf, vigencia]);
  return [{ slug: `guanabara-${id}`, pdf: { url: pdf, manter: true }, meta: {
    titulo: "Encarte Guanabara", campanha: id, vigencia, origem: FONTES.guanabara,
    validade_evidencia: { fonte: FONTES.guanabara, trecho: datas[0][0], metodo: "html" },
    revisao_loja_obrigatoria: true,
  } }];
}

function linksVioleta(conteudo) {
  const links = [...limpar(conteudo).matchAll(/<a\b[^>]*>/gi)].map(([tag]) => atributo(tag, "href"))
    .filter((href) => /\/produto\/folheto-/.test(href))
    .map((href) => urlOficial(href, FONTES.violeta, "/produto/folheto-"));
  if (!links.length) throw new Error("Violeta: índice sem posts de folhetos; revisar fonte");
  return [...new Set(links)];
}
function parsearVioleta(conteudo, origem) {
  urlOficial(origem, FONTES.violeta, "/produto/folheto-");
  const limpo = limpar(conteudo);
  const titulo = entidades(limpo.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "")
    .replace(/\s+/g, " ").trim();
  let datas = titulo.match(/(?:PERÍODO DE|DIAS)\s+(\d{2}\/\d{2}\/\d{4})\s+(?:A|E)\s+(\d{2}\/\d{2}\/\d{4})/i);
  let vigencia;
  if (datas) vigencia = periodo(datas[1], datas[2]);
  else {
    datas = titulo.match(/(?:APENAS PARA O DIA)\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (!datas) throw new Error("Violeta: validade ambígua no título do folheto");
    vigencia = periodo(datas[1], datas[1]);
  }
  const galeria = limpo.match(/<figure\b[^>]*class=["'][^"']*woocommerce-product-gallery__wrapper[^"']*["'][^>]*>([\s\S]*?)<\/figure>/i)?.[1];
  if (!galeria) throw new Error("Violeta: galeria completa ausente");
  const urls = [...galeria.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => atributo(tag, "href"))
    .map((href) => urlOficial(href, FONTES.violeta, "/wp-content/uploads/"));
  if (!urls.length || urls.some((u) => !/\.(?:jpe?g|png)$/i.test(new URL(u).pathname)))
    throw new Error("Violeta: páginas originais ausentes ou inválidas");
  const paginas = [...new Set(urls)].map((url) => ({ url }));
  const id = campanha([origem, paginas, vigencia]);
  return { slug: `violeta-${id}`, paginas, meta: { titulo, campanha: id, vigencia, origem,
    validade_evidencia: { fonte: origem, trecho: titulo, metodo: "html" }, revisao_loja_obrigatoria: true } };
}

async function dona(_args, { fetch: buscar = fetch } = {}) { return parsearDona(await html(FONTES.dona, buscar)); }
async function guanabara(_args, { fetch: buscar = fetch } = {}) { return parsearGuanabara(await html(FONTES.guanabara, buscar)); }
async function violeta(_args, { fetch: buscar = fetch } = {}) {
  const links = linksVioleta(await html(FONTES.violeta, buscar));
  const encartes = [];
  // Sequencial para não pressionar o WordPress. Uma falha não vira lote parcial silencioso.
  for (const link of links) encartes.push(parsearVioleta(await html(link, buscar), link));
  return encartes;
}
module.exports = { FONTES, parsearDona, parsearGuanabara, linksVioleta, parsearVioleta, dona, guanabara, violeta };

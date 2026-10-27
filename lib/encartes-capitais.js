"use strict";

// Adapters de aquisição. Nenhuma data é deduzida de nome de arquivo.
const { createHash } = require("node:crypto");

const FONTES = {
  dona: "https://donafazbem.com.br/folheto/ofertas/",
  guanabara: "https://www.supermercadosguanabara.com.br/encarte",
  violeta: "https://supermercadovioleta.com.br/tabloide/",
  atakarejo: "https://atakarejo.com.br/cidades/salvador/",
  hiperideal: "https://www.hiperideal.com.br/especial/encartes",
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
function urlOficialDeHosts(valor, base, prefixo, hosts) {
  const url = new URL(entidades(valor), base);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password ||
      !url.pathname.startsWith(prefixo))
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
// ─── Atakarejo (encarte por cidade, WordPress) ───────────────────────────────
// Validade só existe no HTML, com ano explícito. Aceita mês único
// ("de 26 a 29/10/2026") e virada de mês ("de 30/10 a 03/11/2026").
function periodoAtakarejo(texto) {
  // Uma campanha por página: duas validades são ambíguas e falham fechado.
  const dois = [...texto.matchAll(/Ofertas v[aá]lidas de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})\/(\d{4})/gi)];
  const um = [...texto.matchAll(/Ofertas v[aá]lidas de (\d{2}) a (\d{2})\/(\d{2})\/(\d{4})/gi)];
  if (dois.length + um.length !== 1)
    throw new Error("Atakarejo: validade ausente ou ambígua na página da cidade");
  if (um.length) {
    const [, de, ate, mes, ano] = um[0];
    return periodo(`${de}/${mes}/${ano}`, `${ate}/${mes}/${ano}`);
  }
  const [, d1, m1, d2, m2, ano] = dois[0];
  // Virada de ano: só recua o ano quando a abertura é em dezembro; um período
  // invertido no mesmo ano (erro da fonte) segue falhando em `periodo`.
  if (m1 === "12" && m2 !== "12")
    return periodo(`${d1}/${m1}/${Number(ano) - 1}`, `${d2}/${m2}/${ano}`);
  return periodo(`${d1}/${m1}/${ano}`, `${d2}/${m2}/${ano}`);
}

function parsearAtakarejo(conteudo, origem) {
  const pagina = limpar(conteudo);
  const botoes = [...pagina.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag)
    .filter((tag) => atributo(tag, "class").split(/\s+/).includes("button-download-ofertas"));
  if (botoes.length !== 1) throw new Error("Atakarejo: esperado um botão único; revisar a fonte");
  const url = urlOficial(atributo(botoes[0], "href"), FONTES.atakarejo, "/wp-content/uploads/");
  if (!/\.pdf$/i.test(new URL(url).pathname)) throw new Error("Atakarejo: botão não aponta para PDF");
  const texto = entidades(pagina.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const vigencia = periodoAtakarejo(texto);
  const trecho = /Ofertas v[aá]lidas de [\d/ a]+/i.exec(texto)?.[0] ?? null;
  // Título é "Salvador | Atakarejo": a cidade vem antes do pipe.
  const cidade = (/<title>\s*([^<|]+?)\s*\|/i.exec(pagina)?.[1] ?? "").trim();
  const id = campanha(url);
  return [{
    slug: `atakarejo-${id}`,
    pdf: { url, manter: true },
    meta: {
      titulo: cidade ? `Encarte Habitual ${cidade}` : "Encarte Habitual",
      campanha: id,
      vigencia,
      validade_evidencia: { fonte: origem ?? FONTES.atakarejo, trecho, metodo: "html" },
      revisao_loja_obrigatoria: true,
    },
  }];
}

// ─── Hiperideal (VTEX IO, lista embutida no HTML) ────────────────────────────
// Campanha com nome de loja não entra: não há prova de abrangência na fonte.
const HIPERIDEAL_POR_LOJA = ["lapa"];
const HIPERIDEAL_PDF_HOSTS = ["hiperideal.gsit.co"];

function fatiarLista(html, marca) {
  const inicio = html.indexOf(marca);
  if (inicio < 0) throw new Error("Hiperideal: lista de encartes ausente na página");
  const abre = inicio + marca.length - 1; // posição do "["
  if (html[abre] !== "[") throw new Error("Hiperideal: marcador da lista sem colchete");
  let profundidade = 0, dentro = false;
  for (let i = abre; i < html.length; i += 1) {
    const c = html[i];
    if (c === '"' && html[i - 1] !== "\\") dentro = !dentro;
    if (dentro) continue;
    if (c === "[") profundidade += 1;
    else if (c === "]" && (profundidade -= 1) === 0) return JSON.parse(html.slice(abre, i + 1));
  }
  throw new Error("Hiperideal: lista de encartes truncada");
}

function parsearHiperideal(conteudo, { hoje } = {}) {
  const marcaBloco = '"blockId":"hiperideal.store-theme@0.x:encartes#encartes"';
  const corte = conteudo.indexOf(marcaBloco);
  if (corte < 0) throw new Error("Hiperideal: bloco de encartes mudou de identificador");
  const lista = fatiarLista(conteudo.slice(corte), '"content":{"encartes":[');
  const dia = hoje ?? new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
  const encartes = [];
  for (const item of lista) {
    const nome = entidades(String(item.nome ?? "")).trim().replace(/\s+/g, " ");
    const de = item.dataInicio, ate = item.dataFim;
    if (!de || !ate) throw new Error(`Hiperideal: campanha sem vigência (${nome || "sem nome"})`);
    if (!(de <= dia && dia <= ate)) continue; // vencida ou futura: o pipeline também descartaria
    if (!item.pdfUrl) throw new Error(`Hiperideal: campanha vigente sem PDF (${nome})`);
    const normalizado = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (HIPERIDEAL_POR_LOJA.some((loja) => normalizado === loja || normalizado.startsWith(`${loja} `))) continue;
    // O CMS já publicou PDF em http://; normaliza antes de validar o host.
    const url = urlOficialDeHosts(String(item.pdfUrl).replace(/^http:\/\//i, "https://"),
      FONTES.hiperideal, "/arquivos/pdf/", HIPERIDEAL_PDF_HOSTS);
    const id = campanha(url);
    encartes.push({
      slug: `hiperideal-${id}`,
      pdf: { url, manter: true },
      meta: {
        titulo: nome || "Encarte Hiperideal",
        campanha: id,
        vigencia: periodo(`${de.slice(8, 10)}/${de.slice(5, 7)}/${de.slice(0, 4)}`,
                          `${ate.slice(8, 10)}/${ate.slice(5, 7)}/${ate.slice(0, 4)}`),
        validade_evidencia: { fonte: FONTES.hiperideal, trecho: nome, metodo: "html" },
      },
    });
  }
  if (!encartes.length) throw new Error("Hiperideal: nenhuma campanha utilizável");
  return encartes;
}

async function atakarejo(args = {}, { fetch: buscar = fetch } = {}) {
  const origem = args.url ?? FONTES.atakarejo;
  return parsearAtakarejo(await html(origem, buscar), origem);
}
async function hiperideal(_args, { fetch: buscar = fetch, hoje } = {}) {
  return parsearHiperideal(await html(FONTES.hiperideal, buscar), { hoje });
}

module.exports = { FONTES, parsearDona, parsearGuanabara, linksVioleta, parsearVioleta,
  dona, guanabara, violeta, parsearAtakarejo, parsearHiperideal, atakarejo, hiperideal };

"use strict";

const CARREFOUR_QUERY = `query SEARCH_STORE_FLYERS($storeId: String, $limit: Int = 100, $offset: Int = 0) @context(sender: "carrefourbr.carrefour-components@0.x") { searchStoreFlyers(storeId: $storeId, limit: $limit, offset: $offset) @runtimeMeta(hash: "15b1f00befd0bff6b88c33e5f0ddeb52f4f269bdec6ef4e2033ccb95ea5086d2") { id totalPages campaign campaignStartDate campaignEndDate storeId images __typename } }`;

const FONTES = {
  carrefour: "https://secure.mercado.carrefour.com.br/_v/segment/graphql/v1?workspace=master&maxAge=short&appsEtag=remove&domain=store&locale=pt-BR&__bindingId=4ddc12a1-e46b-42a6-8211-be64661a8725",
  chama: "https://www.grupochama.com.br/ofertas-do-chama-supermercados/",
  roldao: "https://roldao.com.br/ofertas/",
  extra: "https://folheteria.clubeextra.com.br/home/sites/mercado/index.html",
  extraDados: "https://folheteria.clubeextra.com.br/home/sites/assets/js/campanhas.js",
  paoIndex: "https://folhetos.paodeacucar.com/home/sites/pao-de-acucar/index.html",
  paoDados: "https://folhetos.paodeacucar.com/home/sites/assets/js/campanhas.js",
};
const prefixos = {
  chama: "https://www.grupochama.com.br/wp-content/uploads/",
  roldao: "https://roldao.com.br/wp-content/uploads/",
  extra: "https://folheteria.clubeextra.com.br/home/sites/mercado/",
  paodeacucar: "https://folhetos.paodeacucar.com/home/sites/pao-de-acucar/",
};

async function texto(url, buscar = fetch) {
  const resposta = await buscar(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!resposta.ok) throw new Error(`Fonte indisponível: HTTP ${resposta.status} (${url})`);
  return resposta.text();
}
async function html(url, buscar = fetch) {
  const resposta = await buscar(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!resposta.ok) throw new Error(`Fonte indisponível: HTTP ${resposta.status} (${url})`);
  if (!/text\/html/i.test(resposta.headers.get("content-type") ?? "")) throw new Error(`Fonte não retornou HTML (${url})`);
  return resposta.text();
}
function urlOficial(valor, base, prefixo) {
  let url;
  try { url = new URL(valor, base); } catch { throw new Error("URL de encarte inválida"); }
  if (url.protocol !== "https:" || !url.href.startsWith(prefixo) || url.username || url.password)
    throw new Error("URL fora da origem oficial do encarte");
  return url.href;
}
function dataIso(ano, mes, dia) {
  const valor = `${ano}-${mes}-${dia}`;
  const data = new Date(`${valor}T12:00:00Z`);
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== valor)
    throw new Error("Data inválida no nome do encarte");
  return valor;
}
function dataBr(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor ?? ""));
  if (!m) throw new Error(`Data inválida no folheto: ${valor}`);
  return dataIso(m[3], m[2], m[1]);
}
function periodo(de, ate) {
  if (de > ate) throw new Error("Período de validade invertido no encarte");
  return { de, ate };
}
function hojeLocal() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
function normalizarHoje(hoje) {
  if (hoje === undefined) return hojeLocal();
  if (/^\d{8}$/.test(hoje)) return dataIso(hoje.slice(4), hoje.slice(2, 4), hoje.slice(0, 2));
  if (/^\d{4}-\d{2}-\d{2}$/.test(hoje)) {
    dataIso(hoje.slice(0, 4), hoje.slice(5, 7), hoje.slice(8, 10));
    return hoje;
  }
  throw new Error("hoje deve estar em DDMMYYYY ou YYYY-MM-DD");
}
function faixaDoNome(dd1, mm1, dd2, mm2, aa) {
  const ano = 2000 + Number(aa);
  const de = dataIso(String(ano), mm1, dd1);
  let ate = dataIso(String(ano), mm2, dd2);
  if (ate < de && Number(mm1) === 12 && Number(mm2) === 1) ate = dataIso(String(ano + 1), mm2, dd2);
  return periodo(de, ate);
}
function slug(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function assetImagem(url) {
  if (!/\.(?:jpe?g|png|webp)$/i.test(new URL(url).pathname)) throw new Error(`Asset de encarte inválido (esperado .jpg, .png ou .webp): ${url}`);
  return { url };
}
function metadados({ titulo, campanha, vigencia, origem, evidencia, metodo = "html", loja, regiao }) {
  const meta = { titulo, campanha, vigencia, origem,
    validade_evidencia: { fonte: origem, trecho: evidencia, metodo },
    revisao_loja_obrigatoria: !loja };
  if (loja) Object.assign(meta, { loja, loja_origem: "fonte" });
  if (regiao) meta.regiao = regiao;
  return meta;
}

// Em empate de início de vigência, preserva a ordem da fonte.
function apenasOMaisRecente(encartes, args = {}) {
  if (!args.onlyNewest || encartes.length < 2) return encartes;
  return [encartes.reduce((maisRecente, encarte) =>
    encarte.meta.vigencia.de > maisRecente.meta.vigencia.de ? encarte : maisRecente)];
}

// O nome do arquivo da Chama já veio com erro de digitação ("11.11-a-a17.11.26") e com
// sufixo de reenvio ("PG03-1"): o "a" extra e o "-N" são tolerados. Miniatura (-LxA)
// e "-scaled" (versão grande que o WordPress publica) são os únicos sufixos aceitos.
const TABLOIDE_CHAMA = /https:\/\/www\.grupochama\.com\.br\/wp-content\/uploads\/[^"'<>\s]+?Tabloide-Rede-(\d{2})\.(\d{2})-a-a?(\d{2})\.(\d{2})\.(\d{2})-PG(\d{2})(?:-\d+)?-(\d+x\d+|scaled)\.jpg/gi;
const POST_TABLOIDE_CHAMA = /https:\/\/www\.grupochama\.com\.br\/tabloide-[a-z0-9-]+\//gi;

function paginasChama(conteudo, dia, campanhas) {
  for (const match of conteudo.replace(/\\\//g, "/").matchAll(TABLOIDE_CHAMA)) {
    const vigencia = faixaDoNome(match[1], match[2], match[3], match[4], match[5]);
    if (dia < vigencia.de || dia > vigencia.ate) continue;
    const nome = `Tabloide-Rede-${match[1]}.${match[2]}-a-${match[3]}.${match[4]}.${match[5]}`;
    const grande = match[7].toLowerCase() === "scaled";
    const url = urlOficial(grande ? match[0] : match[0].replace(/-\d+x\d+(?=\.jpg$)/i, ""), FONTES.chama, prefixos.chama);
    if (!campanhas.has(nome)) campanhas.set(nome, { vigencia, paginas: new Map() });
    const paginas = campanhas.get(nome).paginas;
    const ordem = Number(match[6]);
    // A versão "-scaled" listada na própria galeria é a página inteira e vence a derivada da miniatura.
    if (!paginas.has(ordem) || (grande && !paginas.get(ordem).grande)) paginas.set(ordem, { ordem, url, grande });
  }
}

// Desde 04/11/2026 a página de ofertas lista só a capa (PG01) e aponta para um post por
// tabloide; as páginas inteiras ficam na galeria do post. Seguimos esses links, sem
// derrubar a coleta se um post alheio (Farma, loja) falhar enquanto outro entrega páginas.
async function chama(args = {}, { fetch: buscar = fetch, hoje } = {}) {
  const dia = normalizarHoje(args.hoje ?? hoje);
  const conteudo = await html(FONTES.chama, buscar);
  const campanhas = new Map();
  paginasChama(conteudo, dia, campanhas);
  const posts = [...new Set(conteudo.replace(/\\\//g, "/").match(POST_TABLOIDE_CHAMA) ?? [])]
    .filter((url) => !/farma/i.test(url)).slice(0, 6);
  const falhas = [];
  for (const post of posts) {
    try { paginasChama(await html(post, buscar), dia, campanhas); }
    catch (erro) { falhas.push(`${post}: ${erro.message}`); }
  }
  if (!campanhas.size)
    throw new Error(`Chama: nenhuma campanha vigente com páginas de imagem${falhas.length ? ` (falhas nos posts: ${falhas.join("; ")})` : ""}`);
  return apenasOMaisRecente([...campanhas].map(([nome, dados]) => ({
    slug: `chama-${slug(nome)}`,
    paginas: [...dados.paginas.values()].sort((a, b) => a.ordem - b.ordem).map(({ url }) => assetImagem(url)),
    meta: metadados({ titulo: "Encarte Chama", campanha: nome, vigencia: dados.vigencia,
      origem: FONTES.chama, evidencia: nome }),
  })), args);
}

async function roldao(args = {}, deps = {}) {
  return (await require("./roldao").descobrirComEvidencia(args, deps)).encartes;
}

function parsearDataJson(conteudo, rede = "Extra") {
  const inicio = conteudo.search(/\bdataJsonInformation\s*=/);
  if (inicio < 0) throw new Error(`${rede}: dataJsonInformation ausente no JS de campanhas`);
  const igual = conteudo.indexOf("=", inicio);
  const quotePos = conteudo.slice(igual + 1).search(/\S/) + igual + 1;
  const quote = conteudo[quotePos];
  if (quote !== "'" && quote !== '"') throw new Error(`${rede}: dataJsonInformation não é string`);
  const fim = conteudo.lastIndexOf(quote);
  if (fim <= quotePos || conteudo.slice(fim + 1).trim().replace(/;$/, "").trim())
    throw new Error(`${rede}: string dataJsonInformation truncada ou ambígua`);
  const literal = conteudo.slice(quotePos + 1, fim);
  try { return JSON.parse(literal); } catch {}
  try { return JSON.parse(JSON.parse(`"${literal.replace(/\\'/g, "'")}"`)); }
  catch (erro) { throw new Error(`${rede}: JSON de campanhas inválido (${erro.message})`); }
}
function fatiarArray(conteudo, nome, rede = "Extra") {
  const chave = conteudo.indexOf(nome);
  const inicio = conteudo.indexOf("[", chave);
  if (chave < 0 || inicio < 0) throw new Error(`${rede}: ${nome} ausente no config.js`);
  let nivel = 0, string = false, escape = false;
  for (let i = inicio; i < conteudo.length; i += 1) {
    const c = conteudo[i];
    if (string) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') string = false;
      continue;
    }
    if (c === '"') string = true;
    else if (c === "[") nivel += 1;
    else if (c === "]" && --nivel === 0) return JSON.parse(conteudo.slice(inicio, i + 1));
  }
  throw new Error(`${rede}: lista ${nome} truncada`);
}

function dataChave(chave) {
  if (!/^\d{8}$/.test(chave)) return null;
  try { return dataIso(chave.slice(4), chave.slice(2, 4), chave.slice(0, 2)); } catch { return null; }
}
function vigenciaExtra(dados, dia, campanha, regiao = "Grande São Paulo") {
  const dias = Object.entries(dados.extra ?? {}).flatMap(([chave, conteudo]) => {
    const data = dataChave(chave);
    const lista = conteudo?.mercado?.[regiao];
    return data && Array.isArray(lista) && lista.some((item) => item.codigo_campanha === campanha.codigo_campanha && item.link === campanha.link) ? [data] : [];
  }).sort();
  const pos = dias.indexOf(dia);
  if (pos < 0) throw new Error(`Extra: campanha ${campanha.codigo_campanha} não está vigente em ${dia}`);
  let fim = pos;
  while (fim + 1 < dias.length && (Date.parse(`${dias[fim + 1]}T12:00:00Z`) - Date.parse(`${dias[fim]}T12:00:00Z`) === 86400000)) fim += 1;
  return periodo(dia, dias[fim]);
}

async function extra(args = {}, { fetch: buscar = fetch, hoje } = {}) {
  const dia = normalizarHoje(args.hoje ?? hoje);
  const regiao = args.identificador?.regiao ?? "Grande São Paulo";
  const chave = dia.slice(8, 10) + dia.slice(5, 7) + dia.slice(0, 4);
  const json = parsearDataJson(await texto(FONTES.extraDados, buscar));
  const campanhas = json.extra?.[chave]?.mercado?.[regiao];
  if (!Array.isArray(campanhas) || !campanhas.length) throw new Error(`Extra: nenhuma campanha para ${regiao} em ${chave}`);
  const resultado = [];
  for (const campanha of campanhas) {
    const link = urlOficial(campanha.link, FONTES.extra, prefixos.extra);
    const pagina = await html(link, buscar);
    const configUrl = urlOficial(new URL("javascript/config.js", link).href, FONTES.extra, prefixos.extra);
    const config = await texto(configUrl, buscar);
    const paginas = fatiarArray(config, "fliphtml5_pages", "Extra");
    if (!paginas.length) throw new Error(`Extra: campanha ${campanha.codigo_campanha} sem páginas`);
    const assets = paginas.map((item) => {
      const url = urlOficial(item.l, link, prefixos.extra);
      return assetImagem(url);
    });
    const vigencia = vigenciaExtra(json, dia, campanha, regiao);
    resultado.push({
      slug: `extra-${slug(campanha.codigo_campanha)}-${slug(link)}`,
      paginas: assets,
      meta: metadados({ titulo: `Encarte Extra ${campanha.codigo_campanha}`,
        campanha: campanha.codigo_campanha, vigencia, origem: link, regiao,
        evidencia: `${chave}: ${pagina.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? campanha.codigo_campanha}` }),
    });
  }
  return apenasOMaisRecente(resultado, args);
}

async function vigenciaPao(link, buscar) {
  const configUrl = urlOficial(new URL("files/search/book_config.js", link).href, FONTES.paoIndex, prefixos.paodeacucar);
  const trecho = /de (\d{1,2}) a (\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((await texto(configUrl, buscar)).toLowerCase());
  if (!trecho) throw new Error("Pão de Açúcar: validade ausente no book_config.js");
  const dois = (n) => String(n).padStart(2, "0");
  return { vigencia: periodo(dataIso(trecho[4], dois(trecho[3]), dois(trecho[1])), dataIso(trecho[4], dois(trecho[3]), dois(trecho[2]))), trecho: trecho[0] };
}

async function carrefour(args = {}, { fetch: buscar = fetch, hoje } = {}) {
  const dia = normalizarHoje(args.hoje ?? hoje);
  const storeId = args.identificador?.storeId ?? args.storeId ?? "SPR";
  const resposta = await buscar(FONTES.carrefour, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: CARREFOUR_QUERY, variables: { storeId, limit: 100, offset: 0 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resposta.ok) throw new Error(`Fonte indisponível: HTTP ${resposta.status} (Carrefour)`);
  const dados = (await resposta.json())?.data?.searchStoreFlyers;
  if (!Array.isArray(dados)) throw new Error("Carrefour: searchStoreFlyers ausente na resposta");
  const vigentes = dados.filter((flyer) => {
    if (String(flyer.storeId) !== String(storeId)) throw new Error("Carrefour: storeId divergente da configuração");
    return dataBr(flyer.campaignEndDate) >= dia;
  });
  if (!vigentes.length) throw new Error("Carrefour: nenhum folheto vigente");
  return apenasOMaisRecente(vigentes.map((flyer) => {
    if (!Array.isArray(flyer.images) || !flyer.images.length) throw new Error(`Carrefour: folheto ${flyer.id} sem imagens`);
    return {
      slug: `carrefour-${slug(String(flyer.id))}`,
      paginas: flyer.images.map((url) => assetImagem(urlOficial(url, FONTES.carrefour, "https://storage.googleapis.com/carrefour-web-view-tabloides-prod/"))),
      meta: metadados({ titulo: `Encarte Carrefour ${flyer.campaign}`, campanha: String(flyer.id),
        vigencia: periodo(dataBr(flyer.campaignStartDate), dataBr(flyer.campaignEndDate)), origem: FONTES.carrefour,
        loja: { storeId: String(flyer.storeId) },
        evidencia: `${flyer.id} ${flyer.campaignStartDate}..${flyer.campaignEndDate}` }),
    };
  }), args);
}

async function paodeacucar(args = {}, { fetch: buscar = fetch, hoje } = {}) {
  const dia = normalizarHoje(args.hoje ?? hoje);
  const regiao = args.identificador?.regiao ?? "Grande São Paulo";
  const json = parsearDataJson(await texto(FONTES.paoDados, buscar), "Pão de Açúcar");
  // O índice campanhas.js publica com atraso; usa o dia mais recente <= hoje.
  const chaves = Object.keys(json.pao ?? {}).filter((k) => dataChave(k)).filter((k) => dataChave(k) <= dia).sort();
  if (!chaves.length) throw new Error("Pão de Açúcar: índice sem dia anterior ou igual a hoje");
  const chave = chaves[chaves.length - 1];
  const campanhas = json.pao[chave]?.["pao-de-acucar"]?.[regiao];
  if (!Array.isArray(campanhas) || !campanhas.length) throw new Error(`Pão de Açúcar: nenhuma campanha para ${regiao} em ${chave}`);
  const resultado = [];
  for (const campanha of campanhas) {
    const link = urlOficial(campanha.link, FONTES.paoIndex, prefixos.paodeacucar);
    const configUrl = urlOficial(new URL("javascript/config.js", link).href, FONTES.paoIndex, prefixos.paodeacucar);
    const paginas = fatiarArray(await texto(configUrl, buscar), "fliphtml5_pages", "Pão de Açúcar");
    if (!paginas.length) throw new Error(`Pão de Açúcar: campanha ${campanha.codigo_campanha} sem páginas`);
    const datas = await vigenciaPao(link, buscar);
    resultado.push({
      slug: `paodeacucar-${slug(campanha.codigo_campanha)}-${slug(link)}`,
      paginas: paginas.map((item) => assetImagem(urlOficial(item.l, link, prefixos.paodeacucar))),
      meta: metadados({ titulo: `Encarte Pão de Açúcar ${campanha.codigo_campanha}`, campanha: campanha.codigo_campanha,
        vigencia: datas.vigencia, origem: link, regiao, evidencia: datas.trecho }),
    });
  }
  return apenasOMaisRecente(resultado, args);
}

module.exports = { FONTES, chama, roldao, extra, carrefour, paodeacucar };

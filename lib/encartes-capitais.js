"use strict";

// Adapters de aquisição. Nenhuma data é deduzida de nome de arquivo.
const { createHash } = require("node:crypto");

const FONTES = {
  dona: "https://donafazbem.com.br/folheto/ofertas/",
  guanabara: "https://www.supermercadosguanabara.com.br/encarte",
  violeta: "https://supermercadovioleta.com.br/tabloide/",
  violeta_lojas: "https://supermercadovioleta.com.br/lojas/",
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

// /lojas/ do Violeta: blocos "<BAIRRO>" + "LOJA NN" seguidos de "End:" e "Bairro:".
// O tabloide é da rede; a loja configurada se prova aqui, não no post.
const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function parsearLojasVioleta(conteudo, alvo = "Vila Gomes") {
  const limpo = limpar(conteudo).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const linhas = entidades(limpo.replace(/<[^>]+>/g, "\n")).split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const lojas = [];
  linhas.forEach((linha, i) => {
    if (!/^LOJA \d+$/i.test(linha) || i === 0) return;
    const campo = (rotulo) => {
      for (let j = i + 1; j < Math.min(i + 16, linhas.length); j++) {
        if (/^LOJA \d+$/i.test(linhas[j])) break;
        if (new RegExp(`^${rotulo}\\s*:?$`, "i").test(linhas[j])) return linhas[j + 1] ?? null;
      }
      return null;
    };
    lojas.push({ bairro: linhas[i - 1], nome: `${linhas[i - 1]} ${linha}`, endereco: campo("End"), local: campo("Bairro") });
  });
  if (!lojas.length) throw new Error("Violeta: /lojas/ sem blocos de loja; revisar fonte");
  const achadas = lojas.filter((l) => semAcento(l.nome).includes(semAcento(alvo)));
  if (achadas.length !== 1) throw new Error(`Violeta: loja ${alvo} ausente ou ambígua em /lojas/`);
  const [loja] = achadas;
  const partes = String(loja.local ?? "").split(/\s+[–—-]\s+/).map((p) => p.trim());
  const uf = partes.length >= 3 && /^[A-Z]{2}$/.test(partes.at(-1)) ? partes.at(-1) : null;
  const municipio = uf ? partes.at(-2) : null;
  if (!loja.endereco || !municipio) throw new Error(`Violeta: endereço da loja ${alvo} ilegível em /lojas/`);
  return { loja: { nome: loja.nome, endereco: loja.endereco, municipio, uf }, lojas: lojas.map((l) => l.bairro) };
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
async function violetaComEvidencia(args = {}, { fetch: buscar = fetch } = {}) {
  const urlLojas = urlOficial(args.url_loja ?? FONTES.violeta_lojas, FONTES.violeta, "/lojas/");
  const evidenciaFonte = parsearLojasVioleta(await html(urlLojas, buscar), args.loja_contem ?? "Vila Gomes");
  return { encartes: await violeta(args, { fetch: buscar }), evidenciaFonte: { ...evidenciaFonte, url_loja: urlLojas } };
}
// ─── Atakarejo (encarte por cidade, WordPress) ───────────────────────────────
// Validade só existe no HTML, com ano explícito. Aceita mês único
// ("de 26 a 29/10/2026"), virada de mês ("de 30/10 a 03/11/2026") e por extenso.
const MESES_PT = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const pad2 = (n) => String(n).padStart(2, "0");
function periodoAtakarejo(texto) {
  // Uma validade por campanha: duas são ambíguas e falham fechado.
  const duasDatas = [...texto.matchAll(/Ofertas v[aá]lidas de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})\/(\d{4})/gi)];
  const mesUnico = [...texto.matchAll(/Ofertas v[aá]lidas de (\d{2}) a (\d{2})\/(\d{2})\/(\d{4})/gi)];
  // "de 06 e 07 de novembro de 2026" / "entre os dias 30 e 31 de outubro de 2026"
  const extenso = [...texto.matchAll(/Ofertas v[aá]lidas (?:de|entre os dias) (\d{1,2}) (?:e|a) (\d{1,2}) de (\p{L}+) de (\d{4})/giu)];
  // "de 30 de outubro a 02 de novembro de 2026"
  const extensoMeses = [...texto.matchAll(/Ofertas v[aá]lidas de (\d{1,2}) de (\p{L}+) a (\d{1,2}) de (\p{L}+) de (\d{4})/giu)];
  if (duasDatas.length + mesUnico.length + extenso.length + extensoMeses.length !== 1)
    throw new Error("Atakarejo: validade ausente ou ambígua na página da cidade");
  const mesPorNome = (nome) => {
    const mes = MESES_PT[nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
    if (!mes) throw new Error("Atakarejo: mês da validade não reconhecido");
    return mes;
  };
  if (extensoMeses.length) {
    const [, d1, n1, d2, n2, ano] = extensoMeses[0];
    const m1 = mesPorNome(n1), m2 = mesPorNome(n2);
    // Mesma regra da virada de ano dos formatos numéricos.
    const ano1 = m1 === 12 && m2 !== 12 ? Number(ano) - 1 : ano;
    return periodo(`${pad2(d1)}/${pad2(m1)}/${ano1}`, `${pad2(d2)}/${pad2(m2)}/${ano}`);
  }
  if (extenso.length) {
    const [, d1, d2, nome, ano] = extenso[0];
    const mes = mesPorNome(nome);
    return periodo(`${pad2(d1)}/${pad2(mes)}/${ano}`, `${pad2(d2)}/${pad2(mes)}/${ano}`);
  }
  if (mesUnico.length) {
    const [, de, ate, mes, ano] = mesUnico[0];
    return periodo(`${de}/${mes}/${ano}`, `${ate}/${mes}/${ano}`);
  }
  const [, d1, m1, d2, m2, ano] = duasDatas[0];
  // Virada de ano: só recua o ano quando a abertura é em dezembro; um período
  // invertido no mesmo ano (erro da fonte) segue falhando em `periodo`.
  if (m1 === "12" && m2 !== "12")
    return periodo(`${d1}/${m1}/${Number(ano) - 1}`, `${d2}/${m2}/${ano}`);
  return periodo(`${d1}/${m1}/${ano}`, `${d2}/${m2}/${ano}`);
}

function parsearAtakarejo(conteudo, origem) {
  const pagina = limpar(conteudo);
  const pilha = [];
  const cards = [];
  for (const match of pagina.matchAll(/<\/?div\b[^>]*>/gi)) {
    if (/^<\//.test(match[0])) {
      const aberto = pilha.pop();
      if (aberto?.subitem) cards.push(pagina.slice(aberto.inicio, match.index + match[0].length));
    } else {
      pilha.push({ inicio: match.index, subitem: atributo(match[0], "class").split(/\s+/).includes("subitem") });
    }
  }
  // Fail-closed na estrutura: pilha de <div> desbalanceada desloca as fronteiras dos cards,
  // e botão fora de card seria ignorado em silêncio.
  if (pilha.length) throw new Error("Atakarejo: HTML da página desbalanceado; revisar a fonte");
  if (!cards.length) throw new Error("Atakarejo: nenhuma campanha na página da cidade");
  const botoesNaPagina = [...pagina.matchAll(/<a\b[^>]*>/gi)]
    .filter(([tag]) => atributo(tag, "class").split(/\s+/).includes("button-download-ofertas")).length;
  const botoesNosCards = cards.reduce((n, card) => n + [...card.matchAll(/<a\b[^>]*>/gi)]
    .filter(([tag]) => atributo(tag, "class").split(/\s+/).includes("button-download-ofertas")).length, 0);
  if (botoesNaPagina !== botoesNosCards)
    throw new Error("Atakarejo: botão de download fora de card; revisar a fonte");
  // Título é "Salvador | Atakarejo": a cidade vem antes do pipe.
  const cidade = (/<title>\s*([^<|]+?)\s*\|/i.exec(pagina)?.[1] ?? "").trim();
  const vistos = new Set();
  // Toda campanha com botão de download entra; o coletor descarta as fora da vigência.
  return cards.map((card) => {
    const titulo = entidades(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "")
      .replace(/\s+/g, " ").trim();
    const botoes = [...card.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag)
      .filter((tag) => atributo(tag, "class").split(/\s+/).includes("button-download-ofertas"));
    if (botoes.length !== 1) throw new Error(`Atakarejo: botão único ausente na campanha "${titulo}"; revisar a fonte`);
    const url = urlOficial(atributo(botoes[0], "href"), FONTES.atakarejo, "/wp-content/uploads/");
    if (!/\.pdf$/i.test(new URL(url).pathname)) throw new Error("Atakarejo: botão não aponta para PDF");
    if (vistos.has(url)) throw new Error("Atakarejo: campanha duplicada na página da cidade");
    vistos.add(url);
    const texto = entidades(card.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    const vigencia = periodoAtakarejo(texto);
    const trecho = /Ofertas v[aá]lidas (?:de|entre os dias) [^.]+/i.exec(texto)?.[0] ?? null;
    const id = campanha(url);
    return {
      slug: `atakarejo-${id}`,
      pdf: { url, manter: true },
      meta: {
        titulo: titulo || (cidade ? `Encarte Atakarejo ${cidade}` : "Encarte Atakarejo"),
        campanha: id,
        vigencia,
        validade_evidencia: { fonte: origem ?? FONTES.atakarejo, trecho, metodo: "html" },
        revisao_loja_obrigatoria: true,
      },
    };
  });
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

function parsearHiperideal(conteudo, { hoje, permitirVazio = false } = {}) {
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
  if (!encartes.length && !permitirVazio) throw new Error("Hiperideal: nenhuma campanha utilizável");
  return encartes;
}

// ─── Evidência de identidade (Salvador, SPEC rotina Salvador §3.2) ───────────
// O coletor só aceita "sem campanha" com fonte lida, identidade conferida e 0
// encartes em vigor. Estas funções só leem a fonte; `descobrir` segue como era.
const hojeFortaleza = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
const textoDe = (trecho) => entidades(trecho.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function evidenciaAtakarejo(conteudo, origem, hoje, encartes) {
  const pagina = limpar(conteudo);
  const tituloPagina = (/<title>\s*([^<|]+?)\s*\|/i.exec(pagina)?.[1] ?? "").trim() || null;
  const secao = /<div\b[^>]*class=["'][^"']*\bsection-encartes\b[^"']*["'][^>]*>[\s\S]*?<h3\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(pagina);
  const bloco = /<div\b[^>]*class=["'][^"']*\bfiltro-encartes\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(pagina)?.[1] ?? "";
  let cidadeAtiva = null;
  const outras = [];
  for (const [, atributos, interno] of bloco.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a ${atributos}>`;
    const slug = /\/cidades\/([^/?#]+)/.exec(atributo(tag, "href"))?.[1] ?? null;
    if (atributo(tag, "class").split(/\s+/).includes("ativo")) cidadeAtiva = slug;
    else if (textoDe(interno)) outras.push(textoDe(interno));
  }
  const secaoTitulo = secao ? textoDe(secao[1]) : null;
  return {
    url: origem,
    pagina_titulo: tituloPagina,
    secao: secaoTitulo,
    cidade_ativa: cidadeAtiva,
    outras_pracas: outras,
    quantidadeFlyersNaFonte: encartes.filter((e) => e.meta.vigencia.de <= hoje && hoje <= e.meta.vigencia.ate).length,
    ...(secaoTitulo ? { loja: { praca: secaoTitulo } } : {}),
  };
}
async function atakarejoComEvidencia(args = {}, { fetch: buscar = fetch, hoje: hojeDeps } = {}) {
  const origem = args.url ?? FONTES.atakarejo;
  const hoje = args.hoje ?? hojeDeps ?? hojeFortaleza();
  const conteudo = await html(origem, buscar);
  // Página sem nenhum botão só prova ausência se o resto do layout foi reconhecido.
  const semBotoes = !/button-download-ofertas|class=["'][^"']*\bsubitem\b/.test(limpar(conteudo));
  const encartes = semBotoes ? [] : parsearAtakarejo(conteudo, origem);
  const evidenciaFonte = evidenciaAtakarejo(conteudo, origem, hoje, encartes);
  if (semBotoes && (!evidenciaFonte.secao || !evidenciaFonte.cidade_ativa))
    throw new Error("Atakarejo: página sem campanhas e sem layout reconhecido; revisar a fonte");
  return { encartes, evidenciaFonte };
}

function evidenciaHiperideal(conteudo, hoje) {
  const corte = conteudo.indexOf('"blockId":"hiperideal.store-theme@0.x:encartes#encartes"');
  if (corte < 0) throw new Error("Hiperideal: bloco de encartes mudou de identificador");
  const lista = fatiarLista(conteudo.slice(corte), '"content":{"encartes":[');
  const entradas = lista.map((i) => ({ nome: entidades(String(i.nome ?? "")).trim().replace(/\s+/g, " "),
    dataInicio: i.dataInicio ?? null, dataFim: i.dataFim ?? null }));
  const semAcentoMin = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const daLoja = entradas.find((e) => /\bvitoria\b(?!\s+da\s+conquista)/.test(semAcentoMin(e.nome)));
  const deTodas = entradas.find((e) => /\btodas as lojas\b/.test(semAcentoMin(e.nome)));
  const achada = daLoja ? { nome: "Vitória", entrada: daLoja.nome } : deTodas ? { nome: "todas as lojas", entrada: deTodas.nome } : null;
  return {
    url: FONTES.hiperideal,
    entradas,
    quantidadeFlyersNaFonte: entradas.filter((e) => !e.dataInicio || !e.dataFim || (e.dataInicio <= hoje && hoje <= e.dataFim)).length,
    ...(achada ? { loja: achada } : {}),
  };
}
async function hiperidealComEvidencia(args = {}, { fetch: buscar = fetch, hoje: hojeDeps } = {}) {
  const hoje = args.hoje ?? hojeDeps ?? hojeFortaleza();
  const conteudo = await html(FONTES.hiperideal, buscar);
  const encartes = parsearHiperideal(conteudo, { hoje, permitirVazio: true });
  return { encartes, evidenciaFonte: evidenciaHiperideal(conteudo, hoje) };
}

async function atakarejo(args = {}, { fetch: buscar = fetch } = {}) {
  const origem = args.url ?? FONTES.atakarejo;
  return parsearAtakarejo(await html(origem, buscar), origem);
}
async function hiperideal(_args, { fetch: buscar = fetch, hoje } = {}) {
  return parsearHiperideal(await html(FONTES.hiperideal, buscar), { hoje });
}

module.exports = { FONTES, parsearDona, parsearGuanabara, linksVioleta, parsearVioleta, parsearLojasVioleta, violetaComEvidencia,
  dona, guanabara, violeta, parsearAtakarejo, parsearHiperideal, atakarejo, hiperideal,
  evidenciaAtakarejo, atakarejoComEvidencia, evidenciaHiperideal, hiperidealComEvidencia };

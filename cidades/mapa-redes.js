#!/usr/bin/env node
"use strict";

// Mapa nacional de cidades × redes. Lê as listas oficiais de lojas do
// Atacadão, do Assaí e do Grupo Mateus, casa cada loja com o município do
// IBGE e agrega por cidade. Só leitura: nenhum adapter de captura muda.
//
// Uso: node cidades/mapa-redes.js [--saida <pasta>] [--data AAAA-MM-DD] [--sem-cache]

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const ATACADAO_API = "https://apigw.cloud.carrefour.com.br/api-middleware-flyer-services/api/v2/Store";
const MATEUS_PROXY = "https://ofertasmateus.com/api-proxy.php";
const ASSAI_ESTADO_URL = "https://www.assai.com.br/ofertas/pernambuco";
const ASSAI_PAYLOAD = "/sites/default/files/static/ofertas_assai.json";
const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const PAUSA_MS = 300;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function normalizarNome(nome) {
  return String(nome ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const chave = (uf, nome) => `${String(uf).toUpperCase()}|${normalizarNome(nome)}`;

function indexarMunicipios(lista) {
  const porNome = new Map();
  const municipios = lista.map((m) => {
    const uf = m.microrregiao?.mesorregiao?.UF?.sigla ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla ?? m.uf;
    return { ibge: Number(m.id), nome: m.nome, uf };
  });
  for (const m of municipios) porNome.set(chave(m.uf, m.nome), m);
  return { municipios, porNome };
}

function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Casa uma loja pelo nome exato (normalizado). Sem nome, usa a coordenada
// contra os municípios da mesma UF que já receberam loja por nome.
function casarLojas(lojas, { porNome }) {
  const casadas = [];
  const naoCasadas = [];
  for (const loja of lojas) {
    // O DF é um município só; as redes escrevem a região administrativa (Gama, Taguatinga).
    const municipio = loja.uf === "DF" ? porNome.get(chave("DF", "Brasília"))
      : loja.cidade_bruta ? porNome.get(chave(loja.uf, loja.cidade_bruta)) : null;
    if (municipio) casadas.push({ ...loja, ibge: municipio.ibge, casamento: "nome" });
    else naoCasadas.push(loja);
  }
  const ancoras = casadas.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon));
  const restantes = [];
  for (const loja of naoCasadas) {
    if (loja.cidade_bruta || !Number.isFinite(loja.lat) || !Number.isFinite(loja.lon)) {
      restantes.push(loja);
      continue;
    }
    const vizinha = ancoras
      .filter((a) => a.uf === loja.uf)
      .map((a) => ({ a, d: distanciaKm(a, loja) }))
      .sort((x, y) => x.d - y.d)[0];
    if (vizinha && vizinha.d <= 15) casadas.push({ ...loja, ibge: vizinha.a.ibge, casamento: "coordenada" });
    else restantes.push(loja);
  }
  return { casadas, naoCasadas: restantes };
}

function agregar(casadas, { municipios }) {
  const porIbge = new Map(municipios.map((m) => [m.ibge, m]));
  const cidades = new Map();
  for (const loja of casadas) {
    const m = porIbge.get(loja.ibge);
    if (!cidades.has(m.ibge)) cidades.set(m.ibge, { ibge: m.ibge, nome: m.nome, uf: m.uf, redes: {} });
    const c = cidades.get(m.ibge);
    (c.redes[loja.rede] ??= []).push(resumoLoja(loja));
  }
  return [...cidades.values()]
    .map((c) => {
      for (const lista of Object.values(c.redes)) lista.sort((a, b) => a.slug.localeCompare(b.slug));
      return {
        ...c,
        n_redes: Object.keys(c.redes).length,
        n_lojas: Object.values(c.redes).reduce((s, l) => s + l.length, 0),
      };
    })
    .sort((a, b) => b.n_redes - a.n_redes || b.n_lojas - a.n_lojas || a.ibge - b.ibge);
}

function resumoLoja(l) {
  const r = { slug: l.loja_slug, nome: l.loja_nome };
  if (l.marca) r.marca = l.marca;
  if (l.ids) r.ids = l.ids;
  if (l.encartes_vigentes != null) r.encartes_vigentes = l.encartes_vigentes;
  if (l.casamento !== "nome") r.casamento = l.casamento;
  return r;
}

// ---------- coletores (cada um recebe `obter(url, tipo)` com cache) ----------

function lojaAtacadao(s, hoje) {
  const flyers = Array.isArray(s.flyers) ? s.flyers : [];
  return {
    rede: "atacadao",
    uf: s.estado,
    cidade_bruta: s.cidade,
    loja_slug: s.slug,
    loja_nome: s.loja,
    ids: { storeId: s.storeId },
    lat: Number(s.lat),
    lon: Number(s.long),
    encartes_vigentes: flyers.filter((f) => f.exclude !== true && f.validity?.final?.slice(0, 10) >= hoje).length,
  };
}

async function coletarAtacadao(obter, hoje) {
  const lojas = [];
  for (const uf of UFS) {
    const cidades = await obter(`${ATACADAO_API}/city/uf?uf=${uf}`, "json");
    for (const cidade of Array.isArray(cidades) ? cidades : []) {
      for (let pagina = 1; pagina < 50; pagina++) {
        const q = new URLSearchParams({ uf, city: cidade.id, pageSize: "24", pageNumber: String(pagina), "api-version": "2" });
        const r = await obter(`${ATACADAO_API}/city?${q}`, "json");
        const stores = Array.isArray(r?.stores) ? r.stores : [];
        lojas.push(...stores.map((s) => lojaAtacadao(s, hoje)));
        if (stores.length < 24) break;
      }
    }
  }
  return dedupe(lojas, (l) => l.ids.storeId);
}

async function coletarMateus(obter, hoje) {
  const api = async (endpoint) => {
    const r = await obter(`${MATEUS_PROXY}?endpoint=${encodeURIComponent(endpoint)}`, "json");
    if (r?.status !== "success") throw new Error(`Mateus ${endpoint}: resposta inesperada`);
    return r.data;
  };
  const lojas = [];
  for (const estado of await api("/estados")) {
    for (const cidade of await api(`/estados/${estado.sigla}/cidades`)) {
      for (const l of await api(`/cidades/${cidade.idcidade}/lojas`)) {
        let encartes = null;
        try {
          const itens = await api(`/encartes/${estado.sigla.toLowerCase()}/${cidade.idcidade}/${l.idloja}?marca=${encodeURIComponent(l.marca)}`);
          encartes = (Array.isArray(itens) ? itens : []).filter((e) => String(e.validade ?? "").slice(0, 10) >= hoje).length;
        } catch {
          encartes = null;
        }
        lojas.push({
          rede: "mateus",
          marca: l.marca,
          uf: estado.sigla,
          cidade_bruta: cidade.descricao,
          loja_slug: l.idloja,
          loja_nome: String(l.nome_exibicao ?? "").trim(),
          ids: { idcidade: cidade.idcidade },
          encartes_vigentes: encartes,
        });
      }
    }
  }
  return dedupe(lojas, (l) => l.loja_slug);
}

function brParaIso(data) {
  const [d, m, a] = String(data ?? "").split("/");
  return a && m && d ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";
}

// O HTML da página de estado traz um objeto por loja com nid, cidade (c) e uf.
function extrairLojasAssai(html) {
  const lojas = new Map();
  for (const bruto of html.match(/\{[^{}]*"nid":"\d+"[^{}]*"uf":"[A-Z]{2}"[^{}]*\}/g) ?? []) {
    let d;
    try { d = JSON.parse(bruto); } catch { continue; }
    if (d.c == null) continue;
    lojas.set(String(d.nid), d);
  }
  return [...lojas.values()];
}

function lojasAssai(html, payload, hoje) {
  const campanhas = new Map();
  for (const o of Array.isArray(payload?.ofertas) ? payload.ofertas : []) {
    const de = brParaIso(o.start_date);
    const ate = brParaIso(o.end_date);
    if (!(de <= hoje && ate >= hoje)) continue;
    for (const l of Array.isArray(o.lojas) ? o.lojas : []) {
      campanhas.set(String(l.nid), (campanhas.get(String(l.nid)) ?? 0) + 1);
    }
  }
  return extrairLojasAssai(html).map((d) => ({
    rede: "assai",
    uf: d.uf,
    cidade_bruta: String(d.c).trim(),
    loja_slug: String(d.url ?? "").split("/").pop(),
    loja_nome: d.name ?? d.title ?? d.nome ?? String(d.url ?? "").split("/").pop(),
    ids: { nid: Number(d.nid), eid: Number(d.eid) },
    lat: Number(d.lat),
    lon: Number(d.lon),
    encartes_vigentes: payload ? campanhas.get(String(d.nid)) ?? 0 : null,
  }));
}

async function coletarAssai(cacheDir, usarCache, hoje) {
  const arqHtml = path.join(cacheDir, "assai-estado.html");
  const arqPayload = path.join(cacheDir, "assai-payload.json");
  let html;
  let payload;
  if (usarCache) {
    html = await fs.readFile(arqHtml, "utf8").catch(() => null);
    payload = await fs.readFile(arqPayload, "utf8").then(JSON.parse).catch(() => null);
  }
  if (!html) {
    const { chromium } = require(path.join(__dirname, "..", "assai-encartes", "node_modules", "playwright"));
    const browser = await chromium.launch({ headless: true });
    try {
      const contexto = await browser.newContext({ userAgent: UA, locale: "pt-BR", timezoneId: "America/Fortaleza" });
      const page = await contexto.newPage();
      const respostaPayload = page.waitForResponse((r) => r.url().includes(ASSAI_PAYLOAD), { timeout: 60000 });
      respostaPayload.catch(() => {});
      await page.goto(ASSAI_ESTADO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      html = await page.content();
      payload = await respostaPayload.then((r) => r.json()).catch(() => null);
    } finally {
      await browser.close();
    }
    await fs.writeFile(arqHtml, html);
    if (payload) await fs.writeFile(arqPayload, JSON.stringify(payload));
  }
  const lojas = lojasAssai(html, payload, hoje);
  if (lojas.length === 0) throw new Error("Assaí: nenhuma loja no HTML da página de estado");
  return { lojas, comPayload: Boolean(payload) };
}

function dedupe(lista, chaveFn) {
  const vistos = new Map();
  for (const item of lista) vistos.set(String(chaveFn(item)), item);
  return [...vistos.values()];
}

function criarObter(cacheDir, usarCache) {
  let ultima = 0;
  return async function obter(url, tipo) {
    const nome = Buffer.from(url).toString("base64url").slice(-180);
    const arq = path.join(cacheDir, "http", `${nome}.${tipo}`);
    if (usarCache) {
      const salvo = await fs.readFile(arq, "utf8").catch(() => null);
      if (salvo != null) return tipo === "json" ? JSON.parse(salvo) : salvo;
    }
    const espera = ultima + PAUSA_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultima = Date.now();
    const resposta = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" }, signal: AbortSignal.timeout(30000) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status} em ${url}`);
    const texto = await resposta.text();
    const valor = tipo === "json" ? JSON.parse(texto) : texto;
    await fs.mkdir(path.dirname(arq), { recursive: true });
    await fs.writeFile(arq, texto);
    return valor;
  };
}

// ---------- relatório ----------

const NOMES_REDE = { atacadao: "Atacadão", assai: "Assaí", mateus: "Grupo Mateus" };
const REDES = ["atacadao", "assai", "mateus"];

function linhaCidade(c) {
  const celulas = REDES.map((r) => {
    const lojas = c.redes[r];
    if (!lojas) return "—";
    const marcas = r === "mateus" ? ` (${[...new Set(lojas.map((l) => l.marca))].join(", ")})` : "";
    return `${lojas.length}${marcas}`;
  });
  return `| ${c.nome} | ${c.uf} | ${celulas.join(" | ")} | ${c.n_lojas} |`;
}

function relatorioMd({ data, cidades, totais, naoCasadas, avisos }) {
  const cab = `| Cidade | UF | ${REDES.map((r) => NOMES_REDE[r]).join(" | ")} | Lojas |\n|---|---|---|---|---|---|`;
  const tres = cidades.filter((c) => c.n_redes === 3);
  const duas = cidades.filter((c) => c.n_redes === 2);
  const uma = cidades.filter((c) => c.n_redes === 1);
  const porUf = new Map();
  for (const c of uma) (porUf.get(c.uf) ?? porUf.set(c.uf, []).get(c.uf)).push(`${c.nome} (${Object.keys(c.redes).map((r) => NOMES_REDE[r]).join("")})`);
  const linhas = [
    `# Mapa nacional de redes — ${data}`,
    "",
    "Fonte: listas oficiais de lojas de cada rede, casadas com os municípios do IBGE. Gerado por `cidades/mapa-redes.js` (repo promocoes-supermercados-fortaleza).",
    "",
    "## Totais",
    "",
    "| Rede | Lojas | Lojas casadas | Cidades |",
    "|---|---|---|---|",
    ...REDES.map((r) => `| ${NOMES_REDE[r]} | ${totais[r].lojas} | ${totais[r].casadas} | ${totais[r].cidades} |`),
    "",
    "Marcas do Grupo Mateus: MA = Mix Mateus, SM = Mateus Supermercados, CS = Camiño, AR = Armazém, FS = Food Service, SZ = Spazio.",
    "",
    `Cidades com 3 redes: **${tres.length}** · com 2: **${duas.length}** · com 1: **${uma.length}**`,
    ...(avisos.length ? ["", ...avisos.map((a) => `> ${a}`)] : []),
    "",
    "## Cidades com as 3 redes",
    "",
    cab,
    ...tres.map(linhaCidade),
    "",
    "## Cidades com 2 redes",
    "",
    cab,
    ...duas.map(linhaCidade),
    "",
    "## Cidades com 1 rede, por UF",
    "",
    ...[...porUf.keys()].sort().map((uf) => `- **${uf}**: ${porUf.get(uf).sort().join(", ")}`),
    "",
    "## Lojas não casadas com município",
    "",
    naoCasadas.length
      ? naoCasadas.map((l) => `- ${NOMES_REDE[l.rede]} \`${l.loja_slug}\` — cidade "${l.cidade_bruta ?? ""}" / ${l.uf}`).join("\n")
      : "Nenhuma.",
    "",
  ];
  return linhas.join("\n");
}

// ---------- main ----------

function lerArgs(argv) {
  const args = { saida: path.join(os.homedir(), "Developer", "mercadomaisbarato", "docs", "relatorios"), data: null, cache: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--saida") args.saida = argv[++i];
    else if (argv[i] === "--data") args.data = argv[++i];
    else if (argv[i] === "--sem-cache") args.cache = false;
    else if (argv[i] === "--help") {
      console.log("Uso: node cidades/mapa-redes.js [--saida <pasta>] [--data AAAA-MM-DD] [--sem-cache]");
      process.exit(0);
    } else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  const hoje = args.data ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
  const cacheDir = path.join(__dirname, "cache", hoje);
  await fs.mkdir(cacheDir, { recursive: true });
  const obter = criarObter(cacheDir, args.cache);

  console.log("IBGE: municípios…");
  const ibge = indexarMunicipios(await obter(IBGE_URL, "json"));
  console.log(`  ${ibge.municipios.length} municípios`);

  const avisos = [];
  const lojas = [];
  console.log("Atacadão…");
  lojas.push(...(await coletarAtacadao(obter, hoje)));
  console.log("Grupo Mateus…");
  lojas.push(...(await coletarMateus(obter, hoje)));
  console.log("Assaí…");
  try {
    const assai = await coletarAssai(cacheDir, args.cache, hoje);
    lojas.push(...assai.lojas);
    if (!assai.comPayload) avisos.push("Assaí: payload de campanhas não carregou; encartes vigentes do Assaí ficaram sem contagem.");
  } catch (erro) {
    avisos.push(`Assaí ficou fora do mapa: ${erro.message}`);
  }

  const { casadas, naoCasadas } = casarLojas(lojas, ibge);
  const cidades = agregar(casadas, ibge);
  const totais = Object.fromEntries(REDES.map((r) => [r, {
    lojas: lojas.filter((l) => l.rede === r).length,
    casadas: casadas.filter((l) => l.rede === r).length,
    cidades: cidades.filter((c) => c.redes[r]).length,
  }]));

  const base = path.join(args.saida, `mapa-redes-nacionais-${hoje}`);
  await fs.mkdir(args.saida, { recursive: true });
  const nc = naoCasadas.map(({ rede, uf, cidade_bruta, loja_slug }) => ({ rede, uf, cidade_bruta, loja_slug }));
  await fs.writeFile(`${base}.json`, JSON.stringify({ data: hoje, totais, avisos, cidades, nao_casadas: nc }, null, 2) + "\n");
  await fs.writeFile(`${base}.md`, relatorioMd({ data: hoje, cidades, totais, naoCasadas: nc, avisos }));

  for (const r of REDES) console.log(`  ${NOMES_REDE[r]}: ${totais[r].lojas} lojas, ${totais[r].casadas} casadas, ${totais[r].cidades} cidades`);
  for (const a of avisos) console.log(`  [aviso] ${a}`);
  console.log(`Cidades com 3 redes: ${cidades.filter((c) => c.n_redes === 3).length}`);
  console.log(`Saída: ${base}.json / .md`);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}

module.exports = { normalizarNome, indexarMunicipios, casarLojas, agregar, lojaAtacadao, lojasAssai, extrairLojasAssai, relatorioMd };

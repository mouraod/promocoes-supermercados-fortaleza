"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FONTES, chama, extra } = require("./encartes-sp");

function fetchFalso(respostas) {
  return async (url) => {
    const resposta = respostas[url];
    if (!resposta) throw new Error(`URL inesperada: ${url}`);
    return { ok: true, headers: { get: (nome) => nome.toLowerCase() === "content-type" ? resposta.tipo : null }, text: async () => resposta.texto };
  };
}
const html = (texto) => ({ tipo: "text/html; charset=utf-8", texto });
const js = (texto) => ({ tipo: "application/javascript", texto });

test("Chama ordena PG, remove tamanho da miniatura e seleciona a campanha vigente", async () => {
  const origem = FONTES.chama;
  const base = "https://www.grupochama.com.br/wp-content/uploads/2026/10/";
  const pagina = (n) => `${base}Tabloide-Rede-28.10-a-03.11.26-PG${n}-792x1024.jpg`;
  const buscar = fetchFalso({ [origem]: html(`<img src="${pagina("02")}"><img src="${pagina("01")}">`) });
  const [encarte] = await chama({ hoje: "03112026" }, { fetch: buscar });
  assert.equal(encarte.meta.vigencia.de, "2026-10-28");
  assert.equal(encarte.meta.vigencia.ate, "2026-11-03");
  assert.deepEqual(encarte.paginas.map((p) => p.url), [
    pagina("01").replace("-792x1024", ""), pagina("02").replace("-792x1024", ""),
  ]);
  assert.equal(encarte.meta.revisao_loja_obrigatoria, true);
});

test("Chama segue os posts de tabloide da página de ofertas e lê a galeria (layout de 04/11/2026)", async () => {
  const base = "https://www.grupochama.com.br/wp-content/uploads/2023/07/";
  const post = "https://www.grupochama.com.br/tabloide-de-ofertas-supermercado-chama/";
  const loja = "https://www.grupochama.com.br/tabloide-de-ofertas-supermercado-chama-guarulhos/";
  const farma = "https://www.grupochama.com.br/tabloide-ofertas-farma-chama/";
  const rede = (pg, sufixo) => `${base}Tabloide-Rede-11.11-a-a17.11.26-${pg}-${sufixo}.jpg`;
  const principal = `<a href="${loja}"></a><img src="${rede("PG01", "792x1024")}"><a href="${farma}"></a><a href="${post}"></a>
    <img src="${base}Tabloide-Rede-25.03-a-31.03.26-PG01-662x1024.jpg">`;
  const galeria = ["PG01", "PG02", "PG03-1", "PG04"].map((pg) => `<img src="${rede(pg, "792x1024")}">`).join("")
    + `<script>{"pages":["${rede("PG04", "scaled")}","${rede("PG01", "scaled")}"]}</script>`
    + ["PG01", "PG02", "PG03-1"].map((pg) => `<i data-u="${rede(pg, "scaled").replaceAll("/", "\\/")}">`).join("");
  const consultadas = [];
  const base_ = fetchFalso({
    [FONTES.chama]: html(principal),
    [post]: html(galeria),
    [loja]: html(`<img src="${base}Tabloide-loja-19-11.11-a-17.11.26-PG01.jpg">`),
  });
  const buscar = async (url, ...resto) => { consultadas.push(url); return base_(url, ...resto); };
  const encartes = await chama({ hoje: "12112026" }, { fetch: buscar });
  assert.equal(encartes.length, 1);
  const [encarte] = encartes;
  assert.equal(encarte.slug, "chama-tabloide-rede-11-11-a-17-11-26");
  assert.equal(encarte.meta.campanha, "Tabloide-Rede-11.11-a-17.11.26");
  assert.deepEqual(encarte.meta.vigencia, { de: "2026-11-11", ate: "2026-11-17" });
  assert.deepEqual(encarte.paginas.map((p) => p.url), [
    rede("PG01", "scaled"), rede("PG02", "scaled"), rede("PG03-1", "scaled"), rede("PG04", "scaled"),
  ]);
  assert.ok(!consultadas.includes(farma), "post da Farma não é consultado");
});

test("Chama tolera post alheio fora do ar quando a capa da rede já veio, e falha claro sem nada vigente", async () => {
  const post = "https://www.grupochama.com.br/tabloide-de-ofertas-supermercado-chama/";
  const capa = "https://www.grupochama.com.br/wp-content/uploads/2023/07/Tabloide-Rede-11.11-a-17.11.26-PG01-792x1024.jpg";
  const buscar = fetchFalso({ [FONTES.chama]: html(`<img src="${capa}"><a href="${post}"></a>`) });
  const [encarte] = await chama({ hoje: "12112026" }, { fetch: buscar });
  assert.deepEqual(encarte.paginas.map((p) => p.url), [capa.replace("-792x1024", "")]);
  const semNada = fetchFalso({ [FONTES.chama]: html(`<a href="${post}"></a>`) });
  await assert.rejects(chama({ hoje: "12112026" }, { fetch: semNada }), /Chama: nenhuma campanha vigente.*falhas nos posts/);
});

test("Chama dá erro claro se não houver campanha vigente", async () => {
  const buscar = fetchFalso({ [FONTES.chama]: html("") });
  await assert.rejects(chama({ hoje: "04112026" }, { fetch: buscar }), /Chama: nenhuma campanha vigente/);
});

test("Extra usa o calendário diário e percorre fliphtml5_pages na ordem", async () => {
  const linkTerca = "https://folheteria.clubeextra.com.br/home/sites/mercado/pubs/terca-quinta/link_sp/index.html";
  const linkLimpa = "https://folheteria.clubeextra.com.br/home/sites/mercado/pubs/casa-limpa/link_a_sp/index.html";
  const campanha = (codigo, link) => ({ codigo_campanha: codigo, link, horario_inicial_campanha: "00" });
  const daily = {
    "03112026": [campanha("terca-quinta", linkTerca), campanha("casa-limpa", linkLimpa)],
    "04112026": [campanha("terca-quinta", linkTerca), campanha("casa-limpa", linkLimpa)],
    "05112026": [campanha("terca-quinta", linkTerca), campanha("casa-limpa", linkLimpa)],
    "06112026": [campanha("casa-limpa", linkLimpa)],
    "07112026": [campanha("casa-limpa", linkLimpa)],
    "08112026": [campanha("casa-limpa", linkLimpa)],
    "09112026": [campanha("casa-limpa", linkLimpa)],
  };
  const data = { extra: Object.fromEntries(Object.entries(daily).map(([dia, lista]) => [dia, { mercado: { "Grande São Paulo": lista } }])) };
  const dadosJS = `var dataJsonInformation = '${JSON.stringify(JSON.stringify(data)).slice(1, -1)}'`;
  const config = `var fliphtml5_pages=${JSON.stringify([1, 2, 3].map((n) => ({ l: `files/large/${n}.jpg` })))};`;
  const respostas = { [FONTES.extraDados]: js(dadosJS) };
  for (const link of [linkTerca, linkLimpa]) {
    respostas[link] = html("<title>Extra - encarte</title>");
    respostas[new URL("javascript/config.js", link).href] = js(config);
  }
  const encartes = await extra({ hoje: "03112026" }, { fetch: fetchFalso(respostas) });
  assert.equal(encartes.length, 2);
  assert.deepEqual(encartes.map((e) => e.meta.campanha), ["terca-quinta", "casa-limpa"]);
  assert.deepEqual(encartes[0].meta.vigencia, { de: "2026-11-03", ate: "2026-11-05" });
  assert.deepEqual(encartes[1].meta.vigencia, { de: "2026-11-03", ate: "2026-11-09" });
  assert.equal(encartes[0].paginas.length, 3);
  assert.match(encartes[0].paginas[0].url, /terca-quinta\/link_sp\/files\/large\/1\.jpg$/);
  assert.equal(encartes[0].meta.revisao_loja_obrigatoria, true);
});

test("Extra falha com asset que não é uma página de imagem", async () => {
  const link = "https://folheteria.clubeextra.com.br/home/sites/mercado/pubs/terca-quinta/link_sp/index.html";
  const data = { extra: { "03112026": { mercado: { "Grande São Paulo": [{ codigo_campanha: "terca-quinta", link }] } } } };
  const dadosJS = `var dataJsonInformation = '${JSON.stringify(JSON.stringify(data)).slice(1, -1)}'`;
  const buscar = fetchFalso({
    [FONTES.extraDados]: js(dadosJS),
    [link]: html("<title>Extra</title>"),
    [new URL("javascript/config.js", link).href]: js('var fliphtml5_pages=[{"l":"files/large/1.pdf"}];'),
  });
  await assert.rejects(extra({ hoje: "03112026" }, { fetch: buscar }), /Asset de encarte inválido/);
});

test("Extra recusa links fora do domínio oficial", async () => {
  const data = { extra: { "03112026": { mercado: { "Grande São Paulo": [{
    codigo_campanha: "terca-quinta", link: "https://malicioso.example/viewer/index.html",
  }] } } } };
  const dadosJS = `var dataJsonInformation = '${JSON.stringify(JSON.stringify(data)).slice(1, -1)}'`;
  await assert.rejects(extra({ hoje: "03112026" }, { fetch: fetchFalso({ [FONTES.extraDados]: js(dadosJS) }) }), /origem oficial/);
});

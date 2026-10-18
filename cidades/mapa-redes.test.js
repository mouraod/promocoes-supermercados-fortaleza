"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizarNome, indexarMunicipios, casarLojas, agregar, lojaAtacadao, lojasAssai } = require("./mapa-redes");

const ibge = indexarMunicipios([
  { id: 2304400, nome: "Fortaleza", microrregiao: { mesorregiao: { UF: { sigla: "CE" } } } },
  { id: 2303709, nome: "Crateús", microrregiao: { mesorregiao: { UF: { sigla: "CE" } } } },
  { id: 2607901, nome: "Jaboatão dos Guararapes", microrregiao: { mesorregiao: { UF: { sigla: "PE" } } } },
  { id: 2611606, nome: "Recife", microrregiao: { mesorregiao: { UF: { sigla: "PE" } } } },
  { id: 2111300, nome: "São Luís", microrregiao: null, "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: "MA" } } } },
]);

test("normaliza acento, espaço nas pontas, hífen e apóstrofo", () => {
  assert.equal(normalizarNome(" Crateús"), "crateus");
  assert.equal(normalizarNome("Jaboatão-dos-Guararapes"), "jaboatao dos guararapes");
  assert.equal(normalizarNome("SÃO LUÍS"), "sao luis");
  assert.equal(normalizarNome("Olho d'Água"), "olho d agua");
});

test("casa por nome dentro da UF e não confunde estados", () => {
  const { casadas, naoCasadas } = casarLojas([
    { rede: "mateus", uf: "CE", cidade_bruta: " Crateús", loja_slug: "mix-crateus" },
    { rede: "mateus", uf: "MA", cidade_bruta: "São Luís", loja_slug: "mix-sl" },
    { rede: "assai", uf: "CE", cidade_bruta: "Recife", loja_slug: "errada" },
  ], ibge);
  assert.deepEqual(casadas.map((l) => [l.loja_slug, l.ibge]), [["mix-crateus", 2303709], ["mix-sl", 2111300]]);
  assert.deepEqual(naoCasadas.map((l) => l.loja_slug), ["errada"]);
});

test("sem nome de cidade, casa pela coordenada até 15 km de loja já casada", () => {
  const { casadas, naoCasadas } = casarLojas([
    { rede: "atacadao", uf: "PE", cidade_bruta: "Recife", loja_slug: "recife-a", lat: -8.05, lon: -34.9 },
    { rede: "assai", uf: "PE", cidade_bruta: "", loja_slug: "perto", lat: -8.06, lon: -34.91 },
    { rede: "assai", uf: "PE", cidade_bruta: "", loja_slug: "longe", lat: -9.0, lon: -36.0 },
  ], ibge);
  assert.equal(casadas.find((l) => l.loja_slug === "perto").casamento, "coordenada");
  assert.deepEqual(naoCasadas.map((l) => l.loja_slug), ["longe"]);
});

test("Atacadão conta só encartes vigentes e não excluídos", () => {
  const loja = lojaAtacadao({
    storeId: 47, slug: "recife-iputinga", loja: "Recife Iputinga", cidade: "Recife", estado: "PE", lat: "-8.03", long: "-34.93",
    flyers: [
      { exclude: false, validity: { final: "2026-10-19T00:00:00Z" } },
      { exclude: true, validity: { final: "2026-10-19T00:00:00Z" } },
      { exclude: false, validity: { final: "2026-10-10T00:00:00Z" } },
    ],
  }, "2026-10-18");
  assert.equal(loja.encartes_vigentes, 1);
  assert.equal(loja.ids.storeId, 47);
});

test("Assaí: lê lojas do HTML e conta campanhas vigentes por nid", () => {
  const html = `<script>x=[{"nid":"16266","url":"\\/loja\\/assai-avenida-recife","c":"Recife","e":"Pernambuco","eid":16,"uf":"PE","lat":"-8.1","lon":"-34.9"},{"nid":"1","url":"\\/loja\\/assai-jaboatao","c":"Jaboat\\u00e3o dos Guararapes","eid":16,"uf":"PE","lat":"-8.2","lon":"-34.95"}]</script>`;
  const payload = { ofertas: [
    { start_date: "13/10/2026", end_date: "19/10/2026", lojas: [{ eid: 16, nid: 16266 }] },
    { start_date: "01/10/2026", end_date: "05/10/2026", lojas: [{ eid: 16, nid: 16266 }] },
  ] };
  const lojas = lojasAssai(html, payload, "2026-10-18");
  assert.deepEqual(lojas.map((l) => [l.loja_slug, l.cidade_bruta, l.encartes_vigentes]), [
    ["assai-avenida-recife", "Recife", 1],
    ["assai-jaboatao", "Jaboatão dos Guararapes", 0],
  ]);
});

test("agrega por município e ordena por número de redes", () => {
  const { casadas } = casarLojas([
    { rede: "atacadao", uf: "CE", cidade_bruta: "Fortaleza", loja_slug: "fortaleza-aeroporto" },
    { rede: "assai", uf: "CE", cidade_bruta: "Fortaleza", loja_slug: "assai-bezerra-m" },
    { rede: "mateus", marca: "MA", uf: "CE", cidade_bruta: "Fortaleza", loja_slug: "mix-henrique-jorge" },
    { rede: "atacadao", uf: "PE", cidade_bruta: "Recife", loja_slug: "recife-iputinga" },
  ], ibge);
  const cidades = agregar(casadas, ibge);
  assert.deepEqual(cidades.map((c) => [c.ibge, c.n_redes, c.n_lojas]), [[2304400, 3, 3], [2611606, 1, 1]]);
  assert.equal(cidades[0].redes.mateus[0].marca, "MA");
});

test("DF: região administrativa vira Brasília", () => {
  const df = indexarMunicipios([{ id: 5300108, nome: "Brasília", microrregiao: { mesorregiao: { UF: { sigla: "DF" } } } }]);
  const { casadas } = casarLojas([{ rede: "atacadao", uf: "DF", cidade_bruta: "Taguatinga", loja_slug: "taguatinga" }], df);
  assert.equal(casadas[0].ibge, 5300108);
});

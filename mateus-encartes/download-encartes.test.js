const assert = require("node:assert/strict");
const test = require("node:test");

const { mapearEncartes } = require("./download-encartes");

const DATA = [
  {
    id_encarte: 101,
    descricao: "Exclusivo Pole",
    arquivo: "uploads/encartes/exclusivo-pole.pdf",
    marca: "MA",
    inicio: "2026-09-10 00:00:00",
    validade: "2026-09-15 23:59:00",
  },
  {
    id_encarte: 102,
    descricao: "Encarte Vencido",
    arquivo: "uploads/encartes/vencido.pdf",
    marca: "MA",
    inicio: "2026-08-01 00:00:00",
    validade: "2026-08-31 23:59:00",
  },
  {
    id_encarte: 103,
    descricao: "Sem PDF",
    arquivo: "uploads/encartes/banner.jpg",
    marca: "MA",
    inicio: "2026-09-10 00:00:00",
    validade: "2026-09-15 23:59:00",
  },
];

test("mapearEncartes filtra vencidos e itens sem PDF, e monta slug + URL do proxy", () => {
  const encartes = mapearEncartes(DATA, "2026-09-13");
  assert.deepEqual(encartes, [
    {
      slug: "exclusivo-pole-10-a-15-09",
      pdf: {
        url: "https://ofertasmateus.com/api-proxy.php?file=uploads%2Fencartes%2Fexclusivo-pole.pdf",
        manter: true,
      },
      meta: {
        name: "Exclusivo Pole",
        id_encarte: 101,
        vigencia: { de: "2026-09-10", ate: "2026-09-15" },
      },
    },
  ]);
});

test("mapearEncartes devolve vazio quando não há encartes vigentes", () => {
  assert.deepEqual(mapearEncartes([], "2026-09-13"), []);
});

test("listarEncartes usa UF do argumento e cidade/marca do cadastro da loja", async () => {
  const { listarEncartes } = require("./download-encartes");
  const endpoints = [];
  const buscar = async (url) => {
    const endpoint = new URL(url).searchParams.get("endpoint");
    endpoints.push(endpoint);
    const data = endpoint.startsWith("/lojas/")
      ? { idloja: "mix-salvador-norte-shopping", cidade: "salvador-", marca: "MA" }
      : [];
    return { ok: true, json: async () => ({ status: "success", data }) };
  };
  await listarEncartes("mix-salvador-norte-shopping", "ba", buscar);
  assert.deepEqual(endpoints, [
    "/lojas/mix-salvador-norte-shopping",
    "/encartes/ba/salvador-/mix-salvador-norte-shopping?marca=MA",
  ]);
  await assert.rejects(listarEncartes("mix-x", "BA", buscar), /--uf/);
});

test("identidadeDaLoja lê município e UF do endereço do cadastro real de 09/11/2026", () => {
  const { identidadeDaLoja } = require("./download-encartes");
  const fs = require("node:fs");
  const loja = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/loja-mix-salvador-norte-shopping-2026-11-09.json`, "utf8")).data;
  const identidade = identidadeDaLoja(loja);
  assert.deepEqual([identidade.idloja, identidade.municipio, identidade.uf],
    ["mix-salvador-norte-shopping", "Salvador", "BA"]);
  assert.match(identidade.nome_exibicao, /Norte Shopping/);
  assert.equal(identidadeDaLoja({ ...loja, endereco: "sem formato" }).municipio, null);
});

test("descobrirComEvidencia devolve os mesmos encartes de descobrir e a quantidade em vigor", async () => {
  const fs = require("node:fs");
  const { descobrirComEvidencia } = require("./download-encartes");
  const lerJson = (n) => fs.readFileSync(`${__dirname}/fixtures/${n}-mix-salvador-norte-shopping-2026-11-09.json`, "utf8");
  const buscar = async (url) => {
    const corpo = new URL(url).searchParams.get("endpoint").startsWith("/lojas/") ? lerJson("loja") : lerJson("encartes");
    return { ok: true, json: async () => JSON.parse(corpo) };
  };
  const r = await descobrirComEvidencia({ loja: "mix-salvador-norte-shopping", uf: "ba", hoje: "2026-11-09" }, { fetch: buscar });
  assert.equal(r.encartes.length, 4);
  assert.equal(r.evidenciaFonte.quantidadeFlyersNaFonte, 4);
  const depois = await descobrirComEvidencia({ loja: "mix-salvador-norte-shopping", uf: "ba", hoje: "2026-12-01" }, { fetch: buscar });
  assert.deepEqual([depois.encartes.length, depois.evidenciaFonte.quantidadeFlyersNaFonte], [0, 0]);
});

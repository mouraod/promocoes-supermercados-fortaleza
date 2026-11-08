"use strict";

// Habilidades individuais dos adaptadores de São Paulo: identidade da fonte,
// vigência por rede, onlyNewest e prefixos de erro por mercado.

const assert = require("node:assert/strict");
const test = require("node:test");
const { FONTES, carrefour, extra, paodeacucar } = require("./encartes-sp");

const GCS_CARREFOUR = "https://storage.googleapis.com/carrefour-web-view-tabloides-prod/";

function respostaJson(dados) {
  return { ok: true, status: 200, json: async () => dados };
}

function fetchCarrefour(flyers) {
  return async (url, opcoes = {}) => {
    assert.equal(url, FONTES.carrefour);
    assert.equal(opcoes.method, "POST");
    return respostaJson({ data: { searchStoreFlyers: flyers } });
  };
}

function flyer(extra = {}) {
  return {
    id: "enc-1",
    totalPages: 2,
    campaign: "semanal",
    storeId: "SPR",
    campaignStartDate: "03/11/2026",
    campaignEndDate: "09/11/2026",
    images: [`${GCS_CARREFOUR}1.jpg`, `${GCS_CARREFOUR}2.jpg`],
    ...extra,
  };
}

function fetchFalso(respostas) {
  return async (url) => {
    const resposta = respostas[url];
    if (!resposta) throw new Error(`URL inesperada: ${url}`);
    return {
      ok: true,
      headers: { get: (nome) => (nome.toLowerCase() === "content-type" ? resposta.tipo : null) },
      text: async () => resposta.texto,
    };
  };
}
const html = (texto) => ({ tipo: "text/html; charset=utf-8", texto });
const js = (texto) => ({ tipo: "application/javascript", texto });

// ─── Carrefour: identidade comprovada pelo storeId do folheto ─────────────────

test("Carrefour devolve a identidade da loja que a fonte comprova", async () => {
  const [encarte] = await carrefour({ hoje: "2026-11-03" }, { fetch: fetchCarrefour([flyer()]) });

  assert.deepEqual(encarte.meta.loja, { storeId: "SPR" });
  assert.equal(encarte.meta.loja_origem, "fonte");
  assert.equal(encarte.meta.revisao_loja_obrigatoria, false);
  assert.deepEqual(encarte.meta.vigencia, { de: "2026-11-03", ate: "2026-11-09" });
  assert.equal(encarte.meta.campanha, "enc-1");
  assert.equal(encarte.paginas.length, 2);
});

test("Carrefour usa o storeId da configuração, não uma constante", async () => {
  const [encarte] = await carrefour(
    { hoje: "2026-11-03", identificador: { storeId: "SPX" } },
    { fetch: fetchCarrefour([flyer({ storeId: "SPX" })]) },
  );
  assert.deepEqual(encarte.meta.loja, { storeId: "SPX" });

  await assert.rejects(
    carrefour(
      { hoje: "2026-11-03", identificador: { storeId: "SPX" } },
      { fetch: fetchCarrefour([flyer()]) },
    ),
    /storeId divergente da configuração/,
  );
});

test("Carrefour respeita onlyNewest e recusa folheto sem imagens", async () => {
  const dois = [flyer({ id: "a" }), flyer({ id: "b", campaignEndDate: "10/11/2026" })];
  const encartes = await carrefour(
    { hoje: "2026-11-03", onlyNewest: true },
    { fetch: fetchCarrefour(dois) },
  );
  assert.equal(encartes.length, 1);
  assert.equal(encartes[0].meta.campanha, "a");

  await assert.rejects(
    carrefour({ hoje: "2026-11-03" }, { fetch: fetchCarrefour([flyer({ images: [] })]) }),
    /folheto enc-1 sem imagens/,
  );
});

test("Carrefour seleciona o início mais recente mesmo quando a fonte retorna o mais antigo primeiro", async () => {
  const encartes = await carrefour(
    { hoje: "2026-11-03", onlyNewest: true },
    { fetch: fetchCarrefour([
      flyer({ id: "antigo", campaignStartDate: "01/11/2026" }),
      flyer({ id: "recente", campaignStartDate: "03/11/2026" }),
    ]) },
  );
  assert.equal(encartes[0].meta.campanha, "recente");
});

// ─── Extra: a fonte prova a região, não a loja ────────────────────────────────

function fixtureExtra() {
  const linkTerca = "https://folheteria.clubeextra.com.br/home/sites/mercado/pubs/terca-quinta/link_sp/index.html";
  const linkLimpa = "https://folheteria.clubeextra.com.br/home/sites/mercado/pubs/casa-limpa/link_a_sp/index.html";
  const campanha = (codigo, link) => ({ codigo_campanha: codigo, link, horario_inicial_campanha: "00" });
  const diario = {};
  for (const dia of ["03112026", "04112026", "05112026", "06112026", "07112026", "08112026", "09112026"]) {
    diario[dia] = {
      mercado: {
        "Grande São Paulo": [campanha("terca-quinta", linkTerca), campanha("casa-limpa", linkLimpa)],
      },
    };
  }
  const dadosJS = `var dataJsonInformation = '${JSON.stringify(JSON.stringify({ extra: diario })).slice(1, -1)}'`;
  const config = `var fliphtml5_pages=${JSON.stringify([1, 2].map((n) => ({ l: `files/large/${n}.jpg` })))};`;
  const respostas = { [FONTES.extraDados]: js(dadosJS) };
  for (const link of [linkTerca, linkLimpa]) {
    respostas[link] = html("<title>Extra - encarte</title>");
    respostas[new URL("javascript/config.js", link).href] = js(config);
  }
  return { respostas, linkTerca, linkLimpa };
}

test("Extra devolve a região como identidade de escopo", async () => {
  const { respostas } = fixtureExtra();
  const encartes = await extra({ hoje: "03112026" }, { fetch: fetchFalso(respostas) });

  assert.equal(encartes.length, 2);
  assert.equal(encartes[0].meta.regiao, "Grande São Paulo");
  assert.equal(encartes[0].meta.revisao_loja_obrigatoria, true);
  assert.equal(encartes[0].meta.loja, undefined);
});

test("Extra lê a região da configuração e aceita onlyNewest", async () => {
  const { respostas } = fixtureExtra();
  const encartes = await extra(
    { hoje: "03112026", onlyNewest: true, identificador: { regiao: "Grande São Paulo" } },
    { fetch: fetchFalso(respostas) },
  );
  assert.equal(encartes.length, 1);
  assert.equal(encartes[0].meta.campanha, "terca-quinta");

  const outraRegiao = await assert.rejects(
    extra(
      { hoje: "03112026", identificador: { regiao: "Interior" } },
      { fetch: fetchFalso(respostas) },
    ),
    /Extra: nenhuma campanha para Interior em 03112026/,
  );
  void outraRegiao;
});

// ─── Pão de Açúcar: região na identidade e validade do book_config ────────────

function fixturePao({ regiao = "Grande São Paulo", indexTexto, validade = "ofertas validas de 3 a 8/11/2026" } = {}) {
  const link = "https://folhetos.paodeacucar.com/home/sites/pao-de-acucar/pubs/semanal/gpa_sp/index.html";
  const campanha = { codigo_campanha: "semanal", link };
  const dados = { pao: { "03112026": { "pao-de-acucar": { [regiao]: [campanha] } } } };
  const dadosJS = `var dataJsonInformation = '${JSON.stringify(JSON.stringify(dados)).slice(1, -1)}'`;
  const configUrl = new URL("javascript/config.js", link).href;
  const bookUrl = new URL("files/search/book_config.js", link).href;
  return {
    [FONTES.paoDados]: js(indexTexto ?? dadosJS),
    [configUrl]: js(`var fliphtml5_pages=${JSON.stringify([{ l: "files/large/1.jpg" }])};`),
    [bookUrl]: js(validade),
  };
}

test("Pão de Açúcar lê região e validade, sem inventar data", async () => {
  const [encarte] = await paodeacucar(
    { hoje: "2026-11-03" },
    { fetch: fetchFalso(fixturePao()) },
  );

  assert.equal(encarte.meta.regiao, "Grande São Paulo");
  assert.equal(encarte.meta.revisao_loja_obrigatoria, true);
  assert.deepEqual(encarte.meta.vigencia, { de: "2026-11-03", ate: "2026-11-08" });
  assert.match(encarte.paginas[0].url, /files\/large\/1\.jpg$/);
});

test("Pão de Açúcar falha com prefixo próprio e validade ilegível", async () => {
  await assert.rejects(
    paodeacucar({ hoje: "2026-11-03" }, { fetch: fetchFalso(fixturePao({ indexTexto: "var x = 1;" })) }),
    /Pão de Açúcar: dataJsonInformation ausente/,
  );

  await assert.rejects(
    paodeacucar({ hoje: "2026-11-03" }, { fetch: fetchFalso(fixturePao({ validade: "validade indisponivel" })) }),
    /Pão de Açúcar: validade ausente/,
  );
});

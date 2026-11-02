// Identidade oficial da loja (storeInfo) no caminho de descoberta do Atacadão.
// Fixture mínima derivada de /tmp/sp05-evidencia.pKFC8C/aricanduva.html
// (SHA-256 9dc2415b61e52ffc208d6c3a6beee1dcb8437d2828224fc230b2d406f49b85ea):
// __NEXT_DATA__.props.pageProps.storeInfo de Aricanduva.
const assert = require("node:assert/strict");
const test = require("node:test");

const { descobrir, fetchFlyers } = require("./download-encartes");
const loja = require("./fixtures/store-aricanduva.json");

function html(storeInfo) {
  const nextData = JSON.stringify({ props: { pageProps: { storeInfo } } });
  return `<html><script id="__NEXT_DATA__" type="application/json">${nextData}</script></html>`;
}

function resposta(storeInfo) {
  return async () => ({ ok: true, status: 200, text: async () => html(storeInfo) });
}

const ontem = { fetch: resposta(loja), hoje: "2026-10-18" };

test("descobrir devolve a identidade que a página declarou", async () => {
  const encartes = await descobrir({ loja: "aricanduva" }, ontem);
  assert.equal(encartes.length, 2);
  for (const encarte of encartes) {
    assert.deepEqual(encarte.meta.loja, {
      storeId: 226,
      slug: "aricanduva",
      cidade: "São Paulo",
      estado: "SP",
    });
    assert.match(encarte.pdf.url, /^https:\/\/apigw\.cloud\.carrefour\.com\.br\//);
  }
});

test("fetchFlyers legado continua devolvendo só o array", async () => {
  const flyers = await fetchFlyers("aricanduva", ontem);
  assert.ok(Array.isArray(flyers));
  assert.equal(flyers.length, 2);
  assert.equal(flyers[0].meta, undefined);
});

test("flyers sem identidade não quebram a chamada legada", async () => {
  const semStoreId = { ...loja, storeId: undefined };
  const flyers = await fetchFlyers("aricanduva", { ...ontem, fetch: resposta(semStoreId) });
  assert.equal(flyers.length, 2);
  const encartes = await descobrir({ loja: "aricanduva" }, { ...ontem, fetch: resposta(semStoreId) });
  assert.equal(encartes[0].meta.loja.storeId, undefined);
});

test("storeInfo sem flyers mantém o erro de estrutura", async () => {
  const semFlyers = { ...loja, flyers: undefined };
  await assert.rejects(
    descobrir({ loja: "aricanduva" }, { ...ontem, fetch: resposta(semFlyers) }),
    /Estrutura de flyers/,
  );
});

test("filtra teaser sem PDF e excluído, mas preserva inválida só na revisão", async () => {
  const hoje = loja.flyers[0].validity.final.slice(0, 10);
  const filtrada = {
    ...loja,
    flyers: [
      { ...loja.flyers[0], exclude: true },
      { ...loja.flyers[1], urlFinalDocument: "" },
      { ...loja.flyers[0], validity: { initial: "2026-10-01T00:00:00Z", final: "2026-10-10T00:00:00Z" } },
      { ...loja.flyers[0], validity: { initial: "2026-10-20T00:00:00Z" } },
      { ...loja.flyers[0], validity: { initial: "2026-02-30T00:00:00Z", final: "2026-03-05T00:00:00Z" } },
      loja.flyers[0],
    ],
  };
  const legado = await descobrir({ loja: "aricanduva", hoje }, { fetch: resposta(filtrada) });
  assert.deepEqual(legado.map((e) => e.meta.vigencia.ate), [filtrada.flyers[5].validity.final.slice(0, 10)]);
  const revisao = await descobrir(
    { loja: "aricanduva", hoje, revisao: true },
    { fetch: resposta(filtrada) },
  );
  assert.deepEqual(
    revisao.map((e) => e.meta.vigencia),
    [
      { de: "2026-10-20", ate: null },
      { de: "2026-02-30", ate: "2026-03-05" },
      { de: "2026-10-27", ate: "2026-11-02" },
    ],
  );
});

test("a revisão usa a data local informada pelo runner", async () => {
  const noLimite = {
    ...loja,
    flyers: [
      { ...loja.flyers[0], validity: { initial: "2026-10-12T00:00:00Z", final: "2026-10-18T00:00:00Z" } },
    ],
  };
  assert.equal(
    (await descobrir({ loja: "aricanduva", hoje: "2026-10-18" }, { fetch: resposta(noLimite) })).length,
    1,
  );
  assert.equal(
    (await descobrir({ loja: "aricanduva", hoje: "2026-10-19" }, { fetch: resposta(noLimite) })).length,
    0,
  );
});

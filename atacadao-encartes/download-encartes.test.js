// Identidade oficial da loja (storeInfo) no caminho de descoberta do Atacadão.
const assert = require("node:assert/strict");
const test = require("node:test");

const { descobrir, fetchFlyers } = require("./download-encartes");
const loja = require("./fixtures/store-aricanduva.json");

/** Fixture derivada do cache oficial `Store/city?uf=SP&city=São Paulo`. */
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
  assert.equal(encartes.length, 3);
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
  assert.equal(flyers.length, 3);
  assert.equal(flyers[0].meta, undefined);
});

test("storeInfo sem identidade falha em vez de devolver campanha sem prova", async () => {
  const semStoreId = { ...loja, storeId: undefined };
  await assert.rejects(
    descobrir({ loja: "aricanduva" }, { ...ontem, fetch: resposta(semStoreId) }),
    /Identidade da loja ausente/,
  );
});

test("storeInfo sem flyers mantém o erro de estrutura", async () => {
  const semFlyers = { ...loja, flyers: undefined };
  await assert.rejects(
    descobrir({ loja: "aricanduva" }, { ...ontem, fetch: resposta(semFlyers) }),
    /Estrutura de flyers/,
  );
});

test("filtra teaser sem PDF, excluído e vencido", async () => {
  const filtrada = {
    ...loja,
    flyers: [
      { ...loja.flyers[0], exclude: true },
      { ...loja.flyers[1], urlFinalDocument: "" },
      { ...loja.flyers[2], validity: { initial: "2026-10-01T00:00:00Z", final: "2026-10-10T00:00:00Z" } },
      loja.flyers[0],
    ],
  };
  const encartes = await descobrir(
    { loja: "aricanduva" },
    { ...ontem, fetch: resposta(filtrada) },
  );
  assert.equal(encartes.length, 1);
});

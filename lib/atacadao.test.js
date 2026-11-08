"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { descobrir, descobrirComEvidencia } = require("../atacadao-encartes/download-encartes");

const pagina = (flyers) => async () => ({
  ok: true,
  text: async () => `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { storeInfo: { storeId: 920, slug: "salvador-iguatemi", cidade: "Salvador", estado: "BA", flyers } } },
  })}</script>`,
});
const args = { loja: "salvador-iguatemi", hoje: "2026-11-07" };
const vigente = { name: "v", urlFinalDocument: "https://x/v.pdf", validity: { initial: "2026-11-03", final: "2026-11-09" } };
const teaser = { name: "t", validity: { initial: "2026-11-10", final: "2026-11-16" } };

test("Atacadão: fonte com 0 flyers prova ausência (quantidade 0)", async () => {
  const r = await descobrirComEvidencia(args, { fetch: pagina([]) });
  assert.deepEqual(r.encartes, []);
  assert.equal(r.evidenciaFonte.quantidadeFlyersNaFonte, 0);
  assert.equal(r.evidenciaFonte.loja.storeId, 920);
});
test("Atacadão: teaser sem PDF não prova ausência (quantidade 1)", async () => {
  const r = await descobrirComEvidencia(args, { fetch: pagina([teaser]) });
  assert.equal(r.encartes.length, 0);
  assert.equal(r.evidenciaFonte.quantidadeFlyersNaFonte, 1);
});
test("Atacadão: onlyNewest com lista vazia devolve vazio em vez de lançar", async () => {
  const r = await descobrirComEvidencia({ ...args, onlyNewest: true }, { fetch: pagina([]) });
  assert.deepEqual(r.encartes, []);
  assert.deepEqual(await descobrir({ ...args, onlyNewest: true }, { fetch: pagina([teaser]) }), []);
});
test("Atacadão: onlyNewest escolhe o de validade final mais tardia", async () => {
  const mais = { ...vigente, name: "mais", validity: { initial: "2026-11-03", final: "2026-11-12" } };
  const r = await descobrir({ ...args, onlyNewest: true }, { fetch: pagina([vigente, mais]) });
  assert.equal(r.length, 1);
  assert.match(r[0].slug, /^mais-/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { descobrir } = require("./download-encartes");

test("Novo consulta loja antes dos encartes e usa marca retornada, nunca o nome", async () => {
  const endpoints = [];
  const encartes = await descobrir({ loja: "afogados" }, {
    hoje: "2026-10-15",
    fetch: async (url) => {
      const endpoint = new URL(url).searchParams.get("endpoint");
      endpoints.push(endpoint);
      return { ok: true, json: async () => ({ status: "success", data: endpoint.startsWith("/lojas/")
        ? { idloja: "afogados", cidade: "recife", marca: "OUTRA" }
        : [{ id_encarte: 1, descricao: "Ofertas", arquivo: "oferta.pdf", inicio: "2026-10-15", validade: "2026-10-17" }] }) };
    },
  });
  assert.deepEqual(endpoints, ["/lojas/afogados", "/encartes/pe/recife/afogados?marca=OUTRA"]);
  assert.equal(encartes[0].meta.marca_api, "OUTRA");
  assert.equal(new URL(encartes[0].pdf.url).hostname, "ofertas.novoatacarejo.com");
});

test("Novo rejeita identidade divergente ou erro da fonte sem deduzir marca", async () => {
  await assert.rejects(descobrir({}, { fetch: async () => ({ ok: true, json: async () => ({ status: "success", data: { idloja: "afogados", cidade: "recife" } }) }) }), /marca/);
  await assert.rejects(descobrir({}, { fetch: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
});

const assert = require("node:assert/strict");
const test = require("node:test");

const { folhasDoEncarte } = require("./download-encartes");

test("folhasDoEncarte prioriza sheets[].link e filtra links ausentes", () => {
  assert.deepEqual(
    folhasDoEncarte({
      sheets: [{ link: "pagina-1.jpg" }, {}, { link: "pagina-2.jpg" }],
      links: ["fallback.jpg"],
      link: "pagina-unica.jpg",
    }),
    ["pagina-1.jpg", "pagina-2.jpg"],
  );
});

test("folhasDoEncarte usa links quando não há sheets válidos", () => {
  assert.deepEqual(
    folhasDoEncarte({ sheets: [{ nome: "sem link" }], links: ["pagina-1.jpg", "pagina-2.jpg"] }),
    ["pagina-1.jpg", "pagina-2.jpg"],
  );
});

test("folhasDoEncarte trata link como página única", () => {
  assert.deepEqual(folhasDoEncarte({ link: "encarte.jpg" }), ["encarte.jpg"]);
});

test("folhasDoEncarte devolve vazio quando não há folhas", () => {
  assert.deepEqual(folhasDoEncarte({}), []);
  assert.deepEqual(folhasDoEncarte(null), []);
});

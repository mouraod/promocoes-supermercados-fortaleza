"use strict";

// Contrato do resultado estruturado que o enviar-todos.mjs consome. A pasta
// tem que vir do próprio script da rede (linha "Destino:"), nunca de uma
// varredura da pasta mais recente: se a extração falhar, é melhor a rede
// aparecer como erro do que o pai adivinhar uma rodada antiga.

const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const { montarResultadoJson, pastaDoResumo, REDES } = require("./baixar-todos");

test("cada rede do registry tem slug para casar com o enviar-todos.mjs", () => {
  for (const rede of REDES) {
    assert.ok(typeof rede.slug === "string" && rede.slug.length > 0, `${rede.nome} sem slug`);
  }
  const slugs = REDES.map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slug repetido");
});

test("dry-run lista todas as redes sem iniciar downloads", () => {
  const saida = execFileSync("node", [__filename.replace(/\.test\.js$/, ".js"), "--dry-run"], {
    encoding: "utf8",
  });
  assert.match(saida, /Dry-run: nenhum download será executado/);
  assert.match(saida, /Uniforca: .*uniforca-encartes.*download-encartes\.js/);
});

test("pastaDoResumo lê só a linha Destino do filho", () => {
  assert.equal(
    pastaDoResumo("Cometa | 22-Setembro\nEncartes: 1 | Páginas: 3 (3 novas)\nDestino: /tmp/Encartes/Cometa/22-Setembro"),
    "/tmp/Encartes/Cometa/22-Setembro",
  );
  assert.equal(pastaDoResumo("sem linha de destino"), null);
});

test("resultado estruturado é completo mesmo com falha parcial", () => {
  const json = montarResultadoJson([
    { nome: "Cometa", slug: "cometa", ok: true, pasta_download: "/a", erro: null },
    { nome: "SuperDoPovo", slug: "superdopovo", ok: false, pasta_download: null, erro: "sem PDF e sem páginas" },
  ]);

  assert.deepEqual(json, {
    redes: [
      { rede: "cometa", ok: true, pasta_download: "/a", erro: null },
      { rede: "superdopovo", ok: false, pasta_download: null, erro: "sem PDF e sem páginas" },
    ],
  });
});

"use strict";

// Guarda do registry: este teste existe porque o baixar-todos.js já quebrou
// de verdade apontando para mercadao-encartes/download-encartes.js depois
// que o script se mudou para scripts/. Se um script mudar de lugar, a
// entrada em lib/redes.js precisa acompanhar no mesmo commit.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

const { REDES } = require("./redes");

const ROOT = path.join(__dirname, "..");
const FLAGS_CONHECIDAS = new Set(["onlyNewest", "semReuso", "dpi", "all"]);

test("cada rede declara pasta e script que existem no disco", () => {
  assert.ok(REDES.length >= 6, "registry vazio demais");
  for (const rede of REDES) {
    assert.ok(rede.nome, "rede sem nome");
    const script = path.join(ROOT, rede.pasta, rede.script);
    assert.ok(fs.existsSync(script), `script não encontrado: ${script}`);
  }
});

test("flags declaradas são as que o orquestrador sabe encaminhar", () => {
  for (const rede of REDES) {
    for (const flag of rede.flags) {
      assert.ok(FLAGS_CONHECIDAS.has(flag), `${rede.nome}: flag desconhecida ${flag}`);
    }
  }
});

test("deps declaradas mantêm a pré-checagem honesta", () => {
  assert.ok(REDES.some((r) => r.deps.poppler), "ninguém usa poppler? mensagem de pré-checagem mentiria");
  assert.ok(REDES.some((r) => r.deps.playwright), "ninguém usa playwright? idem");
  for (const rede of REDES) {
    assert.ok(typeof rede.deps.poppler === "boolean", `${rede.nome}: deps.poppler ausente`);
    assert.ok(typeof rede.deps.playwright === "boolean", `${rede.nome}: deps.playwright ausente`);
  }
});

"use strict";

// CR-04: as redes com navegador usam a MESMA versão exata do Playwright. Com
// versões diferentes cada pasta pede um build de navegador próprio, e a limpeza
// do `playwright install` de outro projeto apagou o do Guará (12/11/2026).

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { REDES } = require("./redes");

const RAIZ = path.join(__dirname, "..");
const comNavegador = REDES.filter((r) => r.deps.playwright);

function lerJson(...partes) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, ...partes), "utf8"));
}

test("o registry lista as quatro redes com Playwright", () => {
  assert.deepEqual(comNavegador.map((r) => r.slug).sort(), ["assai", "guara", "saoluiz", "superdopovo"]);
});

test("package.json fixa o Playwright em versão exata, sem faixa", () => {
  for (const rede of comNavegador) {
    const pkg = lerJson(rede.pasta, "package.json");
    assert.match(pkg.dependencies?.playwright ?? "", /^\d+\.\d+\.\d+$/, `${rede.pasta}: playwright deve ser versão exata, sem ^ nem ~`);
  }
});

test("os package-lock.json resolvem a mesma versão de playwright-core", () => {
  const versoes = comNavegador.map((rede) => {
    const lock = lerJson(rede.pasta, "package-lock.json");
    const pkg = lerJson(rede.pasta, "package.json");
    const core = lock.packages?.["node_modules/playwright-core"]?.version;
    const playwright = lock.packages?.["node_modules/playwright"]?.version;
    assert.ok(core, `${rede.pasta}: lock sem playwright-core`);
    assert.equal(playwright, pkg.dependencies.playwright, `${rede.pasta}: lock e package.json divergem`);
    assert.equal(core, playwright, `${rede.pasta}: playwright e playwright-core divergem`);
    return [rede.pasta, core];
  });
  const distintas = new Set(versoes.map(([, v]) => v));
  assert.equal(distintas.size, 1, `playwright-core divergente entre redes: ${JSON.stringify(versoes)}`);
});

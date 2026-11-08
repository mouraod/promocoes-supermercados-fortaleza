"use strict";

// Reuso entre rodadas para coleta por cidade: só é seguro quando o destino
// segue o layout canônico <base>/<rede>/<rodada>. Fora dele, o pipeline
// continua desligando o reuso (o vizinho não prova ser da mesma rede).

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { baixarEncartes } = require("./pipeline");

function criarDepsFalsos() {
  const chamadas = { baixar: 0 };
  const deps = {
    async baixarArquivo(_url, caminho) {
      chamadas.baixar += 1;
      try {
        const stat = await fs.stat(caminho);
        if (stat.size > 0) return false;
      } catch { /* não existe */ }
      await fs.writeFile(caminho, "conteudo-falso");
      return true;
    },
    async contarPaginasPdf() {
      return 1;
    },
    async rasterizarPagina(_pdfPath, outBase) {
      await fs.writeFile(`${outBase}.jpg`, "jpg-falso");
    },
    checarPoppler() {},
  };
  return { deps, chamadas };
}

const CONSOLE_SILENTE = { log: () => {}, warn: () => {} };

async function comConsoleSilente(fn) {
  const original = { log: console.log, warn: console.warn };
  Object.assign(console, CONSOLE_SILENTE);
  try {
    return await fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
  }
}

const PAGINAS = [
  { url: "https://exemplo.test/sp/pagina-1.jpg" },
  { url: "https://exemplo.test/sp/pagina-2.jpg" },
];

function rodada({ base, output, agora, semReuso = false }) {
  return {
    rede: "Carrefour",
    source: "https://exemplo.test/sp/carrefour",
    descobrir: async () => [{
      slug: "encarte-semanal",
      paginas: PAGINAS,
      meta: { campanha: "semanal-sp", vigencia: { de: "2026-11-03", ate: "2026-11-09" } },
    }],
    args: { base, output, semReuso },
    extra: { cidade: "sao-paulo-sp", mercado: "carrefour", loja: "hiper-aricanduva" },
    agora,
  };
}

test("coleta por cidade reaproveita quando o destino segue o layout canônico", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-capitais-"));
  const { deps, chamadas } = criarDepsFalsos();

  const r1 = await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(base, "Carrefour", "2026-11-03"), agora: new Date("2026-11-03T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 2);
  assert.equal(r1.manifest.totalPaginas, 2);
  assert.equal(r1.manifest.rede, "Carrefour");

  const r2 = await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(base, "Carrefour", "2026-11-04"), agora: new Date("2026-11-04T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 2, "a segunda rodada não deve baixar de novo");
  assert.equal(r2.manifest.encartes[0].reaproveitado, true);
  assert.equal(r2.manifest.totalPaginas, 2);

  const arquivos = await fs.readdir(path.join(r2.destino, "JPG"));
  assert.equal(arquivos.length, 2);

  await fs.rm(base, { recursive: true, force: true });
});

test("destino fora do layout canônico não reaproveita", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-capitais-"));
  const fora = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-fora-"));
  const { deps, chamadas } = criarDepsFalsos();

  await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(base, "Carrefour", "2026-11-03"), agora: new Date("2026-11-03T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 2);

  await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(fora, "rodada"), agora: new Date("2026-11-04T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 4, "fora do layout o vizinho não prova ser da mesma rede");

  await fs.rm(base, { recursive: true, force: true });
  await fs.rm(fora, { recursive: true, force: true });
});

test("rede diferente no destino também desliga o reuso", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-capitais-"));
  const { deps, chamadas } = criarDepsFalsos();

  await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(base, "Carrefour", "2026-11-03"), agora: new Date("2026-11-03T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 2);

  await comConsoleSilente(() => baixarEncartes({
    ...rodada({ base, output: path.join(base, "Extra", "2026-11-04"), agora: new Date("2026-11-04T12:00:00") }),
    deps,
  }));
  assert.equal(chamadas.baixar, 4);

  await fs.rm(base, { recursive: true, force: true });
});

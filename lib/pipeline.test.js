"use strict";

// Testes do pipeline: tudo offline, sem rede e sem poppler. As dependências
// de download/rasterização são injetadas (seam interno do baixarEncartes),
// então os testes exercitam o pipeline inteiro pela interface pública.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { baixarEncartes, parsearArgs, slugify, vigenciaSlug } = require("./pipeline");

// ─── deps falsos ──────────────────────────────────────────────────────────────

function criarDepsFalsos() {
  const chamadas = { baixar: 0, rasterizar: 0 };
  const deps = {
    async baixarArquivo(_url, caminho) {
      chamadas.baixar += 1;
      try {
        const stat = await fs.stat(caminho);
        if (stat.size > 0) return false; // já existe, mesma semântica do real
      } catch { /* não existe */ }
      await fs.writeFile(caminho, "conteudo-falso");
      return true;
    },
    async contarPaginasPdf() {
      return 3;
    },
    async rasterizarPagina(_pdfPath, outBase) {
      chamadas.rasterizar += 1;
      await fs.writeFile(`${outBase}.jpg`, "jpg-falso");
    },
    checarPoppler() {},
  };
  return { deps, chamadas };
}

async function baseTemp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pipeline-teste-"));
}

const CONSOLE_SILENTE = { log: () => {}, warn: () => {} };

async function comConsoleSilente(fn) {
  const original = { ...console };
  Object.assign(console, CONSOLE_SILENTE);
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

// ─── parsearArgs ──────────────────────────────────────────────────────────────

test("parsearArgs aceita flags listadas e rejeita as demais", async () => {
  const args = await parsearArgs(["--base", "/tmp/x", "--sem-reuso"], {
    aceitas: ["only-newest", "sem-reuso"],
  });
  assert.equal(args.base, "/tmp/x");
  assert.equal(args.semReuso, true);
  assert.equal(args.onlyNewest, false);

  await assert.rejects(
    parsearArgs(["--dpi", "200"], { aceitas: ["only-newest"] }),
    /Argumento desconhecido/
  );
  await assert.rejects(
    parsearArgs(["--only-newest"], { aceitas: ["sem-reuso"] }),
    /Argumento desconhecido/
  );
});

test("parsearArgs valida dpi quando a rede aceita", async () => {
  const ok = await parsearArgs(["--dpi", "300"], { aceitas: ["dpi"] });
  assert.equal(ok.dpi, 300);

  await assert.rejects(parsearArgs(["--dpi", "500"], { aceitas: ["dpi"] }), /--dpi/);
  await assert.rejects(parsearArgs(["--dpi", "abc"], { aceitas: ["dpi"] }), /--dpi/);

  const semDpi = await parsearArgs([], { aceitas: [] });
  assert.equal(semDpi.dpi, undefined);
});

test("parsearArgs injeta padroes (loja do Atacadão)", async () => {
  const args = await parsearArgs([], { aceitas: ["loja"], padroes: { loja: "fortaleza-aeroporto" } });
  assert.equal(args.loja, "fortaleza-aeroporto");
  const alterada = await parsearArgs(["--loja", "fortaleza-fatima"], { aceitas: ["loja"], padroes: { loja: "fortaleza-aeroporto" } });
  assert.equal(alterada.loja, "fortaleza-fatima");
});

// ─── helpers ──────────────────────────────────────────────────────────────────

test("slugify normaliza acentos, espaços e colapsa hífens", () => {
  assert.equal(slugify("Ofertas da Semana 47"), "ofertas-da-semana-47");
  assert.equal(slugify("  Encarte -- Verão  "), "encarte-verao");
  assert.equal(slugify(""), "encarte");
});

test("vigenciaSlug muda de forma quando o mês vira", () => {
  assert.equal(vigenciaSlug("2026-08-01T00:00:00Z", "2026-08-07T23:59:59Z"), "01-a-07-08");
  assert.equal(vigenciaSlug("2026-07-29", "2026-08-04"), "29-07-a-04-08");
});

// ─── baixarEncartes: imagens diretas (Guará, São Luiz, Mercadão) ─────────────

test("encarte de imagens: baixa, nomeia e grava manifest", async () => {
  const base = await baseTemp();
  const { deps } = criarDepsFalsos();
  const args = { base, output: null, semReuso: false };

  const { destino, manifest } = await comConsoleSilente(() => baixarEncartes({
    rede: "RedeTeste",
    source: "https://exemplo.test/folhetos",
    descobrir: async () => [{
      slug: "encarte-da-semana",
      paginas: [{ url: "https://exemplo.test/a.webp" }, { url: "https://exemplo.test/b.webp" }],
      meta: { titulo: "Encarte da Semana" },
    }],
    args,
    agora: new Date("2026-08-04T12:00:00"),
    deps,
  }));

  const arquivos = await fs.readdir(path.join(destino, "JPG"));
  assert.deepEqual(arquivos.sort(), ["encarte-da-semana-pagina-01.webp", "encarte-da-semana-pagina-02.webp"]);

  // sem PDF no encarte, não cria pasta PDF nem campo dpi
  await assert.rejects(fs.access(path.join(destino, "PDF")));
  assert.equal(manifest.dpi, undefined);
  assert.equal(manifest.rede, "RedeTeste");
  assert.equal(manifest.totalPaginas, 2);
  assert.equal(manifest.encartes[0].titulo, "Encarte da Semana");
  assert.equal(manifest.encartes[0].slug, "encarte-da-semana");
  assert.equal(manifest.encartes[0].paginas, 2);
  assert.equal(manifest.encartes[0].reaproveitado, undefined);

  await fs.rm(base, { recursive: true, force: true });
});

// ─── baixarEncartes: PDF mantido (Cometa, Atacadão) ───────────────────────────

test("encarte de PDF com manter: grava PDF/, rasteriza e expõe dpi", async () => {
  const base = await baseTemp();
  const { deps, chamadas } = criarDepsFalsos();
  const args = { base, output: null, semReuso: false, dpi: 150 };

  const { destino, manifest } = await comConsoleSilente(() => baixarEncartes({
    rede: "RedePdf",
    descobrir: async () => [{
      slug: "12-encarte",
      pdf: { url: "https://exemplo.test/12.pdf", manter: true },
      meta: { id: 12, name: "Encarte" },
    }],
    args,
    agora: new Date("2026-08-04T12:00:00"),
    deps,
  }));

  assert.equal(chamadas.baixar, 1); // só o PDF
  assert.equal(chamadas.rasterizar, 3); // contarPaginasPdf falso = 3

  const pdfs = await fs.readdir(path.join(destino, "PDF"));
  assert.deepEqual(pdfs, ["12-encarte.pdf"]);
  const jpgs = (await fs.readdir(path.join(destino, "JPG"))).sort();
  assert.deepEqual(jpgs, ["12-encarte-pagina-01.jpg", "12-encarte-pagina-02.jpg", "12-encarte-pagina-03.jpg"]);

  assert.equal(manifest.dpi, 150);
  assert.equal(manifest.encartes[0].pdf, "PDF/12-encarte.pdf");
  assert.equal(manifest.encartes[0].pdfBaixado, true);
  assert.equal(manifest.encartes[0].paginas, 3);

  await fs.rm(base, { recursive: true, force: true });
});

// ─── baixarEncartes: PDF sem manter (Super do Povo) ───────────────────────────

test("encarte de PDF sem manter: não deixa PDF para trás", async () => {
  const base = await baseTemp();
  const { deps } = criarDepsFalsos();

  const { destino } = await comConsoleSilente(() => baixarEncartes({
    rede: "RedeTmp",
    descobrir: async () => [{
      slug: "sdp",
      pdf: { url: "https://exemplo.test/sdp.pdf" },
      meta: { fonte: "pdf" },
    }],
    args: { base, output: null, semReuso: false, dpi: 200 },
    agora: new Date("2026-08-04T12:00:00"),
    deps,
  }));

  await assert.rejects(fs.access(path.join(destino, "PDF")));
  const jpgs = await fs.readdir(path.join(destino, "JPG"));
  assert.equal(jpgs.length, 3);

  await fs.rm(base, { recursive: true, force: true });
});

// ─── reuso entre rodadas ──────────────────────────────────────────────────────

test("rodada do dia seguinte reaproveita páginas sem baixar de novo", async () => {
  const base = await baseTemp();
  const { deps, chamadas } = criarDepsFalsos();
  const descobrir = async () => [{
    slug: "encarte-estavel",
    paginas: [{ url: "https://exemplo.test/1.webp" }, { url: "https://exemplo.test/2.webp" }],
    meta: {},
  }];

  const rodada1 = await comConsoleSilente(() => baixarEncartes({
    rede: "RedeReuso", descobrir,
    args: { base, output: null, semReuso: false },
    agora: new Date("2026-08-04T12:00:00"),
    deps,
  }));
  assert.equal(chamadas.baixar, 2);

  const rodada2 = await comConsoleSilente(() => baixarEncartes({
    rede: "RedeReuso", descobrir,
    args: { base, output: null, semReuso: false },
    agora: new Date("2026-08-05T12:00:00"),
    deps,
  }));

  assert.equal(chamadas.baixar, 2, "segunda rodada não deve baixar nada");
  assert.equal(rodada2.manifest.encartes[0].reaproveitado, true);
  assert.equal(rodada2.manifest.encartes[0].paginas, 2);
  assert.equal(rodada2.manifest.totalPaginas, 2);

  const jpgs = await fs.readdir(path.join(rodada2.destino, "JPG"));
  assert.equal(jpgs.length, 2, "páginas hardlinkadas na pasta nova");

  // --sem-reuso força download de novo
  await comConsoleSilente(() => baixarEncartes({
    rede: "RedeReuso", descobrir,
    args: { base, output: null, semReuso: true },
    agora: new Date("2026-08-06T12:00:00"),
    deps,
  }));
  assert.equal(chamadas.baixar, 4);

  await fs.rm(base, { recursive: true, force: true });
  void rodada1;
});

// ─── concorrência ─────────────────────────────────────────────────────────────

test("pool com concorrência baixa todas as páginas", async () => {
  const base = await baseTemp();
  const { deps } = criarDepsFalsos();

  const { manifest } = await comConsoleSilente(() => baixarEncartes({
    rede: "RedePool",
    descobrir: async () => [{
      slug: "muitas",
      paginas: Array.from({ length: 5 }, (_ , i) => ({ url: `https://exemplo.test/p${i}.jpg` })),
      meta: {},
    }],
    args: { base, output: null, semReuso: false },
    agora: new Date("2026-08-04T12:00:00"),
    concorrencia: 3,
    deps,
  }));

  assert.equal(manifest.totalPaginas, 5);

  await fs.rm(base, { recursive: true, force: true });
});

// ─── contrato do adapter ──────────────────────────────────────────────────────

test("adapter que devolve encarte sem pdf nem paginas falha claro", async () => {
  const base = await baseTemp();
  const { deps } = criarDepsFalsos();

  await assert.rejects(
    comConsoleSilente(() => baixarEncartes({
      rede: "RedeQuebrada",
      descobrir: async () => [{ slug: "x", meta: {} }],
      args: { base, output: null, semReuso: false },
      deps,
    })),
    /malformado/
  );

  await fs.rm(base, { recursive: true, force: true });
});

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

// ─── reserva de descoberta (CR-05) ───────────────────────────────────────────
// Relógio e API injetados; nenhuma chamada ao site.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { descobrir } = require("./download-encartes");
const logRequisicoes = require("../lib/log-requisicoes");
const { baixarEncartes } = require("../lib/pipeline");

const AGORA = new Date(2026, 10, 16, 12, 0, 0); // 16/11/2026, hora local
const DIA = 24 * 60 * 60 * 1000;
const VIGENTE = { id: 24, name: "Ofertas", start: "2026-11-14", end: "2026-11-20", sheets: [{ link: "https://storage.googleapis.com/b/24-1.jpg" }, { link: "https://storage.googleapis.com/b/24-2.jpg" }] };
const VENCIDO = { id: 22, name: "Antigo", start: "2026-11-01", end: "2026-11-10", sheets: [{ link: "https://storage.googleapis.com/b/22-1.jpg" }] };
const OUTRO_VIGENTE = { id: 25, name: "Carnes", start: "2026-11-15", end: "2026-11-18", pdf: "https://storage.googleapis.com/b/25.pdf" };

const apiFora = async () => { throw new Error("page.waitForResponse: Timeout 90000ms exceeded."); };

async function baseComReservas(reservas) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-reserva-"));
  for (const { pasta, payload, idadeDias } of reservas) {
    const dir = path.join(base, "SuperDoPovo", pasta);
    await fs.mkdir(dir, { recursive: true });
    const arquivo = path.join(dir, "fonte.json");
    await fs.writeFile(arquivo, JSON.stringify(payload));
    const quando = new Date(AGORA.getTime() - idadeDias * DIA);
    await fs.utimes(arquivo, quando, quando);
  }
  return base;
}

function silenciar(fn) {
  const original = console.error;
  console.error = () => {};
  return Promise.resolve(fn()).finally(() => { console.error = original; });
}

test("descoberta pela API grava fonte.json na pasta da rodada e marca fonte_descoberta api", async () => {
  const base = await baseComReservas([]);
  try {
    const payload = [VIGENTE, VENCIDO];
    const encartes = await descobrir({ base }, { agora: AGORA, lerPayload: async () => payload });
    assert.deepEqual(encartes.map((e) => e.meta.id), [24]);
    assert.equal(encartes[0].meta.fonte_descoberta, "api");
    const gravado = JSON.parse(await fs.readFile(path.join(base, "SuperDoPovo", "16-Novembro", "fonte.json"), "utf8"));
    assert.deepEqual(gravado, payload, "payload bruto, com os vencidos também");
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("API fora e reserva de 2 dias: usa só os encartes vigentes e marca a origem", async () => {
  const base = await baseComReservas([{ pasta: "14-Novembro", payload: [VIGENTE, VENCIDO, OUTRO_VIGENTE], idadeDias: 2 }]);
  try {
    logRequisicoes.reiniciar();
    const encartes = await silenciar(() => descobrir({ base }, { agora: AGORA, lerPayload: apiFora }));
    assert.deepEqual(encartes.map((e) => e.meta.id).sort(), [24, 25]);
    for (const e of encartes) assert.equal(e.meta.fonte_descoberta, "reserva:14-Novembro");
    assert.deepEqual(encartes.find((e) => e.meta.id === 24).paginas.map((p) => p.url), VIGENTE.sheets.map((s) => s.link));
    assert.equal(encartes.find((e) => e.meta.id === 25).pdf.url, OUTRO_VIGENTE.pdf);

    // A origem fica no log local (pasta ainda não configurada: vai para a memória até configurar).
    const destino = path.join(base, "SuperDoPovo", "16-Novembro");
    logRequisicoes.configurar({ rede: "SuperDoPovo", destino });
    const linhas = logRequisicoes.lerLog(destino);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].etapa, "descoberta");
    assert.match(linhas[0].erro, /^reserva:14-Novembro: API falhou/);
    await assert.rejects(fs.stat(path.join(destino, "fonte.json")), { code: "ENOENT" }, "reserva não vira fonte nova");
  } finally { logRequisicoes.reiniciar(); await fs.rm(base, { recursive: true, force: true }); }
});

test("API fora e reserva de 8 dias: falha com o erro original", async () => {
  const base = await baseComReservas([{ pasta: "08-Novembro", payload: [VIGENTE], idadeDias: 8 }]);
  try {
    await assert.rejects(silenciar(() => descobrir({ base }, { agora: AGORA, lerPayload: apiFora })), /Timeout 90000ms exceeded/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("API fora e sem nenhuma reserva: falha com o erro original", async () => {
  const base = await baseComReservas([]);
  try {
    await assert.rejects(silenciar(() => descobrir({ base }, { agora: AGORA, lerPayload: apiFora })), /Timeout 90000ms exceeded/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("reserva só com encarte vencido nunca é reaproveitada, nem com --all", async () => {
  const base = await baseComReservas([{ pasta: "15-Novembro", payload: [VENCIDO], idadeDias: 1 }]);
  try {
    for (const args of [{ base }, { base, all: true }]) {
      await assert.rejects(silenciar(() => descobrir(args, { agora: AGORA, lerPayload: apiFora })), /Timeout 90000ms exceeded/);
    }
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("com várias reservas dentro do prazo, vale a mais recente", async () => {
  const base = await baseComReservas([
    { pasta: "12-Novembro", payload: [OUTRO_VIGENTE], idadeDias: 4 },
    { pasta: "15-Novembro", payload: [VIGENTE], idadeDias: 1 },
    { pasta: "01-Novembro", payload: [OUTRO_VIGENTE], idadeDias: 15 },
  ]);
  try {
    const encartes = await silenciar(() => descobrir({ base }, { agora: AGORA, lerPayload: apiFora }));
    assert.deepEqual(encartes.map((e) => e.meta.id), [24]);
    assert.equal(encartes[0].meta.fonte_descoberta, "reserva:15-Novembro");
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("rodada pela reserva: manifest marca a origem e as páginas vêm direto, sem a API", async () => {
  const base = await baseComReservas([{ pasta: "14-Novembro", payload: [VIGENTE, VENCIDO], idadeDias: 2 }]);
  const baixadas = [];
  try {
    const args = { base, output: null, semReuso: true, dpi: 150 };
    const { manifest } = await silenciar(() => baixarEncartes({
      rede: "SuperDoPovo",
      descobrir: (a) => descobrir(a, { agora: AGORA, lerPayload: apiFora }),
      args,
      agora: AGORA,
      deps: {
        async baixarArquivo(url, caminho) { baixadas.push(url); await fs.writeFile(caminho, "jpg"); return true; },
        checarPoppler() {},
      },
    }));
    assert.equal(manifest.totalEncartes, 1);
    assert.equal(manifest.encartes[0].fonte_descoberta, "reserva:14-Novembro");
    assert.deepEqual(baixadas, VIGENTE.sheets.map((s) => s.link));
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

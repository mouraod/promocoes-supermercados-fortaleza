"use strict";

// F4: conversão de páginas de PDF em paralelo com orçamento global.
// Testes com poppler real só rodam se pdftoppm/pdfinfo existirem; o PDF de
// fixture é gerado aqui mesmo (páginas com conteúdo distinto).

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const { baixarEncartes, rasterizarPagina } = require("./pipeline");
const {
  converterPaginasPdf,
  criarCorretorConversao,
  orcamentoConversoes,
} = require("./conversao");

const PIPELINE = path.join(__dirname, "pipeline.js");
const BAIXAR_TODOS = path.join(__dirname, "..", "todos-encartes", "baixar-todos.js");

function temPoppler() {
  try {
    execFileSync("which", ["pdftoppm"], { stdio: "ignore" });
    execFileSync("which", ["pdfinfo"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SEM_POPPLER = temPoppler() ? false : "pdftoppm/pdfinfo ausentes";

// PDF mínimo válido, uma página por item, cada uma com texto e faixas de cor
// diferentes, para que hashes de páginas distintas nunca coincidam.
function gerarPdf(numPaginas) {
  const objetos = [];
  objetos[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids = [];
  for (let i = 0; i < numPaginas; i += 1) {
    const idPagina = 4 + i * 2;
    const idConteudo = 5 + i * 2;
    kids.push(`${idPagina} 0 R`);
    const cor = [(i * 0.17) % 1, (0.3 + i * 0.29) % 1, (0.6 + i * 0.41) % 1].map((c) => c.toFixed(2)).join(" ");
    const conteudo = `${cor} rg 20 20 ${80 + i * 25} ${60 + i * 10} re f ` +
      `0 0 0 rg BT /F1 32 Tf 30 320 Td (Pagina ${i + 1}) Tj ET ` +
      `BT /F1 12 Tf 30 280 Td (Fixture F4 - ${"x".repeat(i + 1)}) Tj ET`;
    objetos[idPagina - 1] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${idConteudo} 0 R >>`;
    objetos[idConteudo - 1] = `<< /Length ${Buffer.byteLength(conteudo)} >>\nstream\n${conteudo}\nendstream`;
  }
  objetos[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${numPaginas} >>`;

  let saida = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((corpo, i) => {
    offsets.push(Buffer.byteLength(saida));
    saida += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const xref = Buffer.byteLength(saida);
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) saida += `${String(o).padStart(10, "0")} 00000 n \n`;
  saida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(saida, "latin1");
}

async function baseTemp(prefixo = "conversao-teste-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefixo));
}

async function comConsoleSilente(fn) {
  const original = { ...console };
  Object.assign(console, { log: () => {}, warn: () => {} });
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

async function hashes(dir) {
  const nomes = (await fs.readdir(dir)).sort();
  const lista = [];
  for (const nome of nomes) {
    const conteudo = await fs.readFile(path.join(dir, nome));
    lista.push([nome, crypto.createHash("sha256").update(conteudo).digest("hex")]);
  }
  return lista;
}

// Saída sequencial de referência: exatamente o comando de antes de F4
// (pdftoppm -f N -l N por página, uma de cada vez), escrita direto no destino.
function converterSequencial(pdfPath, dir, slug, numPaginas, dpi) {
  for (let p = 1; p <= numPaginas; p += 1) {
    const outBase = path.join(dir, `${slug}-pagina-${String(p).padStart(2, "0")}`);
    execFileSync("pdftoppm", ["-jpeg", "-r", String(dpi), "-f", String(p), "-l", String(p), "-singlefile", pdfPath, outBase]);
  }
}

function depsComPdf(pdfFixture, extras = {}) {
  return {
    async baixarArquivo(_url, caminho) {
      await fs.copyFile(pdfFixture, caminho);
      return true;
    },
    ...extras,
  };
}

async function restosDePreparo(destino) {
  return (await fs.readdir(destino)).filter((n) => n.startsWith(".convertendo-"));
}

// ─── bytes, nomes e ordem iguais à conversão sequencial ──────────────────────

for (const numPaginas of [1, 5]) {
  test(`F4: ${numPaginas} página(s) — paralelo e sequencial têm mesmos nomes, ordem e sha256`, { skip: SEM_POPPLER }, async () => {
    const base = await baseTemp();
    const pdfFixture = path.join(base, "fixture.pdf");
    await fs.writeFile(pdfFixture, gerarPdf(numPaginas));
    const dpi = 150;
    const slug = "encarte-f4";

    const refDir = path.join(base, "sequencial");
    await fs.mkdir(refDir);
    converterSequencial(pdfFixture, refDir, slug, numPaginas, dpi);

    let ativos = 0;
    let pico = 0;
    const deps = depsComPdf(pdfFixture, {
      async rasterizarPagina(...a) {
        ativos += 1;
        pico = Math.max(pico, ativos);
        try {
          return await rasterizarPagina(...a);
        } finally {
          ativos -= 1;
        }
      },
    });
    const { destino, manifest } = await comConsoleSilente(() => baixarEncartes({
      rede: "RedeF4",
      descobrir: async () => [{ slug, pdf: { url: "https://exemplo.test/f4.pdf", manter: true }, meta: {} }],
      args: { base: path.join(base, "rodada"), output: null, semReuso: true, dpi },
      agora: new Date("2026-10-11T12:00:00"),
      deps,
    }));

    const referencia = await hashes(refDir);
    const paralelo = await hashes(path.join(destino, "JPG"));
    assert.equal(referencia.length, numPaginas);
    assert.deepEqual(paralelo.map(([n]) => n), Array.from({ length: numPaginas }, (_, i) => `${slug}-pagina-${String(i + 1).padStart(2, "0")}.jpg`));
    assert.deepEqual(paralelo, referencia, "sha256 tem que ser igual ao da saída sequencial");
    assert.equal(new Set(paralelo.map(([, h]) => h)).size, numPaginas, "fixture com páginas distintas");
    assert.equal(manifest.totalPaginas, numPaginas);
    assert.equal(manifest.encartes[0].paginas, numPaginas);
    assert.deepEqual(await restosDePreparo(destino), []);
    if (numPaginas > 1 && orcamentoConversoes() > 1) assert.ok(pico > 1, `páginas deveriam rodar em paralelo (pico ${pico})`);

    await fs.rm(base, { recursive: true, force: true });
  });
}

test("F4: falha de uma página com poppler real não publica nenhuma página", { skip: SEM_POPPLER }, async () => {
  const base = await baseTemp();
  const pdfFixture = path.join(base, "fixture.pdf");
  await fs.writeFile(pdfFixture, gerarPdf(4));
  const deps = depsComPdf(pdfFixture, {
    async rasterizarPagina(pdfPath, outBase, page, dpi, opcoes) {
      if (page === 3) {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("pdftoppm falhou na página 3");
      }
      return rasterizarPagina(pdfPath, outBase, page, dpi, opcoes);
    },
  });
  const args = { base: path.join(base, "rodada"), output: null, semReuso: true, dpi: 150 };
  const descobrir = async () => [{ slug: "quebra", pdf: { url: "https://exemplo.test/q.pdf", manter: true }, meta: {} }];

  await assert.rejects(
    comConsoleSilente(() => baixarEncartes({ rede: "RedeF4", descobrir, args, agora: new Date("2026-10-11T12:00:00"), deps })),
    /página 3/,
  );
  const destino = path.join(args.base, "RedeF4", "11-Outubro");
  assert.deepEqual(await fs.readdir(path.join(destino, "JPG")), [], "nenhuma página publicada");
  assert.deepEqual(await restosDePreparo(destino), []);
  await assert.rejects(fs.access(path.join(destino, "manifest.json")), "sem manifest de rodada concluída");

  await fs.rm(base, { recursive: true, force: true });
});

// ─── falha interrompe as demais e não deixa parcial (sem poppler) ─────────────

test("F4: falha de uma página aborta as outras, apaga o preparo e a rodada seguinte converte tudo", async () => {
  const base = await baseTemp();
  const args = { base, output: null, semReuso: true, dpi: 150 };
  const descobrir = async () => [{ slug: "falha", pdf: { url: "https://exemplo.test/f.pdf", manter: true }, meta: {} }];
  const abortadas = [];
  let iniciadas = 0;

  const depsFalha = {
    async baixarArquivo(_u, caminho) { await fs.writeFile(caminho, "%PDF-falso"); return true; },
    async contarPaginasPdf() { return 6; },
    checarPoppler() {},
    // Cada página escreve um JPG parcial no preparo antes de terminar: se o
    // preparo fosse publicado, a próxima rodada tomaria a página por pronta.
    async rasterizarPagina(_pdf, outBase, page, _dpi, { signal } = {}) {
      iniciadas += 1;
      await fs.writeFile(`${outBase}.jpg`, "parcial");
      if (page === 2) {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("pdftoppm quebrou na página 2");
      }
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 2000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          abortadas.push(page);
          reject(new Error("abortada"));
        }, { once: true });
      });
    },
  };

  const inicio = performance.now();
  await assert.rejects(
    comConsoleSilente(() => baixarEncartes({ rede: "RedeFalha", descobrir, args, agora: new Date("2026-10-11T12:00:00"), deps: depsFalha })),
    /página 2/,
  );
  assert.ok(performance.now() - inicio < 1500, "as demais páginas foram interrompidas, não esperadas");
  const destino = path.join(base, "RedeFalha", "11-Outubro");
  assert.deepEqual(await fs.readdir(path.join(destino, "JPG")), []);
  assert.deepEqual(await restosDePreparo(destino), []);
  assert.equal(abortadas.length, iniciadas - 1, "toda página em andamento recebeu o abort");

  const { manifest } = await comConsoleSilente(() => baixarEncartes({
    rede: "RedeFalha", descobrir, args, agora: new Date("2026-10-11T12:00:00"),
    deps: {
      ...depsFalha,
      async rasterizarPagina(_pdf, outBase) { await fs.writeFile(`${outBase}.jpg`, "jpg"); },
    },
  }));
  assert.equal(manifest.totalPaginas, 6);
  const jpgs = (await fs.readdir(path.join(destino, "JPG"))).sort();
  assert.equal(jpgs.length, 6);
  for (const nome of jpgs) assert.equal(await fs.readFile(path.join(destino, "JPG", nome), "utf8"), "jpg");

  await fs.rm(base, { recursive: true, force: true });
});

test("F4: rasterizarPagina com signal já abortado não inicia pdftoppm", async () => {
  const controle = new AbortController();
  controle.abort(new Error("cancelada antes"));
  await assert.rejects(rasterizarPagina("/nao/existe.pdf", "/tmp/nao-existe", 1, 150, { signal: controle.signal }), /cancelada antes/);
});

// ─── orçamento global ─────────────────────────────────────────────────────────

test("orçamento é max(1, núcleos - 1); MMB_CONVERSOES_MAX só reduz", () => {
  const nucleos = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const padrao = Math.max(1, nucleos - 1);
  assert.equal(orcamentoConversoes({}), padrao);
  assert.equal(orcamentoConversoes({ MMB_CONVERSOES_MAX: "1" }), 1);
  assert.equal(orcamentoConversoes({ MMB_CONVERSOES_MAX: String(padrao + 50) }), padrao);
  for (const invalido of ["0", "-2", "abc", "1.5", ""]) {
    assert.equal(orcamentoConversoes({ MMB_CONVERSOES_MAX: invalido }), padrao);
  }
});

test("F4: dois PDFs simultâneos no mesmo processo dividem um único orçamento", async () => {
  const base = await baseTemp();
  const limite = orcamentoConversoes();
  let ativos = 0;
  let pico = 0;
  async function rasterizar(_pdf, outBase) {
    ativos += 1;
    pico = Math.max(pico, ativos);
    await new Promise((r) => setTimeout(r, 30));
    await fs.writeFile(`${outBase}.jpg`, "jpg");
    ativos -= 1;
  }
  const porPdf = limite + 2;
  async function umPdf(nome) {
    const destino = path.join(base, nome);
    const jpgDir = path.join(destino, "JPG");
    await fs.mkdir(jpgDir, { recursive: true });
    await converterPaginasPdf({
      pdfPath: "/nao/usado.pdf",
      jpgDir,
      preparoDir: destino,
      paginas: Array.from({ length: porPdf }, (_, i) => ({ numero: i + 1, nome: `${nome}-pagina-${String(i + 1).padStart(2, "0")}` })),
      dpi: 150,
      rasterizar,
    });
    return (await fs.readdir(jpgDir)).length;
  }
  const [a, b] = await Promise.all([umPdf("a"), umPdf("b")]);
  assert.equal(a, porPdf);
  assert.equal(b, porPdf);
  assert.equal(pico, limite, `pico ${pico} deveria ser o orçamento global ${limite}, não ${limite} por PDF`);
  await fs.rm(base, { recursive: true, force: true });
});

function filhoFalso() {
  const filho = new EventEmitter();
  filho.connected = true;
  filho.recebidas = [];
  filho.send = (mensagem, cb) => { filho.recebidas.push(mensagem); if (cb) cb(null); return true; };
  return filho;
}

test("corretor: vagas são globais entre filhos e voltam quando um filho morre", () => {
  const corretor = criarCorretorConversao(2);
  const a = filhoFalso();
  const b = filhoFalso();
  corretor.anexar(a);
  corretor.anexar(b);

  a.emit("message", { mmb: "mmb-conversao-pedir", id: 1 });
  a.emit("message", { mmb: "mmb-conversao-pedir", id: 2 });
  b.emit("message", { mmb: "mmb-conversao-pedir", id: 1 });
  assert.equal(corretor.ativos, 2);
  assert.deepEqual(a.recebidas.map((m) => m.id), [1, 2]);
  assert.deepEqual(b.recebidas, [], "b espera: orçamento é global");

  a.emit("message", { mmb: "mmb-conversao-liberar" });
  assert.deepEqual(b.recebidas.map((m) => m.id), [1]);
  assert.equal(corretor.ativos, 2);

  // a morre segurando uma vaga: ela volta ao orçamento.
  a.connected = false;
  a.emit("exit", null, "SIGKILL");
  assert.equal(corretor.ativos, 1);
  b.emit("message", { mmb: "mmb-conversao-liberar" });
  b.emit("message", { mmb: "mmb-conversao-liberar" }); // liberação a mais é ignorada
  assert.equal(corretor.ativos, 0);
});

// Rede falsa que usa o baixarEncartes real; a rasterização falsa marca cada
// página ativa num diretório compartilhado entre processos e registra quantas
// via ao mesmo tempo (contagem feita depois de criar a própria marca).
function scriptRedeConversao({ nome, ativosDir, log, paginas }) {
  return `"use strict";
const fs = require("fs/promises");
const path = require("path");
const { baixarEncartes } = require(${JSON.stringify(PIPELINE)});
async function main() {
  const base = process.argv[process.argv.indexOf("--base") + 1];
  await baixarEncartes({
    rede: ${JSON.stringify(nome)},
    descobrir: async () => [{ slug: "e", pdf: { url: "https://exemplo.test/e.pdf", manter: true }, meta: {} }],
    args: { base, output: null, semReuso: true, dpi: 150 },
    deps: {
      async baixarArquivo(_u, caminho) { await fs.writeFile(caminho, "%PDF-falso"); return true; },
      async contarPaginasPdf() { return ${Number(paginas)}; },
      async rasterizarPagina(_p, outBase, page) {
        const marca = path.join(${JSON.stringify(ativosDir)}, process.pid + "-" + page);
        await fs.writeFile(marca, "");
        const vistos = (await fs.readdir(${JSON.stringify(ativosDir)})).length;
        await fs.appendFile(${JSON.stringify(log)}, JSON.stringify({ rede: ${JSON.stringify(nome)}, vistos }) + "\\n");
        await new Promise((r) => setTimeout(r, 120));
        await fs.rm(marca);
        await fs.writeFile(outBase + ".jpg", "jpg");
      },
      checarPoppler() {},
    },
  });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
`;
}

test("F4: duas redes (processos filhos) convertendo juntas respeitam o orçamento global", async () => {
  const root = await baseTemp("conversao-global-");
  const ativosDir = path.join(root, "ativos");
  const log = path.join(root, "conversoes.log");
  await fs.mkdir(ativosDir);
  const registro = { root, redes: [] };
  for (const nome of ["RedeA", "RedeB"]) {
    const slug = nome.toLowerCase();
    await fs.mkdir(path.join(root, slug));
    await fs.writeFile(path.join(root, slug, "rede.js"), scriptRedeConversao({ nome, ativosDir, log, paginas: 4 }));
    registro.redes.push({ nome, slug, pasta: slug, script: "rede.js", flags: [], deps: { poppler: false, playwright: false } });
  }
  const arquivo = path.join(root, "redes.json");
  await fs.writeFile(arquivo, JSON.stringify(registro));

  const env = { ...process.env, MMB_REDES_JSON: arquivo, MMB_EVENTOS: "1", MMB_CONVERSOES_MAX: "2" };
  const { code, stdout, stderr } = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [BAIXAR_TODOS, "--json", "--paralelo", "2", "--base", path.join(root, "base")], {
      env, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { err += c; });
    proc.on("close", (c) => resolve({ code: c, stdout: out, stderr: err }));
  });

  assert.equal(code, 0, stderr + stdout);
  const json = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.deepEqual(json.redes.map((r) => [r.rede, r.ok]), [["redea", true], ["redeb", true]]);
  for (const r of json.redes) {
    assert.equal((await fs.readdir(path.join(r.pasta_download, "JPG"))).length, 4);
  }
  const registros = fsSync.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(registros.length, 8);
  assert.deepEqual([...new Set(registros.map((r) => r.rede))].sort(), ["RedeA", "RedeB"]);
  const pico = Math.max(...registros.map((r) => r.vistos));
  // Por processo seriam até 2 + 2 = 4; o orçamento é global.
  assert.equal(pico, 2, `pico global ${pico}`);

  // Eventos de F0 continuam válidos com a conversão paralela.
  const { lerEvento } = require("./eventos");
  const eventos = stderr.split("\n").map(lerEvento).filter(Boolean);
  for (const rede of ["redea", "redeb"]) {
    const deRede = eventos.filter((e) => e.rede === rede);
    assert.deepEqual(deRede.map((e) => e.evento), ["download_iniciado", "conversao_iniciada", "conversao_ok", "download_ok"]);
    const conv = deRede.find((e) => e.evento === "conversao_ok");
    const dl = deRede.find((e) => e.evento === "download_ok");
    // 4 páginas de 120 ms com no máximo 2 simultâneas no total: >= 240 ms de
    // parede, e conversao_ms nunca passa da fase de download que a contém.
    assert.ok(conv.ms >= 230 && conv.ms <= dl.ms, `conversao ${conv.ms} vs download ${dl.ms}`);
  }

  await fs.rm(root, { recursive: true, force: true });
});

"use strict";

// Download paralelo de PDFs dentro de uma rede. Sem rede real: um servidor
// HTTPS local (certificado autoassinado gerado na hora) serve PDFs falsos com
// latência por arquivo, e o pipeline roda num processo filho com o baixar
// real (fetch/undici) e NODE_EXTRA_CA_CERTS apontando para o certificado.
// Contagem de páginas e rasterização são falsas e determinísticas: a página
// gerada leva o sha256 do PDF baixado, então qualquer troca de bytes aparece.

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const { baixarEncartes, downloadsPdfParalelos } = require("./pipeline");
const { lerEvento } = require("./eventos");

const PIPELINE = path.join(__dirname, "pipeline.js");

function temOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SEM_OPENSSL = temOpenssl() ? false : "openssl ausente";

// ─── certificado e servidor falso ─────────────────────────────────────────────

let certDir = null;
async function certificado() {
  if (certDir) return certDir;
  certDir = await fs.mkdtemp(path.join(os.tmpdir(), "dl-paralelo-cert-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost",
    "-keyout", path.join(certDir, "chave.pem"),
    "-out", path.join(certDir, "cert.pem"),
  ], { stdio: "ignore" });
  return certDir;
}

test.after(async () => {
  if (certDir) await fs.rm(certDir, { recursive: true, force: true });
});

function corpoPdf(nome, paginas) {
  // Conteúdo distinto por arquivo, começa com %PDF- e informa as páginas.
  return Buffer.from(`%PDF-1.4\n% ${nome}\nPages: ${paginas}\n${"x".repeat(2048)}\n%%EOF\n`);
}

// arquivos: { "/a.pdf": { paginas, latencia, status?, travarNoMeio? } }
async function subirServidor(arquivos) {
  const dir = await certificado();
  const log = [];
  let ativos = 0;
  let pico = 0;
  const timers = new Set();
  const esperar = (ms) => new Promise((resolve) => {
    const t = setTimeout(() => { timers.delete(t); resolve(); }, ms);
    timers.add(t);
  });

  const servidor = https.createServer({
    key: fsSync.readFileSync(path.join(dir, "chave.pem")),
    cert: fsSync.readFileSync(path.join(dir, "cert.pem")),
  }, async (req, res) => {
    const registro = { caminho: req.url, inicio: Date.now(), fim: null, abortado: false };
    log.push(registro);
    ativos += 1;
    pico = Math.max(pico, ativos);
    res.on("close", () => {
      ativos -= 1;
      registro.fim = Date.now();
      registro.abortado = !res.writableFinished;
    });

    const arquivo = arquivos[req.url];
    if (!arquivo) {
      res.writeHead(404).end();
      return;
    }
    await esperar(arquivo.latencia);
    if (res.destroyed) return;
    if (arquivo.status) {
      res.writeHead(arquivo.status, { "Content-Type": "text/html" }).end("erro");
      return;
    }
    const corpo = corpoPdf(req.url, arquivo.paginas);
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": corpo.length });
    if (arquivo.travarNoMeio) {
      // Metade do corpo e trava: o cliente tem um .part em andamento.
      res.write(corpo.subarray(0, corpo.length / 2));
      await esperar(arquivo.travarNoMeio);
      if (!res.destroyed) res.end(corpo.subarray(corpo.length / 2));
      return;
    }
    res.end(corpo);
  });

  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const porta = servidor.address().port;
  return {
    url: (caminho) => `https://localhost:${porta}${caminho}`,
    log,
    get pico() { return pico; },
    async fechar() {
      for (const t of timers) clearTimeout(t);
      servidor.closeAllConnections();
      await new Promise((resolve) => servidor.close(resolve));
    },
  };
}

// ─── pipeline num processo filho ──────────────────────────────────────────────

const DRIVER = `
"use strict";
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const { baixarEncartes } = require(${JSON.stringify(PIPELINE)});
const config = JSON.parse(process.argv[2]);
const deps = {
  async contarPaginasPdf(pdfPath) {
    const texto = await fs.readFile(pdfPath, "latin1");
    return Number(texto.match(/^Pages: (\\d+)$/m)[1]);
  },
  async rasterizarPagina(pdfPath, outBase, pagina) {
    fsSync.appendFileSync(config.logRaster, JSON.stringify({ pdf: pdfPath, pagina, inicio: Date.now() }) + "\\n");
    const bytes = await fs.readFile(pdfPath);
    await new Promise((r) => setTimeout(r, config.rasterMs));
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(outBase + ".jpg", "jpg:" + sha + ":" + pagina);
  },
  checarPoppler() {},
};
const inicio = performance.now();
baixarEncartes({
  rede: "Teste",
  descobrir: async () => config.encartes,
  args: { base: config.base, output: null, semReuso: true, dpi: 200 },
  hostsPermitidos: ["localhost"],
  agora: new Date(config.agora),
  deps,
}).then(
  ({ destino, manifest }) => {
    process.stdout.write("@@resultado " + JSON.stringify({ ok: true, destino, manifest, ms: performance.now() - inicio }) + "\\n");
  },
  (erro) => {
    process.stdout.write("@@resultado " + JSON.stringify({ ok: false, erro: erro.message, ms: performance.now() - inicio }) + "\\n");
  },
);
`;

async function rodarPipeline({ encartes, paralelo, eventos = false, rasterMs = 20 }) {
  const dir = await certificado();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dl-paralelo-"));
  const driver = path.join(root, "driver.js");
  await fs.writeFile(driver, DRIVER);
  const logRaster = path.join(root, "raster.log");
  const config = {
    base: path.join(root, "base"),
    encartes,
    agora: "2026-10-11T12:00:00.000Z",
    logRaster,
    rasterMs,
  };
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, "cert.pem") };
  delete env.MMB_DOWNLOAD_PDF_PARALELO;
  delete env.MMB_EVENTOS;
  if (paralelo !== undefined) env.MMB_DOWNLOAD_PDF_PARALELO = String(paralelo);
  if (eventos) env.MMB_EVENTOS = "1";

  const { stdout, stderr } = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [driver, JSON.stringify(config)], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { err += c; });
    proc.on("close", () => resolve({ stdout: out, stderr: err }));
  });
  const linha = stdout.split("\n").find((l) => l.startsWith("@@resultado "));
  assert.ok(linha, `filho sem resultado:\n${stdout}\n${stderr}`);
  const resultado = JSON.parse(linha.slice("@@resultado ".length));
  let raster = [];
  try {
    raster = (await fs.readFile(logRaster, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* sem conversão */ }
  const destino = path.join(config.base, "Teste", "11-Outubro");
  return { ...resultado, root, destino, stderr, raster };
}

// Lista relativa e sha256 de todos os arquivos da pasta da rodada.
async function inventario(dir) {
  const saida = {};
  async function andar(atual) {
    for (const entrada of await fs.readdir(atual, { withFileTypes: true })) {
      const caminho = path.join(atual, entrada.name);
      if (entrada.isDirectory()) await andar(caminho);
      else saida[path.relative(dir, caminho)] = crypto.createHash("sha256").update(await fs.readFile(caminho)).digest("hex");
    }
  }
  await andar(dir);
  return saida;
}

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// ─── seam de configuração ─────────────────────────────────────────────────────

test("limite de downloads paralelos: 4 por padrão; env só reduz e precisa ser inteiro positivo", async () => {
  assert.equal(downloadsPdfParalelos({}), 4);
  assert.equal(downloadsPdfParalelos({ MMB_DOWNLOAD_PDF_PARALELO: "" }), 4);
  assert.equal(downloadsPdfParalelos({ MMB_DOWNLOAD_PDF_PARALELO: "1" }), 1);
  assert.equal(downloadsPdfParalelos({ MMB_DOWNLOAD_PDF_PARALELO: "2" }), 2);
  assert.equal(downloadsPdfParalelos({ MMB_DOWNLOAD_PDF_PARALELO: "9" }), 4);
  for (const invalido of ["0", "-1", "abc", "1.5", " 2", "2x"]) {
    assert.throws(() => downloadsPdfParalelos({ MMB_DOWNLOAD_PDF_PARALELO: invalido }), /inteiro positivo/, invalido);
  }

  // Valor inválido falha antes de qualquer trabalho (nem chama o adapter).
  const anterior = process.env.MMB_DOWNLOAD_PDF_PARALELO;
  process.env.MMB_DOWNLOAD_PDF_PARALELO = "0";
  let descobriu = false;
  try {
    await assert.rejects(baixarEncartes({
      rede: "X",
      descobrir: async () => { descobriu = true; return []; },
      args: { base: os.tmpdir(), output: null },
    }), /inteiro positivo/);
  } finally {
    if (anterior === undefined) delete process.env.MMB_DOWNLOAD_PDF_PARALELO;
    else process.env.MMB_DOWNLOAD_PDF_PARALELO = anterior;
  }
  assert.equal(descobriu, false);
});

// ─── paralelo x sequencial ────────────────────────────────────────────────────

const SEIS = [
  ["a", 200, 2], ["b", 600, 3], ["c", 300, 1], ["d", 400, 2], ["e", 250, 4], ["f", 350, 2],
];

test("até 4 PDFs simultâneos: parede ≈ max e não soma; pico 4; resultado idêntico ao sequencial", { skip: SEM_OPENSSL }, async () => {
  const arquivos = Object.fromEntries(SEIS.map(([n, latencia, paginas]) => [`/${n}.pdf`, { latencia, paginas }]));
  const soma = SEIS.reduce((s, [, l]) => s + l, 0); // 2100 ms
  const maximo = Math.max(...SEIS.map(([, l]) => l)); // 600 ms

  const servidorSeq = await subirServidor(arquivos);
  const servidorPar = await subirServidor(arquivos);
  try {
    const encartes = (srv) => SEIS.map(([n]) => ({ slug: `encarte-${n}`, pdf: { url: srv.url(`/${n}.pdf`), manter: true }, meta: { id: n } }));
    const seq = await rodarPipeline({ encartes: encartes(servidorSeq), paralelo: 1 });
    const par = await rodarPipeline({ encartes: encartes(servidorPar) });
    assert.equal(seq.ok, true, seq.erro);
    assert.equal(par.ok, true, par.erro);

    // Concorrência observada no servidor.
    assert.equal(servidorSeq.pico, 1);
    assert.equal(servidorPar.pico, 4);
    assert.equal(servidorPar.log.length, 6);

    // Parede: o sequencial soma as latências; o paralelo fica perto da maior
    // (6 arquivos em 4 vagas: ~650 ms), longe da soma.
    assert.ok(seq.ms >= soma, `sequencial ${seq.ms} ms`);
    assert.ok(par.ms >= maximo, `paralelo ${par.ms} ms`);
    assert.ok(par.ms < maximo + 700, `paralelo ${par.ms} ms deveria ficar perto de ${maximo} ms`);

    // Mesmo manifest (ordem de descoberta), mesmos nomes e mesmos bytes.
    assert.deepEqual(par.manifest, seq.manifest);
    assert.deepEqual(par.manifest.encartes.map((e) => e.slug), SEIS.map(([n]) => `encarte-${n}`));
    const invSeq = await inventario(seq.destino);
    const invPar = await inventario(par.destino);
    assert.deepEqual(invPar, invSeq);
    assert.deepEqual(Object.keys(invPar).filter((n) => n.startsWith("JPG/")).sort(),
      SEIS.flatMap(([n, , p]) => Array.from({ length: p }, (_, i) => `JPG/encarte-${n}-pagina-${String(i + 1).padStart(2, "0")}.jpg`)).sort());
    for (const [n, , p] of SEIS) {
      assert.equal(invPar[`PDF/encarte-${n}.pdf`], sha(corpoPdf(`/${n}.pdf`, p)));
    }

    // A conversão de um PDF começa assim que ELE termina de baixar: o mais
    // rápido (a, 200 ms) converte antes de o mais lento (b, 600 ms) terminar.
    const fimB = servidorPar.log.find((r) => r.caminho === "/b.pdf").fim;
    const inicioConvA = Math.min(...par.raster.filter((r) => r.pdf.endsWith("encarte-a.pdf")).map((r) => r.inicio));
    assert.ok(inicioConvA < fimB, `conversão de a (${inicioConvA}) esperou b (${fimB})`);

    await fs.rm(seq.root, { recursive: true, force: true });
    await fs.rm(par.root, { recursive: true, force: true });
  } finally {
    await servidorSeq.fechar();
    await servidorPar.fechar();
  }
});

test("eventos F0 seguem válidos: conversao_iniciada uma vez e conversao_ok sem somar sobreposições", { skip: SEM_OPENSSL }, async () => {
  const arquivos = Object.fromEntries(SEIS.map(([n, latencia, paginas]) => [`/${n}.pdf`, { latencia: latencia / 2, paginas }]));
  const servidor = await subirServidor(arquivos);
  try {
    const encartes = SEIS.map(([n]) => ({ slug: `encarte-${n}`, pdf: { url: servidor.url(`/${n}.pdf`), manter: true } }));
    const r = await rodarPipeline({ encartes, eventos: true, rasterMs: 150 });
    assert.equal(r.ok, true, r.erro);
    const eventos = r.stderr.split("\n").map(lerEvento).filter(Boolean);
    assert.deepEqual(eventos.map((e) => e.evento), ["conversao_iniciada", "conversao_ok"]);
    const ok = eventos[1];
    // 14 páginas de 150 ms: soma ~2100 ms; a parede de conversão é união de
    // intervalos, nunca maior que a fase inteira da rede.
    assert.ok(ok.ms > 0 && ok.ms <= r.ms, `conversao ${ok.ms} vs rede ${r.ms}`);
    assert.ok(!r.stderr.includes("localhost"), "evento vazou URL");
    await fs.rm(r.root, { recursive: true, force: true });
  } finally {
    await servidor.fechar();
  }
});

// ─── colisão de slug ──────────────────────────────────────────────────────────

for (const manter of [true, false]) {
  test(`colisão de slug (manter=${manter}): mesmo resultado do sequencial, sem escrita concorrente no mesmo caminho`, { skip: SEM_OPENSSL }, async () => {
    // Ordem de descoberta: havaianas (1ª), outro, havaianas (2ª, conteúdo e
    // nº de páginas diferentes), mais um.
    const arquivos = {
      "/hav1.pdf": { latencia: 300, paginas: 2 },
      "/outro.pdf": { latencia: 50, paginas: 1 },
      "/hav2.pdf": { latencia: 50, paginas: 3 },
      "/mais.pdf": { latencia: 100, paginas: 1 },
    };
    const lista = (srv) => [
      { slug: "havaianas-27-09-a-11-10", pdf: { url: srv.url("/hav1.pdf"), manter }, meta: { id: 1 } },
      { slug: "outro", pdf: { url: srv.url("/outro.pdf"), manter }, meta: { id: 2 } },
      { slug: "havaianas-27-09-a-11-10", pdf: { url: srv.url("/hav2.pdf"), manter }, meta: { id: 3 } },
      { slug: "mais", pdf: { url: srv.url("/mais.pdf"), manter }, meta: { id: 4 } },
    ];
    const srvSeq = await subirServidor(arquivos);
    const srvPar = await subirServidor(arquivos);
    try {
      const seq = await rodarPipeline({ encartes: lista(srvSeq), paralelo: 1 });
      const par = await rodarPipeline({ encartes: lista(srvPar) });
      assert.equal(seq.ok, true, seq.erro);
      assert.equal(par.ok, true, par.erro);
      assert.deepEqual(par.manifest, seq.manifest);
      assert.deepEqual(await inventario(par.destino), await inventario(seq.destino));
      assert.deepEqual(srvPar.log.map((r) => r.caminho).sort(), srvSeq.log.map((r) => r.caminho).sort());

      const segunda = par.manifest.encartes[2];
      assert.equal(segunda.id, 3);
      if (manter) {
        // Comportamento atual: o PDF da 1ª já existe, a 2ª nem é baixada e
        // herda as páginas da 1ª (ofertas da 2ª se perdem; bug não corrigido).
        assert.ok(!srvPar.log.some((r) => r.caminho === "/hav2.pdf"));
        assert.equal(segunda.pdfBaixado, false);
        assert.equal(segunda.paginas, 2);
        assert.equal((await inventario(par.destino))["PDF/havaianas-27-09-a-11-10.pdf"], sha(corpoPdf("/hav1.pdf", 2)));
      } else {
        // Sem manter, a 2ª baixa de novo no mesmo caminho temporário, mas só
        // depois que a 1ª terminou (nunca ao mesmo tempo).
        const hav1 = srvPar.log.find((r) => r.caminho === "/hav1.pdf");
        const hav2 = srvPar.log.find((r) => r.caminho === "/hav2.pdf");
        assert.ok(hav2.inicio >= hav1.fim, "duas escritas simultâneas no mesmo slug");
      }
      // Ainda assim houve paralelismo entre slugs diferentes.
      assert.ok(srvPar.pico >= 2, `pico ${srvPar.pico}`);

      await fs.rm(seq.root, { recursive: true, force: true });
      await fs.rm(par.root, { recursive: true, force: true });
    } finally {
      await srvSeq.fechar();
      await srvPar.fechar();
    }
  });
}

// ─── falha ────────────────────────────────────────────────────────────────────

test("falha de um download aborta os demais em andamento e não deixa arquivo final parcial", { skip: SEM_OPENSSL }, async () => {
  const arquivos = {
    "/ok.pdf": { latencia: 20, paginas: 1 },
    "/meio.pdf": { latencia: 20, paginas: 2, travarNoMeio: 20_000 },
    "/lento.pdf": { latencia: 20_000, paginas: 1 },
    "/falha.pdf": { latencia: 300, status: 500 },
    "/fila.pdf": { latencia: 20, paginas: 1 },
  };
  const servidor = await subirServidor(arquivos);
  try {
    const encartes = ["ok", "meio", "lento", "falha", "fila"].map((n) => ({
      slug: n, pdf: { url: servidor.url(`/${n}.pdf`), manter: true },
    }));
    // "ok" libera sua vaga cedo; "fila" entra nela e pode concluir antes da
    // falha. O que importa: nada parcial com nome final.
    const r = await rodarPipeline({ encartes, eventos: true });
    assert.equal(r.ok, false);
    assert.match(r.erro, /Falha 500/);
    assert.ok(r.ms < 5000, `falha demorou ${r.ms} ms (downloads travados não foram abortados)`);

    // Os travados foram cortados pelo cliente.
    for (const caminho of ["/meio.pdf", "/lento.pdf"]) {
      const registro = servidor.log.find((x) => x.caminho === caminho);
      assert.ok(registro, caminho);
      assert.ok(registro.fim !== null && registro.abortado, `${caminho} não foi abortado`);
    }

    const inv = await inventario(r.destino);
    const nomes = Object.keys(inv);
    assert.ok(!nomes.some((n) => n.endsWith(".part")), `sobrou .part: ${nomes}`);
    assert.ok(!nomes.includes("manifest.json"), "manifest gravado numa rodada que falhou");
    for (const n of ["meio", "lento", "falha"]) {
      assert.ok(!nomes.includes(`PDF/${n}.pdf`), `PDF parcial ${n}`);
      assert.ok(!nomes.some((x) => x.startsWith(`JPG/${n}-`)), `JPG de ${n}`);
    }
    // O que ficou com nome final está completo.
    for (const n of ["ok", "fila"]) {
      if (inv[`PDF/${n}.pdf`]) assert.equal(inv[`PDF/${n}.pdf`], sha(corpoPdf(`/${n}.pdf`, 1)));
    }
    assert.ok(!nomes.some((x) => x.startsWith(".convertendo-") || x.includes("/.convertendo-")));

    // Eventos continuam válidos e sem URL.
    const eventos = r.stderr.split("\n").map(lerEvento).filter(Boolean);
    for (const e of eventos) assert.ok(["conversao_iniciada", "conversao_falhou"].includes(e.evento), e.evento);
    assert.ok(!r.stderr.includes("localhost"), "stderr vazou URL");

    await fs.rm(r.root, { recursive: true, force: true });
  } finally {
    await servidor.fechar();
  }
});

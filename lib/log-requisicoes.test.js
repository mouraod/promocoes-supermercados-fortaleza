"use strict";

// Log local por requisição (downloads.jsonl). Servidor HTTP local: nenhum teste
// fala com site real.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { baixarArquivo } = require("./pipeline");
const log = require("./log-requisicoes");

const PDF_FALSO = Buffer.from("%PDF-1.4 conteudo falso para o teste");

function iniciarServidor() {
  const servidor = http.createServer((req, res) => {
    if (req.url === "/ok.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("0123456789");
    } else if (req.url === "/doc.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(PDF_FALSO);
    } else if (req.url === "/ausente") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("não achei");
    } else if (req.url === "/lento") {
      // Nunca responde: o cliente estoura o prazo injetado.
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => resolve({
      servidor,
      origem: `http://127.0.0.1:${servidor.address().port}`,
      fechar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }),
    }));
  });
}

test("downloads.jsonl registra url, status, bytes e ms de 200, 404 e prazo estourado", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "log-requisicoes-"));
  const { origem, fechar } = await iniciarServidor();
  try {
    log.reiniciar();
    log.configurar({ rede: "RedeTeste", destino: pasta });
    const opcoes = { permitirHttpLocal: true, timeoutMs: 150 };

    assert.equal(await baixarArquivo(`${origem}/ok.txt`, path.join(pasta, "ok.txt"), opcoes), true);
    assert.equal(await baixarArquivo(`${origem}/doc.pdf`, path.join(pasta, "doc.pdf"), { ...opcoes, tipo: "pdf" }), true);
    await assert.rejects(baixarArquivo(`${origem}/ausente`, path.join(pasta, "x"), opcoes), /Falha 404/);
    await assert.rejects(baixarArquivo(`${origem}/lento`, path.join(pasta, "y"), opcoes), /Tempo esgotado \(150 ms\)/);

    const linhas = log.lerLog(pasta);
    assert.equal(linhas.length, 4);
    const [ok, pdf, nulo, lento] = linhas;

    assert.equal(ok.rede, "RedeTeste");
    assert.equal(ok.etapa, "pagina");
    assert.equal(ok.url, `${origem}/ok.txt`);
    assert.equal(ok.status, 200);
    assert.equal(ok.bytes, 10);
    assert.ok(ok.ms >= 0 && ok.ms < 5000);
    assert.equal(ok.tentativa, 1);
    assert.equal(ok.erro, null);
    assert.ok(!Number.isNaN(Date.parse(ok.ts)));

    assert.equal(pdf.etapa, "pdf");
    assert.equal(pdf.status, 200);
    assert.equal(pdf.bytes, PDF_FALSO.length);

    assert.equal(nulo.url, `${origem}/ausente`);
    assert.equal(nulo.status, 404);
    assert.equal(nulo.bytes, 0);
    assert.match(nulo.erro, /Falha 404/);

    assert.equal(lento.url, `${origem}/lento`);
    assert.equal(lento.status, null);
    assert.equal(lento.erro, "tempo_esgotado");
    assert.ok(lento.ms >= 140, `ms do prazo estourado: ${lento.ms}`);

    // Arquivo só ganha nome final nos sucessos.
    assert.deepEqual((await fs.readdir(pasta)).filter((n) => n !== "downloads.jsonl").sort(), ["doc.pdf", "ok.txt"]);
  } finally {
    log.reiniciar();
    await fechar();
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("http só é aceito em localhost e só com permitirHttpLocal", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "log-requisicoes-"));
  try {
    log.reiniciar();
    await assert.rejects(baixarArquivo("http://127.0.0.1:1/a", path.join(pasta, "a")), /não segura/);
    await assert.rejects(baixarArquivo("http://exemplo.test/a", path.join(pasta, "a"), { permitirHttpLocal: true }), /não segura/);
  } finally {
    log.reiniciar();
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("registros feitos antes de a pasta existir saem quando ela é configurada", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "log-requisicoes-"));
  const pasta = path.join(base, "Rede", "16-Novembro"); // ainda não existe
  try {
    log.reiniciar();
    log.registrar({ etapa: "descoberta", url: "https://exemplo.test/a", status: 200, bytes: 5, ms: 12.4, tentativa: 2 });
    assert.deepEqual(log.lerLog(pasta), []);
    log.configurar({ rede: "Rede", destino: pasta });
    const [linha] = log.lerLog(pasta);
    assert.equal(linha.rede, "Rede");
    assert.equal(linha.etapa, "descoberta");
    assert.equal(linha.ms, 12);
    assert.equal(linha.tentativa, 2);
    assert.throws(() => log.registrar({ etapa: "inventada", url: "x" }), /etapa de log desconhecida/);
  } finally {
    log.reiniciar();
    await fs.rm(base, { recursive: true, force: true });
  }
});

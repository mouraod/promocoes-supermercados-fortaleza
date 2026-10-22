const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { reaproveitarPaginas } = require("./reuso");

test("reuso não atravessa identidade nem lê manifestos legados como Recife", async () => {
  const redeDir = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-identidade-"));
  const origem = path.join(redeDir, "15-Outubro");
  const jpgDirDestino = path.join(redeDir, "22-Outubro/JPG");
  const identidade = { cidade: "recife-pe", loja: "torre", fonte: "https://recibom.com.br/tabloide/", campanha: "hash-urls" };
  try {
    await fs.mkdir(path.join(origem, "JPG"), { recursive: true });
    await fs.mkdir(jpgDirDestino, { recursive: true });
    await fs.writeFile(path.join(origem, "JPG/fixo-pagina-01.jpg"), "imagem");
    const args = { redeDir, dataAtual: "22-Outubro", slug: "fixo", jpgDirDestino, paginasEsperadas: 1, identidade, identidadeConteudo: "conteudo-a" };
    async function manifest(id) {
      await fs.writeFile(path.join(origem, "manifest.json"), JSON.stringify({ encartes: [{ slug: "fixo", paginas: 1, identidade: id, identidade_conteudo: "conteudo-a" }] }));
    }
    for (const id of [undefined, { ...identidade, cidade: "fortaleza-ce" }, { ...identidade, loja: "outra" }, { ...identidade, fonte: "outra" }, { ...identidade, campanha: "outra" }]) {
      await manifest(id);
      assert.equal(await reaproveitarPaginas(args), null);
      assert.deepEqual(await fs.readdir(jpgDirDestino), []);
    }
    await manifest(identidade);
    assert.equal(await reaproveitarPaginas({ ...args, identidade: undefined }), null, "Fortaleza legada também recusa origem escopada");
    assert.equal((await reaproveitarPaginas(args)).paginas, 1);
  } finally { await fs.rm(redeDir, { recursive: true, force: true }); }
});

test("reuso exige identidade de conteúdo do encarte (slug repetido não basta)", async () => {
  const redeDir = await fs.mkdtemp(path.join(os.tmpdir(), "reuso-conteudo-"));
  const origem = path.join(redeDir, "07-Outubro");
  const jpgDirDestino = path.join(redeDir, "21-Outubro/JPG");
  try {
    await fs.mkdir(path.join(origem, "JPG"), { recursive: true });
    await fs.mkdir(jpgDirDestino, { recursive: true });
    await fs.writeFile(path.join(origem, "JPG/carnes-pagina-01.jpg"), "imagem");
    const args = {
      redeDir, dataAtual: "21-Outubro", slug: "carnes",
      jpgDirDestino, paginasEsperadas: 1, identidadeConteudo: "urls-da-semana-nova",
    };
    async function manifest(extra) {
      await fs.writeFile(path.join(origem, "manifest.json"),
        JSON.stringify({ encartes: [{ slug: "carnes", paginas: 1, ...extra }] }));
    }
    // Rodada antiga sem o campo novo e rodada com outra semana: nunca reutiliza.
    for (const extra of [{}, { identidade_conteudo: "urls-da-semana-antiga" }, { identidade_conteudo: null }]) {
      await manifest(extra);
      assert.equal(await reaproveitarPaginas(args), null);
      assert.deepEqual(await fs.readdir(jpgDirDestino), []);
    }
    // Sem identidade na rodada atual (adapter sem URLs) também não reutiliza.
    await manifest({ identidade_conteudo: "urls-da-semana-antiga" });
    assert.equal(await reaproveitarPaginas({ ...args, identidadeConteudo: null }), null);
    // Mesma semana republicada: reutiliza.
    await manifest({ identidade_conteudo: "urls-da-semana-nova" });
    assert.equal((await reaproveitarPaginas(args)).paginas, 1);
    assert.deepEqual(await fs.readdir(jpgDirDestino), ["carnes-pagina-01.jpg"]);
  } finally { await fs.rm(redeDir, { recursive: true, force: true }); }
});

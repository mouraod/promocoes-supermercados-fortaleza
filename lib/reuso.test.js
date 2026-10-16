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
    const args = { redeDir, dataAtual: "22-Outubro", slug: "fixo", jpgDirDestino, paginasEsperadas: 1, identidade };
    async function manifest(id) {
      await fs.writeFile(path.join(origem, "manifest.json"), JSON.stringify({ encartes: [{ slug: "fixo", paginas: 1, identidade: id }] }));
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

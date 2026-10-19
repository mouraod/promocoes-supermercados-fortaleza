const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { gravarListaDeOfertas, medida, montarDados, normalizar } = require("./ofertas-lista");

// São Luiz sem encarte em imagem: a rodada é só a lista de ofertas da loja.
// O que importa aqui é a pasta sair no mesmo formato das redes com imagem
// (manifest.json com 0 páginas), senão o orquestrador trata como falha.

const BRUTAS = [
  {
    produto_id: 1,
    nome: "BANANA PRATA FRUTACOR KG",
    preco: 3.195,
    preco_antigo: 3.89,
    categoria: "hortifruti",
    valido_ate: "2026-10-21",
  },
  {
    produto_id: 2,
    nome: "REFRIGERANTE GUARANÁ ANTARCTICA LATA 350ML",
    preco: 2.89,
    preco_antigo: null,
    categoria: "bebidas",
    valido_ate: "2026-10-25",
  },
  {
    // Repetido por produto: a lista da loja pode trazer o mesmo item em seções
    // diferentes, e o site não deve receber duas linhas do mesmo produto.
    produto_id: 1,
    nome: "BANANA PRATA FRUTACOR KG",
    preco: 3.195,
    categoria: "hortifruti",
    valido_ate: "2026-10-21",
  },
];

test("normalizar deduplica por produto e arredonda o preço", () => {
  const ofertas = normalizar(BRUTAS);
  assert.equal(ofertas.length, 2);
  assert.equal(ofertas[0].preco, 3.2);
  assert.equal(ofertas[0].unidade, "kg");
  assert.equal(ofertas[1].unidade, "ml");
});

test("medida não confunde número de embalagem com contagem", () => {
  assert.deepEqual(medida("GIRASSOL REIJERS POTE Nº 15 UNIDADE"), { quantidade: 1, unidade: "un" });
  assert.deepEqual(medida("ABACAXI PREMIUM UNIDADE"), { quantidade: 1, unidade: "un" });
  assert.deepEqual(medida("TOMATE CEREJA 300G VERMELHA"), { quantidade: 300, unidade: "g" });
  assert.deepEqual(medida("PAPEL HIGIÊNICO 12 ROLOS"), { quantidade: 12, unidade: "un" });
  assert.equal(medida("SAL REFINADO"), null);
});

test("validade do encarte só existe quando todas as ofertas vencem junto", () => {
  const ofertas = normalizar(BRUTAS);
  assert.equal(montarDados({ ofertas, rede: "saoluiz", loja: 355, source: "u" }).valido_ate, null);
  const unica = normalizar([{ produto_id: 9, nome: "SAL 1KG", preco: 4, categoria: "mercearia", valido_ate: "2026-11-01" }]);
  assert.equal(
    montarDados({ ofertas: unica, rede: "saoluiz", loja: 355, source: "u" }).valido_ate,
    "2026-11-01",
  );
});

test("grava ofertas.json e manifest com 0 páginas, no formato do orquestrador", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "saoluiz-lista-"));
  const destino = path.join(raiz, "SaoLuiz", "19-Outubro");
  const ofertas = normalizar(BRUTAS);
  const agora = new Date("2026-10-19T12:00:00-03:00");

  const { destino: pasta } = await gravarListaDeOfertas({
    destino,
    dados: montarDados({ ofertas, rede: "saoluiz", loja: 355, source: "https://loja/ofertas" }),
    manifest: { rede: "SaoLuiz", mercado: "saoluiz", cidade: "fortaleza-ce" },
    agora,
  });

  assert.equal(pasta, destino);
  const manifest = JSON.parse(await fs.readFile(path.join(destino, "manifest.json"), "utf8"));
  assert.equal(manifest.totalEncartes, 0);
  assert.equal(manifest.totalPaginas, 0);
  assert.equal(manifest.totalOfertas, 2);
  assert.equal(manifest.data, "19-Outubro");
  assert.deepEqual(manifest.encartes, []);
  assert.equal(manifest.cidade, "fortaleza-ce");

  const dados = JSON.parse(await fs.readFile(path.join(destino, "ofertas.json"), "utf8"));
  assert.equal(dados.rede, "saoluiz");
  assert.equal(dados.loja, 355);
  assert.equal(dados.ofertas.length, 2);
});

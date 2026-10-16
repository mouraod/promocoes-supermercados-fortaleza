const test = require("node:test");
const assert = require("node:assert/strict");
const { parsearTabloide } = require("./download-encartes");
const imagem = (nome) => `<img class='x landing-block-node-img' srcset='https://cdn.bitrix24.com.br/${nome}-1.jpg 1x, https://cdn.bitrix24.com.br/${nome}-2.jpg 2x'>`;

test("Recibom seleciona somente 2x, ignora logo e identifica a campanha pelo conjunto ordenado", () => {
  const [a] = parsearTabloide(imagem("a") + imagem("b") + '<img class="logo" src="logo.png">');
  const [b] = parsearTabloide(imagem("b") + imagem("a"));
  assert.equal(a.paginas.length, 2);
  assert.match(a.paginas[0].url, /a-2.jpg$/);
  assert.equal(a.meta.campanha, b.meta.campanha);
  assert.notEqual(a.meta.campanha, parsearTabloide(imagem("c") + imagem("b"))[0].meta.campanha);
  assert.equal(a.meta.vigencia, null);
  assert.equal(a.meta.validade_evidencia, null);
});

test("Recibom falha fechado sem 2x ou com host/protocolo alheios", () => {
  assert.throws(() => parsearTabloide('<img class="landing-block-node-img" src="a.jpg">'), /2x/);
  assert.throws(() => parsearTabloide(imagem("a").replaceAll("cdn.bitrix24.com.br", "evil.test")), /host/);
  assert.throws(() => parsearTabloide(imagem("a").replaceAll("https:", "http:")), /host/);
  assert.deepEqual(parsearTabloide("sem campanha"), []);
});

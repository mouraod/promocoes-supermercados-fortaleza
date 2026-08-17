const assert = require("node:assert/strict");
const test = require("node:test");

const {
  atribuirArquivos,
  descobrirEncartes,
  extrairEncartes,
} = require("./download-encartes");
const { baixarPaginasEmPool } = require("../../lib/pipeline");

const URL_A = "https://static.wixstatic.com/media/7c5a00_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~mv2.jpg/v1/fill/w_1600,h_2262,al_c,q_90/Folheto_page-0001.jpg";
const URL_B = "https://static.wixstatic.com/media/7c5a00_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb~mv2.jpg/v1/fill/w_1600,h_2262,al_c,q_90/Folheto_page-0002.jpg";

function img(url, alt) {
  return `<img srcSet="${url} 2x" alt="${alt}">`;
}

test("ignora HTML sem encartes", () => {
  assert.deepEqual(extrairEncartes('<img src="https://exemplo.test/logo.png">', "home"), []);
});

test("deduplica mídia repetida entre fontes", () => {
  const encartes = descobrirEncartes([
    { fonte: "home", html: img(URL_A, "Folheto_page-0001.jpg") },
    { fonte: "ofertas", html: img(URL_A, "Folheto_page-0001.jpg") },
  ]);
  assert.equal(encartes.length, 1);
  assert.equal(encartes[0].paginas.length, 1);
  assert.deepEqual(encartes[0].paginas[0].fontes, ["home", "ofertas"]);
});

test("agrupa páginas e evita colisão de arquivo", () => {
  const encartes = atribuirArquivos(descobrirEncartes([
    { fonte: "home", html: `${img(URL_A, "Folheto_page-0001.jpg")}${img(URL_B, "Folheto_page-0001.jpg")}` },
  ]));
  assert.equal(encartes[0].paginas.length, 2);
  assert.match(encartes[0].paginas[0].arquivo, /^folheto-pagina-01\.jpg$/);
  assert.match(encartes[0].paginas[1].arquivo, /^folheto-pagina-01-[a-f0-9]{8}\.jpg$/);
});

test("baixa páginas com concorrência limitada", async () => {
  let ativas = 0;
  let maximas = 0;
  const paginas = Array.from({ length: 9 }, (_, numero) => ({
    urlOriginal: `https://exemplo.test/${numero}.jpg`, arquivo: `${numero}.jpg`,
  }));

  const resultado = await baixarPaginasEmPool(paginas, 4, async () => {
    ativas += 1;
    maximas = Math.max(maximas, ativas);
    await new Promise((resolve) => setTimeout(resolve, 5));
    ativas -= 1;
    return true;
  });

  assert.deepEqual(resultado, { novas: 9, puladas: 0 });
  assert.equal(maximas, 4);
});

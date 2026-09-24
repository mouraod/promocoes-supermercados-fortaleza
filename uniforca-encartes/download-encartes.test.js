const assert = require("node:assert/strict");
const test = require("node:test");

const { decodificarEntidades, extrairEncartes } = require("./download-encartes");

const URL_BASE = "https://www.redeuniforca.com.br/wp-content/uploads/2026/09/";

function item(titulo, href, extra = "") {
  return `
    <div class="promotions__item">
      <p>${titulo}</p>
      ${extra}
      ${href ? `<a href="${href}" target="_blank">ver encarte</a>` : ""}
    </div>`;
}

function secao(...itens) {
  return `<section class="promotions"><div class="promotions__items">${itens.join("\n")}</div></section>`;
}

test("extrairEncartes encontra PDFs e imagem direta na seção vigente", () => {
  const html = secao(
    item("Encarte Semanal &#8211; Setembro", `http://www.redeuniforca.com.br/wp-content/uploads/2026/09/encarte.pdf`),
    item("Encarte Cooperado Dag &amp; Colgate", `${URL_BASE}cooperado.png`),
    item("Encarte Cooperado", `${URL_BASE}cooperado-2.pdf`),
  );

  assert.deepEqual(extrairEncartes(html), [
    {
      titulo: "Encarte Semanal – Setembro",
      url: `${URL_BASE}encarte.pdf`,
      tipo: "pdf",
    },
    {
      titulo: "Encarte Cooperado Dag & Colgate",
      url: `${URL_BASE}cooperado.png`,
      tipo: "imagem",
    },
    {
      titulo: "Encarte Cooperado",
      url: `${URL_BASE}cooperado-2.pdf`,
      tipo: "pdf",
    },
  ]);
});

test("normaliza links http para https", () => {
  const html = secao(item("Encarte Semanal", "http://www.redeuniforca.com.br/ofertas/encarte.jpg"));
  assert.equal(extrairEncartes(html)[0].url, "https://www.redeuniforca.com.br/ofertas/encarte.jpg");
});

test("corta os itens depois de Ofertas anteriores ou Encartes anteriores", () => {
  const html = `<section class="promotions">
    ${item("Encarte vigente", `${URL_BASE}vigente.pdf`)}
    <h3>Ofertas anteriores</h3>
    ${item("Encarte vencido", `${URL_BASE}vencido.pdf`)}
  </section>`;
  assert.deepEqual(extrairEncartes(html).map(({ titulo }) => titulo), ["Encarte vigente"]);
});

test("aceita promotions__items como raiz alternativa", () => {
  const html = `<div class="promotions__items">${item("Encarte", `${URL_BASE}encarte.webp`)}</div>`;
  assert.equal(extrairEncartes(html)[0].tipo, "imagem");
});

test("falha com mensagem descritiva quando não existe a seção", () => {
  assert.throws(
    () => extrairEncartes("<html><body>página redesenhada</body></html>"),
    /Seção 'promotions'.*não encontrada/,
  );
});

test("falha quando a seção está vazia", () => {
  assert.throws(() => extrairEncartes('<section class="promotions"></section>'), /Nenhum encarte encontrado/);
});

test("ignora itens com host diferente do domínio permitido", () => {
  const html = secao(
    item("Externo", "https://exemplo.com/encarte.pdf"),
    item("Uniforça", `${URL_BASE}interno.pdf`),
  );
  assert.deepEqual(extrairEncartes(html).map(({ titulo }) => titulo), ["Uniforça"]);
});

test("ignora item sem link sem descartar os demais", () => {
  const html = secao(
    item("Sem link", null),
    item("Com link", `${URL_BASE}com-link.jpg`),
  );
  assert.deepEqual(extrairEncartes(html).map(({ titulo }) => titulo), ["Com link"]);
});

test("decodificarEntidades resolve entidades numéricas decimais, hexadecimais e nomeadas", () => {
  assert.equal(decodificarEntidades("Encarte &#8211; Dag &amp; Colgate &#xE9;"), "Encarte – Dag & Colgate é");
  assert.equal(decodificarEntidades("&lt;promoção&gt; &quot;especial&quot; &apos;hoje&apos;"), '<promoção> "especial" \'hoje\'');
});

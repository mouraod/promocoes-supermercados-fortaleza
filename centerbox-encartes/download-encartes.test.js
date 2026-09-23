const assert = require("node:assert/strict");
const test = require("node:test");

const { decodificarEntidades, extrairOfertasDaSemana } = require("./download-encartes");

// Fatia mínima do HTML real de grupocenterbox.com.br/ofertas/ (WordPress),
// sem rede: título da seção vigente, dois itens, um logo e a divisória da
// seção expirada, que precisa ficar de fora.

const OFERTAS = `
  <div class="offers__title">
    <h4 class="is-green">ENCARTES</h4>
    <h3>Ofertas da semana</h3>
  </div>
  <section class="offers">
    <div class="container">
      <div class="offers__item">
        <h3 class="is-green">Carnes &#8211; Frente</h3>
        <img
          data-fancybox="gallery"
          src="https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-21-at-15.42.44.jpeg"
          alt="Carnes &#8211; Frente"
        >
      </div>
      <div class="offers__item">
        <h3 class="is-green">Ofertas de FLV &amp; Carnes Reden&#231;&#227;o</h3>
        <img data-fancybox="gallery" src="https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-17-at-13.52.12-2.jpeg">
      </div>
      <img src="https://www.grupocenterbox.com.br/wp-content/uploads/2024/12/mini-banner.png">
    </div>
  </section>
  <div class="offers__title">
    <h3>Ofertas anteriores</h3>
  </div>
  <section class="offers">
    <div class="container">
      <div class="offers__item">
        <h3 class="is-green">Encarte antigo</h3>
        <img data-fancybox="gallery" src="https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/encarte-vencido.jpeg">
      </div>
    </div>
  </section>
`;

test("extrairOfertasDaSemana corta na divisória e ignora a seção expirada", () => {
  assert.deepEqual(extrairOfertasDaSemana(OFERTAS), [
    {
      titulo: "Carnes – Frente",
      url: "https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-21-at-15.42.44.jpeg",
    },
    {
      titulo: "Ofertas de FLV & Carnes Redenção",
      url: "https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/WhatsApp-Image-2026-09-17-at-13.52.12-2.jpeg",
    },
  ]);
});

test("extrairOfertasDaSemana ignora img fora do wp-content/uploads da própria rede", () => {
  const html = `
    <h3>Ofertas da semana</h3>
    <div class="offers__item">
      <h3>De outro domínio</h3>
      <img src="https://cdn.exemplo.com/wp-content/uploads/2026/09/foto.jpeg">
    </div>
    <div class="offers__item">
      <h3>Sem imagem</h3>
    </div>
    <h3>Ofertas anteriores</h3>
  `;
  assert.deepEqual(extrairOfertasDaSemana(html), []);
});

test("extrairOfertasDaSemana usa o resto do HTML quando não há divisória", () => {
  const html = `
    <h3>Ofertas da semana</h3>
    <div class="offers__item">
      <h3>Semana de Ofertas</h3>
      <img src="https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/semana.jpeg">
    </div>
  `;
  assert.deepEqual(extrairOfertasDaSemana(html), [
    {
      titulo: "Semana de Ofertas",
      url: "https://www.grupocenterbox.com.br/wp-content/uploads/2026/09/semana.jpeg",
    },
  ]);
});

test("extrairOfertasDaSemana devolve vazio quando a seção vigente está vazia", () => {
  assert.deepEqual(extrairOfertasDaSemana("<h3>Ofertas da semana</h3><h3>Ofertas anteriores</h3>"), []);
});

test("extrairOfertasDaSemana falha alto quando o título da seção sumiu", () => {
  assert.throws(
    () => extrairOfertasDaSemana("<html><body>página redesenhada</body></html>"),
    /Seção 'Ofertas da semana' não encontrada no HTML/,
  );
});

test("decodificarEntidades resolve numéricas, hexadecimais e nomeadas", () => {
  assert.equal(decodificarEntidades("Carnes &#8211; Frente"), "Carnes – Frente");
  assert.equal(decodificarEntidades("FLV &amp; Carnes Reden&#231;&#227;o"), "FLV & Carnes Redenção");
  assert.equal(decodificarEntidades("caf&#xE9; &quot;quente&quot;"), 'café "quente"');
  assert.equal(decodificarEntidades("sem entidade"), "sem entidade");
});

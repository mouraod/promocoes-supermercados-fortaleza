const assert = require("node:assert/strict");
const test = require("node:test");

const { extrairGaleria, extrairLinksEncarte } = require("./download-encartes");

// Fatias mínimas do HTML real do site (WordPress + Elementor), sem rede.

const LISTAGEM = `
  <a href="https://frangolandia.com/encarte/horti-%f0%9f%8d%85%f0%9f%8d%89/">Horti</a>
  <a href="https://frangolandia.com/encarte/so-bebidas-megacao-%f0%9f%8d%b8%f0%9f%8d%b9/">Bebidas</a>
  <a href="https://frangolandia.com/encarte/horti-%f0%9f%8d%93/">Horti de novo</a>
  <a href="https://frangolandia.com/encarte/horti-%f0%9f%8d%85%f0%9f%8d%89/">Horti repetido</a>
  <a href="https://frangolandia.com/lojas/">não é encarte</a>
`;

const PAGINA = `
  <a class="e-gallery-item elementor-gallery-item elementor-animated-content"
     href="https://frangolandia.com/wp-content/uploads/2026/08/PHOTO-2026-08-21-10-42-14.jpg"
     data-elementor-open-lightbox="yes">
    <div class="e-gallery-image" data-thumbnail="https://frangolandia.com/wp-content/uploads/2026/08/PHOTO-2026-08-21-10-42-14-300x400.jpg"></div>
  </a>
  <a class="e-gallery-item" href="https://frangolandia.com/wp-content/uploads/2026/08/PHOTO-2026-08-21-10-42-15.jpg"></a>
  <a class="elementor-button elementor-button-link elementor-size-xl"
     href="https://frangolandia.com/wp-content/uploads/2026/08/4o-Encarte-Horti-23-a-25.08.pdf">Download em PDF</a>
  <img src="https://frangolandia.com/wp-content/uploads/2022/03/selo.png">
  <a class="e-gallery-item" href="https://outro-dominio.com/wp-content/uploads/2026/08/foto.jpg"></a>
`;

test("extrairLinksEncarte deduplica URLs e numera slugs que colidiriam", () => {
  const encartes = extrairLinksEncarte(LISTAGEM);
  assert.deepEqual(encartes, [
    { url: "https://frangolandia.com/encarte/horti-%f0%9f%8d%85%f0%9f%8d%89/", slug: "horti" },
    { url: "https://frangolandia.com/encarte/so-bebidas-megacao-%f0%9f%8d%b8%f0%9f%8d%b9/", slug: "so-bebidas-megacao" },
    { url: "https://frangolandia.com/encarte/horti-%f0%9f%8d%93/", slug: "horti-2" },
  ]);
});

test("extrairGaleria mantém a ordem do HTML e ignora PDF, logos e outros domínios", () => {
  assert.deepEqual(extrairGaleria(PAGINA), [
    "https://frangolandia.com/wp-content/uploads/2026/08/PHOTO-2026-08-21-10-42-14.jpg",
    "https://frangolandia.com/wp-content/uploads/2026/08/PHOTO-2026-08-21-10-42-15.jpg",
  ]);
});

test("extrairGaleria devolve vazio quando não há galeria", () => {
  assert.deepEqual(extrairGaleria("<html><body>sem galeria</body></html>"), []);
});

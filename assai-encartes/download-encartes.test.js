const assert = require("node:assert/strict");
const test = require("node:test");

const { prepararOfertas } = require("./download-encartes");

const BEZERRA_M = { eid: "6", nid: "172" };
const URL_CDN = "https://d2q57q7k4hzryv.cloudfront.net/assai";

const payload = {
  lojas: [
    { eid: "6", nid: "172", name: "Assaí Bezerra M" },
    { eid: "6", nid: "173", name: "Assaí Parangaba" },
  ],
  ofertas: [
    {
      id: 701,
      title: "Festival de ofertas",
      start_date: "22/08/2026",
      end_date: "28/08/2026",
      destaque: 10,
      lojas: [{ eid: "6", nid: "172" }],
      images: [{ url: `${URL_CDN}/701-1.jpg` }],
    },
    {
      id: 702,
      title: "Ofertas da semana",
      start_date: "21/08/2026",
      end_date: "27/08/2026",
      destaque: 0,
      lojas: [{ eid: "6", nid: "172" }],
      images: [
        { url: `${URL_CDN}/702-1.jpg` },
        { url: `${URL_CDN}/702-2.jpg` },
        { url: `${URL_CDN}/702-3.jpg` },
        { url: `${URL_CDN}/702-4.jpg` },
      ],
    },
    {
      id: 703,
      title: "Oferta de outra loja",
      start_date: "22/08/2026",
      end_date: "28/08/2026",
      destaque: 99,
      lojas: [{ eid: "6", nid: "173" }],
      images: [{ url: `${URL_CDN}/703-1.jpg` }],
    },
    {
      id: 704,
      title: "Oferta sem páginas",
      start_date: "22/08/2026",
      end_date: "28/08/2026",
      destaque: 5,
      lojas: [{ eid: "6", nid: "172" }],
      images: [],
    },
  ],
};

test("prepararOfertas mantém apenas campanhas do Bezerra M, ordenadas e com todas as páginas", () => {
  const avisos = [];
  const encartes = prepararOfertas(payload, BEZERRA_M, { onlyNewest: false }, (aviso) => avisos.push(aviso));

  assert.deepEqual(encartes.map((encarte) => ({
    slug: encarte.slug,
    paginas: encarte.paginas.map((pagina) => pagina.url),
    vigencia: encarte.meta.vigencia,
  })), [
    {
      slug: "701-22-08-a-28-08",
      paginas: [`${URL_CDN}/701-1.jpg`],
      vigencia: { de: "2026-08-22", ate: "2026-08-28" },
    },
    {
      slug: "702-21-08-a-27-08",
      paginas: [
        `${URL_CDN}/702-1.jpg`,
        `${URL_CDN}/702-2.jpg`,
        `${URL_CDN}/702-3.jpg`,
        `${URL_CDN}/702-4.jpg`,
      ],
      vigencia: { de: "2026-08-21", ate: "2026-08-27" },
    },
  ]);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /704.*sem imagens.*ignorado/i);
});

test("prepararOfertas escolhe a primeira campanha ordenada para --only-newest", () => {
  const encartes = prepararOfertas(payload, BEZERRA_M, { onlyNewest: true }, () => {});

  assert.deepEqual(encartes.map((encarte) => encarte.slug), ["701-22-08-a-28-08"]);
});

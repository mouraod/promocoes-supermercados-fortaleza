const assert = require("node:assert/strict");
const test = require("node:test");

const { mapearEncartes } = require("./download-encartes");

const DATA = [
  {
    id_encarte: 101,
    descricao: "Exclusivo Pole",
    arquivo: "uploads/encartes/exclusivo-pole.pdf",
    marca: "MA",
    inicio: "2026-09-10 00:00:00",
    validade: "2026-09-15 23:59:00",
  },
  {
    id_encarte: 102,
    descricao: "Encarte Vencido",
    arquivo: "uploads/encartes/vencido.pdf",
    marca: "MA",
    inicio: "2026-08-01 00:00:00",
    validade: "2026-08-31 23:59:00",
  },
  {
    id_encarte: 103,
    descricao: "Sem PDF",
    arquivo: "uploads/encartes/banner.jpg",
    marca: "MA",
    inicio: "2026-09-10 00:00:00",
    validade: "2026-09-15 23:59:00",
  },
];

test("mapearEncartes filtra vencidos e itens sem PDF, e monta slug + URL do proxy", () => {
  const encartes = mapearEncartes(DATA, "2026-09-13");
  assert.deepEqual(encartes, [
    {
      slug: "exclusivo-pole-10-a-15-09",
      pdf: {
        url: "https://ofertasmateus.com/api-proxy.php?file=uploads%2Fencartes%2Fexclusivo-pole.pdf",
        manter: true,
      },
      meta: {
        name: "Exclusivo Pole",
        id_encarte: 101,
        vigencia: { de: "2026-09-10", ate: "2026-09-15" },
      },
    },
  ]);
});

test("mapearEncartes devolve vazio quando não há encartes vigentes", () => {
  assert.deepEqual(mapearEncartes([], "2026-09-13"), []);
});

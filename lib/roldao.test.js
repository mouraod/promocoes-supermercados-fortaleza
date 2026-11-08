"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { descobrirComEvidencia } = require("./roldao");

function fonte({ mudar = () => {}, total = 101 } = {}) {
  const posts = Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    link: `https://roldao.com.br/ofertas-da-semana/post-${i + 1}/`,
    title: { rendered: `Campanha ${i + 1}` },
  }));
  return async (url) => {
    const u = new URL(url),
      page = Number(u.searchParams.get("page"));
    const parent = Number(u.searchParams.get("parent"));
    let dados = parent
      ? [
          {
            id: 1000 + parent,
            post: parent,
            mime_type: "application/pdf",
            source_url: `https://roldao.com.br/wp-content/uploads/2026/11/${parent}.pdf`,
          },
        ]
      : posts.slice((page - 1) * 100, page * 100);
    let n = parent ? 1 : total,
      p = Math.ceil(n / 100),
      status = 200;
    const estado = { dados, n, p, status, url, parent, page };
    mudar(estado);
    return {
      ok: estado.status === 200,
      status: estado.status,
      headers: new Headers({
        "x-wp-total": String(estado.n),
        "x-wp-totalpages": String(estado.p),
      }),
      json: async () => estado.dados,
    };
  };
}

test("descobre duas páginas e vincula PDF do post selecionado, sem inferir loja ou data", async () => {
  const r = await descobrirComEvidencia(
    { ids_posts: [101] },
    { fetch: fonte() },
  );
  assert.equal(r.evidenciaFonte.posts, 101);
  assert.equal(r.evidenciaFonte.anexos, 101);
  assert.equal(r.evidenciaFonte.selecao_completa, false);
  assert.equal(r.encartes.length, 1);
  assert.equal(r.encartes[0].meta.post_id, 101);
  assert.equal(r.encartes[0].meta.vigencia, null);
  assert.equal(r.encartes[0].meta.revisao_loja_obrigatoria, true);
  assert.match(r.encartes[0].pdf.url, /101\.pdf$/);
  assert.equal(r.encartes[0].pdf.manter, true);
});

test("percorre todas as páginas de anexos antes de selecionar o PDF", async () => {
  const buscar = async (url) => {
    const u = new URL(url),
      midia = u.pathname.endsWith("/media"),
      page = Number(u.searchParams.get("page"));
    const anexos = Array.from({ length: 101 }, (_, i) => ({
      id: i + 100,
      post: 1,
      mime_type: i === 100 ? "application/pdf" : "image/jpeg",
      source_url: `https://roldao.com.br/wp-content/uploads/${i}.${i === 100 ? "pdf" : "jpg"}`,
    }));
    const dados = midia
      ? anexos.slice((page - 1) * 100, page * 100)
      : [{ id: 1, link: "https://roldao.com.br/ofertas-da-semana/um/" }];
    return {
      ok: true,
      headers: new Headers({
        "x-wp-total": midia ? "101" : "1",
        "x-wp-totalpages": midia ? "2" : "1",
      }),
      json: async () => dados,
    };
  };
  const r = await descobrirComEvidencia({ ids_posts: [1] }, { fetch: buscar });
  assert.equal(r.evidenciaFonte.anexos, 101);
  assert.equal(r.encartes[0].meta.anexo_id, 200);
});

test("padrão oficial do post 5046 escolhe o PDF integral, não a imagem de capa", async () => {
  const post = {
    id: 5046,
    link: "https://roldao.com.br/ofertas-da-semana/fim-de-semana-arrasador-dia-r-rede/",
    title: { rendered: "Fim de Semana Arrasador + Dia R (REDE)" },
  };
  const base = "https://roldao.com.br/wp-content/uploads/2026/11/";
  const anexos = [
    {
      id: 5047,
      post: 5046,
      mime_type: "application/pdf",
      source_url: `${base}ROLDAO-DIA-R-REDE-05-A-08-11-2026-1.pdf`,
    },
    {
      id: 5048,
      post: 5046,
      mime_type: "image/jpeg",
      source_url: `${base}ROLDAO-DIA-R-REDE-05-A-08-11-2026-01-scaled.jpg`,
    },
  ];
  const buscar = async (url) => {
    const dados = url.includes("media?") ? anexos : [post];
    return {
      ok: true,
      headers: new Headers({
        "x-wp-total": String(dados.length),
        "x-wp-totalpages": "1",
      }),
      json: async () => dados,
    };
  };
  const { encartes } = await descobrirComEvidencia(
    { ids_posts: [5046] },
    { fetch: buscar },
  );
  assert.equal(encartes.length, 1);
  assert.equal(encartes[0].meta.anexo_id, 5047);
  assert.equal(encartes[0].pdf.url, anexos[0].source_url);
  assert.equal(encartes[0].pdf.redirect, "error");
  assert.equal(encartes[0].meta.vigencia, null);
});

test("não adquire automaticamente posts históricos ou desconhecidos", async () => {
  const r = await descobrirComEvidencia({}, { fetch: fonte({ total: 1 }) });
  assert.equal(r.encartes.length, 0);
  assert.equal(r.evidenciaFonte.catalogo.length, 1);
});

test("falha fechada em página truncada, duplicada, HTTP, anexo divergente ou origem externa", async () => {
  for (const mudar of [
    (s) => {
      if (!s.parent && s.page === 2) s.dados = [];
    },
    (s) => {
      if (!s.parent && s.page === 2) s.dados[0].id = 1;
    },
    (s) => {
      if (!s.parent && s.page === 2) s.status = 500;
    },
    (s) => {
      if (s.parent === 1) s.dados[0].post = 2;
    },
    (s) => {
      if (s.parent === 1) s.dados[0].source_url = "https://evil.example/a.pdf";
    },
  ])
    await assert.rejects(
      descobrirComEvidencia({ ids_posts: [1] }, { fetch: fonte({ mudar }) }),
    );
});

test("candidato PDF com MIME incompatível permanece no catálogo e impede completude", async () => {
  const buscar = fonte({
    total: 1,
    mudar: (s) => {
      if (s.parent) {
        s.dados.push({
          id: 9000,
          post: 1,
          mime_type: "application/octet-stream",
          source_url: "https://roldao.com.br/wp-content/uploads/outro.pdf",
        });
        s.n = 2;
      }
    },
  });
  const r = await descobrirComEvidencia({ ids_posts: [1] }, { fetch: buscar });
  assert.equal(r.encartes.length, 1);
  assert.equal(r.evidenciaFonte.descoberta_completa, false);
  assert.equal(r.evidenciaFonte.catalogo[0].pdfs[1].id, 9000);
  assert.match(r.evidenciaFonte.lacunas[0], /MIME incompatível/);
});

test("falha de rede conserva descoberta parcial e endereço que falhou", async () => {
  const base = fonte({ total: 2 });
  const buscar = async (url, opts) => {
    if (url.includes("parent=2")) throw new TypeError("fetch failed");
    return base(url, opts);
  };
  await assert.rejects(
    descobrirComEvidencia({ ids_posts: [1] }, { fetch: buscar }),
    (erro) => {
      assert.match(erro.message, /media\?parent=2.*fetch failed/);
      assert.equal(erro.evidenciaFonte.descoberta_completa, false);
      assert.deepEqual(erro.evidenciaFonte.posts_selecionados, [1]);
      assert.equal(erro.evidenciaFonte.catalogo[0].id, 1);
      return true;
    },
  );
});

test("sem PDF ou com vários PDFs, mantém lacuna explícita", async () => {
  const buscar = fonte({
    total: 2,
    mudar: (s) => {
      if (s.parent === 1) {
        s.dados = [];
        s.n = 0;
        s.p = 0;
      }
      if (s.parent === 2) {
        s.dados.push({
          ...s.dados[0],
          id: 9999,
          source_url: "https://roldao.com.br/wp-content/uploads/outro.pdf",
        });
        s.n = 2;
      }
    },
  });
  const r = await descobrirComEvidencia(
    { ids_posts: [1, 2] },
    { fetch: buscar },
  );
  assert.equal(r.evidenciaFonte.descoberta_completa, false);
  assert.equal(r.encartes.length, 2);
  assert.equal(r.evidenciaFonte.lacunas.length, 3);
});

"use strict";

// Snapshots oficiais externos e imutáveis; ausência é skip, nunca fonte sintética.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { contarPaginasPdf } = require("../lib/pipeline");
const { prepararOfertas } = require("../assai-encartes/download-encartes");
const { descobrir: novo } = require("../novo-encartes/download-encartes");
const { descobrir: atacadao } = require("../atacadao-encartes/download-encartes");
const { parsearTabloide } = require("../recibom-encartes/download-encartes");

const base = process.env.RECIFE_FIXTURES;
const hoje = "2026-10-15";
const ler = (nome) => fs.readFile(path.join(base, "fontes", nome), "utf8");

for (const [rede, contagens] of [["NovoAtacarejo", [5, 9]], ["Recibom", [1, 8]], ["Assai", [5, 9]], ["Atacadao", [6, 12]]]) {
  test(`G-F5.1 ${rede}: parser oficial e páginas locais de 15/10`, { skip: !base }, async () => {
    let encartes;
    if (rede === "NovoAtacarejo") {
      const loja = await ler("novo-loja.json");
      const lista = await ler("novo-lista.json");
      const endpoints = [];
      encartes = await novo({ loja: "afogados" }, { hoje, fetch: async (url) => {
        const endpoint = new URL(url).searchParams.get("endpoint");
        endpoints.push(endpoint);
        assert.ok(endpoint === "/lojas/afogados" || endpoint === "/encartes/pe/recife/afogados?marca=MA");
        return { ok: true, json: async () => JSON.parse(endpoint.startsWith("/lojas/") ? loja : lista) };
      } });
      assert.equal(endpoints[0], "/lojas/afogados");
    } else if (rede === "Recibom") {
      encartes = parsearTabloide(await ler("recibom.html"));
    } else if (rede === "Assai") {
      const html = await ler("assai-browser.html");
      const tag = html.match(/<[^>]*class="[^"]*bloco-ofertas-tabloide[^>]*>/)?.[0];
      assert.ok(tag, "bloco oficial com identificadores da loja");
      const loja = { eid: tag.match(/data-eid="([^"]+)"/)[1], nid: tag.match(/data-nid="([^"]+)"/)[1] };
      assert.deepEqual(loja, { eid: "16", nid: "16266" });
      encartes = prepararOfertas(JSON.parse(await ler("assai-payload.json")), loja)
        .filter((e) => e.meta.vigencia.de <= hoje && e.meta.vigencia.ate >= hoje);
    } else {
      const html = await ler("atacadao.html");
      encartes = await atacadao({ loja: "recife-iputinga" }, { hoje, fetch: async (url) => {
        assert.equal(url, "https://www.atacadao.com.br/loja/recife-iputinga");
        return { ok: true, text: async () => html };
      } });
    }
    const manifest = JSON.parse(await fs.readFile(path.join(base, rede, "manifest.json"), "utf8"));
    let paginas = 0;
    for (const e of encartes) {
      const entrada = manifest.encartes.find((m) => rede === "Recibom" || m.slug === e.slug);
      assert.ok(entrada, `campanha do parser precisa existir no acervo oficial: ${e.slug}`);
      const quantidade = e.pdf ? await contarPaginasPdf(path.join(base, rede, entrada.pdf)) : e.paginas.length;
      assert.equal(quantidade, entrada.paginas);
      if (!e.pdf) {
        for (const [i] of e.paginas.entries()) {
          const prefixo = `${entrada.slug}-pagina-${String(i + 1).padStart(2, "0")}.`;
          const dir = path.join(base, rede, "JPG");
          const nome = (await fs.readdir(dir)).find((n) => n.startsWith(prefixo));
          assert.ok(nome && (await fs.stat(path.join(dir, nome))).size > 0, prefixo);
        }
      }
      paginas += quantidade;
    }
    assert.deepEqual([encartes.length, paginas], contagens);
    assert.equal(encartes.length, manifest.totalEncartes);
    assert.equal(paginas, manifest.totalPaginas);
    console.log(`G-F5.1 ${rede}: ${encartes.length}/${paginas} (parser + acervo oficial)`);
  });
}

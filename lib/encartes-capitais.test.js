"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parsearDona, parsearGuanabara, linksVioleta, parsearVioleta, violeta } = require("./encartes-capitais");

const dona = '<a href="https://donafazbem.com.br/wp-content/uploads/2026/10/Folheto-DONA-15-a-18-10-26.pdf" id="btn-baixar-folheto">BAIXAR O PDF</a>';
const guanabara = '<p><strong>Validade:</strong> Promoção válida de 14/10/2026 até 20/10/2026,, enquanto durarem nossos estoques.</p><a href="/encarte/baixe">Baixar encarte</a>';
const post = 'https://supermercadovioleta.com.br/produto/folheto-final-de-semana/';
function galeria(titulo = 'OFERTAS VÁLIDAS PARA OS DIAS 17/10/2026 E 18/10/2026') {
  return '<h1>' + titulo + '</h1><img src="https://externo.example/logo.jpg">' +
    '<figure class="woocommerce-product-gallery__wrapper product-gallery-slider">' +
    [1, 2, 3, 4].map((n) => `<div><a href="https://supermercadovioleta.com.br/wp-content/uploads/2026/10/Tabloide_SAB-DOM_17-18-${n}baixa.jpg"><img src="miniatura-${n}.jpg"></a></div>`).join('') + '</figure>';
}
test('Dona exige botão oficial único e mantém validade visual pendente', () => {
  const [e] = parsearDona(dona);
  assert.equal(e.meta.vigencia, null);
  assert.equal(e.meta.validade_evidencia, null);
  assert.ok(e.pdf.manter);
  assert.throws(() => parsearDona(dona + dona));
  assert.throws(() => parsearDona(dona.replace('https://donafazbem.com.br/', 'https://malicioso.example/')));
});
test('Guanabara usa data explícita no HTML, rejeita ausente, inválida e ambígua', () => {
  const [e] = parsearGuanabara(guanabara);
  assert.deepEqual(e.meta.vigencia, { de: '2026-10-14', ate: '2026-10-20' });
  for (const conteudo of ['', guanabara + guanabara, guanabara.replace('14/10/2026', '31/02/2026'), guanabara.replace('14/10/2026', '21/10/2026')])
    assert.throws(() => parsearGuanabara(conteudo));
  assert.throws(() => parsearGuanabara(guanabara.replace('/encarte/baixe', 'https://malicioso.example/encarte/baixe')));
});
test('Violeta segue galeria de 4 originais, sem miniaturas ou produto relacionado', () => {
  const e = parsearVioleta(galeria(), post);
  assert.equal(e.paginas.length, 4);
  assert.ok(e.paginas.every((p) => /baixa\.jpg$/.test(p.url)));
  assert.deepEqual(e.meta.vigencia, { de: '2026-10-17', ate: '2026-10-18' });
  assert.deepEqual(parsearVioleta(galeria('OFERTAS VÁLIDAS APENAS PARA O DIA 19/10/2026'), post).meta.vigencia, { de: '2026-10-19', ate: '2026-10-19' });
  assert.deepEqual(parsearVioleta(galeria('OFERTAS VÁLIDAS PARA O PERÍODO DE 17/10/2026 A 01/11/2026'), post).meta.vigencia, { de: '2026-10-17', ate: '2026-11-01' });
  assert.throws(() => parsearVioleta(galeria('OFERTAS DA SEMANA'), post));
  assert.throws(() => parsearVioleta(galeria().replaceAll('https://supermercadovioleta.com.br/wp-content/', 'https://externo.example/wp-content/'), post));
});
test('Violeta deduplica links, recusa índice vazio e propaga falha parcial', async () => {
  const indice = `<a href="${post}"></a><a href="${post}"></a>`;
  assert.deepEqual(linksVioleta(indice), [post]);
  assert.throws(() => linksVioleta('<p>Erro</p>'));
  let consultas = 0;
  await assert.rejects(violeta({}, { fetch: async () => {
    consultas++;
    return consultas === 1 ? new Response(indice, { headers: { 'content-type': 'text/html' } }) : new Response('Erro', { status: 503 });
  } }), /503/);
});

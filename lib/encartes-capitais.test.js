"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parsearDona, parsearGuanabara, linksVioleta, parsearVioleta, violeta, parsearAtakarejo, parsearHiperideal } = require("./encartes-capitais");

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
const atakarejo = '<title>Salvador | Atakarejo</title>' +
  '<div class="box-image"><p>Encarte Habitual Salvador</p>' +
  '<a href="https://atakarejo.com.br/wp-content/uploads/2026/10/26-a-29.10-Habitual-salvador-1.pdf" target="_blank" class="box-image box-image-desktop button-download-ofertas">' +
  '<p>Ofertas válidas de 26 a 29/10/2026.</p></div>';
const hiperideal = '{"blockId":"hiperideal.store-theme@0.x:encartes#encartes"}' +
  '"content":{"encartes":[{"nome":"Varejo ","pdfUrl":"https://hiperideal.gsit.co/arquivos/pdf/ENCARTE_VAREJO_27OUTa04NOV.pdf","dataInicio":"2026-10-27","dataFim":"2026-11-04"},' +
  '{"nome":"Lapa","pdfUrl":"https://hiperideal.gsit.co/arquivos/pdf/ENCARTE_LAPA_29a05OUT_.pdf","dataInicio":"2026-10-27","dataFim":"2026-11-04"},' +
  '{"nome":"Especial de Frios","pdfUrl":"https://hiperideal.gsit.co/arquivos/pdf/FRIOS_25a01dez.pdf","dataInicio":"2025-11-25","dataFim":"2025-12-01"},' +
  '{"nome":"ola","pdfUrl":"","dataInicio":"2026-01-01","dataFim":"2026-01-07"},' +
  '{"nome":"Prot","pdfUrl":"http://hiperideal.gsit.co/arquivos/pdf/Proteinas_15a21OUT.pdf","dataInicio":"2026-10-15","dataFim":"2026-10-21"}]}';

test('Atakarejo usa botão oficial e validade do HTML com ano', () => {
  const [e] = parsearAtakarejo(atakarejo, 'https://atakarejo.com.br/cidades/salvador/');
  assert.deepEqual(e.meta.vigencia, { de: '2026-10-26', ate: '2026-10-29' });
  assert.ok(e.pdf.manter && /\.pdf$/.test(e.pdf.url));
  assert.match(e.meta.titulo, /Salvador/);
  assert.equal(e.meta.validade_evidencia.metodo, 'html');
  assert.throws(() => parsearAtakarejo(atakarejo + atakarejo));
  assert.throws(() => parsearAtakarejo(atakarejo.replace('Ofertas válidas de 26 a 29/10/2026.', '')));
  assert.throws(() => parsearAtakarejo(atakarejo.replace('de 26 a 29/10/2026', 'de 26 a 29')));
});
test('Atakarejo aceita virada de mês com dois meses explícitos', () => {
  const [e] = parsearAtakarejo(atakarejo.replace('de 26 a 29/10/2026', 'de 30/10 a 03/11/2026'));
  assert.deepEqual(e.meta.vigencia, { de: '2026-10-30', ate: '2026-11-03' });
});
test('Atakarejo só recua o ano na virada dezembro→janeiro', () => {
  const [e] = parsearAtakarejo(atakarejo.replace('de 26 a 29/10/2026', 'de 30/12 a 02/01/2027'));
  assert.deepEqual(e.meta.vigencia, { de: '2026-12-30', ate: '2027-01-02' });
  // Período invertido no mesmo mês é erro da fonte, não virada de ano.
  assert.throws(() => parsearAtakarejo(atakarejo.replace('de 26 a 29/10/2026', 'de 29/10 a 26/10/2026')));
  // Duas validades na mesma página são ambíguas.
  assert.throws(() => parsearAtakarejo(atakarejo.replace('</div>', '</div><p>Ofertas válidas de 02 a 05/11/2026.</p>')));
});
test('Atakarejo recusa PDF fora do host oficial', () => {
  assert.throws(() => parsearAtakarejo(atakarejo.replace('https://atakarejo.com.br/', 'https://malicioso.example/')));
});
test('Hiperideal lê JSON do VTEX, ignora vencida e campanha por loja, falha sem PDF vigente', () => {
  const [e] = parsearHiperideal(hiperideal, { hoje: '2026-10-27' });
  assert.equal(e.meta.titulo, 'Varejo');
  assert.deepEqual(e.meta.vigencia, { de: '2026-10-27', ate: '2026-11-04' });
  assert.equal(e.slug.startsWith('hiperideal-'), true);
  assert.ok(e.pdf.manter);
  // Só a campanha de varejo entra: "Lapa" é por loja e a vencida some.
  assert.equal(parsearHiperideal(hiperideal, { hoje: '2026-10-27' }).length, 1);
  // O CMS publica PDF em http://; o adapter normaliza antes de validar o host.
  const comHttp = parsearHiperideal(
    hiperideal.replace('"dataInicio":"2026-10-15","dataFim":"2026-10-21"', '"dataInicio":"2026-10-27","dataFim":"2026-11-04"'),
    { hoje: '2026-10-27' },
  ).find((x) => x.meta.titulo === 'Prot');
  assert.equal(comHttp.pdf.url, 'https://hiperideal.gsit.co/arquivos/pdf/Proteinas_15a21OUT.pdf');
  assert.throws(() => parsearHiperideal(hiperideal, { hoje: '2026-01-03' })); // placeholder vigente sem PDF
  assert.throws(() => parsearHiperideal(hiperideal.replace('hiperideal.gsit.co', 'malicioso.example')));
  assert.throws(() => parsearHiperideal(hiperideal.replace('"dataInicio":"2026-10-27",', '')));
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

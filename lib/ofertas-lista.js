"use strict";

// Parte pura do coletor de ofertas do São Luiz: transformar a resposta da API
// da loja em linhas do contrato de oferta e gravar a pasta da rodada
// (ofertas.json + manifest.json) quando não há encarte em imagem para baixar.

const fs = require("fs/promises");
const path = require("path");
const { dateFolderName } = require("./pipeline");

const LIMITE = { kg: 100, g: 100000, l: 100, ml: 100000, un: 9999 };

/** Medida a partir do nome, como a loja imprime ("350ML", "1L", "KG"). */
function medida(nome) {
  const t = String(nome ?? "").toLowerCase();
  const peso = t.match(/(\d+(?:[.,]\d+)?) ?(kg|g|ml|l|lt|litros?)\b/);
  if (peso) {
    const quantidade = Number(peso[1].replace(",", "."));
    const unidade = peso[2].startsWith("l") ? "l" : peso[2];
    if (quantidade > 0 && quantidade <= LIMITE[unidade]) return { quantidade, unidade };
  }
  // "POTE Nº 15 UNIDADE" tem número de embalagem, não contagem: fica null.
  const contagem = t.match(/(?<!n[ºo] )(\d+) ?(?:unidades|un|und|rolos)\b/);
  if (contagem && Number(contagem[1]) <= LIMITE.un)
    return { quantidade: Number(contagem[1]), unidade: "un" };
  if (/\bkg\b\s*$/.test(t)) return { quantidade: 1, unidade: "kg" };
  if (/\b(?:unidade|und)\b\s*$/.test(t)) return { quantidade: 1, unidade: "un" };
  return null;
}

/** Deduplica por produto da loja e normaliza para o contrato de oferta do site. */
function normalizar(brutas) {
  const vistos = new Set();
  const centavos = (valor) => Math.round(valor * 100) / 100;
  return (brutas ?? [])
    .filter((o) => {
      if (!o.nome || !(o.preco > 0) || o.preco > 100000) return false;
      if (vistos.has(o.produto_id)) return false;
      vistos.add(o.produto_id);
      return true;
    })
    .map((o) => {
      const tamanho = medida(o.nome);
      return {
        nome: o.nome,
        preco: centavos(o.preco),
        preco_antigo: o.preco_antigo && o.preco_antigo > o.preco ? centavos(o.preco_antigo) : null,
        quantidade: tamanho?.quantidade ?? null,
        unidade: tamanho?.unidade ?? null,
        categoria: o.categoria,
        observacao: null,
        lojas_restricao: null,
        confianca: 1,
        valido_ate: o.valido_ate ?? null,
        codigo_barras: o.codigo_barras ?? null,
      };
    });
}

/** Corpo enviado ao site: validade do encarte só quando todas as ofertas têm a mesma. */
function montarDados({ ofertas, rede, loja, source }) {
  const validades = [...new Set(ofertas.map((o) => o.valido_ate).filter(Boolean))].sort();
  return {
    rede,
    loja,
    source,
    valido_ate: validades.length === 1 ? validades[0] : null,
    ofertas,
  };
}

/** Pasta da rodada sem encarte em imagem: grava ofertas.json + manifest.json
 *  (0 encartes, 0 páginas) e devolve o caminho, no mesmo formato das redes que
 *  baixam imagem — é o que o orquestrador lê para saber o que houve. */
async function gravarListaDeOfertas({ destino, dados, manifest, agora = new Date() }) {
  await fs.mkdir(destino, { recursive: true });
  const completo = {
    ...manifest,
    data: manifest.data ?? dateFolderName(agora),
    downloadedAt: agora.toISOString(),
    totalEncartes: 0,
    totalPaginas: 0,
    totalOfertas: dados.ofertas.length,
    encartes: [],
  };
  await fs.writeFile(path.join(destino, "ofertas.json"), JSON.stringify(dados, null, 1));
  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(completo, null, 2));
  return { destino, manifest: completo };
}

module.exports = { medida, normalizar, montarDados, gravarListaDeOfertas };

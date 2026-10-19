#!/usr/bin/env node
// Coleta as ofertas da loja 355 direto da API que a página /ofertas renderiza
// (cards do HTML são só o resultado dela). Sem visão, sem leitura de imagem.
//
//   node saoluiz-encartes/ofertas.js [saida.json]
//
// Saída: JSON no contrato de oferta da ingestão do site, com validade exata
// (`end_at` da oferta na plataforma), nome, preço, preço riscado e categoria.

const { chromium } = require("playwright");
const { writeFile } = require("node:fs/promises");

const LOJA = 355;
const BASE = "https://merconnect.mercadapp.com.br/mapp/v2";
const URL_LOJA = `https://mercadinhossaoluiz.com.br/loja/${LOJA}/ofertas`;

// Seção da vitrine -> slug de categoria do site (lib/categorias.ts).
const CATEGORIAS = {
  "Semana da Peixaria": "carnes",
  Hortifrúti: "hortifruti",
  Açougue: "carnes",
  Peixaria: "carnes",
  Padaria: "padaria",
  Congelados: "congelados",
  "Frios e Lacticínios": "laticinios",
  Mercearia: "mercearia",
  "Doces e Biscoitos": "biscoitos",
  Massas: "mercearia",
  "Vinhos e Espumantes": "bebidas",
  Bebidas: "bebidas",
  "Bebidas Alcoólicas": "bebidas",
  "Higiene e Perfumaria": "higiene",
  "Costume Saudável": "outros",
  Petshop: "pet",
  "Utilidades e Bazar": "outros",
};

const LIMITE = { kg: 100, g: 100000, l: 100, ml: 100000, un: 9999 };

function medida(nome) {
  const t = String(nome).toLowerCase();
  const peso = t.match(/(\d+(?:[.,]\d+)?) ?(kg|g|ml|l|lt|litros?)\b/);
  if (peso) {
    const quantidade = Number(peso[1].replace(",", "."));
    const unidade = peso[2].startsWith("l") ? "l" : peso[2];
    if (quantidade > 0 && quantidade <= LIMITE[unidade]) return { quantidade, unidade };
  }
  const contagem = t.match(/(?<!n[ºo] )(\d+) ?(?:unidades|un|und|rolos)\b/);
  if (contagem && Number(contagem[1]) <= LIMITE.un) return { quantidade: Number(contagem[1]), unidade: "un" };
  // Vendido por peso ou avulso: o tamanho vem implícito no nome.
  if (/\bkg\b\s*$/.test(t)) return { quantidade: 1, unidade: "kg" };
  if (/\b(?:unidade|und)\b\s*$/.test(t)) return { quantidade: 1, unidade: "un" };
  return null;
}

const dia = (iso) => (iso ? String(iso).slice(0, 10) : null);
const semEmoji = (texto) => texto.replace(/[^\p{L}\p{N}\s]/gu, "").trim();

async function coletar() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // O header muda quando a página renova o token: guarda sempre o da última
    // chamada que deu certo, e não o da primeira.
    let autorizacao = null;
    page.on("response", (res) => {
      if (res.ok() && res.url().startsWith(BASE)) {
        const valor = res.request().headers()["authorization"];
        if (valor) autorizacao = valor;
      }
    });
    await page.goto(URL_LOJA, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);
    if (!autorizacao) throw new Error("token da loja não capturado: a página não chamou a API");

    return await page.evaluate(
      async ([authorization, base, loja, categorias]) => {
        const buscar = async (caminho) => {
          const resposta = await fetch(`${base}${caminho}`, { headers: { Authorization: authorization } });
          if (!resposta.ok) throw new Error(`${resposta.status} em ${caminho}`);
          return resposta.json();
        };
        const { categories } = await buscar(`/markets/${loja}/brand_categories`);
        const ofertas = [];
        for (const secao of categories) {
          const { mixes } = await buscar(`/markets/${loja}/items/offers?section_id=${secao.id}&limit=100`);
          for (const mix of mixes ?? []) {
            for (const item of mix.items) {
              const validade = item.offers?.[0]?.end_at;
              ofertas.push({
                produto_id: item.product_id,
                nome: item.description,
                preco: Number(item.price),
                preco_antigo: item.original_price ? Number(item.original_price) : null,
                secao: secao.display_name,
                categoria: categorias[secao.display_name.replace(/[^\p{L}\p{N}\s]/gu, "").trim()] ?? "outros",
                valido_ate: validade ? String(validade).slice(0, 10) : null,
                codigo_barras: item.bar_code || null,
              });
            }
          }
        }
        return ofertas;
      },
      [autorizacao, BASE, LOJA, CATEGORIAS],
    );
  } finally {
    await browser.close();
  }
}

function normalizar(brutas) {
  const vistos = new Set();
  return brutas
    .filter((o) => o.nome && o.preco > 0 && o.preco <= 100000 && !vistos.has(o.produto_id) && vistos.add(o.produto_id))
    .map((o) => {
      const tamanho = medida(o.nome);
      return {
        nome: o.nome,
        preco: Math.round(o.preco * 100) / 100,
        preco_antigo: o.preco_antigo && o.preco_antigo > o.preco ? Math.round(o.preco_antigo * 100) / 100 : null,
        quantidade: tamanho?.quantidade ?? null,
        unidade: tamanho?.unidade ?? null,
        categoria: o.categoria,
        observacao: null,
        lojas_restricao: null,
        confianca: 1,
        valido_ate: o.valido_ate,
        codigo_barras: o.codigo_barras,
      };
    });
}

if (require.main === module) {
  coletar()
    .then(async (brutas) => {
      const ofertas = normalizar(brutas);
      const validades = [...new Set(ofertas.map((o) => o.valido_ate).filter(Boolean))];
      const saida = {
        rede: "saoluiz",
        loja: LOJA,
        source: URL_LOJA,
        valido_ate: validades.length === 1 ? validades[0] : null,
        ofertas,
      };
      const arquivo = process.argv[2];
      if (arquivo) await writeFile(arquivo, JSON.stringify(saida, null, 1));
      if (!arquivo) console.log(JSON.stringify(saida, null, 1));
      console.error(
        `ofertas=${ofertas.length} validade=${validades.join(",") || "?"} ` +
          `com_medida=${ofertas.filter((o) => o.unidade).length} pedido=${brutas.length}`,
      );
    })
    .catch((erro) => {
      console.error(erro.message);
      process.exit(1);
    });
}

module.exports = { coletar, normalizar, medida, semEmoji };

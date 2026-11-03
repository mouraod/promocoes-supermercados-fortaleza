---
name: violeta-encartes
description: >
  Baixa os tabloides do Supermercados Violeta da praça São Paulo (SP), lendo a
  galeria de cada post do tabloide. Use quando o usuário mencionar "baixar
  encartes Violeta", "encartes Violeta" ou colar a URL
  supermercadovioleta.com.br/tabloide/.
---

# Violeta Encartes

Tabloides do Supermercados Violeta em `supermercadovioleta.com.br/tabloide/`.
Usado pelo pipeline de São Paulo via `cidades/sao-paulo-sp.json` — não use
para Fortaleza.

## Como funciona

1. Lê `/tabloide/` e coleta os links dos posts de encarte.
2. Abre cada post e lê a galeria original
   (`woocommerce-product-gallery__wrapper`).
3. Baixa todas as páginas da galeria, em ordem, sem cortar miniaturas.
4. A vigência vem do título do post; sem data legível o encarte não é
   publicado.

## Identidade e vigência

A fonte não expõe identificador de loja. O manifesto sai com
`revisao_loja_obrigatoria: true`; a loja de referência (Vila Gomes — Loja 01)
vem da configuração e precisa ser conferida visualmente.

## Proibições

- Não publicar só a primeira imagem: o índice não contém todas as páginas.
- Não descartar encartes futuros ou vencidos antes da revisão: eles restringem
  loja.
- Não deduzir loja do post: o título não identifica a unidade.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

---
name: carrefour-encartes
description: >
  Baixa os folhetos do Carrefour da praça São Paulo (SP) pelo GraphQL de
  folheteria do site, lendo a identidade da loja na própria resposta. Use
  quando o usuário mencionar "baixar encartes Carrefour", "encartes Carrefour"
  ou colar a URL secure.mercado.carrefour.com.br.
---

# Carrefour Encartes

Folhetos do Carrefour em `secure.mercado.carrefour.com.br`, consultados pela
query `SEARCH_STORE_FLYERS`. Usado pelo pipeline de São Paulo via
`cidades/sao-paulo-sp.json` — não use para Fortaleza.

## Como funciona

1. Faz `POST` na GraphQL do site com a query `SEARCH_STORE_FLYERS` e o
   `storeId` da configuração (`identificador_fonte.storeId`, hoje `SPR`).
2. Confere que cada folheto devolvido tem `storeId` igual ao configurado; um
   `storeId` diferente é divergência de fonte e falha.
3. Descarta folheto com `campaignEndDate` anterior a hoje e exige `images[]`
   não vazio.
4. Baixa as imagens do bucket `carrefour-web-view-tabloides-prod` na ordem do
   array.

## Identidade e vigência

A fonte prova a loja: cada encarte sai no manifesto com
`loja: { storeId }` e `loja_origem: "fonte"`, e `revisao_loja_obrigatoria:
false`. A vigência vem de `campaignStartDate`/`campaignEndDate`, com data
real conferida (dia/mês inválido falha).

## Particularidades

- O bucket do Google Cloud responde `application/octet-stream` para JPEG; o
  pipeline aceita esse tipo e decide pelo magic number da imagem.
- Em 12/11/2026 a página 10 da revista de Natal (`...-0010.jpeg`) veio como
  PDF de uma página sob nome `.jpeg`. O pipeline rasteriza (200 dpi, poppler)
  só PDF real de exatamente uma página; HTML, lixo e PDF de várias páginas
  continuam falhando como "Imagem inválida".
- A campanha DROGARIA aparece na mesma resposta. Ela não é folheto de
  supermercado: fica fora do catálogo até decisão explícita.
- O adapter aceita `onlyNewest`, que reduz a lista de encartes à campanha mais recente; o coletor de cidade ainda não repassa a flag.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

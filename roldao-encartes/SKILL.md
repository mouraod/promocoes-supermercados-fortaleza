---
name: roldao-encartes
description: >
  Baixa o folheto do Roldão Atacadista da praça São Paulo (SP), lendo a página
  de ofertas do site. Use quando o usuário mencionar "baixar encartes Roldão",
  "encartes Roldao" ou colar a URL roldao.com.br/ofertas/.
---

# Roldão Encartes

Folheto do Roldão em `roldao.com.br/ofertas/`. Usado pelo pipeline de São
Paulo via `cidades/sao-paulo-sp.json` — não use para Fortaleza.

## Como funciona

1. Percorre a API oficial paginada de posts e de anexos por post; preserva o catálogo e as lacunas no registro da execução.
2. Adquire somente posts selecionados pelo operador (`--post-roldao` no coletor de cidade). Sem seleção, o catálogo é registrado, mas a coleta falha sem declarar ausência.
3. Para cada PDF selecionado, conserva o arquivo e rasteriza todas as páginas pelo pipeline. O manifesto registra post, anexo e origem.
4. A seleção é parcial e exige revisão visual de todas as páginas, lojas, vigências e condições. Mais de um PDF no mesmo post é uma lacuna, não uma associação aprovada.

## Identidade e vigência

A API não comprova loja nem validade. O manifesto mantém `vigencia: null` e exige revisão; confirme Nações Unidas, município de São Paulo, e as datas no próprio material. Não aprove campanha pela seleção ou pelo título.

## Dependências

`fetch` nativo e Poppler (`pdfinfo` e `pdftoppm`) para rasterizar os PDFs.

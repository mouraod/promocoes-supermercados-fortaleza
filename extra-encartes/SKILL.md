---
name: extra-encartes
description: >
  Baixa os encartes do Mercado Extra da praça Grande São Paulo (SP) pelo índice
  diário de campanhas e pelos viewers FlipHTML5. Use quando o usuário mencionar
  "baixar encartes Extra", "encartes Extra" ou colar a URL
  folheteria.clubeextra.com.br.
---

# Extra Encartes

Encartes do Mercado Extra em `folheteria.clubeextra.com.br`. Usado pelo
pipeline de São Paulo via `cidades/sao-paulo-sp.json` — não use para Fortaleza.

## Como funciona

1. Lê `sites/assets/js/campanhas.js` e extrai o literal `dataJsonInformation`.
2. Seleciona a chave do dia (`DDMMYYYY`) e a lista da região configurada
   (`identificador_fonte.regiao`, hoje `Grande São Paulo`).
3. Para cada campanha do dia, abre o viewer, lê `javascript/config.js` e
   fatia a lista `fliphtml5_pages` mantendo a ordem.
4. A vigência sai do calendário diário: a campanha vale de hoje até o último
   dia consecutivo em que a mesma campanha aparece no índice.

## Identidade e vigência

A fonte prova a região, não a loja. O manifesto registra
`regiao: "Grande São Paulo"` e `revisao_loja_obrigatoria: true` — a loja de
referência (`grande-sao-paulo`) é escopo regional e precisa de revisão humana
para publicação.

## Proibições

- Não tratar campanha de e-commerce como folheto físico.
- Não aceitar URL de outro host: o adaptador recusa link fora de
  `folheteria.clubeextra.com.br`.
- Não inventar vigência quando o índice não lista a campanha no dia.

## Particularidades

- O adapter aceita `onlyNewest`, que escolhe o início de vigência mais recente e preserva a ordem da fonte em caso de empate; o coletor de cidade ainda não repassa a flag. No Extra, o início informado é o dia consultado, então campanhas do mesmo dia empatam e a seleção segue a ordem da fonte.
- O índice é compartilhado com o Pão de Açúcar apenas no formato; os hosts e
  os erros são separados por mercado.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

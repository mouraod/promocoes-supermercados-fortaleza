---
name: paodeacucar-encartes
description: >
  Adaptador (bloqueado) dos folhetos do Pão de Açúcar da praça Grande São
  Paulo (SP), pelo índice de campanhas e pelos viewers FlipHTML5. Use quando o
  usuário mencionar "encartes Pão de Açúcar", "encartes Pao de Acucar" ou
  colar a URL folhetos.paodeacucar.com.
---

# Pão de Açúcar Encartes (bloqueado)

Adaptador escrito para o Pão de Açúcar em `folhetos.paodeacucar.com`, praça
Grande São Paulo. **Não está na configuração de cidade** e não é executado
pelo coletor de São Paulo. Não use para Fortaleza.

## Por que está bloqueado

O índice compartilhado
`https://folhetos.paodeacucar.com/home/sites/assets/js/campanhas.js` está
parado em `31102026` e só lista campanhas velhas (27/10 a 01/11). A validade
real só aparece no OCR de `files/search/book_config.js` como
"ofertas válidas de 3 a 0/11/2026" — o mês sai corrompido. O adaptador falha
de propósito em `vigenciaPao()` em vez de inventar data.

## Como funcionaria

1. Lê `campanhas.js` e escolhe o dia mais recente menor ou igual a hoje.
2. Seleciona a região configurada (`identificador_fonte.regiao`, hoje
   `Grande São Paulo`).
3. Lê `javascript/config.js` de cada campanha e fatia `fliphtml5_pages`.
4. Extrai a vigência do `book_config.js` e falha se não conseguir ler.

## Desbloqueios possíveis

- Descobrir de onde o front do GPA lê as campanhas do dia (o índice
  compartilhado não é a fonte do viewer).
- Aceitar campanha sem validade confiável — não recomendado: viola a regra de
  não publicar fonte com vigência incerta.

## Identidade e vigência

A fonte prova a região, não a loja: o manifesto sairia com `regiao` e
`revisao_loja_obrigatoria: true`. A loja de referência (`gpa-sp`) é escopo
regional.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

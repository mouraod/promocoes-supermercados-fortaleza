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

1. Lê o HTML de `/ofertas/` e casa as páginas publicadas em
   `wp-content/uploads` com o padrão
   `ROLDAO-<campanha>-DD-E-DD-MM-AAAA-PGnn-scaled.jpg`.
2. Agrupa por campanha e ordena por `PGnn`.
3. A vigência vem do nome do arquivo (`DD-E-DD-MM-AAAA`), com data real
   conferida; período invertido falha.
4. Materiais em PDF no mesmo HTML são ignorados: só as páginas de imagem
   entram.

## Identidade e vigência

O folheto é de rede: a fonte não identifica a loja. O manifesto sai com
`revisao_loja_obrigatoria: true`; a loja de referência (Nações Unidas) vem da
configuração e precisa ser conferida visualmente. A triagem de 02/11 viu a
Mooca em um PDF da fonte — não presuma que o slug da loja no cadastro
corresponde à unidade do folheto sem revisar.

## Particularidades

- O padrão exige o sufixo `-scaled.jpg`; URL sem ele não é página de encarte.
- O adapter aceita `onlyNewest`, que reduz a lista de encartes à campanha mais recente; o coletor de cidade ainda não repassa a flag.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

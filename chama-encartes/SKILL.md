---
name: chama-encartes
description: >
  Baixa o tabloide do Chama Supermercados da praça São Paulo (SP), lendo a
  página de ofertas do grupo. Use quando o usuário mencionar "baixar encartes
  Chama", "encartes Chama" ou colar a URL grupochama.com.br.
---

# Chama Encartes

Tabloide do Chama em `www.grupochama.com.br/ofertas-do-chama-supermercados/`.
Usado pelo pipeline de São Paulo via `cidades/sao-paulo-sp.json` — não use
para Fortaleza.

## Como funciona

1. Lê o HTML da página de ofertas e casa as URLs de página do tabloide
   (`Tabloide-Rede-DD.MM-a-DD.MM.AA-PGnn-LxA.jpg` ou `-scaled.jpg`; tolera o
   `a` duplicado e o sufixo `-N` de reenvio que a fonte já publicou).
   Desde 04/11/2026 essa página lista só a capa e links para um post por
   tabloide (`/tabloide-de-ofertas-supermercado-chama/`); o adaptador segue
   esses links (exceto Farma) e lê a galeria completa do post.
2. Agrupa por campanha, ordena por `PGnn` e prefere a versão `-scaled`
   publicada na galeria; sem ela, remove o sufixo de miniatura (`-LxA`).
3. Filtra pela vigência lida do próprio nome do arquivo; sem campanha vigente
   o adaptador falha em vez de devolver lista vazia.

## Identidade e vigência

O tabloide é de rede: a fonte não identifica a loja. O manifesto sai com
`revisao_loja_obrigatoria: true`; a loja de referência (Água Rasa) vem da
configuração e precisa ser conferida visualmente, inclusive restrições por
loja no rodapé.

## Particularidades

- O padrão exige `PG` e sufixo `-LxA` ou `-scaled`; página fora dele não entra. Tabloides `Tabloide-loja-NN` (de uma loja só) não entram: o manifesto é da rede.
- Post alheio fora do ar não derruba a coleta se outra fonte já entregou páginas; sem nenhuma campanha vigente o erro lista as falhas.
- O adapter aceita `onlyNewest`, que reduz a lista de encartes à campanha mais recente; o coletor de cidade ainda não repassa a flag.

## Dependências

- Nenhuma externa: `fetch` nativo, sem poppler e sem Playwright.

---
name: atacadao-encartes
description: >
  Baixa todos os encartes vigentes do Atacadao (todas as paginas em alta resolucao). Use quando o usuario mencionar "baixar encartes Atacadao", "encartes Atacadao", "download encartes Atacadao", ou colar a URL atacadao.com.br/loja/.
---

# Atacadao Encartes Downloader

Baixa todos os encartes vigentes e **todas as suas paginas** via parse do `__NEXT_DATA__` do site + rasterizacao do PDF com poppler. Sem Playwright, sem npm install, sem API separada.

## Setup (so na primeira vez)

```bash
brew install poppler
```

## Comando padrao

```bash
node atacadao-encartes/download-encartes.js
```

Saida: `~/Downloads/Encartes/Atacadao/DD-Mes/`

## Como funciona

1. `fetch` do HTML de `https://www.atacadao.com.br/loja/{slug}`
2. Extrai o `<script id="__NEXT_DATA__">` e parseia o JSON
3. Navega em `props.pageProps.storeInfo.flyers[]` e filtra: so encartes com `exclude !== true` e `validity.final >= hoje`
4. Para cada encarte: baixa o PDF de `urlFinalDocument` (idempotente)
5. `pdfinfo` conta o nº de paginas; `pdftoppm -jpeg -r 200` rasteriza cada uma em JPG ~2205x3150 px
6. Pula arquivos ja existentes (idempotente por PDF e por pagina)
7. Tenta reaproveitar paginas de rodadas anteriores via `lib/reuso.js`
8. Grava `manifest.json` com rede, loja, data, DPI e lista de encartes

## Estrutura de saida

```
Downloads/Encartes/Atacadao/DD-Mes/
  PDF/
    super-ofertas-27-07-a-05-08.pdf
    festival-de-chocolates-01-08-a-09-08.pdf
  JPG/
    super-ofertas-27-07-a-05-08-pagina-01.jpg
    super-ofertas-27-07-a-05-08-pagina-02.jpg
    festival-de-chocolates-01-08-a-09-08-pagina-01.jpg
  manifest.json
```

Nome do arquivo: `<slug>-pagina-NN.jpg`. O slug e `slugify(name)-DD-MM-a-DD-MM` usando as datas de vigencia, o que diferencia folhetos com mesmo nome (ex: varios "Super Ofertas" com vigencias diferentes).

## Opcoes

```bash
# Loja especifica (Fortaleza)
node atacadao-encartes/download-encartes.js --loja fortaleza-aeroporto

# So o encarte mais recente (teste)
node atacadao-encartes/download-encartes.js --only-newest

# Resolucao alternativa
node atacadao-encartes/download-encartes.js --dpi 300

# Pasta de destino alternativa
node atacadao-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa (contera Atacadao/DD-Mes/ dentro)
node atacadao-encartes/download-encartes.js --base /outro/caminho

# Sem reuso de paginas anteriores
node atacadao-encartes/download-encartes.js --sem-reuso
```

## Lojas Fortaleza

```
fortaleza-barra-do-ceara
fortaleza-br-116
fortaleza-aeroporto
fortaleza-fatima
fortaleza-maraponga-24hrs
fortaleza-vila-peri
fortaleza-osorio
```

## Comportamento ao acionar

1. Executar o script direto — sem perguntas desnecessarias
2. Mostrar o output (rede, loja, data, dpi, nº encartes, nº paginas, destino)
3. Confirmar a pasta com `ls` se o usuario quiser verificar
4. Se `pdfinfo`/`pdftoppm` ausentes, o script ja exibe `brew install poppler`
5. Se houver outro erro, mostrar a mensagem exata

---
name: mateus-encartes
description: >
  Baixa todos os encartes vigentes do Mix Mateus (Grupo Mateus, Fortaleza) em alta resolução. Use quando o usuário mencionar "baixar encartes Mateus", "encartes Mix Mateus", "download encartes Mateus", ou colar a URL ofertasmateus.com.
---

# Mix Mateus Encartes Downloader

Baixa todos os encartes vigentes e **todas as suas páginas** via API JSON aberta do site + rasterização do PDF com poppler. Sem Playwright, sem npm install.

## Setup (só na primeira vez)

```bash
brew install poppler
```

## Comando padrão

```bash
node mateus-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/Mateus/DD-Mês/`

## Como funciona

1. A página do site é só casca; o JS chama uma API JSON via proxy. `fetch` de `https://ofertasmateus.com/api-proxy.php?endpoint=/encartes/ce/fortaleza/{loja}?marca=MA`
2. Filtra: só encartes com `validade >= hoje`
3. Para cada encarte: baixa o PDF de `api-proxy.php?file=<arquivo>` (idempotente). O host `admin.ofertasmateus.com` dá 403 direto, por isso o proxy
4. `pdfinfo` conta o nº de páginas; `pdftoppm -jpeg -r 200` rasteriza cada uma em JPG ~2205x3150 px
5. Pula arquivos já existentes (idempotente por PDF e por página)
6. Tenta reaproveitar páginas de rodadas anteriores via `lib/reuso.js`
7. Grava `manifest.json` com rede, loja, data, DPI e lista de encartes

## Estrutura de saída

```
Downloads/Encartes/Mateus/DD-Mes/
  PDF/
    exclusivo-pole-10-a-15-09.pdf
    familia-pet-10-a-15-09.pdf
  JPG/
    exclusivo-pole-10-a-15-09-pagina-01.jpg
  manifest.json
```

Nome do arquivo: `<slug>-pagina-NN.jpg`. O slug é `slugify(descricao)-DD-a-DD-MM` usando as datas de vigência.

## Opções

```bash
# Loja específica (Fortaleza)
node mateus-encartes/download-encartes.js --loja mix-jose-walter

# Resolução alternativa
node mateus-encartes/download-encartes.js --dpi 300

# Pasta de destino alternativa
node mateus-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa (conterá Mateus/DD-Mês/ dentro)
node mateus-encartes/download-encartes.js --base /outro/caminho

# Sem reuso de páginas anteriores
node mateus-encartes/download-encartes.js --sem-reuso
```

## Lojas Fortaleza

```
mix-henrique-jorge
mix-jose-walter
mix-messejana
```

## Comportamento ao acionar

1. Executar o script direto — sem perguntas desnecessárias
2. Mostrar o output (rede, loja, data, dpi, nº encartes, nº páginas, destino)
3. Confirmar a pasta com `ls` se o usuário quiser verificar
4. Se `pdfinfo`/`pdftoppm` ausentes, o script já exibe `brew install poppler`
5. Se houver outro erro, mostrar a mensagem exata

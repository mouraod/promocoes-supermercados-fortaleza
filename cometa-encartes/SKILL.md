---
name: cometa-encartes
description: >
  Baixa todos os encartes da semana do Cometa Supermercados (todas as páginas em alta resolução). Use quando o usuário mencionar "baixar encartes Cometa", "encartes Cometa", "download encartes Cometa", ou colar a URL cometasupermercados.com.br/encartes.
---

# Cometa Encartes Downloader

Baixa todos os encartes e **todas as suas páginas** via API do Cometa + rasterização do PDF com poppler. Sem Playwright, sem npm install.

## Setup (só na primeira vez)

```bash
brew install poppler
```

## Comando padrão

```bash
node cometa-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/Cometa/DD-Mês/`

## Como funciona

1. `GET https://cometasupermercados.com.br/api/encartes` → lista completa (Strapi)
2. Para cada encarte: baixa o PDF de `adminx.cometasupermercados.com.br` (idempotente)
3. `pdfinfo` conta o nº de páginas; `pdftoppm -jpeg -r 200` rasteriza cada uma em JPG 2205×3150 px
4. Pula arquivos já existentes (idempotente por PDF e por página)
5. Grava `manifest.json` com rede, data, DPI e lista de encartes

## Estrutura de saída

```
Downloads/Encartes/Cometa/24-Junho/
  PDF/
    281-cooperado-nissin-e-cargill.pdf
    301-dezenal.pdf
    ...
  JPG/
    281-cooperado-nissin-e-cargill-pagina-01.jpg
    301-dezenal-pagina-01.jpg
    301-dezenal-pagina-04.jpg
    ...
  manifest.json
```

## Opções

```bash
# Só o encarte mais recente (teste)
node cometa-encartes/download-encartes.js --only-newest

# Resolução alternativa
node cometa-encartes/download-encartes.js --dpi 300

# Pasta de destino alternativa (conterá PDF/ e JPG/)
node cometa-encartes/download-encartes.js --output /caminho/completo
```

## Comportamento ao acionar

1. Executar o script direto — sem perguntas desnecessárias
2. Mostrar o output (rede, data, dpi, nº encartes, nº páginas, destino)
3. Confirmar a pasta com `ls` se o usuário quiser verificar
4. Se `pdfinfo`/`pdftoppm` ausentes, o script já exibe `brew install poppler`
5. Se houver outro erro, mostrar a mensagem exata

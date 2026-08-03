---
name: superdopovo-encartes
description: >
  Baixa todos os encartes vigentes do Super do Povo Supermercados (todas as páginas em alta resolução). Use quando o usuário mencionar "baixar encartes Super do Povo", "encartes Super do Povo", "encartes SDP", ou colar a URL loja.superdopovo.com.br/booklets.
---

# Super do Povo Encartes Downloader

Baixa todos os encartes vigentes e **todas as suas páginas** via Playwright (navegador headless) + rasterização de PDF com poppler. O próprio JS do site autentica e lista os encartes; o script intercepta a resposta e, para cada encarte, baixa o PDF (quando existe) rasterizando cada página em alta resolução — só cai para as imagens prontas do site quando não há PDF.

## Setup (só na primeira vez)

```bash
brew install poppler
cd superdopovo-encartes && npm install
```

O Chromium do Playwright é baixado automaticamente no primeiro `npm install` (via `npx playwright install chromium` se necessário).

## Comando padrão

```bash
node superdopovo-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/SuperDoPovo/DD-Mês/`

## Como funciona

1. Abre Chromium headless e navega para `loja.superdopovo.com.br/booklets`
2. Intercepta a resposta de rede de `/api/v1/booklets/<shop_id>` — o site é um SPA da plataforma botvendas e essa rota exige um JWT de curta duração que o próprio JS obtém sozinho (não dá pra chamar a API direto com `curl`)
3. Filtra por vigência: mantém só encartes com `end >= hoje` (ignora vencidos; use `--all` para trazer todos)
4. Para cada encarte:
   - **Se tem `pdf`**: baixa o PDF num arquivo temporário, `pdfinfo` conta as páginas, `pdftoppm -jpeg -r 200` rasteriza cada uma. O PDF é descartado depois — só o JPG fica.
   - **Se não tem `pdf`** (`pdf: null`): baixa direto as imagens de `sheets[]`, que já vêm prontas do CDN público (Google Storage).
   - Encartes sem PDF e sem `sheets`/`links` são pulados com aviso, sem quebrar o script.
5. Pula arquivos já existentes (idempotente por página)
6. Grava `manifest.json` com rede, data, dpi, vigência e fonte (`pdf` ou `sheets`) de cada encarte

### Por que PDF em vez das imagens prontas (`sheets`)

O payload da API já traz imagens rasterizadas em `sheets[]`, mas elas são baixa resolução (~72dpi, tipo 595×842) e às vezes **têm menos páginas que o PDF real** (um encarte observado tinha 4 sheets contra 5 páginas no PDF). Por isso o script sempre prefere o PDF quando ele existe, e só usa `sheets` como fallback nos encartes que não têm PDF (normalmente fotos soltas tipo "WhatsApp Image...", cuja imagem única já é a fonte original em boa qualidade).

## Estrutura de saída

```
Downloads/Encartes/SuperDoPovo/16-Julho/
  JPG/
    1605-17-a-19-07-pagina-01.jpg   (via PDF, ~2205x3150)
    1605-17-a-19-07-pagina-05.jpg
    1602-17-a-23-07-pagina-01.jpeg  (via sheets, sem PDF disponível)
    ...
  manifest.json
```

Nome do arquivo: `<id>-<vigência>-pagina-NN.<ext>`. O campo `name` da API (nome de arquivo cru, tipo "WhatsApp Image 2026-07-09 at 14.49.17.jpeg") é ignorado — vigência (`start`/`end`) é mais confiável e informativo.

## Opções

```bash
# Só o encarte mais recente (teste)
node superdopovo-encartes/download-encartes.js --only-newest

# Inclui encartes já vencidos
node superdopovo-encartes/download-encartes.js --all

# Resolução alternativa de rasterização
node superdopovo-encartes/download-encartes.js --dpi 300

# Pasta de destino alternativa (conterá JPG/)
node superdopovo-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa (conterá SuperDoPovo/DD-Mês/ dentro)
node superdopovo-encartes/download-encartes.js --base /outro/caminho
```

## Comportamento ao acionar

1. Executar o script direto — sem perguntas desnecessárias
2. Mostrar o output (rede, data, dpi, nº encartes, nº páginas, destino)
3. Confirmar a pasta com `ls` se o usuário quiser verificar
4. Se `pdfinfo`/`pdftoppm` ausentes, o script já exibe `brew install poppler`
5. Se Playwright ausente, o script falha com mensagem clara — rodar `npm install` na pasta `superdopovo-encartes/`
6. Se houver outro erro, mostrar a mensagem exata

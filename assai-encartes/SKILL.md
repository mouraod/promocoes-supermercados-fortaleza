---
name: assai-encartes
description: >
  Use when the user asks to download Assaí or Assai offers, asks for Assaí encartes, or provides an assai.com.br/ofertas URL for the Bezerra M store in Fortaleza.
---

# Assaí Encartes Downloader

Baixa os encartes exibidos para o Assaí Bezerra M, incluindo todas as páginas
de cada campanha. O script usa Playwright apenas para identificar a loja e
interceptar a lista oficial de ofertas; as imagens são baixadas pelo pipeline.

## Setup

```bash
cd assai-encartes
npm install
npx playwright install chromium
```

## Comando padrão

```bash
node assai-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/Assai/DD-Mês/`.

## Opções

```bash
# Só o primeiro encarte mostrado pelo site
node assai-encartes/download-encartes.js --only-newest

# Pasta de destino alternativa
node assai-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa
node assai-encartes/download-encartes.js --base /outro/caminho

# Não reaproveita páginas de rodadas anteriores
node assai-encartes/download-encartes.js --sem-reuso
```

## Como funciona

1. Abre a página de ofertas do Assaí Bezerra M.
2. Lê `eid` e `nid` de `.bloco-ofertas-tabloide`.
3. Intercepta `ofertas_assai.json`, seleciona apenas as campanhas dessa loja e
   mantém a ordem de destaque do site.
4. Baixa todas as imagens de cada campanha e grava `manifest.json` com a loja,
   vigência e identificador da oferta.

## Comportamento ao acionar

1. Executar o script direto, sem perguntas desnecessárias.
2. Mostrar a saída do downloader e informar o destino.
3. Se Playwright ou Chromium estiver ausente, orientar: `cd assai-encartes && npm install && npx playwright install chromium`.
4. Para analisar promoções, ler visualmente as imagens baixadas.

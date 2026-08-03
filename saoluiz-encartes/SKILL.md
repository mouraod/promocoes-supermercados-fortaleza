---
name: saoluiz-encartes
description: >
  Baixa todos os encartes da semana do Mercadinhos Sao Luiz (loja 355), todas as paginas. Use quando o usuario mencionar "baixar encartes Sao Luiz", "encartes Sao Luiz", "encartes Mercadinhos Sao Luiz", ou colar a URL mercadinhossaoluiz.com.br/loja/355/encartes.
---

# Sao Luiz Encartes Downloader

Baixa todos os encartes e **todas as suas paginas** via Playwright (navegador headless). O proprio JS do site autentica e lista os flipbooks; o script intercepta a resposta e baixa as imagens do CDN publico.

## Setup (so na primeira vez)

```bash
cd saoluiz-encartes && npm install
```

O Chromium do Playwright e baixado automaticamente no primeiro `npm install` (via `npx playwright install chromium` se necessario).

## Comando padrao

```bash
node saoluiz-encartes/download-encartes.js
```

Saida: `~/Downloads/Encartes/SaoLuiz/DD-Mes/`

## Como funciona

1. Abre Chromium headless e navega para `mercadinhossaoluiz.com.br/loja/355/encartes`
2. Intercepta a resposta de rede de `/flipbooks` -- ja contem todas as paginas (campo `images_urls`)
3. Para cada encarte: baixa cada pagina como JPG do CDN publico (idempotente -- pula se ja existe)
4. Grava `manifest.json` com rede, data, lista de encartes e total de paginas

## Estrutura de saida

```
Downloads/Encartes/SaoLuiz/25-Junho/
  JPG/
    69559-especial-sao-joao-17-a-2806-pagina-01.jpg
    69559-especial-sao-joao-17-a-2806-pagina-02.jpg
    ...
    69711-peixaria-25-a-2806-pagina-01.jpg
  manifest.json
```

## Opcoes

```bash
# So o encarte mais recente (teste)
node saoluiz-encartes/download-encartes.js --only-newest

# Pasta de destino alternativa
node saoluiz-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa (contera SaoLuiz/DD-Mes/ dentro)
node saoluiz-encartes/download-encartes.js --base /outro/caminho
```

## Comportamento ao acionar

1. Executar o script direto -- sem perguntas desnecessarias
2. Mostrar o output (rede, data, nr encartes, nr paginas, destino)
3. Confirmar a pasta com `ls` se o usuario quiser verificar
4. Se Playwright ausente, o script falha com mensagem clara -- rodar `npm install` na pasta `saoluiz-encartes/`
5. Se houver outro erro, mostrar a mensagem exata

## Analise de promocoes

Quando o usuario pedir as melhores promocoes (ex: "quais as melhores promocoes de hoje?"), ler todas as imagens JPG da pasta e apresentar os destaques.

### Formato obrigatorio de preco

Sempre usar: `de R$ X por **R$ Y** (Z% off)`

Nunca usar tachado (~~R$ X~~). Sempre o formato "de ... por".

### Estrutura da resposta

Organizar por categoria com cabecalho em negrito. Ordenar dentro de cada categoria do maior para o menor desconto. Incluir apenas os itens com desconto relevante (acima de 15% ou preco muito bom). Exemplo:

**Biscoitos & Doces**
- Kit Kat Vários Tipos 41,5g: de R$ 6,25 por **R$ 3,49** (45% off)
- Biscoito Wafer Amandita 200g: de R$ 28,29 por **R$ 17,99** (36% off)

**Acougue**
- Picanha Bovina Maturatta Congelada Peca: de R$ 107,90 por **R$ 84,90/kg** (21% off)

### Categorias sugeridas (adaptar ao que existir no encarte)

Biscoitos & Doces, Mercearia, Limpeza & Casa, Perfumaria, Bebidas, Acougue, Peixaria, Hortifruti, Laticinios

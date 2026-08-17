---
name: guara-encartes
description: >
  Baixa todos os encartes vigentes do Supermercado Guara (todas as paginas em alta resolucao). Use quando o usuario mencionar "baixar encartes Guara", "encartes Guara", "encartes Supermercado Guara", ou colar a URL supermercadoguara.com.br/folhetos.
---

# Guara Encartes Downloader

Baixa todos os encartes e **todas as suas paginas** via Playwright (navegador headless). O site e um SPA Angular sobre a plataforma Regex Solutions; o SSR renderiza so skeletons e a API retorna dados criptografados, entao o script espera o Angular renderizar os cards no DOM, extrai titulo + URL da capa de cada encarte, sonda o CDN pra descobrir quantas paginas tem (incrementando o sufixo ate 403) e baixa tudo do CDN publico (`cdn.regexsolutions.com.br`).

## Setup (so na primeira vez)

```bash
cd guara-encartes && npm install
```

O Chromium do Playwright e baixado automaticamente no primeiro `npm install` (via `npx playwright install chromium` se necessario).

## Comando padrao

```bash
node guara-encartes/download-encartes.js
```

Saida: `~/Downloads/Encartes/Guara/DD-Mes/`

## Como funciona

1. Abre Chromium headless e navega para `supermercadoguara.com.br/folhetos`
2. Espera os `.card-folheto img[src]` aparecerem no DOM (o Angular renderiza skeletons no SSR e substitui pelos dados reais depois de decriptar a resposta da API)
3. Extrai de cada card: titulo, subtitulo (vigencia) e URL da imagem de capa
4. Para cada encarte, sonda o CDN incrementando o sufixo da URL (`-1`, `-2`, ...) ate receber 403, pra descobrir quantas paginas tem
5. Baixa cada pagina como webp (requer User-Agent de navegador; idempotente por pagina)
6. Grava `manifest.json` com rede, data, lista de encartes e total de paginas

## Estrutura de saida

```
Downloads/Encartes/Guara/17-Agosto/
  JPG/
    encarte-horti-e-mercearia-1708-e-18082026-pagina-01.webp
    encarte-horti-e-mercearia-1708-e-18082026-pagina-02.webp
    encarte-m-dias.-pagina-01.webp
    ...
  manifest.json
```

## Opcoes

```bash
# So o encarte mais recente (teste)
node guara-encartes/download-encartes.js --only-newest

# Pasta de destino alternativa
node guara-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa (contera Guara/DD-Mes/ dentro)
node guara-encartes/download-encartes.js --base /outro/caminho

# Nao reaproveita paginas de rodadas anteriores
node guara-encartes/download-encartes.js --sem-reuso
```

## Comportamento ao acionar

1. Executar o script direto -- sem perguntas desnecessarias
2. Mostrar o output (rede, data, nr encartes, nr paginas, destino)
3. Confirmar a pasta com `ls` se o usuario quiser verificar
4. Se Playwright ausente, o script falha com mensagem clara -- rodar `npm install` na pasta `guara-encartes/`
5. Se houver outro erro, mostrar a mensagem exata

## Analise de promocoes

Quando o usuario pedir as melhores promocoes (ex: "quais as melhores promocoes de hoje?"), ler todas as imagens da pasta e apresentar os destaques.

### Formato obrigatorio de preco

Sempre usar: `de R$ X por **R$ Y** (Z% off)`

Nunca usar tachado (~~R$ X~~). Sempre o formato "de ... por".

### Estrutura da resposta

Organizar por categoria com cabecalho em negrito. Ordenar dentro de cada categoria do maior para o menor desconto. Incluir apenas os itens com desconto relevante (acima de 15% ou preco muito bom). Exemplo:

**Biscoitos & Doces**
- Kit Kat Varios Tipos 41,5g: de R$ 6,25 por **R$ 3,49** (45% off)

### Categorias sugeridas (adaptar ao que existir no encarte)

Biscoitos & Doces, Mercearia, Limpeza & Casa, Perfumaria, Bebidas, Acougue, Peixaria, Hortifruti, Laticinios

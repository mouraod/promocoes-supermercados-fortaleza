---
name: uniforca-encartes
description: >
  Baixa os encartes vigentes da Rede Uniforça, rasterizando PDFs e baixando
  imagens diretas. Use quando o usuário mencionar "baixar encartes Uniforça",
  "encartes Uniforça", ou colar a URL redeuniforca.com.br/ofertas.
---

# Uniforça Encartes

Baixa os encartes da seção "Encartes" do site da Rede Uniforça. O site é
WordPress com HTML estático. Os encartes podem ser PDFs (rasterizados com
poppler) ou imagens diretas (JPEG/PNG).

## Comando padrão

```bash
node uniforca-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/Uniforca/DD-Mês/`

## Como funciona

1. Lê o HTML de `redeuniforca.com.br/ofertas/`.
2. Extrai cada `<div class="promotions__item">`: título (`<p>`) e link (`<a>`).
3. PDFs (`.pdf`) são baixados e rasterizados com poppler; o original fica em `PDF/`.
4. Imagens (`.jpg`, `.jpeg`, `.png` ou `.webp`) são baixadas diretamente para `JPG/`.
5. Grava `manifest.json`.

O site não publica vigência estruturada. A validade deve ser lida visualmente
das imagens pelo pipeline de extração.

## Opções

```bash
# Pasta de destino alternativa
node uniforca-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa
node uniforca-encartes/download-encartes.js --base /outro/caminho

# Resolução do PDF (padrão: 200 dpi)
node uniforca-encartes/download-encartes.js --dpi 300

# Sem reaproveitar páginas de rodadas anteriores
node uniforca-encartes/download-encartes.js --sem-reuso
```

## Dependências

- poppler: `brew install poppler` (para rasterizar PDFs).
- Sem Playwright e sem `npm install`.

## Comportamento ao acionar

1. Executar o script sem perguntas desnecessárias.
2. Mostrar os encartes encontrados, quantidade baixada/pulada e destino.
3. Se nenhum encarte for encontrado, mostrar a mensagem exata do erro.
4. Se a seção de encartes não existir no HTML, avisar e parar.

---
name: centerbox-encartes
description: >
  Baixa os encartes vigentes do Center Box (Grupo Centerbox), todas as páginas
  em resolução original. Use quando o usuário mencionar "baixar encartes
  Center Box", "encartes Centerbox", "encartes do Center Box", ou colar a URL
  grupocenterbox.com.br/ofertas.
---

# Center Box Encartes

Baixa as imagens da seção "Ofertas da semana" do site do Grupo Centerbox. O
site é WordPress com HTML estático, então não requer Playwright nem npm install
nem poppler. Sem PDF — as imagens originais já são JPEG em boa resolução.

## Comando padrão

```bash
node centerbox-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/CenterBox/DD-Mês/`

## Como funciona

1. Lê o HTML de `grupocenterbox.com.br/ofertas/`
2. Extrai apenas as imagens da seção "Ofertas da semana" (ignora "Ofertas anteriores")
3. Cada `<div class="offers__item">` contém um `<h3>` (título) e `<img>` (URL da imagem)
4. Baixa os originais de `wp-content/uploads/` e grava `manifest.json`

O site não publica vigência estruturada. Depois do download, ler os JPGs
visualmente e só incluir no `ofertas.json` itens cuja vigência esteja clara. O
script nunca interpreta o conteúdo das imagens.

## Opções

```bash
# Pasta de destino alternativa
node centerbox-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa, contendo CenterBox/DD-Mês/
node centerbox-encartes/download-encartes.js --base /outro/caminho

# Baixa tudo de novo, sem reaproveitar páginas de rodadas anteriores
node centerbox-encartes/download-encartes.js --sem-reuso
```

## Comportamento ao acionar

1. Executar o script sem perguntas desnecessárias.
2. Mostrar os encartes encontrados, a quantidade baixada ou pulada e o destino.
3. Se a seção "Ofertas da semana" estiver vazia, avisar e parar (não baixar da seção anterior).
4. Se nenhuma imagem for encontrada, mostrar a mensagem exata do erro (o HTML pode ter mudado).

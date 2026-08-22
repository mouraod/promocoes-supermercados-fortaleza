---
name: frangolandia-encartes
description: >
  Baixa os encartes vigentes da Frangolandia (Fortaleza), todas as páginas de cada encarte
  publicadas na galeria do site, na resolução original. Use quando o usuário mencionar
  "baixar encartes Frangolandia", "encartes Frangolandia", "encarte da Frangolandia", ou colar
  URLs de frangolandia.com/encartes ou frangolandia.com/encarte/.
---

# Frangolandia Encartes

Baixa as imagens da galeria de cada encarte listado em `frangolandia.com/encartes/`. O site é WordPress + Elementor com HTML estático, então não requer Playwright nem `npm install`. O botão "Download em PDF" é ignorado: a galeria já contém todas as páginas em JPG.

## Comando padrão

```bash
node frangolandia-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/Frangolandia/DD-Mês/`.

## Como funciona

1. Lê o HTML de `frangolandia.com/encartes/` e extrai os links de `/encarte/<slug>/`.
2. Abre cada página e extrai os `href` da galeria Elementor (`a.e-gallery-item`), na ordem em que o site exibe.
3. Baixa os originais de `wp-content/uploads` e grava `manifest.json`.

O site não publica vigência estruturada. Depois do download, ler os JPGs visualmente e só incluir no `ofertas.json` itens cuja vigência esteja clara. O script nunca interpreta o conteúdo das imagens.

## Opções

```bash
# Pasta de destino alternativa
node frangolandia-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa, contendo Frangolandia/DD-Mês/
node frangolandia-encartes/download-encartes.js --base /outro/caminho

# Baixa tudo de novo, sem reaproveitar páginas de rodadas anteriores
node frangolandia-encartes/download-encartes.js --sem-reuso
```

## Comportamento ao acionar

1. Executar o script sem perguntas desnecessárias.
2. Mostrar os encartes encontrados, a quantidade baixada ou pulada e o destino.
3. Se uma página de encarte não tiver galeria, avisar e continuar com as demais.
4. Se nenhum link ou imagem for encontrada, mostrar a mensagem exata do erro (o HTML do site pode ter mudado).

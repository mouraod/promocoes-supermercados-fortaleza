---
name: mercadao-encartes
description: >
  Baixa os encartes atuais do Mercadão São Luiz, em todas as páginas disponíveis na home e em /ofertas, na resolução original do Wix. Use quando o usuário mencionar "baixar encartes Mercadão", "encartes Mercadão São Luiz", "encartes Mercadão", ou colar URLs de mercadaosaoluiz.com.br.
---

# Mercadão São Luiz Encartes

Baixa as imagens de encarte que o site publica diretamente na home e em `/ofertas`. Não requer Playwright nem `npm install`.

## Comando padrão

```bash
node mercadao-encartes/download-encartes.js
```

Saída: `~/Downloads/Encartes/MercadaoSaoLuiz/DD-Mês/`.

## Como funciona

1. Lê o HTML de `mercadaosaoluiz.com.br/` e `mercadaosaoluiz.com.br/ofertas`.
2. Identifica imagens verticais de encarte nos `srcSet`, deduplica as duas páginas e baixa o original público do Wix.
3. Agrupa nomes como `_page-0001` e `-imagens-0` como páginas de um encarte.
4. Grava `manifest.json` com URLs, nomes e contagem de páginas.

O site não fornece uma vigência estruturada. Depois do download, ler os JPGs visualmente e só incluir em análises de ofertas itens cuja vigência esteja clara. O script nunca interpreta o conteúdo das imagens.

## Opções

```bash
# Só descobre e mostra as páginas, sem gravar arquivos
node mercadao-encartes/download-encartes.js --dry-run

# Pasta de destino alternativa
node mercadao-encartes/download-encartes.js --output /caminho/completo

# Pasta raiz alternativa, contendo MercadaoSaoLuiz/DD-Mês/
node mercadao-encartes/download-encartes.js --base /outro/caminho
```

## Comportamento ao acionar

1. Executar o script sem perguntas desnecessárias.
2. Mostrar as páginas descobertas, a quantidade baixada ou pulada e o destino.
3. Se apenas uma fonte não expuser encartes, mostrar aviso e continuar com a outra.
4. Se nenhuma imagem for encontrada, ou se o HTML do Wix deixar de conter as imagens, mostrar a mensagem exata do erro.

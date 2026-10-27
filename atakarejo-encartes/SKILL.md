---
name: atakarejo-encartes
description: >
  Baixa o Encarte Habitual do Atakarejo da praça Salvador (BA), lendo a página
  da cidade e rasterizando o PDF. Use quando o usuário mencionar "baixar
  encartes Atakarejo", "encartes Atakarejo", "encarte do Atakarejo" ou colar a
  URL atakarejo.com.br/cidades/salvador/.
---

# Atakarejo Encartes

Encarte Habitual da cidade, em `atakarejo.com.br/cidades/<slug>/`. A página da
cidade traz **um** botão `button-download-ofertas` apontando para o PDF no
próprio host. Este adapter é usado pelo pipeline de Salvador (BA) via
`cidades/salvador-ba.json` — **não** use para Fortaleza.

## Como funciona

1. Lê o HTML da cidade e localiza o botão oficial de download.
2. Valida que o PDF é HTTPS, do host `atakarejo.com.br`, sob
   `/wp-content/uploads/`, e termina em `.pdf`.
3. Lê a validade do HTML: `Ofertas válidas de 26 a 29/10/2026.` (ou
   `de 30/10 a 03/11/2026`). Sem essa frase, o adapter falha.
4. O título (`Salvador | Atakarejo`) define a cidade no nome do encarte.

O PDF é mantido (`manter: true`) e rasterizado pelo pipeline com poppler.

## Proibições

- Não usar `atakarejo.com.br/encartes/` — responde HTTP 500.
- Não deduzir vigência do nome do arquivo: a data vem do HTML.
- O mesmo PDF vale para a cidade inteira; a loja é só a de referência.

## Dependências

- poppler: `brew install poppler` (rasterização do PDF).

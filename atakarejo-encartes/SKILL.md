---
name: atakarejo-encartes
description: >
  Baixa os encartes vigentes do Atakarejo da praça Salvador (BA) (Habitual, de marca e de evento), lendo a página
  da cidade e rasterizando o PDF. Use quando o usuário mencionar "baixar
  encartes Atakarejo", "encartes Atakarejo", "encarte do Atakarejo" ou colar a
  URL atakarejo.com.br/cidades/salvador/.
---

# Atakarejo Encartes

Encartes da cidade, em `atakarejo.com.br/cidades/<slug>/`. A página traz um
card por campanha (Habitual, Black Bahia, Sadia e Perdigão, Mega Dia…), cada
um com **um** botão `button-download-ofertas` apontando para o PDF no próprio
host. Todas entram; o coletor descarta as vencidas pela validade do card. Este adapter é usado pelo pipeline de Salvador (BA) via
`cidades/salvador-ba.json` — **não** use para Fortaleza.

## Como funciona

1. Lê o HTML da cidade e localiza o botão oficial de cada card de campanha.
2. Valida que o PDF é HTTPS, do host `atakarejo.com.br`, sob
   `/wp-content/uploads/`, e termina em `.pdf`.
3. Lê a validade de cada card: `Ofertas válidas de 26 a 29/10/2026.`,
   `de 30/10 a 03/11/2026` ou por extenso (`de 06 e 07 de novembro de 2026`,
   `entre os dias 30 e 31 de outubro de 2026`). Card sem essa frase, ou com
   duas, faz o adapter falhar.
4. O título (`Salvador | Atakarejo`) define a cidade no nome do encarte.

O PDF é mantido (`manter: true`) e rasterizado pelo pipeline com poppler.

## Proibições

- Não usar `atakarejo.com.br/encartes/` — responde HTTP 500.
- Não deduzir vigência do nome do arquivo: a data vem do HTML.
- O mesmo PDF vale para a cidade inteira; a loja é só a de referência.

## Dependências

- poppler: `brew install poppler` (rasterização do PDF).

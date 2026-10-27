---
name: hiperideal-encartes
description: >
  Baixa os encartes vigentes do Hiperideal (Salvador, BA) a partir do JSON
  embutido na página de encartes, rasterizando os PDFs. Use quando o usuário
  mencionar "baixar encartes Hiperideal", "encartes Hiperideal" ou colar a URL
  hiperideal.com.br/especial/encartes.
---

# Hiperideal Encartes

Lista de campanhas embutida no HTML de
`hiperideal.com.br/especial/encartes`, no bloco VTEX
`hiperideal.store-theme@0.x:encartes#encartes`. Os PDFs ficam em outro host:
`hiperideal.gsit.co/arquivos/pdf/`. Este adapter serve a praça Salvador (BA)
via `cidades/salvador-ba.json` — **não** use para Fortaleza.

## Como funciona

1. Fatia a lista `content.encartes[]` do HTML e faz o parse do JSON.
2. Descarta campanhas vencidas ou futuras usando `dataInicio`/`dataFim`.
3. Descarta campanha com nome de loja (`Lapa`): não há prova de abrangência.
4. Normaliza `http://` para `https://` e exige host `hiperideal.gsit.co` sob
   `/arquivos/pdf/`.
5. O título do encarte é o `nome` cru da campanha.

Campanha vigente sem `pdfUrl`, data ausente ou lista sem estrutura fazem o
adapter falhar — nunca devolve lista vazia "com sucesso". O PDF é mantido e
rasterizado pelo pipeline com poppler.

## Dependências

- poppler: `brew install poppler` (rasterização do PDF).

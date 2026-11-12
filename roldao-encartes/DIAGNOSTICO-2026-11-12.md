# Diagnóstico: "roldao: seleção vazia — ausência não comprovada" (12/11/2026)

## Conclusão

Não é intermitência da fonte nem filtro do adapter. A falha é determinística: o coletor
chamou o adapter **sem `--post-roldao`** (`ids_posts: []`), e o adapter, por desenho
(commit f568437, teste "não adquire automaticamente posts históricos ou desconhecidos"),
só adquire PDFs de posts escolhidos pelo operador. Sem seleção o resultado é sempre
`encartes: []`. O coletor só aceita lista vazia como "sem campanha" quando
`evidenciaFonte.quantidadeFlyersNaFonte === 0` e a rede está em `comEvidenciaDeAusencia`
(hoje só Atacadão e, em Salvador, as redes listadas); o Roldão não está nessa lista e o
adapter nunca emite esse campo. Logo, vazio vira erro, corretamente.

## Evidência (`.dados/execucoes-encartes/sao-paulo-sp/*.json`, rede `roldao`)

| execução | `posts_selecionados` | resultado |
|---|---|---|
| 2026-11-08T133523 | `[]` | falhou: seleção vazia |
| 2026-11-08T133632 | `[5062, 5058, 5052, 5049, 5046, 5028]` | coletada: 7 encartes, 17 páginas |
| 2026-11-10 (3 execuções), 11-11, 11-12T124540 | `[]` | falharam (3 tentativas iguais) |

Na mesma manhã de 08/11, a única diferença entre a falha e o sucesso foi a lista de
posts passada ao adapter. A fonte respondeu igual nas duas: 119 posts, 253 anexos, mesmas
6 lacunas (posts com 2 PDFs). Em 12/11 a fonte devolve 131 posts, 277 anexos, paginação
íntegra, e as mesmas 6 lacunas antigas (5062, 4956, 4758, 4611, 4597, 4585); nenhuma
lacuna nova. Os registros de 05, 06 e 07/11 têm outra mensagem ("nenhuma campanha vigente
com páginas de imagem"), de versão anterior do adapter/coletor, e também sem posts.

Reprodução ao vivo em 12/11 (somente leitura, `lib/roldao.js` desta branch):

- `descobrirComEvidencia({ ids_posts: [] })` -> `encartes: 0`, posts 131, anexos 277,
  `quantidadeFlyersNaFonte` indefinido (disparo do erro do coletor).
- `descobrirComEvidencia({ ids_posts: [5090, 5093, 5096] })` -> 3 encartes
  (`roldao-post-5090-pdf-5091`, `-5093-pdf-5094`, `-5096-pdf-5097`).

A fonte (API WordPress `ofertas-da-semana` + `media?parent=`) está estável e não mudou de
formato. Ela publica vários posts por semana (ex.: 09 e 11/11: Fim de Semana Arrasador
REDE/COMBATE/V, Hortifruti REDE/COMBATE/V, Quinta da Carne, Pepsico, BRF), sem data de
vigência nem loja estruturadas, por isso a escolha dos posts é do operador.

## Por que não há conserto no adapter

Fazer o adapter escolher posts sozinho (por data de publicação, título ou "mais recentes")
contraria a regra atual (vigência `null`, revisão obrigatória de loja/vigência/visual) e
afrouxaria a prova de ausência. Declarar `quantidadeFlyersNaFonte: 0` seria falso: a fonte
tem posts recentes.

## O que seria preciso (fora deste repositório)

1. A rotina diária de São Paulo (`rotina: true`) precisa de um passo de seleção que
   forneça `--post-roldao <id>` (repetível) ao `coletar-cidade.cjs`, com os posts novos da
   semana escolhidos a partir do catálogo que a execução já grava em
   `evidencia_fonte.catalogo` (id, título, PDFs) — por operador, ou por regra explícita
   aprovada (ex.: posts publicados desde a última coleta, excluindo históricos).
2. Enquanto isso, a falha é o comportamento correto, mas a mensagem engana ("revisar o
   adapter"). No coletor, quando `rede === "roldao"` e `ids_posts` está vazio, a mensagem
   deveria dizer "nenhum post selecionado (--post-roldao)". O coletor é só leitura nesta
   tarefa.
3. Para a rotina deixar de depender de seleção manual, a decisão de produto é definir a
   regra de seleção automática e como ela prova cobertura (hoje a seleção é sempre
   `selecao_completa: false`).

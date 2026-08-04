---
name: todos-encartes
description: >
  Skill guarda-chuva de encartes e ofertas dos supermercados de Fortaleza (Cometa, Mercadinhos São Luiz, Mercadão São Luiz e Super do Povo): baixa de uma vez os encartes das quatro redes, disparando as quatro skills individuais em sequência. Use quando o usuário pedir "baixar todos os encartes", "encartes da semana", "atualizar encartes", "encartes de todas as redes" ou "encartes de todos os mercados". Para uma rede só, use a skill daquela rede (cometa-encartes, saoluiz-encartes, mercadao-encartes ou superdopovo-encartes) em vez desta.
---

# Todos os Encartes (skill mãe)

Roda `cometa-encartes`, `saoluiz-encartes`, `mercadao-encartes` e `superdopovo-encartes` em sequência, sem precisar disparar uma por uma. Não substitui as skills individuais — elas continuam funcionando isoladas, e é o que usar quando o pedido for de uma rede só.

Reaproveita automaticamente (via hardlink) páginas de encartes que já foram baixados em rodadas anteriores, então rodadas repetidas na mesma semana são rápidas (Cometa, São Luiz e Super do Povo; o Mercadão baixa JPGs prontos e é idempotente por arquivo, sem reuso).

## Comando padrão

```bash
node todos-encartes/baixar-todos.js
```

Saída: `~/Downloads/Encartes/<Rede>/DD-Mês/`, uma pasta por rede, formato idêntico ao das skills individuais.

## Como funciona

1. Pré-checagem: confere `pdfinfo`/`pdftoppm` (poppler) e o `node_modules/playwright` de São Luiz e Super do Povo. Falhando algo, para ali, sem baixar nada, e mostra o comando exato pra corrigir.
2. Roda `cometa-encartes` → `saoluiz-encartes` → `mercadao-encartes` → `superdopovo-encartes`, um de cada vez (evita dois navegadores headless simultâneos).
3. Rede que falha não trava as outras — o orquestrador segue pras próximas e reporta a falha no resumo final.
4. Ao final, imprime um resumo consolidado (encartes, páginas, novas vs. reaproveitadas, por rede).

## Opções

```bash
# Pasta raiz alternativa (conterá <Rede>/DD-Mês/ de cada uma)
node todos-encartes/baixar-todos.js --base /caminho/completo

# Resolução de rasterização (Cometa e Super do Povo; São Luiz e Mercadão não rasterizam)
node todos-encartes/baixar-todos.js --dpi 300

# Só o encarte mais recente de cada rede (útil para teste)
node todos-encartes/baixar-todos.js --only-newest

# Não reaproveita páginas de rodadas anteriores, baixa tudo de novo
node todos-encartes/baixar-todos.js --sem-reuso

# Inclui encartes já vencidos (só afeta Super do Povo)
node todos-encartes/baixar-todos.js --all
```

O Mercadão aceita só `--base`: o orquestrador não repassa pra ele `--only-newest`, `--sem-reuso`, `--dpi` nem `--all`, porque o downloader dele não tem essas opções.

Não existe `--output` aqui — ele apontaria as quatro redes pra mesma pasta, sobrescrevendo uma a outra. Pra isso, rode a skill da rede específica.

## Comportamento ao acionar

1. Executar o script direto — sem perguntas desnecessárias
2. Deixar a saída de cada rede rolar no terminal (é o `stdio: inherit` dos quatro scripts filhos)
3. No final, mostrar o resumo consolidado
4. Se alguma rede faltar dependência (poppler ou Playwright), a pré-checagem já mostra o comando exato — rodar e tentar de novo
5. Se uma rede falhar em tempo de execução (rede fora do ar, etc.), as outras continuam; reportar a falha exatamente como aparece no resumo
6. Se o usuário pedir só uma rede específica ("baixar só o Cometa", por exemplo), usar a skill daquela rede em vez desta

## Análise de promoções (sob demanda)

Quando o usuário pedir as melhores promoções das redes juntas (ex: "quais as melhores promoções da semana?"), ler as imagens JPG das pastas baixadas e apresentar os destaques.

### Formato obrigatório de preço

Sempre usar: `de R$ X por **R$ Y** (Z% off)`

Nunca usar tachado (~~R$ X~~). Sempre o formato "de ... por".

### Estrutura da resposta

Organizar por categoria com cabeçalho em negrito. Dentro de cada categoria, ordenar do maior pro menor desconto e indicar a rede de cada item (já que agora há quatro fontes). Incluir só itens com desconto relevante (acima de 15% ou preço muito bom). Exemplo:

**Açougue**
- Picanha Bovina Maturatta Congelada Peça: de R$ 107,90 por **R$ 84,90/kg** (21% off) — São Luiz
- Alcatra Bovina Congelada Kg: de R$ 39,90 por **R$ 32,90/kg** (18% off) — Cometa

**Biscoitos & Doces**
- Kit Kat Vários Tipos 41,5g: de R$ 6,25 por **R$ 3,49** (45% off) — São Luiz

### Categorias sugeridas (adaptar ao que existir nos encartes)

Biscoitos & Doces, Mercearia, Limpeza & Casa, Perfumaria, Bebidas, Açougue, Peixaria, Hortifruti, Laticínios

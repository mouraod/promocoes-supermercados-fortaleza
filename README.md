# Promoções de Supermercados de Fortaleza

Skills para agentes de código (Claude Code, Codex, Pi) baixarem os encartes
vigentes de supermercados brasileiros em alta resolução, prontos para o agente
ler as páginas e comparar ofertas.

## Mercados

| Skill | Mercado |
|---|---|
| `cometa-encartes` | Supermercado Cometa (Fortaleza) |
| `saoluiz-encartes` | São Luiz |
| `superdopovo-encartes` | Super do Povo |
| `mercadao-encartes` | Mercadão São Luiz |
| `atacadao-encartes` | Atacadão |
| `guara-encartes` | Supermercado Guará |
| `todos-encartes` | Baixa os encartes de todos os mercados de uma vez |

## Instalar

```bash
git clone https://github.com/mouraod/promocoes-supermercados-fortaleza.git ~/Developer/promocoes-supermercados-fortaleza
ln -s ~/Developer/promocoes-supermercados-fortaleza/cometa-encartes ~/.claude/skills/cometa-encartes
```

Ajuste o destino do symlink para o seu agente: `~/.codex/skills` (Codex) ou
`~/.pi/agent/skills` (Pi).

Skills com `package.json` precisam de `npm install` na própria pasta. Node 18
ou superior (fetch nativo).

## Como usar

Peça ao agente: "baixar encartes do Cometa", "baixar encartes São Luiz", ou
cole um link de encarte. O download salva as páginas em JPG/PDF organizadas
por mercado e data, com um manifest por encarte. A leitura das ofertas é
visual, feita pelo próprio agente; nenhum script interpreta imagem.

O script é só o download. Comparar com a sua lista de compras, montar a lista
da semana e decidir o que vale a pena é conversa com o agente.

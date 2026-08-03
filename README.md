# Encartes Skills

Quatro [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills) para baixar os encartes semanais de supermercados, em alta resolução, prontos pra consulta ou análise de promoções.

Licenciado sob [MIT](LICENSE).

## Skills

### [`cometa-encartes/`](cometa-encartes/) — Cometa Supermercados
Consulta a API pública do site (Strapi), baixa os PDFs dos encartes e rasteriza cada página em JPG via `poppler`. Sem navegador, sem dependências npm.

### [`saoluiz-encartes/`](saoluiz-encartes/) — Mercadinhos São Luiz
Abre um Chromium headless via Playwright, intercepta a resposta de rede que lista os flipbooks e baixa as imagens do CDN público de cada página.

### [`superdopovo-encartes/`](superdopovo-encartes/) — Super do Povo Supermercados
Abre um Chromium headless via Playwright (o site exige um JWT de curta duração que só o próprio JS obtém) para listar os encartes vigentes, e depois baixa e rasteriza o PDF de cada um com `poppler` em alta resolução — caindo para as imagens prontas do site só quando não há PDF disponível.

### [`todos-encartes/`](todos-encartes/) — skill mãe
Dispara as três acima em sequência, uma opção pra quem não quer chamar uma por uma. Não substitui as skills individuais.

## Reaproveitamento entre rodadas

Cada script grava numa pasta `<Rede>/DD-Mês/` nova a cada dia. `lib/reuso.js`, compartilhado pelos três, procura páginas já baixadas em rodadas anteriores da mesma rede e as reaproveita via hardlink em vez de baixar e rasterizar de novo — só quando o `manifest.json` da rodada antiga confirma que a página existe de fato e está completa. Ativo por padrão; `--sem-reuso` desliga.

## Como usar

Cada pasta tem seu próprio `SKILL.md` com instruções detalhadas. Resumo rápido:

```bash
# Cometa (precisa de poppler: brew install poppler)
node cometa-encartes/download-encartes.js

# São Luiz (precisa de: cd saoluiz-encartes && npm install)
node saoluiz-encartes/download-encartes.js

# Super do Povo (precisa de poppler e: cd superdopovo-encartes && npm install)
node superdopovo-encartes/download-encartes.js

# As três de uma vez (mesmos pré-requisitos das três acima)
node todos-encartes/baixar-todos.js
```

Saída padrão em `~/Downloads/Encartes/<Rede>/DD-Mês/`.

## Sincronizando entre Mac e Windows

O Claude Code só reconhece skills que estão fisicamente dentro de `~/.claude/skills/`. Este repo é a fonte única de verdade; em cada máquina você cria um **link** de `~/.claude/skills/<nome>` apontando pra pasta correspondente do clone local. `git pull` atualiza o conteúdo real, e o link já reflete a mudança sem precisar copiar nada.

### Mac / Linux (symlink)

```bash
git clone https://github.com/mouraod/claude-encartes-skills.git ~/Developer/claude-encartes-skills

ln -s ~/Developer/claude-encartes-skills/cometa-encartes ~/.claude/skills/cometa-encartes
ln -s ~/Developer/claude-encartes-skills/saoluiz-encartes ~/.claude/skills/saoluiz-encartes
ln -s ~/Developer/claude-encartes-skills/superdopovo-encartes ~/.claude/skills/superdopovo-encartes
ln -s ~/Developer/claude-encartes-skills/todos-encartes ~/.claude/skills/todos-encartes
```

### Windows (junction)

```powershell
git clone https://github.com/mouraod/claude-encartes-skills.git C:\Users\<user>\git\claude-encartes-skills

mklink /J "%USERPROFILE%\.claude\skills\cometa-encartes" "C:\Users\<user>\git\claude-encartes-skills\cometa-encartes"
mklink /J "%USERPROFILE%\.claude\skills\saoluiz-encartes" "C:\Users\<user>\git\claude-encartes-skills\saoluiz-encartes"
mklink /J "%USERPROFILE%\.claude\skills\superdopovo-encartes" "C:\Users\<user>\git\claude-encartes-skills\superdopovo-encartes"
mklink /J "%USERPROFILE%\.claude\skills\todos-encartes" "C:\Users\<user>\git\claude-encartes-skills\todos-encartes"
```

`mklink /J` cria uma *junction* (não precisa de admin nem de Developer Mode, ao contrário de `/D`).

> **Atenção (Windows):** symlinks/junctions exigem esse passo extra em toda máquina nova — o `git clone` sozinho não resolve. E no Windows é fácil, sem querer, arrastar/copiar a pasta em vez de linkar: se isso acontecer, a skill "gruda" numa cópia estática que não sincroniza mais com o repo, e as mudanças feitas ali nunca voltam pro Git.

### Fluxo do dia a dia

```bash
git pull      # traz mudanças de outra máquina
git add -A && git commit -m "..." && git push   # publica mudanças feitas aqui
```

## Aviso

Esses scripts consultam endpoints públicos (API/CDN) dos respectivos sites para uso pessoal e não intensivo (baixar o encarte da semana). Não fazem scraping agressivo nem burlam autenticação. Use com bom senso quanto à frequência das requisições.

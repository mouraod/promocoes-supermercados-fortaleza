# Encartes e Ofertas de Supermercados de Fortaleza

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#pré-requisitos)
[![Plataforma](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](#pré-requisitos)

Baixe os encartes semanais dos supermercados de Fortaleza (Cometa, Mercadinhos São Luiz, Mercadão São Luiz e Super do Povo) em alta resolução, prontos pra consulta ou comparação de promoções. O repositório reúne [skills para o Claude Code](https://docs.claude.com/en/docs/claude-code/skills) em PT-BR, uma por rede, e cada uma consulta endpoints públicos (API/CDN) do respectivo site, com volume baixo, para uso pessoal.

Os nomes técnicos individuais (`cometa-encartes`, `saoluiz-encartes`, `mercadao-encartes` e `superdopovo-encartes`) permanecem estáveis para não quebrar instalações existentes. `todos-encartes` é a skill guarda-chuva que dispara as quatro de uma vez.

Os encartes chegam como JPG em ~200 DPI (rasterizados do PDF quando possível), organizados por rede e data, com um `manifest.json` por rodada. Um orquestrador dispara as quatro redes de uma vez, e um módulo compartilhado reaproveita por hardlink páginas já baixadas em rodadas anteriores, pra rodadas repetidas na mesma semana serem rápidas.

## Skills

| Skill | Rede | Como baixa | Dependências |
|---|---|---|---|
| [`cometa-encartes`](cometa-encartes/SKILL.md) | Cometa Supermercados | API pública (Strapi) + rasterização de PDF | poppler |
| [`saoluiz-encartes`](saoluiz-encartes/SKILL.md) | Mercadinhos São Luiz (loja 355) | Playwright headless interceptando a rota `/flipbooks`; baixa JPG do CDN | Playwright |
| [`mercadao-encartes`](mercadao-encartes/SKILL.md) | Mercadão São Luiz | Lê o HTML de mercadaosaoluiz.com.br (home e `/ofertas`) e baixa os JPGs originais do Wix | nenhuma |
| [`superdopovo-encartes`](superdopovo-encartes/SKILL.md) | Super do Povo | Playwright + rasterização de PDF (fallback para as imagens prontas do site) | poppler + Playwright |
| [`todos-encartes`](todos-encartes/SKILL.md) | As quatro acima | Dispara as quatro em sequência | todas acima |

`todos-encartes` é uma skill mãe de conveniência: não substitui as individuais, que continuam funcionando isoladas e são o que usar quando o pedido for de uma rede só. Cada pasta tem um `SKILL.md` com o passo a passo completo, opções de linha de comando e o comportamento esperado ao acionar.

## Pré-requisitos

- **Node.js 18 ou superior** (Playwright 1.60 exige; testado até Node 26).
- **Nenhuma dependência extra**, só o Mercadão: lê o HTML do site direto e baixa os JPGs do Wix.
- **poppler**, só Cometa e Super do Povo: fornece `pdfinfo` e `pdftoppm`.
  - macOS: `brew install poppler`
  - Windows: [poppler-windows](https://github.com/oschwartz10612/poppler-windows/releases) (ou `scoop install poppler`)
  - Linux: `sudo apt install poppler-utils`
- **Playwright**, só São Luiz e Super do Povo: instalado com `npm install` dentro da pasta da skill; o Chromium é baixado automaticamente na primeira vez.

## Uso rápido

```bash
git clone https://github.com/mouraod/claude-encartes-skills.git
cd claude-encartes-skills

# dependências das skills que usam Playwright (uma vez)
(cd saoluiz-encartes && npm install)
(cd superdopovo-encartes && npm install)

# as quatro redes de uma vez
node todos-encartes/baixar-todos.js
```

Saída em `~/Downloads/Encartes/<Rede>/DD-Mês/` (pasta `JPG/` + `manifest.json` por rodada). Para uma rede só:

```bash
node cometa-encartes/download-encartes.js      # poppler
node saoluiz-encartes/download-encartes.js     # Playwright
node mercadao-encartes/download-encartes.js    # sem dependências
node superdopovo-encartes/download-encartes.js # poppler + Playwright
```

## Como funciona

Cada script segue o mesmo molde: descobre os encartes vigentes, baixa cada página como JPG (rasterizando o PDF quando existe, em ~200 DPI), pula o que já existe (idempotente) e grava um `manifest.json` com rede, data e lista de encartes.

- **Cometa**: `GET /api/encartes` (Strapi) lista tudo; baixa o PDF e rasteriza com `pdftoppm -jpeg -r 200`.
- **São Luiz**: Playwright abre `mercadinhossaoluiz.com.br/loja/355/encartes`, intercepta a resposta de `/flipbooks` (já traz todas as `images_urls`) e baixa direto do CDN público.
- **Mercadão São Luiz**: lê o HTML de `mercadaosaoluiz.com.br/` e `/ofertas`, identifica imagens verticais de encarte nos `srcSet` e baixa o original público do Wix (sem navegador, sem dependências).
- **Super do Povo**: Playwright abre `loja.superdopovo.com.br/booklets`, intercepta `/api/v1/booklets/<shop_id>` (JWT de curta duração que só o JS do site obtém), filtra por vigência e rasteriza o PDF; só cai para as `sheets[]` quando o encarte não tem PDF.

## Reaproveitamento entre rodadas

Cada rodada grava numa pasta `<Rede>/DD-Mês/` nova. O [`lib/reuso.js`](lib/reuso.js), compartilhado pelas skills de Cometa, São Luiz e Super do Povo, procura páginas já baixadas em rodadas anteriores da mesma rede e as reaproveita via hardlink em vez de baixar e rasterizar de novo. Só reusa quando o `manifest.json` da rodada antiga confirma o número exato de páginas e todos os arquivos existem e não estão vazios, o que protege contra herdar um encarte truncado de uma rodada interrompida. Ativo por padrão; `--sem-reuso` desliga. (O Mercadão não reusa via hardlink: o downloader dele é idempotente por arquivo e pula páginas já baixadas.)

## Análise de promoções

Além do download, as skills suportam análise sob demanda. Ao perguntar "quais as melhores promoções da semana?", o agente lê os JPGs baixados e apresenta os destaques por categoria, ordenados do maior para o menor desconto, no formato **de R$ X por R$ Y (Z% off)** (nunca tachado). Os detalhes do formato obrigatório estão nos `SKILL.md` de [`saoluiz-encartes`](saoluiz-encartes/SKILL.md) e [`todos-encartes`](todos-encartes/SKILL.md).

## Estrutura do repositório

```
claude-encartes-skills/
├─ cometa-encartes/         # Cometa (poppler)
│  ├─ download-encartes.js
│  └─ SKILL.md
├─ saoluiz-encartes/        # São Luiz (Playwright)
│  ├─ download-encartes.js
│  ├─ package.json
│  └─ SKILL.md
├─ mercadao-encartes/       # Mercadão São Luiz (sem dependências)
│  ├─ download-encartes.js
│  ├─ download-encartes.test.js
│  └─ SKILL.md
├─ superdopovo-encartes/    # Super do Povo (Playwright + poppler)
│  ├─ download-encartes.js
│  ├─ package.json
│  └─ SKILL.md
├─ todos-encartes/          # skill mãe (orquestra as quatro)
│  ├─ baixar-todos.js
│  └─ SKILL.md
├─ lib/
│  └─ reuso.js              # reaproveitamento via hardlink (compartilhado)
├─ LICENSE
└─ README.md
```

## Instalação como skill do Claude Code

O Claude Code só reconhece skills que estão dentro de `~/.claude/skills/`. Este repo é a fonte de verdade; em cada máquina você aponta `~/.claude/skills/<nome>` para a pasta correspondente do clone local. Um `git pull` atualiza o conteúdo sem precisar copiar nada.

**macOS / Linux (symlink), a partir da raiz do clone:**

```bash
ln -s "$PWD/cometa-encartes"      ~/.claude/skills/cometa-encartes
ln -s "$PWD/saoluiz-encartes"     ~/.claude/skills/saoluiz-encartes
ln -s "$PWD/mercadao-encartes"    ~/.claude/skills/mercadao-encartes
ln -s "$PWD/superdopovo-encartes" ~/.claude/skills/superdopovo-encartes
ln -s "$PWD/todos-encartes"       ~/.claude/skills/todos-encartes
```

**Windows (junction, não precisa de admin):**

```powershell
mklink /J "%USERPROFILE%\.claude\skills\cometa-encartes"      "%CD%\cometa-encartes"
mklink /J "%USERPROFILE%\.claude\skills\saoluiz-encartes"     "%CD%\saoluiz-encartes"
mklink /J "%USERPROFILE%\.claude\skills\mercadao-encartes"    "%CD%\mercadao-encartes"
mklink /J "%USERPROFILE%\.claude\skills\superdopovo-encartes" "%CD%\superdopovo-encartes"
mklink /J "%USERPROFILE%\.claude\skills\todos-encartes"       "%CD%\todos-encartes"
```

> No Windows, `mklink /J` cria uma junction (não precisa de admin, ao contrário de `/D`). Evite arrastar ou copiar a pasta em vez de linkar: a skill "gruda" numa cópia estática que para de sincronizar com o repo, e mudanças feitas nela nunca voltam para o Git.

## Resolução de problemas

- **`pdfinfo` / `pdftoppm` não encontrados** (Cometa, Super do Povo): instale o poppler, em [Pré-requisitos](#pré-requisitos).
- **Playwright ausente** (São Luiz, Super do Povo): rode `npm install` dentro da pasta da skill; o Chromium é baixado na primeira vez.
- **Mercadão não baixa nada**: a home ou `/ofertas` pode ter mudado o HTML; rode com `--dry-run` para ver o que o script descobre antes de gravar arquivos.
- **Nenhuma imagem baixada**: o site pode ter mudado a estrutura do HTML/JSON, ou o encarte da semana ainda não foi publicado. O script mostra a mensagem exata; abra a URL no navegador para confirmar.

## Uso responsável

Estes scripts consultam endpoints públicos (API/CDN) dos respectivos sites para uso pessoal e não intensivo (baixar o encarte da semana). Não fazem scraping agressivo, não burlam autenticação e respeitam a estrutura pública de cada site. Use com bom senso quanto à frequência das requisições e não redistribua o conteúdo baixado de forma automatizada. O software é fornecido "como está", sem garantia.

## Licença

[MIT](LICENSE), (c) 2026 Davi Mourão. Sugestões e PRs são bem-vindos.

#!/usr/bin/env bash
# Exporta os arquivos versionados do repo privado (HEAD) para a pasta do repo publico.
# Nao copia .git, node_modules nem arquivos nao versionados (ex: package-lock local).
# O proprio helper (scripts/export-public.sh) fica fora da copia publica.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${1:-$HOME/Developer/encartes-skills}"

mkdir -p "$DST"
cd "$SRC"

git ls-files | grep -v '^scripts/export-public.sh$' | while IFS= read -r f; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
done

# Repo publico usa nome e URLs do repo publico
sed -i '' 's#claude-encartes-skills#encartes-skills#g' "$DST/README.md"

echo "Exportado para $DST"

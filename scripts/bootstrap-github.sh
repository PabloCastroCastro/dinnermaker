#!/usr/bin/env bash
# Bootstrap del repo en GitHub: crea el remoto (si no existe), sube el código,
# y crea labels / milestones / issues a partir de scripts/labels.tsv,
# scripts/milestones.json y backlog/issues.json.
#
# Idempotente: si algo ya existe (label, milestone, issue con el mismo
# título), se salta en lugar de duplicar.
#
# Uso:
#   bash scripts/bootstrap-github.sh [nombre-repo] [public|private]
#
# Requiere: gh (autenticado con `gh auth login`), node, git.
# (gh trae su propio motor jq para --jq; para leer scripts/milestones.json y
# backlog/issues.json usamos node en vez de depender de un jq externo.)

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="${1:-dinner-match}"
VISIBILITY="${2:-private}"

command -v gh >/dev/null 2>&1 || { echo "Falta gh CLI. https://cli.github.com"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Falta node."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh no está autenticado. Ejecuta: gh auth login"; exit 1; }

# Emite cada elemento de un array JSON como una línea de JSON compacto
# (equivalente a `jq -c '.[]'`).
json_rows() { node -e 'for (const x of require(require("path").resolve(process.argv[1]))) console.log(JSON.stringify(x));' "$1"; }
# Extrae un campo string de una fila JSON (equivalente a `jq -r '.campo'`).
json_field() { node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]] ?? "");' "$1" "$2"; }

# ---- 1. Repo remoto ----
if git remote get-url origin >/dev/null 2>&1; then
  echo "Remote 'origin' ya existe: $(git remote get-url origin)"
else
  echo "Creando repo en GitHub: $REPO_NAME ($VISIBILITY)…"
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
fi

CURRENT_BRANCH="$(git branch --show-current)"
git push -u origin "$CURRENT_BRANCH" 2>/dev/null || echo "(nada nuevo que subir)"

# ---- 1b. Rama develop ----
echo ""
if git rev-parse --verify develop >/dev/null 2>&1; then
  echo "Rama 'develop' ya existe localmente."
else
  echo "Creando rama 'develop' desde '$CURRENT_BRANCH'…"
  git branch develop "$CURRENT_BRANCH"
fi
git push -u origin develop 2>/dev/null || echo "(develop ya está en el remoto)"

# ---- 2. Labels ----
echo ""
echo "Creando labels…"
while IFS=$'\t' read -r name color desc; do
  [ -z "$name" ] && continue
  if gh label create "$name" --color "$color" --description "$desc" 2>/dev/null; then
    echo "  + $name"
  else
    gh label edit "$name" --color "$color" --description "$desc" >/dev/null 2>&1 \
      && echo "  = $name (actualizado)" \
      || echo "  ! $name (no se pudo crear ni editar)"
  fi
done < scripts/labels.tsv

# ---- 3. Milestones ----
echo ""
echo "Creando milestones…"
json_rows scripts/milestones.json | while IFS= read -r row; do
  title=$(json_field "$row" title)
  desc=$(json_field "$row" description)
  exists=$(gh api repos/:owner/:repo/milestones -f state=all --jq \
    ".[] | select(.title==\"$title\") | .title" 2>/dev/null || true)
  if [ -z "$exists" ]; then
    gh api repos/:owner/:repo/milestones -f title="$title" -f description="$desc" >/dev/null
    echo "  + $title"
  else
    echo "  = $title (ya existe)"
  fi
done

# ---- 4. Issues ----
echo ""
echo "Creando issues…"
json_rows backlog/issues.json | while IFS= read -r row; do
  title=$(json_field "$row" title)
  body=$(json_field "$row" body)
  labels=$(node -e 'console.log(JSON.parse(process.argv[1]).labels.join(","));' "$row")
  milestone=$(json_field "$row" milestone)

  existing=$(gh issue list --search "\"$title\" in:title" --state all --json title \
    --jq ".[] | select(.title==\"$title\") | .title" 2>/dev/null || true)
  if [ -n "$existing" ]; then
    echo "  = $title (ya existe)"
    continue
  fi
  gh issue create --title "$title" --body "$body" --label "$labels" --milestone "$milestone" >/dev/null
  echo "  + $title"
done

echo ""
echo "Listo. Repo: $(gh repo view --json url --jq .url 2>/dev/null || echo '(revisa git remote -v)')"

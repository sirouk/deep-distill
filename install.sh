#!/usr/bin/env bash
# deep-distill installer — installs the skill into Claude Code, Codex, and/or Hermes.
#
# SKILL.md is a cross-agent standard, so the same skill works in all three; only the
# install directory differs. This script copies the files from a local clone if present,
# otherwise fetches them from raw GitHub URLs (so `curl ... | bash` works with no clone).
#
# Usage:
#   ./install.sh [claude|codex|hermes|all]        # default: all
#   bash install.sh codex
#   curl -fsSL https://raw.githubusercontent.com/sirouk/deep-distill/main/install.sh | bash -s -- claude
#
# Env overrides: DEEP_DISTILL_REPO (default sirouk/deep-distill), DEEP_DISTILL_BRANCH (default main).
set -euo pipefail

REPO="${DEEP_DISTILL_REPO:-sirouk/deep-distill}"
BRANCH="${DEEP_DISTILL_BRANCH:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
FILES=(SKILL.md scripts/stage_document.py scripts/assemble.py references/workflow-template.js references/techniques.md)

claude_dir="$HOME/.claude/skills/deep-distill"
codex_dir="$HOME/.codex/skills/deep-distill"
hermes_dir="$HOME/.hermes/skills/deep-distill"

case "${1:-all}" in
  all)    targets="claude codex hermes" ;;
  claude) targets="claude" ;;
  codex)  targets="codex" ;;
  hermes) targets="hermes" ;;
  *) echo "usage: install.sh [claude|codex|hermes|all]"; exit 1 ;;
esac

have_local() { [ -f "SKILL.md" ] && [ -f "scripts/stage_document.py" ]; }

install_one() {
  dest="$1"
  mkdir -p "$dest/scripts" "$dest/references"
  for f in "${FILES[@]}"; do
    if have_local; then
      cp "$f" "$dest/$f"
    else
      curl -fsSL "$BASE/$f" -o "$dest/$f"
    fi
  done
  echo "✓ installed deep-distill -> $dest"
}

for t in $targets; do
  case "$t" in
    claude) install_one "$claude_dir" ;;
    codex)  install_one "$codex_dir" ;;
    hermes) install_one "$hermes_dir" ;;
  esac
done

echo
echo "Done. Restart the agent so it picks up the skill, then ask e.g.:"
echo "  \"deep-distill this PDF in my Downloads\""
for t in $targets; do
  case "$t" in
    claude) echo "  • Claude Code: start a fresh session, then /skills to confirm it loaded." ;;
    codex)  echo "  • Codex: skills may be gated — run 'codex --enable skills' once, then restart." ;;
    hermes) echo "  • Hermes: auto-discovered from ~/.hermes/skills on startup — just restart." ;;
  esac
done

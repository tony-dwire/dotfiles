#!/usr/bin/env bash
# Link dotfiles into the home folders. Safe to run any number of times.
#
# Usage:
#   ./setup.sh            link everything
#   ./setup.sh --dry-run  show what would happen, change nothing
#
# Plain apps link as one directory into ~/.config.
# The pi package is different: it uses GNU stow into $HOME,
# because ~/.pi/agent mixes config with local state.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

run() { if [ "$DRY" = 1 ]; then echo "dry-run: $*"; else "$@"; fi }

# Top-level entries we do not link: the repo's own files, and packages
# handled another way (pi uses stow; systemd units are copied by hand).
# The dot- variant holds the stow tree for pi; do not link it either.
SKIP="pi .pi systemd README.md setup.sh"

link_top_level() {
  local name="$1"
  local link="$HOME/.config/$name"
  local want
  want="$(realpath -m --relative-to="$HOME/.config" "$REPO/$name")"

  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$want" ]; then
      echo "ok      $name"
    else
      echo "CONFLICT $name: link points to $(readlink "$link"), fix by hand"
    fi
  elif [ -e "$link" ]; then
    echo "CONFLICT $name: real file or directory exists, not touching it"
  else
    echo "link    $name"
    run mkdir -p "$(dirname "$link")"
    run ln -s "$want" "$link"
  fi
}

mkdir -p "$HOME/.config"

for entry in "$REPO"/* "$REPO"/.[!.]*; do
  name="$(basename "$entry")"
  case "$name" in .git|.gitignore|.gitmodules) continue ;; esac
  case " $SKIP " in *" $name "*) continue ;; esac
  link_top_level "$name"
done

echo
echo "stow: pi -> $HOME"
if [ "$DRY" = 1 ]; then
  stow --dir="$REPO" --target="$HOME" --simulate --restow pi
else
  stow --dir="$REPO" --target="$HOME" --restow pi
fi

echo
echo "submodules"
run git -C "$REPO" submodule update --init --recursive

echo
echo "done"

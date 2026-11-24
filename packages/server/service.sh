#!/bin/sh
# Avvio del servizio su Linux e macOS (estensione Neutralino, `sh server/service.sh --desktop`).
# Un'app aperta dal desktop (Finder, menu delle applicazioni) non ha il PATH della shell
# dell'utente, dove di solito stanno node, git e claude (nvm, Homebrew, ~/.local/bin):
# se manca qualcosa lo si prende da una shell di login. stdin resta quello di Neutralino.
here=$(dirname "$0")

missing() {
  for c in node git claude; do command -v "$c" >/dev/null 2>&1 || return 0; done
  return 1
}

if missing; then
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d" ;; esac
  done
  if missing && [ -n "${SHELL:-}" ]; then
    p=$("$SHELL" -lic 'printf "\n__JEKO_PATH__%s\n" "$PATH"' </dev/null 2>/dev/null |
      sed -n 's/^__JEKO_PATH__//p' | tail -n 1)
    [ -n "$p" ] && PATH="$p:$PATH"
  fi
  export PATH
fi

exec node "$here/jeko.js" "$@"

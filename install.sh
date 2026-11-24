#!/bin/sh
# Installa o aggiorna Jeko su Linux e macOS dall'ultima release GitHub:
#
#   curl -fsSL https://github.com/leolmi/jeko/releases/latest/download/install.sh | sh
#
# Variabili facoltative:
#   JEKO_VERSION  versione da installare (es. 0.3.0); predefinita l'ultima
#   JEKO_DIR      cartella dell'app; predefinita <dati dell'utente>/jeko/app
#   JEKO_FROM     cartella con manifest.json e pacchetti (release/), al posto di GitHub
#
# Dopo la prima installazione l'app si aggiorna da sola (Opzioni → Versione e aggiornamenti).
# macOS è provvisorio: non è mai stato provato su un Mac vero.
set -eu

REPO="${JEKO_REPO:-leolmi/jeko}"
say() { printf '%s\n' "$*"; }
warn() { printf 'attenzione: %s\n' "$*" >&2; }
fail() {
  printf 'jeko: %s\n' "$*" >&2
  exit 1
}

# ---------- sistema ----------

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux)
    case "$arch" in
      x86_64 | amd64) key=linux-x64 ;;
      aarch64 | arm64) key=linux-arm64 ;;
      *) fail "architettura non supportata: $arch" ;;
    esac
    data="${XDG_DATA_HOME:-$HOME/.local/share}/jeko"
    ;;
  Darwin)
    key=mac-universal
    data="$HOME/Library/Application Support/jeko"
    ;;
  *) fail "sistema non supportato: $os (su Windows si usa lo zip della release)" ;;
esac
dir="${JEKO_DIR:-$data/app}"

# ---------- prerequisiti ----------

command -v curl >/dev/null 2>&1 || fail "manca curl"
command -v tar >/dev/null 2>&1 || fail "manca tar"
command -v node >/dev/null 2>&1 || fail "manca Node.js: serve la 22 o successiva (https://nodejs.org)"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "serve Node.js 22 o successivo, c'è il $(node -v)"
command -v git >/dev/null 2>&1 || warn "manca git, che Jeko usa nei progetti"
command -v claude >/dev/null 2>&1 || warn "claude (Claude Code) non è nel PATH"
if [ "$os" = Linux ]; then
  ldconfig=$(command -v ldconfig || echo /sbin/ldconfig)
  if [ -x "$ldconfig" ] && ! "$ldconfig" -p 2>/dev/null | grep -q libwebkit2gtk-4; then
    warn "manca WebKitGTK (es. libwebkit2gtk-4.1-0), che serve alla finestra"
  fi
  command -v zenity >/dev/null 2>&1 || command -v kdialog >/dev/null 2>&1 ||
    warn "senza zenity o kdialog il pulsante per scegliere una cartella non funziona"
fi

# ---------- download ----------

if [ -n "${JEKO_FROM:-}" ]; then
  base="$JEKO_FROM"
elif [ -n "${JEKO_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${JEKO_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi
# Con JEKO_FROM i file si copiano dalla cartella (es. release/ di `npm run package`).
get() {
  if [ -n "${JEKO_FROM:-}" ]; then cp "$JEKO_FROM/$1" "$2"; else curl -fL $3 "$base/$1" -o "$2"; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
get manifest.json "$tmp/manifest.json" -sS || fail "release non trovata ($base)"

info=$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const p = (m.packages || {})[process.argv[2]];
  if (!p) process.exit(3);
  console.log(`${m.version} ${p.name} ${p.sha256}`);
' "$tmp/manifest.json" "$key") || fail "la release non ha un pacchetto per $key"
set -- $info
version=$1
name=$2
sha=$3

say "scarico Jeko $version ($key)"
get "$name" "$tmp/$name" --progress-bar || fail "download non riuscito"
got=$(node -e '
  const c = require("crypto"), fs = require("fs");
  console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$tmp/$name")
[ "$got" = "$sha" ] || fail "pacchetto rovinato (SHA-256)"

mkdir -p "$tmp/files"
tar -xzf "$tmp/$name" -C "$tmp/files"
[ -f "$tmp/files/jeko" ] && [ -f "$tmp/files/server/jeko.js" ] || fail "pacchetto incompleto"

# ---------- installazione ----------

if curl -fs --max-time 2 http://127.0.0.1:4310/api/health 2>/dev/null | grep -q '"jeko"'; then
  warn "Jeko è acceso: la nuova versione parte dal prossimo avvio (chiudi l'app e il servizio)"
fi

mkdir -p "$dir"
for e in jeko resources.neu server icon.png; do
  rm -rf "$dir/$e" "$dir/$e.old"
  cp -R "$tmp/files/$e" "$dir/$e"
done
chmod 755 "$dir/jeko"

if [ "$os" = Linux ]; then
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat >"$apps/jeko.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jeko
Comment=Tool di SDLC locale e personale
Exec="$dir/jeko"
Path=$dir
Icon=$dir/icon.png
Terminal=false
Categories=Development;
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps" 2>/dev/null || true
  say "Jeko $version installato in $dir"
  say "si apre dal menu delle applicazioni, o con: \"$dir/jeko\""
else
  # Provvisorio: un .app che lancia l'eseguibile della cartella (che si aggiorna da solo).
  # Senza firma Apple: si toglie la quarantena e, se serve, si firma ad-hoc.
  xattr -dr com.apple.quarantine "$dir" 2>/dev/null || true
  codesign -v "$dir/jeko" 2>/dev/null || codesign --force --sign - "$dir/jeko" 2>/dev/null || true
  bundle="$HOME/Applications/Jeko.app"
  rm -rf "$bundle"
  mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
  cat >"$bundle/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Jeko</string>
  <key>CFBundleIdentifier</key><string>it.leolmi.jeko</string>
  <key>CFBundleExecutable</key><string>Jeko</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
</dict>
</plist>
EOF
  launcher="$bundle/Contents/MacOS/Jeko"
  printf '#!/bin/sh\ncd "%s" && exec ./jeko\n' "$dir" >"$launcher"
  chmod 755 "$launcher"
  say "Jeko $version installato in $dir"
  say "si apre da $bundle, o con: \"$dir/jeko\""
fi
say "dati e registro: $data"

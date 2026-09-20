#!/bin/sh
# Build the Wails v3 shell for Linux (GTK3).
#
# Uses the local GTK/WebKit prefix extracted to ~/.local/wails-root because
# system -dev packages cannot be installed without root. See docs in
# internal/ for details. Requires: gcc, go >= 1.24.
set -e
cd "$(dirname "$0")"

WAILS_ROOT="$HOME/.local/wails-root"

export PATH="$HOME/.local/bin:$PATH"
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig"
export CGO_CFLAGS="-I$WAILS_ROOT/usr/include/harfbuzz"
export CGO_LDFLAGS="-Wl,--rpath-link,$WAILS_ROOT/usr/lib/x86_64-linux-gnu"
export CGO_LDFLAGS_ALLOW="-Wl,--rpath-link.*"

OUT="${1:-bin/freshrss-reader}"
mkdir -p "$(dirname "$OUT")"

# 1. Build the renderer bundle (webpack).
npm run build

# 2. Build the Go binary embedding dist/.
go build -tags gtk3 -o "$OUT" .
echo "Built $OUT"

# To run: LD_LIBRARY_PATH="$HOME/.local/wails-root/usr/lib/x86_64-linux-gnu" "$OUT"

#!/bin/sh
# Build the Wails v3 shell for Linux (GTK3) and Windows (WebView2),
# both into bin/.
#
# The Linux build uses the local GTK/WebKit prefix extracted to
# ~/.local/wails-root because system -dev packages cannot be installed
# without root. See docs in internal/ for details. Requires: gcc,
# go >= 1.24. The Windows build is cgo-free (WebView2 backend) and is
# cross-compiled with CGO_ENABLED=0.
set -e
cd "$(dirname "$0")"

WAILS_ROOT="$HOME/.local/wails-root"

export PATH="$HOME/.local/bin:$PATH"
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig"
export CGO_CFLAGS="-I$WAILS_ROOT/usr/include/harfbuzz"
export CGO_LDFLAGS="-Wl,--rpath-link,$WAILS_ROOT/usr/lib/x86_64-linux-gnu"
export CGO_LDFLAGS_ALLOW="-Wl,--rpath-link.*"

mkdir -p bin

# 1. Build the renderer bundle (webpack), embedded into both binaries.
npm run build

# 2. Build the Linux binary embedding dist/.
go build -tags gtk3 -o bin/freshrss-reader .
echo "Built bin/freshrss-reader"

# 3. Cross-compile the Windows binary (no gtk3 tag: Wails uses the
# native WebView2 backend). -H windowsgui avoids a console window.
# The application icon and version info come from rsrc_windows_amd64.syso
# in the repo root, which the Go linker picks up automatically. Regenerate
# it after changing the icon or version with:
#   go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64 \
#       --manifest gui --icon build/icon.ico --product-name "FreshRSS Reader" \
#       --product-version 1.0.0.0 --file-version 1.0.0.0 \
#       --file-description "FreshRSS desktop RSS client" \
#       --original-filename FreshRSS-Reader.exe --out rsrc
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w -H windowsgui" \
    -o bin/FreshRSS-Reader.exe .
echo "Built bin/FreshRSS-Reader.exe"

# To run (Linux): LD_LIBRARY_PATH="$HOME/.local/wails-root/usr/lib/x86_64-linux-gnu" bin/freshrss-reader

#!/bin/sh
# Run the Wails v3 shell on Linux without root.
#
# The GTK3/WebKit runtime libraries live in ~/.local/wails-root (extracted
# from .deb packages, see build.sh). WebKit also needs its helper processes
# (WebKitNetworkProcess etc.) under the compiled-in path
# /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1, so inside a user namespace we
# build a tmpfs overlay (system libs via a second bind of the original dir,
# extracted libs win) and bind-mount it over /usr/lib/x86_64-linux-gnu.
set -e
cd "$(dirname "$0")"

WAILS_ROOT="$HOME/.local/wails-root"
APP="${1:-bin/freshrss-reader}"
shift 2>/dev/null || true

exec unshare -rm sh -c '
set -e
WAILS_ROOT="$1"; APP="$2"; shift 2
mkdir -p /tmp/wl-orig /tmp/wl-ovl
mount --bind /usr/lib/x86_64-linux-gnu /tmp/wl-orig
mount -t tmpfs none /tmp/wl-ovl
# Overlay entries: system libs via the original bind view, extracted libs win.
for f in /tmp/wl-orig/*; do
    ln -s "$f" "/tmp/wl-ovl/$(basename "$f")"
done
for f in "$WAILS_ROOT"/usr/lib/x86_64-linux-gnu/*; do
    ln -sfn "$f" "/tmp/wl-ovl/$(basename "$f")"
done
mount --bind /tmp/wl-ovl /usr/lib/x86_64-linux-gnu
export WEBKIT_INJECTED_BUNDLE_PATH="$WAILS_ROOT/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/"
exec "$APP" "$@"
' overlay "$WAILS_ROOT" "$APP" "$@"

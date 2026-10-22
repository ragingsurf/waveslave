#!/bin/sh
# Build the GitHub Pages site: run refresh.sh, then wrap the page with the phone install bits (manifest, icons, offline cache).
# Usage: sh build-site.sh <outdir>   -> writes <outdir>/index.html and the files in web/
set -e
HERE=$(cd "$(dirname "$0")" && pwd); OUT=${1:-_site}; W=${RUNNER_TEMP:-/tmp}/surf
sh "$HERE/refresh.sh" "$W"
mkdir -p "$OUT"
# The page asks for chat.js by an address that changes with it (chat.js?v=<its checksum>): GitHub Pages lets a browser keep both files 10
# minutes, and a reload fetches the page again but takes its scripts from that cache, so a new page could otherwise run the chat.js before it.
V=$(cksum < "$HERE/web/chat.js" | cut -d' ' -f1)
sed "s|src=\"chat.js\"|src=\"chat.js?v=$V\"|" "$HERE/web/head.html" "$W/taitung-surf.html" > "$OUT/index.html"
cp "$HERE/web/manifest.webmanifest" "$HERE/web/sw.js" "$HERE/web/chat.js" "$HERE"/web/*.png "$OUT/"
touch "$OUT/.nojekyll"
echo "site ready in $OUT"

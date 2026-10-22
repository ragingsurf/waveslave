#!/bin/sh
# Build the GitHub Pages site: run refresh.sh, then wrap the page with the phone install bits (manifest, icons, offline cache).
# Usage: sh build-site.sh <outdir>   -> writes <outdir>/index.html and the files in web/
set -e
HERE=$(cd "$(dirname "$0")" && pwd); OUT=${1:-_site}; W=${RUNNER_TEMP:-/tmp}/surf
sh "$HERE/refresh.sh" "$W"
mkdir -p "$OUT"
cat "$HERE/web/head.html" "$W/taitung-surf.html" > "$OUT/index.html"
cp "$HERE/web/manifest.webmanifest" "$HERE/web/sw.js" "$HERE/web/chat.js" "$HERE"/web/*.png "$OUT/"
touch "$OUT/.nojekyll"
echo "site ready in $OUT"

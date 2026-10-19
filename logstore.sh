#!/bin/sh
# Keep the forecast-vs-buoy log (log/) for good on the "data" branch, alongside the Actions cache that carries it run to run.
#   sh logstore.sh restore [dir] : fetch any of the last 30 days the cache lost or holds differently (a cache miss would start from empty)
#   sh logstore.sh save [dir]    : add each finished day (Taipei date, so not today's file, which still grows) the branch lacks,
#                            then drop cached files older than 40 days; the branch keeps everything
# dir is the log folder, log (Taiwan) by default; log-jp holds Japan's, under the same name on the branch.
# The branch is fetched without old file contents (only the files restore asks for are downloaded), so it stays quick as it grows.
set -e
cd "$(dirname "$0")"; L=${2:-log}; mkdir -p "$L"
TODAY=$(TZ=Asia/Taipei date +%Y-%m-%d)
git fetch -q --depth=1 --filter=blob:none origin +refs/heads/data:refs/remotes/origin/data 2>/dev/null && P=origin/data || P=
case "$1" in
restore)
  # seed-log/ holds days logged before this existed (by the project's own hourly job); they go in once, ahead of the cache's copies.
  [ "$L" = log ] && for f in seed-log/20*; do
    [ -f "$f" ] && { [ -z "$P" ] || [ -z "$(git ls-tree --name-only "$P" "$L/$(basename "$f")")" ]; } && cp "$f" "$L"/
  done
  [ -n "$P" ] || { echo "no data branch yet"; exit 0; }
  # Finished days come from the branch, the saved copy, whenever the cache lacks them or holds a different one.
  FROM=$(TZ=Asia/Taipei date -d '-30 days' +%Y-%m-%d); n=0
  for f in $(git ls-tree --name-only "$P" "$L"/); do
    d=$(basename "$f" | cut -c1-10)
    [ "$(printf '%s\n%s\n' "$FROM" "$d" | sort | head -1)" = "$FROM" ] || continue  # older than 30 days
    [ -f "$f" ] && [ "$(git hash-object "$f")" = "$(git rev-parse "$P:$f")" ] && continue
    git show "$P:$f" > "$f.tmp" && mv "$f.tmp" "$f" && n=$((n+1))
  done
  echo "restored $n log files from the data branch" ;;
save)
  export GIT_INDEX_FILE="${RUNNER_TEMP:-/tmp}/logstore.index"; rm -f "$GIT_INDEX_FILE"
  if [ -n "$P" ]; then git read-tree "$P"; else git read-tree --empty; fi
  n=0
  for f in "$L"/20*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in "$TODAY"*|*.tmp) continue ;; esac
    git ls-files --error-unmatch "$f" >/dev/null 2>&1 && continue
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$f"; n=$((n+1))
  done
  if [ "$n" -gt 0 ]; then
    T=$(git write-tree --missing-ok)
    C=$(git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      commit-tree "$T" ${P:+-p "$P"} -m "Forecast-vs-buoy log ($L): $n finished day file(s)")
    git push -q origin "$C:refs/heads/data"
  fi
  for f in $(find "$L" -name '20*' -mtime +40); do git ls-files --error-unmatch "$f" >/dev/null 2>&1 && rm -f "$f"; done
  rm -f "$GIT_INDEX_FILE"
  echo "saved $n log files to the data branch" ;;
*) echo "usage: sh logstore.sh restore|save" >&2; exit 1 ;;
esac

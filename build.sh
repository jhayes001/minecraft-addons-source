#!/usr/bin/env bash
# Packages each add-on (behavior pack + resource pack) into dist/<Name>_v<version>.mcaddon
# Usage: ./build.sh            builds all add-ons
#        ./build.sh MazeWand   builds just one
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for bp in addons/*_BP; do names+=("$(basename "$bp" _BP)"); done
fi

for name in "${names[@]}"; do
  bp="addons/${name}_BP"; rp="addons/${name}_RP"
  [ -d "$bp" ] && [ -d "$rp" ] || { echo "No add-on called $name"; exit 1; }
  version=$(python3 -c "import json,sys;print('.'.join(map(str,json.load(open(sys.argv[1]))['header']['version'])))" "$bp/manifest.json")
  out="dist/${name}_v${version}.mcaddon"
  rm -f "$out"
  (cd addons && zip -qr "../$out" "${name}_BP" "${name}_RP")
  echo "Built $out"
done

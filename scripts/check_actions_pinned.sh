#!/usr/bin/env bash
#
# Every GitHub Action this repository runs is pinned to a full commit SHA, never a tag or a branch.
#
# A release job here can mint an OIDC token that npm accepts for a public package, and a tag is a
# pointer its owner can move. So a `uses:` line passes only when its ref is 40 hexadecimal
# characters. Local actions (`./…`) and container images (`docker://…`) are refused rather than
# ranked: nothing here uses either, and a shape this check does not read is not one it may pass.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shopt -s nullglob
files=("$root"/.github/workflows/*.yml "$root"/.github/workflows/*.yaml)
[ "${#files[@]}" -gt 0 ] || { echo "✗ no workflow files found under .github/workflows"; exit 1; }

bad=0
count=0
for f in "${files[@]}"; do
  while IFS= read -r line; do
    n="${line%%:*}"
    ref="$(printf '%s' "${line#*:}" | sed -E 's/^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*//; s/[[:space:]]+#.*$//; s/^["'\'']//; s/["'\'']$//')"
    count=$((count + 1))
    if [[ ! "$ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$ ]]; then
      echo "✗ ${f#"$root"/}:$n uses \`$ref\`, which is not pinned to a full commit SHA"
      bad=1
    fi
  done < <(grep -nE '^[[:space:]]*-?[[:space:]]*uses:' "$f" || true)
done
[ "$count" -gt 0 ] || { echo "✗ no uses: lines were read, so nothing was checked"; exit 1; }
[ "$bad" -eq 0 ] || exit 1
echo "✓ all $count actions in ${#files[@]} workflow file(s) are pinned to a full commit SHA"

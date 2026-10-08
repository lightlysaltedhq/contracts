#!/usr/bin/env bash
#
# Every GitHub Action this repository runs is pinned to a full commit SHA, never a tag or a branch.
#
# A release job here can mint an OIDC token that npm accepts for a public package, and a tag is a
# pointer its owner can move. So a `uses` value passes only when its ref is 40 hexadecimal
# characters. Local actions (`./…`) and container images (`docker://…`) are refused rather than
# ranked: nothing here uses either, and a shape this check does not read is not one it may pass.
#
# The key is matched however YAML lets it be written (block or flow mapping, quoted or not, space
# before the colon), in workflows and in composite actions under .github/actions. A `uses:` inside
# a `run:` block is read too and fails closed, which is the safe direction.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
files=()
while IFS= read -r f; do files+=("$f"); done < <(
  find "$root/.github/workflows" "$root/.github/actions" -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | sort)
[ "${#files[@]}" -gt 0 ] || { echo "✗ no workflow files found under .github/workflows"; exit 1; }

# A `uses` key: at a line start (after an optional list dash), or after `{` or `,` in a flow
# mapping; optionally quoted; any spaces before the colon.
key='(^|[{,])[[:space:]]*(-[[:space:]]+)?["'\'']?uses["'\'']?[[:space:]]*:'

bad=0
count=0
for f in "${files[@]}"; do
  while IFS= read -r line; do
    n="${line%%:*}"
    body="${line#*:}"
    # Every `uses` value on the line (a flow mapping can hold more than one).
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      count=$((count + 1))
      if [[ ! "$ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$ ]]; then
        echo "✗ ${f#"$root"/}:$n uses \`$ref\`, which is not pinned to a full commit SHA"
        bad=1
      fi
    done < <(printf '%s\n' "$body" | sed -E 's/[[:space:]]+#.*$//' | grep -oE "${key}[[:space:]]*[^,}[:space:]]+" \
               | sed -E "s/^.*uses[\"']?[[:space:]]*:[[:space:]]*//; s/^[\"']//; s/[\"']\$//")
  done < <(grep -nE "$key" "$f" || true)
done
[ "$count" -gt 0 ] || { echo "✗ no uses: values were read, so nothing was checked"; exit 1; }
[ "$bad" -eq 0 ] || exit 1
echo "✓ all $count actions in ${#files[@]} workflow file(s) are pinned to a full commit SHA"

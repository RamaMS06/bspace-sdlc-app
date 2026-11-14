#!/usr/bin/env bash
# Mechanical gate for vue-slice-screen steps 14 and 19.
#
#   validate-slice.sh <specs/NNN-screen-name/plan.md> <generated-vue-dir> [repo-root]
#   validate-slice.sh --self-test
#
# Exit 0 = every mechanical check passed. Non-zero = at least one gate failed; the
# output names each one. A gate whose only evidence is an agent's claim is not passed
# (subagent-driven-development rule 5) — this script is that evidence.
#
# It checks only what is mechanically checkable. Text fidelity, component/prop
# correctness, and the visual comparison still need the human gate (step 15) and the
# render check (step 19).
set -uo pipefail

fail=0
note() { printf 'FAIL  %s\n' "$*"; fail=1; }
ok()   { printf 'ok    %s\n' "$*"; }

# cells <file> <section-name> <column-number> -> that column's value for each data row
cells() {
  awk -v sec="$2" -v col="$3" '
    /^## /       { inside = ($0 == "## " sec); sep = 0; next }
    !inside      { next }
    /^\| *-+/    { sep = 1; next }
    sep && /^\|/ {
      n = split($0, c, "|")
      if (n <= col) next
      v = c[col + 1]
      gsub(/^[ \t]+|[ \t]+$/, "", v)
      first = c[2]; gsub(/^[ \t]+|[ \t]+$/, "", first)
      if (first != "") print v
    }' "$1"
}

validate() {
  local plan="$1" vuedir="$2" root="${3:-.}"
  fail=0
  [ -f "$plan" ] || { note "plan not found: $plan"; return "$fail"; }

  # --- 1. Coverage covers the Inventory exactly (step 14) --------------------
  local inv cov missing
  inv=$(cells "$plan" Inventory 1 | sort -u)
  cov=$(cells "$plan" Coverage 1 | sort -u)
  if [ -z "$inv" ]; then
    note "Inventory table is empty — step 9/10 did not run"
  else
    missing=$(comm -23 <(printf '%s\n' "$inv") <(printf '%s\n' "$cov"))
    if [ -n "$missing" ]; then
      note "Inventory nodes with no Coverage row:"; printf '        %s\n' $missing
    else
      ok "Coverage covers all $(printf '%s\n' "$inv" | wc -l | tr -d ' ') Inventory nodes"
    fi
  fi
  # every Coverage row states a resolution
  if cells "$plan" Coverage 2 | grep -qx ''; then
    note "Coverage has a row with an empty Resolution cell"
  fi

  # every Coverage row has Color/Typography filled — blank means "not resolved yet",
  # only the literal "n/a" means "not a visible text node" (SKILL.md step 11)
  local missing_tok=0
  while IFS='|' read -r id color typo; do
    [ -n "${id:-}" ] || continue
    if [ -z "${color:-}" ] || [ -z "${typo:-}" ]; then
      note "$id: Coverage row has a blank Color or Typography cell (use 'n/a' if this node has no visible text)"
      missing_tok=$((missing_tok + 1))
    fi
    if printf '%s %s' "${color:-}" "${typo:-}" | grep -qE '#[0-9a-fA-F]{3,8}|[0-9]+px'; then
      note "$id: Coverage row records a raw hex/px value — record the token name instead"
      missing_tok=$((missing_tok + 1))
    fi
  done < <(paste -d'|' \
      <(cells "$plan" Coverage 1) \
      <(cells "$plan" Coverage 3) \
      <(cells "$plan" Coverage 4))
  [ "$missing_tok" -eq 0 ] && [ -n "$inv" ] && ok "every Coverage row has Color and Typography resolved or marked n/a"

  # --- 2. Asset rows point at something that exists -------------------------
  local n=0
  while IFS='|' read -r id res folder; do
    [ -n "${id:-}" ] || continue
    case "$res" in
      exported|reused)
        n=$((n + 1))
        if [ -z "$folder" ]; then
          note "$id: resolution '$res' with an empty Folder cell"
        elif [ ! -e "$root/$folder" ] && [ ! -e "$folder" ]; then
          note "$id: Folder '$folder' does not exist on disk"
        fi
        ;;
    esac
  done < <(paste -d'|' \
      <(cells "$plan" "Asset decisions" 1) \
      <(cells "$plan" "Asset decisions" 3) \
      <(cells "$plan" "Asset decisions" 5))
  [ "$n" -gt 0 ] && ok "$n exported/reused asset path(s) exist on disk"

  # --- 3. Required evidence boxes are filled (steps 15, 19) -----------------
  grep -q 'verbatim answer.*: *""' "$plan" \
    && note "step 15 gate: developer's verbatim answer box is empty"
  grep -q 'evidence (required[^)]*): *``' "$plan" \
    && note "step 19 gate: render/dev-server evidence box is empty"

  # --- 4. Scans over the generated .vue files -------------------------------
  [ -d "$vuedir" ] || { note "generated-vue-dir not found: $vuedir"; return "$fail"; }
  local vues
  vues=$(find "$vuedir" -name '*.vue' -type f)
  [ -n "$vues" ] || { note "no .vue files under $vuedir"; return "$fail"; }

  # files promised by plan.md exist once output is generated (output-contract.md)
  local declared n_decl=0 n_missing=0
  declared=$(awk '
    /^## Files to create/ { inside = 1; next }
    /^## / { inside = 0 }
    inside && /^- `/ {
      path = $0
      sub(/^- `/, "", path)
      sub(/`.*/, "", path)
      print path
    }' "$plan")
  if [ -n "$declared" ]; then
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      n_decl=$((n_decl + 1))
      if [ ! -e "$root/$path" ] && [ ! -e "$path" ]; then
        note "Files to create: '$path' is listed in plan.md but does not exist on disk"
        n_missing=$((n_missing + 1))
      fi
    done <<< "$declared"
    [ "$n_missing" -eq 0 ] && ok "all $n_decl file(s) listed under Files to create exist on disk"
  fi

  # placeholder copy (output-contract.md "Never ship a placeholder-shaped string")
  if grep -nE '>[[:space:]]*(Label|Title|Text|Detail|—)[[:space:]]*<|(Tab|Item)[[:space:]]+[0-9]|[Ll]orem' $vues; then
    note "placeholder-shaped copy above — remove, or record the developer's confirmation in $plan"
  else
    ok "no placeholder-shaped copy"
  fi

  # negative margins (output-contract.md "Never use a negative margin")
  if grep -nE 'margin[a-z-]*:[[:space:]]*(-|calc\([[:space:]]*-)' $vues; then
    note "negative margin above — fix the parent's gap/padding, unless a Coverage row records a real Figma overlap"
  else
    ok "no negative margins"
  fi

  # a11y: every <img> carries alt (alt="" is a valid decorative declaration)
  if grep -nE '<img(\s[^>]*)?>' $vues | grep -vE '\salt=' ; then
    note "<img> without alt above — alt from the Figma layer name, or alt=\"\" if decorative"
  else
    ok "every <img> declares alt"
  fi

  # a11y: icon-only control needs an accessible name
  if grep -nE '<(button|BButton)[^>]*(icon-only|iconOnly)' $vues | grep -vE 'aria-label|:aria-label|aria-labelledby'; then
    note "icon-only control without aria-label above"
  fi

  # raw literals that should be tokens (design-system.md)
  if grep -noE '[a-z-]+:[[:space:]]*(#[0-9a-fA-F]{3,8}|[0-9]+px)' $vues; then
    note "raw color/px literal above — use token()/color()"
  else
    ok "no raw color/px literals"
  fi

  return "$fail"
}

self_test() {
  local d; d=$(mktemp -d)
  trap 'rm -rf "$d"' RETURN
  mkdir -p "$d/src"

  # a plan whose Coverage misses an Inventory node, with both evidence boxes empty
  cat >"$d/bad.md" <<'EOF'
## Inventory
| Node ID | Name | Layout |
| --- | --- | --- |
| 1:1 | Root | VERTICAL |
| 1:2 | Title | - |
| 1:3 | Subtitle | - |

## Coverage
| Node ID | Resolution | Color | Typography | Source | Justification |
| --- | --- | --- | --- | --- | --- |
| 1:1 | native-layout | n/a | n/a | n/a | wrapper |
| 1:3 | CM-02 | #1AA053 |  |  | heading |

## Asset decisions
| AS ID | Node ID | Resolution | Mode | Folder | Validated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AS-01 | 1:9 | exported | svgAssets | src/assets/nope | yes |  |

## Files to create
- `src/Bad.vue`
- `src/Missing.vue`

## Progress checklist
- [ ] Plan reviewed
  > Developer's verbatim answer (required — box invalid without it): ""
EOF
  printf '<template><img src="a.png"><p>Tab 1</p></template>\n<style>.a{color:#fff;margin-top:-4px}</style>\n' \
    >"$d/src/Bad.vue"

  if validate "$d/bad.md" "$d/src" "$d" >"$d/out" 2>&1; then
    echo "SELF-TEST FAILED: bad fixture passed"; cat "$d/out"; return 1
  fi
  for expected in '1:2' '1:3' 'AS-01' 'verbatim answer' 'placeholder' 'negative margin' 'without alt' 'raw color' 'blank Color or Typography' 'raw hex/px' 'Missing.vue'; do
    grep -q "$expected" "$d/out" || { echo "SELF-TEST FAILED: no finding for '$expected'"; cat "$d/out"; return 1; }
  done

  # the same plan, corrected
  mkdir -p "$d/src/assets/ok"
  cat >"$d/good.md" <<'EOF'
## Inventory
| Node ID | Name | Layout |
| --- | --- | --- |
| 1:1 | Root | VERTICAL |
| 1:2 | Title | - |

## Coverage
| Node ID | Resolution | Color | Typography | Source | Justification |
| --- | --- | --- | --- | --- | --- |
| 1:1 | native-layout | n/a | n/a | n/a | wrapper |
| 1:2 | CM-01 | color(text, dark) | typography(heading, md) | variable | BText |

## Asset decisions
| AS ID | Node ID | Resolution | Mode | Folder | Validated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AS-01 | 1:9 | exported | svgAssets | src/assets/ok | yes |  |

## Files to create
- `src/Good.vue`

## Progress checklist
- [x] Plan reviewed
  > Developer's verbatim answer (required — box invalid without it): "go ahead"
EOF
  printf '<template><img src="a.png" alt="Logo"><p>Jakarta</p></template>\n<style>.a{gap:token("gap",null,null,"md")}</style>\n' \
    >"$d/src/Good.vue"
  rm "$d/src/Bad.vue"

  if ! validate "$d/good.md" "$d/src" "$d" >"$d/out2" 2>&1; then
    echo "SELF-TEST FAILED: good fixture failed"; cat "$d/out2"; return 1
  fi
  echo "self-test passed"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test; exit $?
fi
if [ $# -lt 2 ]; then
  sed -n '2,9p' "$0"; exit 2
fi
validate "$@"
[ "$fail" -eq 0 ] && echo "--- all mechanical gates passed" || echo "--- gates failed"
exit "$fail"

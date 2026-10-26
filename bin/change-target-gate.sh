#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node --experimental-strip-types "$root/skills/change-target-gate/scripts/change-target-gate.ts" "$@"

#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node --experimental-strip-types "$script_dir/change-target-gate.ts" "$@"

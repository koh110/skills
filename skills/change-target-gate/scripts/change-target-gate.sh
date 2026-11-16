#!/bin/sh
set -eu

# NodeがTypeScriptのmodule URLをrealpathへ解決するため、symlink経由でも実体pathで起動する。
script_dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
exec node --experimental-strip-types "$script_dir/change-target-gate.ts" "$@"

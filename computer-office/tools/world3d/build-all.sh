#!/usr/bin/env bash
# Reconstruit les sprites et le sol depuis les sources fournies, régénère la carte, puis valide et teste.
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/world3d/build-sprites.mjs | tail -1
node tools/world3d/gen-pilot-map.mjs
node tools/world3d/validate.mjs
node --test tools/world3d/test/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"

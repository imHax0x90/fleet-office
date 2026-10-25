#!/usr/bin/env bash
# Régénère toutes les ressources originales de la ville 3D puis les valide.
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/world3d/gen-textures.mjs >/dev/null
node tools/world3d/build-models.mjs
node tools/world3d/gen-pilot-map.mjs
node tools/world3d/validate.mjs

#!/usr/bin/env bash
# Déploie le front (statique) et/ou le serveur vers microservices, avec sauvegarde .bak.<TS>.
# usage: ./deploy.sh            -> public/* (lite.html lite.js lite.css orca.css theme.js md.js fonts/)
#        ./deploy.sh server     -> + server.js, vérif syntaxe distante, restart fleet-orchestrator
set -euo pipefail
cd "$(dirname "$0")"; TS=$(date +%s); H=debian@microservices; R='~/computer-office'
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
FILES=(public/lite.html public/lite.js public/lite.css public/orca.css public/theme.js public/md.js)
for f in "${FILES[@]}"; do node --check "$f" 2>/dev/null || [[ "$f" != *.js ]] || { echo "syntaxe KO: $f"; exit 1; }; done
$SSH $H "mkdir -p $R/public/fonts"
for f in "${FILES[@]}"; do scp -q -o BatchMode=yes "$f" "$H:/tmp/$(basename "$f").new"; done
scp -q -o BatchMode=yes public/fonts/* "$H:$R/public/fonts/"
if [ -d public/world ]; then $SSH $H "mkdir -p $R/public/world"; scp -q -r -o BatchMode=yes public/world/. "$H:$R/public/world/"; fi
$SSH $H "cd $R/public && for f in ${FILES[*]##public/}; do [ -f \$f ] && cp \$f \$f.bak.$TS; mv /tmp/\$f.new \$f; done; ls -1 | head -0"
if [[ "${1:-}" == server ]]; then
  node --check server.js; node --check automations.js; node --check skillsys.js
  scp -q -o BatchMode=yes automations.js skillsys.js "$H:$R/"
  scp -q -o BatchMode=yes server.js "$H:/tmp/server.check.js"
  $SSH $H "node --check /tmp/server.check.js && cp $R/server.js $R/server.js.bak.$TS && mv /tmp/server.check.js $R/server.js && sudo -n systemctl restart fleet-orchestrator && sleep 2 && systemctl is-active fleet-orchestrator"
fi
echo "déployé ($TS)"

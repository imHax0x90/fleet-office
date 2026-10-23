# 🏢 Fleet Office

Un **bureau 3D temps réel** pour voir vos agents Claude Code travailler.
Chaque job devient un personnage, placé dans une salle selon son activité :

| Salle | Qui s'y trouve |
|-------|----------------|
| 🏢 **Bureau** | les agents qui bossent en solo (ou bloqués / en échec) |
| 🤝 **Coworking** | ceux qui ont délégué à des sous-agents / mènent plusieurs tâches |
| 🏋️ **Gym** | au repos, terminés, ou en file d'attente (récup' & skills) |

Statuts animés : 💻 au travail · 🤝 collabore · ✅ terminé · 🧘 repos · 🙋 bloqué · ⚠️ échec.

## Lancer

```bash
node server.js
# puis ouvrir http://localhost:4173
# ou http://<ip-locale>:4173 depuis un autre appareil du réseau
```

Ou `npm start`. **Aucune dépendance à installer** : Node natif + Three.js vendoré dans `public/vendor/`.

### Options (variables d'env)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORT` | `4173` | port HTTP |
| `HOST` | `0.0.0.0` | interface d'écoute |
| `CLAUDE_JOBS_DIR` | `~/.claude/jobs` | dossier des jobs à surveiller |

Le serveur écoute maintenant sur toutes les interfaces par défaut, donc il est joignable
depuis le réseau local via l'adresse IP LAN de la machine, en plus de `localhost`.

## Comment ça marche

```
~/.claude/sessions/*.json   (toutes les sessions Claude vivantes : interactives + bg)
~/.claude/jobs/<id>/state.json   (détail des jobs de fond)
            │  scan 1.2s + vérif pid vivant
            ▼
        server.js  ──SSE /events──>  Office 3D (Three.js)
```

- **Pas de proxy à installer** : Claude Code écrit déjà l'état de chaque session sur
  disque. `server.js` lit `~/.claude/sessions/*.json` (registre des sessions live, avec
  `pid`/`cwd`/`kind`/`status`), garde seulement celles dont le process tourne, et enrichit
  les jobs de fond avec leur `~/.claude/jobs/<id>/state.json`.
- Serveur Node natif (zéro dépendance), diffusion en **Server-Sent Events**.
- `public/app.js` : scène Three.js — loft **deux étages** (bureau + lounge en bas, gym en
  mezzanine avec escalier), **robots 3D riggés** (RobotExpressive, CC0) animés selon le
  statut (Idle / Sitting / Running / Dance / Death…), éclairage par image (IBL) + bloom sur
  les néons. Tous les assets sont vendorés dans `public/vendor/` (aucun CDN au runtime).
  Fallback automatique vers des persos primitifs si le modèle ne charge pas.
- `tools/blender/generate_fleet_office_assets.py` : générateur Blender des GLB dans
  `public/vendor/models/gen/` pour garder un pipeline de rendu cohérent et remplaçable.

`CLAUDE_SESSIONS_DIR` permet de surcharger le dossier des sessions.

### Observabilité temps réel

Le serveur **tail incrémentalement** les transcripts `~/.claude/projects/<cwd>/<sessionId>.jsonl`
(offset par fichier, pas de re-scan complet) pour extraire, par agent :

- l'**activité réelle** : édition de fichier, commande shell, `git commit`/`push`, appel MCP,
  délégation à un sous-agent… (affichée en bulle live au-dessus du personnage + historique
  dans le panneau au clic) ;
- les **tokens** cumulés et un **coût estimé** (table de prix par modèle) ;
- le **modèle** et la **branche git**.

**Inspecteur agent live** (clic sur un personnage) : infos (modèle, branche git, tokens, coût)
+ un flux **« Live Claude Code »** en lecture seule qui rejoue le transcript en temps réel —
messages de l'agent, prompts, appels d'outils, et sortie terminal (`$ cmd` → résultat).
Endpoint : `GET /api/transcript?id=<sessionId>&n=<N>`.

**Dashboard CTO** (bouton 📊 en haut) : agents par statut, tokens, coût session + estimation
horaire, missions/activité par agent, blocages, branches git.
`CLAUDE_PROJECTS_DIR` surcharge le dossier des transcripts.

### Limite assumée (lecture seule)

Fleet Office **observe** ; il ne **pilote** pas encore Claude Code. Tout ce qui est écriture
du cahier des charges (envoyer un prompt depuis l'UI, attribuer une mission, spawner un agent,
gates de validation merge/deploy, gym auto-installant des skills, décomposition multi-agents
d'une mission) suppose un backend qui drive les process Claude Code (`claude` en `stream-json`
ou l'Agent SDK) + des décisions de sécurité — c'est la phase suivante, à cadrer avant de coder.

## Brancher d'autres agents (Codex, agents serveur Debian…)

Le serveur lit des fichiers `state.json` au format Claude Code. Pour afficher d'autres
agents, écris pour chacun un dossier contenant un `state.json` avec au minimum :

```json
{
  "daemonShort": "codex-42",
  "name": "Codex — refactor",
  "template": "codex",
  "state": "working",
  "inFlight": { "tasks": 1, "queued": 0 },
  "cwd": "/chemin/projet",
  "createdAt": "2026-06-10T15:00:00.000Z",
  "updatedAt": "2026-06-10T15:04:00.000Z"
}
```

Pointe `CLAUDE_JOBS_DIR` sur un dossier qui regroupe tout ce petit monde, et ils
apparaîtront ensemble dans le bureau. (C'est le « point d'entrée unique » du plan d'archi.)

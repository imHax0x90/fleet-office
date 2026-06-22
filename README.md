# 🏢 Fleet Office

**Visualise et pilote tes agents Claude Code** — en 3D temps réel sur ta machine, et à distance depuis ton téléphone, sur tout ton réseau Tailscale / Proxmox.

Deux applications autour d'un même cerveau (l'orchestrateur) :

```
fleet-office/
├─ computer-office/    ← BACKEND + bureau 3D cyberpunk (desktop)   ── le « cerveau »
├─ mobile-controller/  ← app mobile de pilotage (PWA + APK Android)
└─ sync/               ← script de synchro multi-appareils
```

| Composant | C'est quoi | Lancer |
|-----------|------------|--------|
| 🖥️ **Backend + 3D** | Orchestrateur Node + bureau 3D Three.js | `cd computer-office && node server.js` → http://localhost:4173 |
| 📱 **Mobile** | Deck tactique néon (web/PWA + **APK Android livré**) | `cd mobile-controller && node server.js` → http://localhost:4174 |

---

## 1. Prérequis

- **Node.js ≥ 18** (le backend et l'app mobile sont en Node natif, **zéro `npm install` requis** pour les faire tourner — Three.js et les modèles 3D sont vendorés dans le repo).
- Pour **reconstruire l'APK** seulement : JDK 17 + Android SDK (platform android-34). Sinon, l'APK debug est déjà fourni.
- Des agents Claude Code (`claude`) qui tournent : Fleet Office lit l'état que Claude Code écrit déjà sur disque (`~/.claude/sessions/*.json`). Aucun proxy à installer.

## 2. Démarrage rapide

### 🖥️ Le bureau 3D + backend (`computer-office`)

```bash
cd computer-office
node server.js                 # → http://localhost:4173
#   node server.js  puis ouvrir http://localhost:4173/?demo  pour peupler le bureau d'agents fictifs
```

Ouvre `http://localhost:4173` (ou `http://<ip-LAN>:4173` depuis un autre appareil du réseau).
Chaque agent Claude Code devient un personnage 3D, rangé par salle selon son activité (bureau / coworking / gym), avec activité live, tokens, coût estimé et flux « Live Claude Code » au clic.

Détails, options (`PORT`, `HOST`, `CLAUDE_JOBS_DIR`…) et fonctionnement : **[`computer-office/README.md`](computer-office/README.md)**.

### 📱 L'app mobile (`mobile-controller`)

**Option A — installer l'APK Android (le plus simple).**
L'APK debug est livré dans le repo : **[`mobile-controller/FleetCtrl-debug.apk`](mobile-controller/FleetCtrl-debug.apk)**.

```bash
adb install -r mobile-controller/FleetCtrl-debug.apk     # via USB/adb
# ou : copier le .apk sur le téléphone et l'ouvrir (autoriser les « sources inconnues »)
```

À l'ouverture, l'app demande l'**URL de l'orchestrateur** (⚙) : mets l'adresse de la machine qui fait tourner `computer-office`, ex. `http://black-station:4173` (nom Tailscale) ou `http://<ip-LAN>:4173`.

**Option B — version web / PWA (pour tester sans installer).**
Le mini-serveur sert l'app **et** proxifie l'API vers l'orchestrateur (une seule origine, zéro CORS) :

```bash
cd mobile-controller
ORCHESTRATOR_URL=http://localhost:4173 node server.js    # → http://localhost:4174
```

Sur Android/Chrome : menu ⋮ → « Installer l'application » pour le plein écran + icône.

Build de l'APK, déploiement d'agents à distance et détails : **[`mobile-controller/README.md`](mobile-controller/README.md)**.

## 3. Multi-nœud (Tailscale / Proxmox)

Un agent peut tourner **en local** ou sur n'importe quel nœud Tailscale joignable : l'orchestrateur
enrobe `claude` dans `ssh <nœud> 'cd <cwd> && claude …'`. Le sélecteur de machine apparaît au
déploiement depuis l'app mobile.

Prérequis sur le nœud distant :
1. en ligne sur **Tailscale** ;
2. **clé SSH** depuis la machine de l'orchestrateur (`ssh <nœud>` sans mot de passe) ;
3. **`claude` installé et authentifié** sur le nœud.

## 4. Synchro multi-appareils (`sync/`)

`sync/fleet-sync.sh` rapatrie dans une session de travail les échanges faits depuis un autre
appareil (téléphone / iPad / web via Fleet Office). Voir [`sync/sync.md`](sync/sync.md).

---

## Architecture en bref

```
~/.claude/sessions/*.json        (sessions Claude vivantes : interactives + background)
~/.claude/jobs/<id>/state.json   (détail des jobs de fond)
            │  scan ~1.2 s + vérif pid vivant + tail incrémental des transcripts
            ▼
   computer-office/server.js  ──SSE /events──▶  Bureau 3D (Three.js)
            │
            └──── API ◀──proxy──  mobile-controller/server.js  ──▶  FleetCtrl (PWA / APK)
```

- **Backend (`computer-office/server.js`)** : Node natif, zéro dépendance, diffusion **Server-Sent Events**. Lit l'état des sessions Claude Code et tail les transcripts pour l'activité live, les tokens et le coût.
- **3D (`computer-office/public/`)** : scène Three.js, loft deux étages, robots riggés (RobotExpressive, CC0) animés selon le statut, IBL + bloom. Assets vendorés (`public/vendor/`), aucun CDN au runtime.
- **APK (`mobile-controller/`)** : app Capacitor (Android) + PWA, pilotage de la flotte à distance via Tailscale.

## Licence

MIT.

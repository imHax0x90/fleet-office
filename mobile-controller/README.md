# FleetCtrl — app mobile

Pilotage mobile de tes agents Claude Code (deck tactique néon). Se connecte à l'orchestrateur
(`computer-office`) via Tailscale. Fonctionne en **web / PWA installable** et en **APK Android**.

## Ce qu'on peut faire
- Roster temps réel (SSE), statut / salle / **machine** de chaque agent.
- Pilotage : feed live, envoi de messages, **chips de follow-up**, **autocomplétion des commandes `/`**, stop / gym / fermer.
- **Déploiement** d'un agent avec **sélecteur de machine** : local ou n'importe quel nœud Tailscale.

## Lancer en web (test / PWA)
Le mini-serveur sert l'app **et** proxifie l'API vers l'orchestrateur (une seule origine, zéro CORS) :
```bash
ORCHESTRATOR_URL=http://localhost:4173 node server.js   # http://localhost:4174
# PORT et ORCHESTRATOR_URL configurables. Depuis le tel : http://<nom-tailscale>:4174
```
Sur Android/Chrome : menu ⋮ → « Installer l'application » pour l'avoir en plein écran avec icône.

## APK Android
Un APK debug est déjà construit : **`FleetCtrl-debug.apk`**.
```bash
adb install -r FleetCtrl-debug.apk          # via USB/adb
# ou : transférer le .apk sur le tel et l'ouvrir (autoriser les sources inconnues)
```
À l'ouverture, l'app demande l'**URL de l'orchestrateur** (⚙) — mets l'adresse Tailscale de la
machine qui fait tourner `computer-office`, ex. `http://black-station:4173`.

### Reconstruire l'APK
```bash
npm install
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk   ANDROID_HOME=$HOME/Android/Sdk
npx cap sync android && cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```
(JDK 17 requis pour Gradle 8.2 ; SDK : platform android-34.) Icônes : `npx @capacitor/assets generate --android` depuis `assets/icon.png`.

## Déployer un agent sur une machine distante (Tailscale/Proxmox)
Au déploiement, choisis la machine cible. Pour qu'un nœud soit utilisable :
1. il est **en ligne sur Tailscale** ;
2. **clé SSH** depuis la machine de l'orchestrateur (`ssh <nœud>` doit marcher sans mot de passe) ;
3. **`claude` installé et authentifié** sur le nœud.

L'orchestrateur lance alors `ssh <nœud> 'cd <cwd> && claude …'` ; tout le pilotage (streaming,
follow-ups, commandes `/`) passe par SSH. Le transcript distant est lu via SSH.
> Niveau 2 (provisionner des VM/LXC Proxmox à la volée via l'API Proxmox) : pas encore implémenté.

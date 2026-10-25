# Village pixel art (`/world3d/`)

Village de gestion d'agents « façon RPG DS » : monde Three.js à caméra oblique fixe, **sol en tuiles et tout le reste en sprites 2D verticaux** (assets IcyEthics + pack de l'utilisateur ; aucun modèle 3D généré). URL : `http://fleetoffice/world3d/`.

## Données réelles
* `/api/world` → une maison par projet ; `/api/agents` → agents, rafraîchis toutes les 4 s. Un dossier = un lot de la carte (`lots[]`, 28 emplacements, débordement sur les lots libres). Rien n'est simulé : source injoignable → « non connecté ».
* Bâtiments fonctionnels (`zones[]`) → vues de la console : Quartier général (église) = flotte · Laboratoire IA = skills/métiers · Centre d'opérations (entrepôt) = machines `/api/hosts` · Atelier dev (chalet) = équipes · Centre de supervision (porte fortifiée) = agents bloqués/en échec + évaluations.
* États d'agent → visuel (`assetcat.mjs`) : idle, working, thinking (seulement si le backend fournit `phase`), success, error, offline (d'après `/api/hosts`), blocked ; pastille au-dessus du personnage, teinte grise si hors ligne.
* Gestion par maison : créer un agent (`/api/spawn`), fermer (`/api/world/close`) et rouvrir (`/api/world/reopen`) une session.

## Contrôles
ZQSD / flèches, Maj = courir, clic = sélectionner ou marcher, molette / pincement = zoom, glisser = déplacer la vue, **M** carte, **N** jour/nuit (heure locale ; `?time=22`), **C** choisir son personnage (`?hero=<id>`), **P** perfs, **F** recentrer. La caméra est fixe (les sprites restent face à l'écran).

## Assets (tous issus des sources fournies)
| Quoi | Source | Licence |
|---|---|---|
| Maisons (6), bâtiments fonctionnels (5), puits, foin, caisses, clôture, jardinière, buissons, rochers, hautes herbes, arbres (2), roche des falaises, tuiles d'herbe / pierre / terre | découpes rectangulaires de `Tilesets/padded_mycorTown.png` (icyethics/PokemonAssets), rognées sur la transparence | `icyethics-noncommercial` (README : usage non commercial, dérivés libres, crédit IcyEthics ; texte non juridique, non vérifié) |
| Tuiles de pavés / eau / sable, arbre, banc, lampadaire, 8 métiers et 5 héros (3 états × 4 directions) | `persos_pixel_art_pack.zip` (généré par un script de l'utilisateur, copié dans `assets/sources/`) | `oeuvre-utilisateur` (déclarée par l'auteur) |
| 8 habitants overworld (feuilles 4×4 de 32×48) | `Overworld Sprites/` (IcyEthics) | idem IcyEthics |

Les originaux sont copiés **intacts** dans `assets/sources/` ; les dérivés (`tex/sp_*.png`, `ground.png`, `cliff.png`) portent leur rectangle source dans `registry.json`. **Exclus** : tout `ukbigdave/PokemonSprites` (créatures, © The Pokémon Company), `Trchar*`, portrait Hilda, `speech hgss*`, sprites de créatures, `OW_*` (fond opaque).
Inventaire complet de l'archive : `assets/inventory.json` (`node tools/world3d/inventory.mjs --assets <PokemonAssets> --sprites-list <liste du zip>`).

## Pipeline
* `tools/world3d/build-sprites.mjs` : découpe les sprites (liste de rectangles commentée), construit l'atlas de sol 12 × 32 px (herbe, fleurs, pavés, dalles, terre, eau ×2 frames, sable…), le registre pour les non-personnages. `import-sprites.mjs` / `import-overworld.mjs` : feuilles de personnages. `gen-pilot-map.mjs` : carte (`maps/pilot.json` : sol ASCII, relief `plateaus`/`ramps`, `lots`, `zones`, `objects`, `npcs`). `validate.mjs` : registre, fichiers, licences, carte. `tools/world3d/build-all.sh` : tout + tests (`npm run test:world3d`).
* **Catalogue** `public/world3d/assetcat.mjs` : ids stables, `find({category, tags, text, minW…})`, `frameRect(id, {dir, state|frame})`, `sheetInfo`, `image(id)` avec cache et placeholder identifiable, états d'agents → visuel. Un asset absent donne un « ? » magenta, jamais de plantage.
* **Ajouter un sprite** : une ligne `T("mon_id", "building", [x, y, w, h], pixelsParUnité, { collide: … })` dans `build-sprites.mjs`, puis `build-all.sh` ; le placer dans `gen-pilot-map.mjs`. **Ajouter un personnage** : `import-sprites.mjs` (cellules 64×64, 3 états) ou une entrée `sheet:{px,cell,cols,rows,rowsOrder,colsOrder,footPx}` + `animations` (idle/walk/run) ; il apparaît seul dans la grille de choix (touche C).

## Rendu et performances
Textures `NEAREST` (pixels nets), sol en un maillage, décor instancié par blocs de 16×16 tuiles (frustum culling), ombres d'une lumière directionnelle, relief (collines à falaises avec rampes, murs texturés par la roche de la tilesheet), eau animée, hautes herbes, jour/nuit avec halos de lampadaires, bâtiments qui s'estompent devant le joueur. HUD perfs : **P**.

## Limites
Pas d'intérieurs ; facades toutes orientées au sud (caméra fixe) ; les planches de tuiles IcyEthics sont des autotiles 2D dont on n'utilise que des découpes ; mobile/tactile et fortes charges d'agents non testés ; falaises = paliers et rampes (pas de saut de corniche).

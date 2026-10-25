# Ville 3D (pilote) — `/world3d/`

Overworld 3D low-poly inspiré des RPG DS (caméra oblique, textures pixel nettes, relief de toits, personnages billboard), branché sur les vraies données
de l'orchestrateur : une **maison par projet**, des **agents** qui y vivent, cinq **bâtiments fonctionnels** reliés aux vues de la console.
URL : `http://fleetoffice/world3d/` (même chemin sur n'importe quel hôte). Lien « 3D » dans la ville 2D (`/world/`).

## Ce qui est livré

| Brique | Fichiers |
|---|---|
| Moteur Three.js (zéro dépendance ajoutée : Three + GLTFLoader déjà vendorisés) | `public/world3d/index.html`, `world3d.js`, `world3d.css` |
| Registre d'assets (id stable, catégorie, source, dimensions, ancre, échelle, matériaux, occlusion, collision, licence, animations, visuel de secours) | `public/world3d/assets/registry.json` |
| Registre de licences | `assets/licences.json`, `assets/LICENCES.md` |
| Textures originales (sol 8 tuiles, murs, toits, fenêtres, portes, feuillage, 8 feuilles de personnages (grosse tête, contour, casquette/bonnet/capuche, sac, jupe) 4 dir × 4 frames) | `assets/tex/*.png` ← `tools/world3d/gen-textures.mjs` |
| Modèles GLB originaux (5 bâtiments fonctionnels, 6 maisons, 3 arbres, buisson, fleurs, lampadaire, banc, panneau, fontaine, caisse) | `assets/models/*.glb` ← `tools/world3d/build-models.mjs` |
| Carte pilote 64×80 en plan de petite ville (place centrale, avenue vers le QG, rues de lotissement avec maisons face à face, clôtures, parterres, boîtes aux lettres, ceinture d'arbres, 2 mares, 32 lots) | `assets/maps/pilot.json` ← `tools/world3d/gen-pilot-map.mjs` |
| Import OBJ/MTL → GLB avec garde-fou de licence | `tools/world3d/import-obj.mjs` |
| Validation (registre, GLB binaire, licences, carte) | `tools/world3d/validate.mjs` |

Tout régénérer + valider : `tools/world3d/build-all.sh`. Déployer : `./deploy.sh server` (la route `/world3d/` est dans `server.js`).

## Données réelles, rien de simulé

* `GET /api/world` → maisons (une par dossier de projet) et quartiers ; `GET /api/agents` → agents et statuts. Rafraîchi toutes les 4 s.
* Chaque maison est posée sur un **lot** de la carte (`lots[]`, regroupés par quartier : 2 rues de lotissement × 2 côtés de l'avenue = 4 quartiers de 8 lots = 32 lots). Au-delà, les maisons
  débordent sur les lots libres (compteur « hors quartier » dans le HUD). Les agents d'un dossier sans maison se rassemblent devant le Quartier général.
* Les agents marchent autour de leur maison quand ils travaillent, restent en place sinon ; pastille au-dessus de la tête : au travail / bloqué / en échec.
* Bâtiments fonctionnels (`zones[]` de la carte) — panneau + bouton qui ouvre la vue de la console en surimpression :
  Quartier général → flotte (tableau de bord) · Laboratoire IA → métiers + skills · Centre d'opérations → machines (`/api/hosts`) ·
  Atelier dev → équipes · Centre de supervision → agents bloqués/en échec + évaluations.
* Si une source n'est pas joignable, le panneau affiche **« non connecté »** ; si l'orchestrateur est injoignable, une bannière le dit. Aucun chiffre inventé.

## Ajouter un bâtiment sans toucher au moteur

1. **Modèle** : ajoutez un `def("mon_batiment", "building", (m) => { … }, { collide: { type: "box", w, d } })` dans `tools/world3d/build-models.mjs`
   (primitives : `box`, `prism`, `cone`, `dome`, `gable`, `hip`, `plate`), ou importez un OBJ (ci-dessous). `node tools/world3d/build-models.mjs` écrit le GLB
   et l'entrée de registre (dimensions mesurées sur la géométrie).
2. **Placement** : dans `gen-pilot-map.mjs` (ou directement `maps/pilot.json`), ajoutez `{ id, asset, x, y, rot, label, view, blurb }` à `zones`
   (bâtiment fonctionnel) ou `{ x, y, rot, district }` à `lots` (maison de projet), ou un objet décoratif à `objects`.
3. `node tools/world3d/validate.mjs`. Le moteur charge tout par id depuis le registre.

Un asset absent ou illisible n'abîme jamais la scène : une **boîte colorée cerclée de magenta** aux dimensions du registre le remplace, le HUD passe en rouge
(« N de secours ») et l'erreur est listée en infobulle.

## Choix de caméra

| Option | Avantages | Limites |
|---|---|---|
| Orthographique oblique | pas de déformation, tuiles constantes | pas de profondeur, toits et façades « plats », ombre de perspective absente |
| Isométrique (45° en azimut) | lisible, classique | masque davantage, rompt avec la grille de façade DS, personnages vus de biais |
| **Perspective à champ étroit (retenu : FOV 28°, élévation 52°)** | relief des toits et façades, légère fuite qui donne la profondeur « overworld DS », billboards verticaux nets | demande un fondu des bâtiments qui masquent le joueur (fait : rayon caméra→joueur) |

Réglages : `?zoom=` (distance), `?pitch=` (élévation en degrés), `?yaw=`, `?res=2` (rendu demi-résolution pour un grain « DS » marqué). Q/E pivotent par pas de 45°.

## Performances (mesurées, rendu logiciel headless — un vrai GPU est bien plus rapide)

* Textures : `NEAREST` à l'agrandissement (pixels nets), mipmaps `NEAREST_MIPMAP_LINEAR` sur murs/toits (supprime le scintillement), atlas de sol sans mipmap. Un seul fichier PNG par texture, mis en cache.
* Sol : **1 seul maillage fusionné** (≈ 24 000 tuiles) ; bordures de pavés : 1 `InstancedMesh`.
* Décor : **1 022 instances** (arbres, buissons, fleurs, mobilier + forêt de bordure) en **626 blocs** de 16×16 tuiles → le frustum culling écarte les blocs hors champ :
  caméra éloignée ≈ 256 appels de rendu / 85 k triangles ; caméra rapprochée ≈ 77–100 appels / 60–66 k triangles. Sans instanciation : ≈ 2 500 appels (estimation : 1 022 objets × ~2,5 sous-maillages).
* Ombres : une `DirectionalLight` (carte 2048) qui suit la caméra ; personnages = disque d'ombre (pas de coût de shadow map).
* HUD perfs : touche **P** (fps, appels, triangles, géométries, textures).

## Pokémon DS Map Studio (PDSMS) — évaluation et usage possible

Constats vérifiés (dépôt `Trifindo/Pokemon-DS-Map-Studio`, release 2.2 de 2021) :

* Application Java 8 : tilemap → modèle 3D automatique ; **aucun fichier de licence** (`license: null`) → tous droits réservés ; le code et les 30 `.pdsts` ne sont donc **pas** copiés ici.
* L'export natif est `.nsbmd`, qui nécessite **`g3dcvtr.exe`** (propriétaire, SDK Nintendo — non fourni) + une DLL xerces. Sans lui, pas de `.nsbmd`.
* Les jeux de tuiles « Platinum / DP / HGSS / BW » sont des reconstitutions de graphismes Nintendo par la communauté : à ne pas présenter comme libres. Seuls des tilesets
  « Various » (ex. `Low_Poly_Tileset`, `Sylvan_Town`) pourraient être originaux, mais **aucune licence n'est publiée** : à demander à l'auteur avant tout usage hors poste.

Usage prévu, **optionnel et hors dépôt** : dessiner une carte dans PDSMS (Java 8+, poste local) avec **vos** tilesets sous licence claire, exporter en **OBJ/MTL + PNG**
(si votre version l'expose — à vérifier à l'installation), puis :

```bash
node tools/world3d/import-obj.mjs --obj export/ma_ville.obj --id ma_ville --category building \
  --licence CC-BY-4.0 --licence-url https://… --source "https://…" --author "Nom" --scale 0.0625 --up y
node tools/world3d/validate.mjs
```

L'import triangule, aplatit en GLB (textures PNG embarquées, échantillonnage nearest), mesure les dimensions, écrit l'entrée de registre et **refuse** sans licence ni provenance.
Chaîne validée sur un OBJ/MTL de test (`tools/world3d/fixtures/pillar.*`, créé pour ce dépôt) : chargé et rendu dans la scène.
**Repli (livré)** : tout ce qui est visible aujourd'hui est généré par nos scripts (CC0) ; PDSMS n'est pas une dépendance.

## Limites connues / assets manquants

* Pas de modèles d'intérieur : entrer dans un bâtiment ouvre la vue console correspondante (pas de scène intérieure 3D).
* Personnages : sprites de 16×24 générés (6 palettes) — pas de variantes d'accessoires ni d'animation de course dédiée (la course accélère le cycle de marche).
* Un seul biome (herbe, pavés, dalles, terre, eau statique — non animée) ; pas de cycle jour/nuit (les lampadaires sont émissifs mais n'éclairent pas).
* Caméra : pas de collision de caméra avec les bâtiments (fondu à la place). Tactile : glisser = déplacer la vue, pincer = zoom, toucher le sol = marcher ; pas de joystick virtuel.
* Au-delà de 30 projets, l'ajout de lots se fait dans la carte (`lots[]`).
* Mesures de fps faites sans GPU (rendu logiciel) : à confirmer sur appareil (mobile/APK : l'APK charge le même front, aucune reconstruction nécessaire).

## Tests exécutés

`node tools/world3d/validate.mjs` (28 assets, 21 GLB, carte) · chargement headless de `/world3d/` contre l'orchestrateur réel : 20/20 assets, 9 maisons, 12 agents, 0 erreur de console ·
marche / course / collision contre le Quartier général / clic-déplacement / rotation Q-E · clic sur chacun des 5 bâtiments (panneaux alimentés par `/api/*`) · ouverture de la console intégrée ·
asset cassé (fallback orange + HUD rouge) · asset importé (OBJ → GLB) chargé et visible · validateur : détecte fichier absent / licence manquante (exit 1).

## Ambiance « ville de RPG DS » (v3)

* **Jour / nuit** selon l'heure locale (`?time=22` pour forcer, touche **N** : nuit → jour → auto) : ciel, brouillard et lumières changent, halos additifs sur les lampadaires, fenêtres éclairées, personnages assombris.
* **Eau animée** (2 images d'atlas alternées), **berges de sable**, **lac avec ponton**, **ruisseau et pont**, **hautes herbes** (touffes en billboards croisés), **champs de fleurs**, **moulin à voiles tournantes**, **tour de l'horloge**, **portes de ville** aux quatre sorties, arbres d'alignement le long des rues.
* Ces décors sont de catégorie `scenery` dans le registre : purs éléments d'ambiance, sans lien avec des données.
* Cases de carte : `b` = pont/ponton (eau dessous, praticable), `t` = hautes herbes ; `animated[]` = props animés (rotation continue).

## Relief et habitants (v4)

* **Falaises** : la carte déclare `plateaus[]` (rectangles de niveau 1 = 2,2 unités) et `ramps[]` (rampes dans un sens n/s/e/w). Le moteur calcule la hauteur du sol (`heightAt`), élève sol, décors, bâtiments, lampadaires et personnages, et génère les **murs de roche** là où deux tuiles voisines diffèrent de hauteur. Un personnage ne franchit une différence > 0,45 que par une rampe. Deux collines : la colline du moulin (nord-ouest) et la terrasse de l'horloge (nord-est).
* **Habitants décoratifs** : `npcs[]` de la carte (14 : meunier, pêcheur, jardinier, facteur en tournée, joggeur, enfants, ancien sur son banc, gardiens de porte…), en promenade, en patrouille ou statiques, avec quelques répliques. **Ils ne représentent aucun agent** : étiquette « · décor » au survol et bandeau d'avertissement dans leur panneau ; ils ne sont pas comptés avec les agents (HUD : « 14 habitants (décor) »).
* Textures ajoutées : roche de falaise, 4 tenues d'habitants (ancien, pêcheur, jardinier, facteur).

## Pack de l'utilisateur (persos_pixel_art_pack.zip) — tout est utilisé

Le pack est généré par un script écrit par l'utilisateur (`assets/sources/persos_pixel_art_pack/`, licence `oeuvre-utilisateur`, vérifiée « déclarée par l'auteur »).

* **Personnages** : 8 rôles `pnj/` (tenue des agents selon leur métier, habitants) et 5 héros `principaux/` (apparence du joueur, touche **C** pour changer, mémorisée ; `?hero=hero_red`). Feuilles de 64×64 × 3 états (statique / marche / course) : la vraie animation de course sert avec Maj et pour les joggeurs. Import : `tools/world3d/import-sprites.mjs`.
* **Tuiles** : herbe, pavés, chemin de sable et eau (+ copie décalée pour l'animation) remplacent les tuiles correspondantes de l'atlas de sol (`gen-textures.mjs`).
* **Bâtiments** : les 4 icônes deviennent les **enseignes illustrées** posées devant le QG, le labo IA, le centre d'opérations et l'atelier (`sign_*`).
* **Décor** : l'arbre devient `tree_sprite` (deux plans croisés), mélangé aux arbres de la ceinture de la ville. Banc et lampadaire du pack n'ont pas été repris : les modèles 3D du projet les remplacent avec relief et ombres.
* `build-models.mjs` conserve les entrées de registre importées lors d'une régénération.

## Archive de fan-assets (pokemon_assets.zip) — audit, catalogue, licences

Archive de 3 Go (64 606 fichiers) examinée sans extraction complète : `PokemonSprites` (≈ 64 000 sprites de **créatures**) et `PokemonAssets` (personnages overworld, tilesets, interface). Inventaire complet dans `public/world3d/assets/inventory.json` (chemin, catégorie, dimensions, transparence, grille probable, états/directions, méthode de découpe, confiance, statut `utilisé / candidat / écarté / exclu`, raison). Régénération : `node tools/world3d/inventory.mjs --assets <PokemonAssets> --sprites-list <liste du zip>`.

**Licences — ce qui est utilisé et pourquoi**
* `ukbigdave/PokemonSprites` : licence du dépôt « *All image contents within are Copyright The Pokémon Company* » (le CC0 ne couvre que le code). **Aucune image n'est copiée** dans ce dépôt ni déployée ; hors sujet pour un village d'agents de toute façon (créatures).
* `icyethics/PokemonAssets` : README = usage **non commercial**, dérivés libres d'usage, crédit à IcyEthics (licence `icyethics-noncommercial`, texte non juridique, marquée *non vérifiée*). Utilisés : 8 personnages overworld (`ow_*`, feuilles 4×4 de 32×48, fond transparent, convention RPG Maker : bas/gauche/droite/haut) et 2 arbres découpés dans la planche de tuiles (`ow_tree_*`, rectangles consignés au registre). **Exclus** : `Trchar*`/`trchar*` (nommage des trainers par défaut d'Essentials, probable contenu Nintendo), `trainer_image_hilda`, `speech hgss*`, tous les sprites de créatures et icônes ; les `OW_*` (fond opaque) sont écartés. Les originaux sont copiés **intacts** dans `assets/sources/icyethics_pokemonassets/` ; les dérivés sont dans `derived/` avec lien vers leur source.
* Les tilesets 32 px de l'archive (planches d'autotiles top-down de 256×11 072) sont inventoriés mais **non intégrés** : la ville est en 3D, leurs autotiles 2D n'y ont pas de sens.

**Catalogue d'assets** (`public/world3d/assetcat.mjs`, construit sur `registry.json`) : ids stables, `find({category, tags, text, minW…})`, `frameRect(id, {dir, state|frame})` (découpe d'une spritesheet par métadonnées, sans fichier par frame), `sheetInfo(id)` (séquences idle/walk/run), `image(id)` (chargement paresseux, cache, requêtes en vol dédoublonnées, **placeholder identifiable** si absent). États d'agents → visuel : `agentState/agentVisual` (idle, working, thinking, success, error, offline, blocked ; `offline` d'après `/api/hosts`, `thinking` seulement si le backend fournit `phase`). Tests : `npm run test:world3d` (6 tests + validation du registre).

**Ajouter un asset / associer une spritesheet à un personnage**
1. Déposer le PNG (fond transparent) et lancer `import-overworld.mjs` (grille 4×4 de 32×48) ou `import-sprites.mjs` (cellules 64×64, 3 états) — ou ajouter à la main une entrée de registre avec `sheet: { px, cell, cols, rows, rowsOrder, colsOrder, footPx }` et `animations` (`idle`/`walk`/`run` = indices de colonnes + fps), `licence`, `source`.
2. L'utiliser : `sheet: "mon_id"` dans un habitant de `gen-pilot-map.mjs` (`npcs[]`), ou dans la liste `HEROES` (touche C) ; les agents prennent la tenue de leur métier (`OUTFIT`).
3. `node tools/world3d/validate.mjs` puis `npm run test:world3d`.

## Nettoyage et choix du personnage

* Les 20 feuilles de personnages **générées** à la main du début (`char_*`, code de dessin et repli associé) ont été supprimées. Tout personnage vient maintenant du pack utilisateur ou de l'archive IcyEthics ; un id absent donne un fantôme magenta « ? » (jamais de plantage).
* **Choisir son personnage** : touche **C** ou bouton « Personnage (C) » → grille de tous les personnages jouables du catalogue (21 : héros et métiers du pack utilisateur, habitants IcyEthics) avec aperçu ; le choix est mémorisé (`localStorage`, ou `?hero=<id>`). Un nouveau personnage importé dans le registre apparaît automatiquement dans la grille.

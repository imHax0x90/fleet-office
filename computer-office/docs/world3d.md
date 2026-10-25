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

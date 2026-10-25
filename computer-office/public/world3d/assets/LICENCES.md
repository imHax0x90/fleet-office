# Licences des ressources — Ville 3D

Chaque entrée de `registry.json` porte un champ `licence` (identifiant SPDX défini dans `licences.json`). `node tools/world3d/validate.mjs` **échoue** si une
ressource référence une licence inconnue ou non redistribuable.

| Ressource | Origine | Licence | Remarque |
|---|---|---|---|
| `tex/*.png` (sol, murs, toits, fenêtres, portes, feuillage, personnages) | dessinés par code : `tools/world3d/gen-textures.mjs` | CC0-1.0 | originaux, déterministes, régénérables |
| `models/*.glb` (maisons, QG, labo IA, centre d'opérations, atelier, supervision, arbres, buissons, mobilier) | construits par code : `tools/world3d/build-models.mjs` | CC0-1.0 | originaux, aucun modèle tiers |
| `maps/pilot.json` | `tools/world3d/gen-pilot-map.mjs` | CC0-1.0 | éditable à la main |
| Three.js + GLTFLoader (`public/vendor/`) | https://threejs.org | MIT | déjà présent dans le dépôt |
| Geist (`public/fonts/`) | Vercel | OFL-1.1 | interface |
| KenneyPixel.ttf (`public/world/assets/`) | https://kenney.nl | CC0-1.0 | titres pixel |

## Ce qui n'est PAS dans le dépôt, et pourquoi

* **Ressources extraites de jeux Pokémon (modèles, tuiles, sprites)** et **recréations « fan » de personnages ou de bâtiments Pokémon** : propriété de Nintendo / Game Freak / The Pokémon Company, non libres. Elles ne sont ni embarquées, ni utilisées comme dépendance implicite, ni présentées comme libres de droits.
* **Pokémon DS Map Studio** (https://github.com/Trifindo/Pokemon-DS-Map-Studio) : le dépôt n'a **aucun fichier de licence** (API GitHub : `license: null`) → tous droits réservés par défaut. L'outil est *utilisable* sur votre poste, mais ni son code ni ses 30 jeux de tuiles `.pdsts` ne sont copiés ici. Les tilesets Platinum/DP/HGSS/BW y sont des reconstitutions communautaires de graphismes Nintendo.
* L'export `.nsbmd` de PDSMS exige `g3dcvtr.exe` (outil propriétaire du SDK Nintendo, non fourni par PDSMS) : **non utilisé ici**. Le chemin d'import retenu est OBJ/MTL → GLB (voir `docs/world3d.md`).

## Ajouter une ressource tierce

`tools/world3d/import-obj.mjs` refuse d'importer sans `--licence` et `--source`. Sans `--licence-url`, l'entrée est marquée `licenceVerified:false` et la validation affiche un avertissement : vérifiez la licence à la source avant de publier.

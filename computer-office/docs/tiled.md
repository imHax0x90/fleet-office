# Éditer la ville avec Tiled

La ville (`/world/`) peut être modifiée à la main dans **Tiled** (https://www.mapeditor.org, libre et gratuit).

## Principe
- `public/world/maps/town.tmj` = la carte. Tant qu'elle existe **et** que la grille du monde n'a pas changé, le jeu la charge à la place de la génération automatique.
- Ce que tu édites : le **sol** (calque `ground`), le **décor peint** (calque d'image `decor` : fleurs, clôtures, ombres…), les **objets** (calque `props` : arbres, buissons, lampadaires, herbes hautes) et les **collisions** (calque `collision` : rectangles solides).
- Ce qui reste géré par le serveur (et se met à jour tout seul) : les **maisons** (une par projet), les grands bâtiments (Académie, Arène), la fontaine, les panneaux de quartier, les villageois.

## Ouvrir et modifier
1. Ouvre `public/world/maps/town.tmj` dans Tiled.
2. **Sol** : peins avec le tileset `town-ground` (92 tuiles : herbe, sable, rue, place, chemin, eau avec leurs bordures). La propriété `kind` de chaque tuile (grass, street, path, plaza, water, sand) décide du comportement (l'eau bloque le passage).
3. **Objets** : glisse des arbres/buissons/lampadaires depuis le tileset `town-props` dans le calque `props` (la propriété `base` règle l'ordre d'affichage devant/derrière le joueur).
4. **Collisions** : dessine ou supprime des rectangles dans `collision`.
5. Enregistre, puis `./deploy.sh` et recharge `/world/`.

## Quand la carte est ignorée
Si la grille change (nouveau quartier, nouvelle rangée de lots → taille de la ville différente), la carte n'est plus valable : le jeu revient à la génération automatique (état visible dans `#dbg` → `carte`). Dans ce cas, **ré-exporte** :

```
http://fleetoffice/world/?export=1&map=off      # génère les fichiers sur le serveur (public/world/maps/)
scp -r debian@microservices:computer-office/public/world/maps/. public/world/maps/
```

Attention : cela remplace ta carte éditée. Fais une copie avant.

## Paramètres utiles
- `?map=off` : ignore la carte et force la génération automatique.
- `?export=1` : exporte la ville actuelle au format Tiled.

## Tuiles de sol et licences
Le tileset de sol et les objets sont **dessinés par le moteur** (aucun asset tiers). Tu peux ajouter d'autres tilesets libres de droits (Kenney CC0, LPC…) dans Tiled ; garde leur licence dans `public/world/assets/LICENSES.txt`.

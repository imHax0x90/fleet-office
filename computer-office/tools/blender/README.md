# Blender Assets

Ce dossier contient le générateur Blender utilisé pour produire les `.glb` consommés par
`public/app.js`.

## Générer les assets

Dans Blender, lance:

```bash
blender --background --python tools/blender/generate_fleet_office_assets.py
```

Le script écrit les modèles dans:

```text
public/vendor/models/gen/
```

## Ce que le script couvre

- `bench`
- `weight_bench`
- `squat_rack`
- `dumbbells`
- `dumbbell_rack`
- `plate_tree`
- `cable_machine`
- `treadmill`
- `treadmill_pro`
- `spin_bike`
- `kettlebell`
- `plant`
- `wall_art`
- `surfboard`
- `chair`
- `armchair`
- `sofa`
- `bookshelf`
- `desk`
- `workstation`
- `task_lamp`
- `storage_cabinet`
- `meeting_table`
- `mirror_panel`

## Assets déjà réutilisés

- `public/vendor/models/RobotExpressive.glb` et `public/vendor/models/SheenChair.glb` viennent des exemples officiels de `three.js`.

## Pistes externes utiles

- OpenGameArt: https://opengameart.org/
- Sketchfab: https://sketchfab.com/

Pour cette scène, la voie la plus fiable reste le pack procédural Blender, puis l'ajout
progressif de quelques assets CC bien choisis si on en trouve qui collent vraiment au rendu
visé.

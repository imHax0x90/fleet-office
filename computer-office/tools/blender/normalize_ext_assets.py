"""Normalise les GLB externes (public/vendor/models/ext/) -> conventions Fleet Office.

Pour chaque asset : recentre l'empreinte (base à y=0, centré en x/z) et met à l'échelle
pour atteindre une taille cible (hauteur ou longueur) cohérente avec les modèles `gen/`.
Exporte vers public/vendor/models/gen/<out>.glb (drop-in dans GEN_MODELS).

  blender --background --python tools/blender/normalize_ext_assets.py
"""
from __future__ import annotations
import math
import pathlib
import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / "public" / "vendor" / "models" / "ext"
GEN = ROOT / "public" / "vendor" / "models" / "gen"

# asset ext -> (axe d'ajustement, taille cible en m, nom de sortie dans gen/)
PLAN = {
    "treadmill":  ("height", 1.45, "treadmill_pro"),
    "bench":      ("length", 1.35, "bench"),
    "kettlebell": ("height", 0.52, "kettlebell"),
    "dumbbell":   ("length", 0.45, "dumbbells"),
    "barbell":    ("length", 2.20, "barbell"),
    "squat_rack": ("height", 2.42, "squat_rack"),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bbox(objs):
    mn = Vector((math.inf,) * 3)
    mx = Vector((-math.inf,) * 3)
    for o in objs:
        if o.type != "MESH":
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


def normalize(src: pathlib.Path, fit: str, size: float, out: str):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(src))
    objs = list(bpy.context.scene.objects)
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        print(f"[{src.name}] aucun mesh"); return False
    # smooth + matériaux : on garde ceux de l'asset, juste un coup de lissage
    for o in meshes:
        try:
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.shade_smooth()
        except Exception:
            pass
    mn, mx = world_bbox(meshes)
    dims = mx - mn
    # échelle cible
    extent = dims.z if fit == "height" else max(dims.x, dims.y)
    if extent <= 1e-6:
        print(f"[{src.name}] dimension nulle"); return False
    scale = size / extent
    # empty parent à l'origine pour transformer le groupe
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = out + "_root"
    for o in objs:
        if o.parent is None and o is not root:
            o.parent = root
            o.matrix_parent_inverse = root.matrix_world.inverted()
    # recentre (base à 0, centré x/y) puis met à l'échelle
    cx = (mn.x + mx.x) / 2
    cy = (mn.y + mx.y) / 2
    root.location = (-cx * scale, -cy * scale, -mn.z * scale)
    root.scale = (scale, scale, scale)
    # export
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(GEN / f"{out}.glb"), export_format="GLB", use_selection=True,
        export_apply=True, export_animations=False, export_yup=True,
    )
    print(f"[{src.name}] -> gen/{out}.glb (x{scale:.3f}, {fit}={size}m)")
    return True


def run():
    if not EXT.exists():
        print("pas de dossier ext/"); return
    n = 0
    for name, (fit, size, out) in PLAN.items():
        src = EXT / f"{name}.glb"
        if not src.exists():
            print(f"[{name}] absent (ext/{name}.glb)"); continue
        try:
            if normalize(src, fit, size, out):
                n += 1
        except Exception as e:
            print(f"[{name}] ERREUR: {str(e)[:200]}")
    print(f"\n{n} assets normalisés -> {GEN}")


if __name__ == "__main__":
    run()

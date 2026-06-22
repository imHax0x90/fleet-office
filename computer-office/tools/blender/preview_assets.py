"""Rend des GLB en PNG (3/4 vue) pour juger visuellement les assets.

  blender --background --python tools/blender/preview_assets.py -- <glb1> <glb2> ...

Sort les PNG dans tools/previews/<nom>.png
"""
from __future__ import annotations
import math
import sys
import pathlib
import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUTDIR = ROOT / "tools" / "previews"
OUTDIR.mkdir(parents=True, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 420
    sc.render.resolution_y = 420
    sc.render.film_transparent = False


def world_bbox(meshes):
    mn = Vector((math.inf,) * 3); mx = Vector((-math.inf,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx


def setup_world():
    w = bpy.data.worlds.new("W"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.86, 0.9, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = w


def render_glb(path: pathlib.Path):
    reset(); setup_world()
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print(f"[{path.name}] aucun mesh"); return
    mn, mx = world_bbox(meshes)
    center = (mn + mx) / 2
    size = max((mx - mn).x, (mx - mn).y, (mx - mn).z) or 1.0
    # soleil (up = Z après import glTF Y-up -> Blender Z-up)
    sd = bpy.data.lights.new("S", "SUN"); sd.energy = 3.0
    sun = bpy.data.objects.new("S", sd); bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(40))
    cam_data = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    d = size * 1.95
    # deux angles 3/4 (avant-droit, avant-gauche) pour ne pas se faire piéger par le raccourci
    angles = {"": Vector((d * 0.95, -d * 1.05, d * 0.72)), "_b": Vector((-d * 1.05, -d * 0.9, d * 0.62))}
    for suffix, offset in angles.items():
        cam.location = center + offset
        cam.rotation_euler = (center - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
        out = OUTDIR / (path.stem + suffix + ".png")
        bpy.context.scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
    print(f"[{path.name}] -> {path.stem}.png (+_b)")


for a in argv:
    p = pathlib.Path(a)
    if p.exists():
        try:
            render_glb(p)
        except Exception as e:
            print(f"[{a}] ERREUR: {str(e)[:200]}")

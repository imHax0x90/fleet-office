"""
Fleet Office asset generator for Blender.

Run inside Blender:

  blender --background --python tools/blender/generate_fleet_office_assets.py

The script generates the GLB files already consumed by public/app.js and writes
them to public/vendor/models/gen/.
"""

from __future__ import annotations

import math
import pathlib
from typing import Callable, Iterable

import bpy


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "public" / "vendor" / "models" / "gen"


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except Exception:
            pass
    if hasattr(scene, "eevee"):
        try:
            scene.eevee.taa_render_samples = 64
            scene.eevee.use_gtao = True
            scene.eevee.use_bloom = False
        except Exception:
            pass


def make_world() -> None:
    world = bpy.data.worlds.new("FleetOfficeWorld")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    bg = nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.96, 0.92, 0.84, 1.0)
        bg.inputs[1].default_value = 0.35
    bpy.context.scene.world = world


def _set_input(bsdf, names, value):
    """Affecte la première entrée existante (les noms du Principled BSDF ont
    changé entre Blender 3.x et 4.x/5.x : Clearcoat -> Coat Weight, etc.)."""
    if isinstance(names, str):
        names = (names,)
    for n in names:
        sock = bsdf.inputs.get(n)
        if sock is not None:
            try:
                sock.default_value = value
                return True
            except Exception:
                pass
    return False


def make_material(name: str, color, roughness=0.6, metallic=0.0, emission=None,
                  emission_strength=0.0, coat=0.0, coat_roughness=0.05,
                  sheen=0.0, sheen_tint=(1.0, 1.0, 1.0), spec=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    _set_input(bsdf, ("Specular IOR Level", "Specular"), spec)
    if coat > 0.0:  # vernis : reflets nets sur les métaux/laques
        _set_input(bsdf, ("Coat Weight", "Clearcoat"), coat)
        _set_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), coat_roughness)
    if sheen > 0.0:  # voile mat des tissus (lumière rasante)
        _set_input(bsdf, ("Sheen Weight", "Sheen"), sheen)
        _set_input(bsdf, ("Sheen Tint",), (*sheen_tint, 1.0) if not _is_scalar_sheen(bsdf) else sheen_tint[0])
    if emission is not None:
        _set_input(bsdf, ("Emission Color", "Emission"), (*emission, 1.0))
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def _is_scalar_sheen(bsdf):
    sock = bsdf.inputs.get("Sheen Tint")
    try:
        return not hasattr(sock.default_value, "__len__")
    except Exception:
        return True


M = {}


def init_materials():
    global M
    M = {
        "dark": make_material("Dark", (0.10, 0.11, 0.13), 0.42, 0.05, coat=0.25, coat_roughness=0.12),
        "metal": make_material("Metal", (0.23, 0.24, 0.27), 0.30, 0.85, coat=0.35, coat_roughness=0.08),
        "wood": make_material("Wood", (0.74, 0.58, 0.34), 0.55, 0.02, coat=0.15, coat_roughness=0.2),
        "wood_dark": make_material("WoodDark", (0.28, 0.18, 0.11), 0.55, 0.02, coat=0.18, coat_roughness=0.18),
        "fabric": make_material("Fabric", (0.73, 0.41, 0.26), 0.92, 0.00, sheen=0.5, sheen_tint=(0.95, 0.78, 0.66)),
        "fabric_soft": make_material("FabricSoft", (0.78, 0.79, 0.81), 0.92, 0.00, sheen=0.6, sheen_tint=(0.96, 0.97, 1.0)),
        "rubber": make_material("Rubber", (0.08, 0.08, 0.09), 0.78, 0.02),
        "glass": make_material("Glass", (0.65, 0.82, 0.97), 0.06, 0.00, coat=0.5, coat_roughness=0.02, spec=0.8),
        "leaf": make_material("Leaf", (0.28, 0.58, 0.31), 0.78, 0.00, sheen=0.3),
        "leaf2": make_material("Leaf2", (0.42, 0.75, 0.36), 0.78, 0.00, sheen=0.3),
        "ceramic": make_material("Ceramic", (0.92, 0.89, 0.82), 0.55, 0.00, coat=0.6, coat_roughness=0.05),
        "neon": make_material("Neon", (1.0, 0.68, 0.24), 0.25, 0.00, emission=(1.0, 0.66, 0.20), emission_strength=8.0),
        "label": make_material("Label", (0.92, 0.78, 0.46), 0.88, 0.00, sheen=0.2),
        # --- équipement de musculation ---
        "chrome": make_material("Chrome", (0.79, 0.80, 0.83), 0.16, 1.0, coat=0.5, coat_roughness=0.04),
        "steel_dark": make_material("SteelDark", (0.13, 0.14, 0.17), 0.34, 0.8, coat=0.3, coat_roughness=0.1),
        "leather": make_material("Leather", (0.08, 0.09, 0.11), 0.42, 0.0, coat=0.35, coat_roughness=0.14),
        "bumper_r": make_material("BumperR", (0.66, 0.11, 0.12), 0.66, 0.0),
        "bumper_b": make_material("BumperB", (0.09, 0.26, 0.58), 0.66, 0.0),
        "bumper_g": make_material("BumperG", (0.11, 0.46, 0.22), 0.66, 0.0),
        "bumper_y": make_material("BumperY", (0.82, 0.62, 0.10), 0.66, 0.0),
        "bumper_k": make_material("BumperK", (0.05, 0.05, 0.06), 0.74, 0.0),
        "accent": make_material("Accent", (0.95, 0.40, 0.12), 0.5, 0.0, coat=0.3),
    }


def set_material(obj, mat):
    if not obj or not obj.data or not hasattr(obj.data, "materials"):
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def shade(obj, smooth=True, bevel=0.02, segments=3):
    if smooth:
        try:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.shade_smooth()
        except Exception:
            pass
    if bevel > 0:
        mod = obj.modifiers.new(name="Bevel", type="BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"


def parent_to(child, parent):
    child.parent = parent


def root(name: str):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    return obj


def selected_tree(obj) -> Iterable[bpy.types.Object]:
    yield obj
    for child in obj.children:
        yield from selected_tree(child)


def export_glb(scene_root, filepath: pathlib.Path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected_tree(scene_root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = scene_root
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_yup=True,
    )


def cube(name, dims, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.02, parent=None):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (dims[0] / 2, dims[1] / 2, dims[2] / 2)
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=False, bevel=bevel)
    if parent:
        parent_to(obj, parent)
    return obj


def cyl(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, vertices=24, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=True, bevel=bevel)
    if parent:
        parent_to(obj, parent)
    return obj


def sphere(name, radius, loc=(0, 0, 0), mat=None, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=True, bevel=0.0)
    if parent:
        parent_to(obj, parent)
    return obj


def torus(name, major=0.4, minor=0.08, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=32, minor_segments=16, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=True, bevel=0.0)
    if parent:
        parent_to(obj, parent)
    return obj


def capsule(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, parent=None):
    bpy.ops.mesh.primitive_capsule_add(radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=True, bevel=0.0)
    if parent:
        parent_to(obj, parent)
    return obj


def plane(name, size=(1, 1), loc=(0, 0, 0), rot=(0, 0, 0), mat=None, parent=None):
    bpy.ops.mesh.primitive_plane_add(location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, 1)
    if mat:
        set_material(obj, mat)
    shade(obj, smooth=False, bevel=0.0)
    if parent:
        parent_to(obj, parent)
    return obj


def make_prop_frame(parent, name, size=(1, 1, 1), material=None, thickness=0.07):
    outer = cube(f"{name}_frame", size, mat=material or M["metal"], parent=parent, bevel=thickness * 0.15)
    return outer


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


AX = (0, math.pi / 2, 0)  # aligne l'axe d'un cylindre/disque sur X (sens de la barre)
BUMPERS = ("bumper_r", "bumper_b", "bumper_g", "bumper_y", "bumper_k")


def _load_plates(parent, x_inner, side, count=3, r0=0.235, thick=0.06):
    """Empile des disques bumper colorés vers l'extérieur le long de X (+ moyeu chromé)."""
    for i in range(count):
        x = x_inner + side * (i * (thick + 0.006))
        rad = r0 - i * 0.014
        cyl(f"plate_{side}_{i}", rad, thick, loc=(x, 0, 0), rot=AX, mat=M[BUMPERS[i % len(BUMPERS)]],
            parent=parent, vertices=46, bevel=0.012)
        cyl(f"plate_hub_{side}_{i}", 0.032, thick + 0.004, loc=(x, 0, 0), rot=AX, mat=M["chrome"],
            parent=parent, vertices=20)


def build_barbell(name="barbell", length=2.2, loaded=True, plate_count=3):
    """Barre olympique : manche acier + manchons chromés + disques bumper + bagues."""
    r = root(name)
    cyl("shaft", 0.016, length * 0.66, rot=AX, mat=M["metal"], parent=r, vertices=22)
    for side in (-1, 1):
        cyl(f"sleeve_{side}", 0.026, length * 0.26, loc=(side * length * 0.40, 0, 0), rot=AX,
            mat=M["chrome"], parent=r, vertices=24)
        cyl(f"flange_{side}", 0.05, 0.03, loc=(side * length * 0.30, 0, 0), rot=AX, mat=M["steel_dark"],
            parent=r, vertices=22)
        if loaded:
            x_inner = side * length * 0.33
            _load_plates(r, x_inner, side, count=plate_count)
            cx = x_inner + side * (plate_count * 0.066 + 0.03)
            cyl(f"collar_{side}", 0.045, 0.05, loc=(cx, 0, 0), rot=AX, mat=M["accent"], parent=r, vertices=18)
    return r


def build_dumbbell(name="dumbbells"):
    """Haltère hexagonal (têtes caoutchouc) à manche acier moleté."""
    r = root(name)
    cyl("handle", 0.043, 0.58, rot=AX, mat=M["metal"], parent=r, vertices=20)
    for side in (-1, 1):
        x = side * 0.34
        for i, (rad, w) in enumerate(((0.15, 0.1), (0.2, 0.13))):
            cyl(f"hex_{side}_{i}", rad, w, loc=(x + side * i * 0.09, 0, 0), rot=AX, mat=M["bumper_k"],
                parent=r, vertices=6, bevel=0.012)
        cyl(f"cap_{side}", 0.05, 0.04, loc=(x + side * 0.22, 0, 0), rot=AX, mat=M["chrome"], parent=r, vertices=18)
    return r


def build_kettlebell(name="kettlebell"):
    body = sphere("body", 0.27, loc=(0, 0.28, 0), mat=M["bumper_k"], parent=(r := root(name)))
    body.scale = (1.0, 0.92, 1.0)
    cyl("base", 0.2, 0.05, loc=(0, 0.045, 0), mat=M["steel_dark"], parent=r, bevel=0.02, vertices=28)
    cube("neck", (0.16, 0.12, 0.16), loc=(0, 0.46, 0), mat=M["bumper_k"], parent=r, bevel=0.03)
    torus("handle", major=0.14, minor=0.03, loc=(0, 0.55, 0), rot=(0, 0, 0), mat=M["steel_dark"], parent=r)
    return r


def build_plate_tree(name="plate_tree"):
    r = root(name)
    cube("base", (0.82, 0.1, 0.82), loc=(0, 0.05, 0), mat=M["steel_dark"], parent=r, bevel=0.02)
    cyl("pole", 0.07, 1.95, loc=(0, 0.97, 0), mat=M["metal"], parent=r, vertices=20)
    cube("cap", (0.16, 0.1, 0.16), loc=(0, 1.96, 0), mat=M["accent"], parent=r, bevel=0.02)
    for side, y, col in ((-1, 0.5, "bumper_r"), (1, 0.84, "bumper_b"), (-1, 1.18, "bumper_g"), (1, 1.52, "bumper_y")):
        cyl(f"peg_{side}_{y}", 0.032, 0.4, loc=(0.18 * side, y, 0), rot=AX, mat=M["metal"], parent=r, vertices=16)
        for i in range(2):
            cyl(f"plate_{side}_{y}_{i}", 0.22 - i * 0.02, 0.055, loc=(0.3 * side + side * i * 0.07, y, 0),
                rot=AX, mat=M[col], parent=r, vertices=44, bevel=0.01)
    return r


def build_dumbbell_rack(name="dumbbell_rack"):
    r = root(name)
    cube("frame", (1.6, 0.1, 0.74), loc=(0, 0.96, 0), mat=M["steel_dark"], parent=r, bevel=0.02)
    for x in (-0.78, 0.78):
        cube(f"end_{x}", (0.1, 1.0, 0.7), loc=(x, 0.5, 0), mat=M["steel_dark"], parent=r, bevel=0.02)
    for z, y in ((-0.2, 0.52), (0.0, 0.76), (0.2, 1.0)):
        cube(f"shelf_{z}", (1.42, 0.05, 0.2), loc=(0, y, z), mat=M["metal"], parent=r, bevel=0.012)
        cube(f"lip_{z}", (1.42, 0.07, 0.03), loc=(0, y + 0.04, z + 0.1), mat=M["accent"], parent=r, bevel=0.008)
        for i in range(4):
            d = build_dumbbell(f"dumbbell_{z}_{i}")
            s = 0.7 - z * 0.2
            d.scale = (s, s, s)
            d.rotation_euler = (math.radians(90), 0, 0)  # haltères couchés en travers de l'étagère
            d.location = (-0.5 + i * 0.33, y + 0.12, z)
            parent_to(d, r)
    return r


def build_bench(name="bench"):
    """Banc plat : assise cuir épaisse + bâti acier en A."""
    r = root(name)
    cube("pad", (1.35, 0.14, 0.36), loc=(0, 0.49, 0), mat=M["leather"], parent=r, bevel=0.06)
    cube("pad_seam", (1.36, 0.04, 0.06), loc=(0, 0.56, 0), mat=M["steel_dark"], parent=r, bevel=0.01)
    cube("spine", (1.42, 0.09, 0.1), loc=(0, 0.4, 0), mat=M["steel_dark"], parent=r, bevel=0.01)
    for x in (-0.52, 0.52):
        for z in (-0.22, 0.22):
            cube(f"leg_{x}_{z}", (0.07, 0.42, 0.07), loc=(x, 0.21, z),
                 rot=(math.radians(12 if z > 0 else -12), 0, 0), mat=M["metal"], parent=r, bevel=0.01)
        cube(f"foot_{x}", (0.1, 0.05, 0.6), loc=(x, 0.03, 0), mat=M["dark"], parent=r, bevel=0.01)
    return r


def build_weight_bench(name="weight_bench"):
    """Banc de développé couché : banc plat + colonnes à J-cups + barre chargée."""
    r = root(name)
    bench = build_bench("bench_core")
    parent_to(bench, r)
    bench.location = (0, 0, 0)
    for z in (-0.42, 0.42):
        cube(f"upright_{z}", (0.08, 1.34, 0.08), loc=(-0.72, 0.67, z), mat=M["metal"], parent=r, bevel=0.01)
        cube(f"upfoot_{z}", (0.18, 0.06, 0.34), loc=(-0.72, 0.04, z), mat=M["dark"], parent=r, bevel=0.01)
        cube(f"jcup_{z}", (0.12, 0.1, 0.16), loc=(-0.66, 1.22, z), mat=M["accent"], parent=r, bevel=0.02)
        cube(f"jcup_lip_{z}", (0.1, 0.14, 0.05), loc=(-0.62, 1.27, z), mat=M["accent"], parent=r, bevel=0.02)
    cube("crossbrace", (0.08, 0.08, 0.95), loc=(-0.72, 0.5, 0), mat=M["metal"], parent=r, bevel=0.01)
    return r


def build_squat_rack(name="squat_rack"):
    """Power cage : 4 montants, cadre haut, barre de traction, J-cups, barres de sécurité,
    pegs de rangement chargés, et barre olympique chargée sur les J-cups."""
    r = root(name)
    H = 2.42
    fz, bz = 0.58, -0.58
    xs = (-0.82, 0.82)
    # pieds (rails avant-arrière) + patins
    for x in xs:
        cube(f"foot_{x}", (0.13, 0.09, 1.55), loc=(x, 0.045, 0), mat=M["steel_dark"], parent=r, bevel=0.02)
        for z in (fz + 0.2, bz - 0.2):
            cube(f"pad_{x}_{z}", (0.2, 0.05, 0.22), loc=(x, 0.025, z), mat=M["dark"], parent=r, bevel=0.01)
    # 4 montants
    for x in xs:
        for z in (fz, bz):
            cube(f"post_{x}_{z}", (0.1, H, 0.1), loc=(x, H / 2, z), mat=M["metal"], parent=r, bevel=0.012)
    # cadre supérieur (périmètre)
    for z in (fz, bz):
        cube(f"top_x_{z}", (1.74, 0.1, 0.1), loc=(0, H - 0.05, z), mat=M["metal"], parent=r, bevel=0.012)
    for x in xs:
        cube(f"top_z_{x}", (0.1, 0.1, 1.26), loc=(x, H - 0.05, 0), mat=M["metal"], parent=r, bevel=0.012)
    # barre de traction chromée (façade)
    cyl("pullup", 0.028, 1.78, loc=(0, H - 0.05, fz), rot=AX, mat=M["chrome"], parent=r, vertices=22)
    # perçages sur la face interne des montants avant
    for x in xs:
        for i in range(20):
            cube(f"hole_{x}_{i}", (0.034, 0.022, 0.03), loc=(x, 0.45 + i * 0.085, fz - 0.065),
                 mat=M["steel_dark"], parent=r)
    # J-cups (montants avant) + barres de sécurité horizontales avant-arrière (cubes = axe sûr)
    bar_y = 1.40
    for x in xs:
        inn = -0.07 if x > 0 else 0.07
        cube(f"jcup_{x}", (0.16, 0.1, 0.2), loc=(x + inn, bar_y, fz - 0.04), mat=M["accent"], parent=r, bevel=0.02)
        cube(f"jcup_lip_{x}", (0.12, 0.13, 0.06), loc=(x + inn, bar_y + 0.09, fz - 0.13), mat=M["accent"], parent=r, bevel=0.02)
        cube(f"safety_{x}", (0.06, 0.06, 1.16), loc=(x, 0.95, 0), mat=M["accent"], parent=r, bevel=0.02)
    # barre olympique chargée, posée sur les J-cups (axe X = façade, orientation prouvée OK)
    bar = build_barbell("cage_bar", length=2.12, loaded=True, plate_count=3)
    bar.location = (0, bar_y + 0.05, fz - 0.04)
    parent_to(bar, r)
    return r


def build_cable_machine(name="cable_machine"):
    r = root(name)
    cube("base", (1.65, 0.12, 1.0), loc=(0, 0.06, 0), mat=M["dark"], parent=r, bevel=0.02)
    cube("rear_upright", (0.12, 2.1, 0.16), loc=(-0.58, 1.05, 0), mat=M["metal"], parent=r, bevel=0.015)
    cube("front_upright", (0.12, 2.1, 0.16), loc=(0.58, 1.05, 0), mat=M["metal"], parent=r, bevel=0.015)
    cube("top_bar", (1.45, 0.08, 0.16), loc=(0, 2.05, 0), mat=M["metal"], parent=r, bevel=0.01)
    cube("cross_bar", (1.0, 0.08, 0.12), loc=(0, 1.5, 0), mat=M["metal"], parent=r, bevel=0.01)
    cube("stack_box", (0.42, 1.12, 0.34), loc=(-0.46, 0.58, 0), mat=M["dark"], parent=r, bevel=0.02)
    cube("head_unit", (0.62, 0.24, 0.48), loc=(0.36, 1.72, 0), mat=M["metal"], parent=r, bevel=0.02)
    cube("pad", (0.44, 0.08, 0.3), loc=(0.18, 0.48, 0), mat=M["fabric_soft"], parent=r, bevel=0.015)
    for i in range(7):
        cube(f"plate_{i}", (0.29, 0.07, 0.24), loc=(-0.46, 0.16 + i * 0.14, 0), mat=M["metal"], parent=r, bevel=0.01)
    cyl("pulley_top", 0.08, 0.12, loc=(0.0, 1.86, 0), rot=(math.pi / 2, 0, 0), mat=M["metal"], parent=r)
    cyl("pulley_mid", 0.07, 0.12, loc=(0.0, 1.14, 0), rot=(math.pi / 2, 0, 0), mat=M["metal"], parent=r)
    cyl("pulley_low", 0.06, 0.12, loc=(0.0, 0.54, 0), rot=(math.pi / 2, 0, 0), mat=M["metal"], parent=r)
    cyl("handle_bar", 0.035, 0.56, loc=(0.18, 0.28, 0.0), rot=(0, math.pi / 2, 0), mat=M["dark"], parent=r)
    cube("foot_left", (0.18, 0.06, 0.36), loc=(-0.6, 0.03, 0.32), mat=M["metal"], parent=r, bevel=0.01)
    cube("foot_right", (0.18, 0.06, 0.36), loc=(0.6, 0.03, 0.32), mat=M["metal"], parent=r, bevel=0.01)
    return r


def build_treadmill(name="treadmill"):
    r = root(name)
    cube("deck", (1.95, 0.16, 0.9), loc=(0, 0.22, 0), rot=(0, math.radians(4), 0), mat=M["dark"], parent=r, bevel=0.035)
    cube("belt", (1.7, 0.04, 0.58), loc=(0, 0.28, 0), rot=(0, math.radians(4), 0), mat=M["rubber"], parent=r, bevel=0.01)
    cube("motor_cover", (0.58, 0.24, 0.42), loc=(-0.68, 0.22, 0), mat=M["metal"], parent=r, bevel=0.03)
    cube("console_stem", (0.12, 0.75, 0.12), loc=(0.18, 0.72, 0), mat=M["metal"], parent=r, bevel=0.01)
    cube("console", (0.52, 0.14, 0.42), loc=(0.42, 1.18, 0), mat=M["metal"], parent=r, bevel=0.03)
    cube("screen", (0.38, 0.02, 0.24), loc=(0.45, 1.21, 0.14), mat=M["glass"], parent=r, bevel=0.005)
    cube("handrail_left", (1.16, 0.06, 0.06), loc=(-0.22, 1.05, 0.42), rot=(0, 0, math.radians(8)), mat=M["metal"], parent=r, bevel=0.01)
    cube("handrail_right", (1.16, 0.06, 0.06), loc=(-0.22, 1.05, -0.42), rot=(0, 0, math.radians(8)), mat=M["metal"], parent=r, bevel=0.01)
    cube("rear_housing", (0.28, 0.14, 0.82), loc=(0.72, 0.2, 0), mat=M["metal"], parent=r, bevel=0.015)
    for x in (-0.82, 0.82):
        cyl(f"leg_{x}", 0.04, 0.92, loc=(x, 0.46, 0), rot=(math.radians(90), 0, 0), mat=M["metal"], parent=r)
    return r


def build_treadmill_pro(name="treadmill_pro"):
    r = build_treadmill(name)
    cube("hood", (0.58, 0.28, 0.82), loc=(-0.62, 0.98, 0), rot=(0, math.radians(2), 0), mat=M["metal"], parent=r, bevel=0.02)
    cube("rear_column", (0.2, 0.82, 0.24), loc=(-0.88, 1.02, 0), mat=M["metal"], parent=r, bevel=0.015)
    cube("side_panel", (0.24, 0.52, 0.42), loc=(-0.3, 0.92, 0.5), rot=(0, math.radians(8), 0), mat=M["dark"], parent=r, bevel=0.015)
    torus("fan_ring", major=0.13, minor=0.025, loc=(-0.64, 1.28, 0), rot=(math.pi / 2, 0, 0), mat=M["dark"], parent=r)
    cube("fan_housing", (0.22, 0.18, 0.22), loc=(-0.68, 1.28, 0), mat=M["metal"], parent=r, bevel=0.01)
    return r


def build_spin_bike(name="spin_bike"):
    r = root(name)
    cyl("flywheel", 0.42, 0.1, loc=(0.06, 0.54, 0), rot=(0, math.pi / 2, 0), mat=M["dark"], parent=r)
    cyl("axle", 0.03, 1.1, loc=(-0.12, 0.9, 0), rot=(0, 0, math.radians(10)), mat=M["metal"], parent=r)
    cube("base_front", (1.05, 0.06, 0.08), loc=(0.2, 0.06, 0), rot=(0, 0, math.radians(14)), mat=M["metal"], parent=r, bevel=0.01)
    cube("base_back", (0.98, 0.06, 0.08), loc=(-0.38, 0.06, 0), rot=(0, 0, math.radians(-12)), mat=M["metal"], parent=r, bevel=0.01)
    cube("main_frame", (0.08, 0.62, 0.08), loc=(-0.12, 0.83, 0), rot=(0, 0, math.radians(8)), mat=M["metal"], parent=r, bevel=0.01)
    cube("seat_post", (0.08, 0.54, 0.08), loc=(-0.2, 1.16, 0), rot=(0, 0, math.radians(8)), mat=M["metal"], parent=r, bevel=0.01)
    cube("seat", (0.34, 0.09, 0.2), loc=(-0.08, 1.38, 0), rot=(0, 0, math.radians(8)), mat=M["fabric"], parent=r, bevel=0.02)
    cube("handlebar_stem", (0.08, 0.58, 0.08), loc=(0.12, 1.0, 0), rot=(0, 0, math.radians(-6)), mat=M["metal"], parent=r, bevel=0.01)
    cube("handlebar", (0.62, 0.05, 0.05), loc=(0.3, 1.38, 0), rot=(0, 0, math.radians(-18)), mat=M["metal"], parent=r, bevel=0.01)
    cube("handlebar_grip_l", (0.12, 0.06, 0.06), loc=(0.56, 1.42, 0.12), rot=(0, 0, math.radians(-18)), mat=M["dark"], parent=r, bevel=0.01)
    cube("handlebar_grip_r", (0.12, 0.06, 0.06), loc=(0.56, 1.42, -0.12), rot=(0, 0, math.radians(-18)), mat=M["dark"], parent=r, bevel=0.01)
    cube("console", (0.18, 0.12, 0.18), loc=(0.16, 1.18, 0), mat=M["dark"], parent=r, bevel=0.02)
    cyl("pedal_left", 0.045, 0.18, loc=(0.04, 0.52, 0.3), rot=(math.pi / 2, 0, 0), mat=M["dark"], parent=r)
    cyl("pedal_right", 0.045, 0.18, loc=(0.04, 0.52, -0.3), rot=(math.pi / 2, 0, 0), mat=M["dark"], parent=r)
    cube("crank_cover", (0.18, 0.14, 0.18), loc=(0.02, 0.54, 0), mat=M["metal"], parent=r, bevel=0.02)
    return r


def build_plant(name="plant", loc=(0, 0, 0), scale=1.0, parent=None):
    r = root(name)
    r.location = loc
    r.scale = (scale, scale, scale)
    cyl("pot", 0.18, 0.28, loc=(0, 0.14, 0), mat=M["ceramic"], parent=r, bevel=0.02)
    cyl("soil", 0.14, 0.03, loc=(0, 0.3, 0), mat=M["dark"], parent=r, bevel=0.01)
    for i in range(7):
        ang = (i / 7.0) * math.tau
        leaf = sphere(f"leaf_{i}", 0.09, loc=(math.cos(ang) * 0.16, 0.5 + (i % 3) * 0.03, math.sin(ang) * 0.16), mat=M["leaf" if i % 2 == 0 else "leaf2"], parent=r)
        leaf.scale = (0.5, 1.4, 0.45)
        leaf.rotation_euler = (0, math.radians(55), ang)
    if parent:
        parent_to(r, parent)
    return r


def build_wall_art(name="wall_art"):
    r = root(name)
    cube("frame", (1.0, 1.6, 0.07), loc=(0, 0.8, 0), mat=M["wood_dark"], parent=r, bevel=0.01)
    plane("panel", (0.86, 1.46), loc=(0, 0.8, 0.04), mat=M["label"], parent=r)
    for idx, x in enumerate((-0.22, 0.0, 0.22)):
        cube(f"stripe_{idx}", (0.08, 1.0 + idx * 0.12, 0.025), loc=(x, 0.8, 0.06), mat=M["wood"], parent=r, bevel=0.005)
    return r


def build_surfboard(name="surfboard"):
    r = root(name)
    board = cube("board_core", (0.52, 2.15, 0.09), loc=(0, 1.08, 0), mat=M["wood"], parent=r, bevel=0.06)
    board.scale = (0.9, 1.0, 1.0)
    nose = sphere("nose", 0.26, loc=(0, 2.08, 0), mat=M["label"], parent=r)
    nose.scale = (1.0, 0.9, 0.5)
    tail = sphere("tail", 0.18, loc=(0, 0.12, 0), mat=M["label"], parent=r)
    tail.scale = (1.0, 0.9, 0.6)
    for x in (-0.11, 0.11):
        cube(f"fin_{x}", (0.03, 0.16, 0.08), loc=(x, 0.2, -0.02), mat=M["dark"], parent=r, bevel=0.01)
    return r


def build_chair(name="chair"):
    r = root(name)
    cube("seat", (0.5, 0.08, 0.45), loc=(0, 0.48, 0), mat=M["fabric"], parent=r, bevel=0.02)
    cube("back", (0.46, 0.55, 0.07), loc=(0, 0.82, -0.17), mat=M["fabric"], parent=r, bevel=0.02)
    for x in (-0.18, 0.18):
        cyl(f"leg_{x}_front", 0.02, 0.48, loc=(x, 0.24, 0.15), mat=M["metal"], parent=r)
        cyl(f"leg_{x}_back", 0.02, 0.48, loc=(x, 0.24, -0.15), mat=M["metal"], parent=r)
    return r


def build_armchair(name="armchair"):
    r = root(name)
    cube("seat", (0.75, 0.15, 0.68), loc=(0, 0.38, 0), mat=M["fabric"], parent=r, bevel=0.03)
    cube("back", (0.75, 0.55, 0.18), loc=(0, 0.82, -0.18), mat=M["fabric"], parent=r, bevel=0.03)
    cube("arm_l", (0.12, 0.38, 0.58), loc=(-0.33, 0.58, 0.0), mat=M["fabric"], parent=r, bevel=0.02)
    cube("arm_r", (0.12, 0.38, 0.58), loc=(0.33, 0.58, 0.0), mat=M["fabric"], parent=r, bevel=0.02)
    for x in (-0.28, 0.28):
        cyl(f"leg_{x}_1", 0.02, 0.28, loc=(x, 0.12, 0.24), mat=M["metal"], parent=r)
        cyl(f"leg_{x}_2", 0.02, 0.28, loc=(x, 0.12, -0.24), mat=M["metal"], parent=r)
    return r


def build_sofa(name="sofa"):
    r = root(name)
    cube("base", (1.7, 0.18, 0.78), loc=(0, 0.36, 0), mat=M["fabric"], parent=r, bevel=0.04)
    cube("back", (1.7, 0.55, 0.18), loc=(0, 0.9, -0.24), mat=M["fabric"], parent=r, bevel=0.04)
    cube("arm_l", (0.14, 0.5, 0.78), loc=(-0.77, 0.62, 0), mat=M["fabric"], parent=r, bevel=0.03)
    cube("arm_r", (0.14, 0.5, 0.78), loc=(0.77, 0.62, 0), mat=M["fabric"], parent=r, bevel=0.03)
    return r


def build_bookshelf(name="bookshelf"):
    r = root(name)
    cube("frame", (1.3, 1.9, 0.28), loc=(0, 0.95, 0), mat=M["metal"], parent=r, bevel=0.02)
    for level in (0.45, 0.92, 1.39):
        cube(f"shelf_{level}", (1.18, 0.04, 0.22), loc=(0, level, 0), mat=M["wood_dark"], parent=r, bevel=0.008)
        for i in range(5):
            x = -0.42 + i * 0.2
            cube(f"book_{level}_{i}", (0.08, 0.22 + (i % 3) * 0.05, 0.03), loc=(x, level + 0.14, 0.05), mat=M["label"], parent=r, bevel=0.005)
        build_plant(f"plant_{level}", loc=(0.46, level + 0.04, 0), scale=0.8, parent=r)
    return r


def build_desk(name="desk"):
    r = root(name)
    cube("top", (1.9, 0.08, 0.82), loc=(0, 0.78, 0), mat=M["wood_dark"], parent=r, bevel=0.02)
    for x in (-0.82, 0.82):
        cube(f"leg_{x}", (0.09, 0.72, 0.09), loc=(x, 0.36, 0), mat=M["metal"], parent=r, bevel=0.01)
    cube("monitor", (0.55, 0.32, 0.05), loc=(0.45, 1.12, -0.15), mat=M["dark"], parent=r, bevel=0.01)
    cube("screen", (0.48, 0.24, 0.02), loc=(0.45, 1.12, -0.115), mat=M["glass"], parent=r, bevel=0.0)
    cube("laptop", (0.32, 0.04, 0.22), loc=(-0.32, 0.89, 0.05), rot=(math.radians(78), 0, math.radians(8)), mat=M["metal"], parent=r, bevel=0.01)
    cube("mug", (0.10, 0.10, 0.10), loc=(0.1, 0.89, 0.13), mat=M["ceramic"], parent=r, bevel=0.02)
    build_plant("desk_plant", loc=(0.68, 0.78, 0.2), scale=0.75, parent=r)
    return r


def build_workstation(name="workstation"):
    r = root(name)
    desk = build_desk("desk_block")
    desk.scale = (1.0, 1.0, 1.0)
    parent_to(desk, r)
    desk.location = (0, 0, 0)
    chair = build_chair("chair_block")
    chair.location = (-0.2, 0, 0.65)
    chair.rotation_euler = (0, 0, math.radians(180))
    parent_to(chair, r)
    cube("partition", (0.08, 1.2, 1.1), loc=(-0.95, 1.0, 0), mat=M["fabric"], parent=r, bevel=0.01)
    cube("task_light", (0.15, 0.35, 0.04), loc=(0.72, 1.35, -0.25), rot=(math.radians(-20), 0, math.radians(35)), mat=M["dark"], parent=r, bevel=0.01)
    return r


def build_task_lamp(name="task_lamp"):
    r = root(name)
    cyl("base", 0.09, 0.03, loc=(0, 0.015, 0), mat=M["metal"], parent=r)
    cyl("stem", 0.015, 0.55, loc=(0, 0.29, 0), mat=M["metal"], parent=r)
    cyl("arm1", 0.012, 0.33, loc=(0.14, 0.48, 0), rot=(0, 0, math.radians(24)), mat=M["metal"], parent=r)
    cyl("arm2", 0.012, 0.26, loc=(0.28, 0.63, 0), rot=(0, 0, math.radians(-28)), mat=M["metal"], parent=r)
    cube("head", (0.16, 0.09, 0.16), loc=(0.38, 0.76, 0), mat=M["neon"], parent=r, bevel=0.01)
    return r


def build_storage_cabinet(name="storage_cabinet"):
    r = root(name)
    cube("body", (1.25, 1.05, 0.42), loc=(0, 0.525, 0), mat=M["dark"], parent=r, bevel=0.025)
    for i in range(3):
        cube(f"drawer_{i}", (1.12, 0.26, 0.08), loc=(0, 0.2 + i * 0.32, 0.18), mat=M["wood_dark"], parent=r, bevel=0.01)
    for x in (-0.47, 0.47):
        cyl(f"leg_{x}", 0.03, 0.15, loc=(x, 0.07, 0), mat=M["metal"], parent=r)
    build_plant("cabinet_plant", loc=(0.45, 1.12, 0.12), scale=0.55, parent=r)
    return r


def build_meeting_table(name="meeting_table"):
    r = root(name)
    cube("top", (2.8, 0.08, 1.1), loc=(0, 0.76, 0), mat=M["wood_dark"], parent=r, bevel=0.05)
    cyl("pedestal", 0.12, 0.68, loc=(0, 0.35, 0), mat=M["metal"], parent=r)
    cube("foot", (1.2, 0.06, 1.2), loc=(0, 0.03, 0), mat=M["dark"], parent=r, bevel=0.02)
    for x in (-1.15, 1.15):
        chair = build_chair(f"chair_{x}")
        chair.location = (x, 0, 0.8)
        chair.rotation_euler = (0, 0, math.radians(180 if x < 0 else 0))
        parent_to(chair, r)
    return r


def build_mirror_panel(name="mirror_panel"):
    r = root(name)
    cube("frame", (1.4, 2.4, 0.08), loc=(0, 1.2, 0), mat=M["metal"], parent=r, bevel=0.015)
    plane("mirror", (1.22, 2.18), loc=(0, 1.2, 0.05), mat=M["glass"], parent=r)
    return r


ASSETS: list[tuple[str, Callable[[], bpy.types.Object]]] = [
    ("bench", build_bench),
    ("weight_bench", build_weight_bench),
    ("squat_rack", build_squat_rack),
    ("dumbbells", build_dumbbell),
    ("dumbbell_rack", build_dumbbell_rack),
    ("plate_tree", build_plate_tree),
    ("cable_machine", build_cable_machine),
    ("treadmill", build_treadmill),
    ("treadmill_pro", build_treadmill_pro),
    ("spin_bike", build_spin_bike),
    ("kettlebell", build_kettlebell),
    ("plant", build_plant),
    ("wall_art", build_wall_art),
    ("surfboard", build_surfboard),
    ("chair", build_chair),
    ("armchair", build_armchair),
    ("sofa", build_sofa),
    ("bookshelf", build_bookshelf),
    ("desk", build_desk),
    ("workstation", build_workstation),
    ("task_lamp", build_task_lamp),
    ("storage_cabinet", build_storage_cabinet),
    ("meeting_table", build_meeting_table),
    ("mirror_panel", build_mirror_panel),
]


def run() -> None:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    init_materials()
    for filename, builder in ASSETS:
        reset_scene()
        make_world()
        init_materials()
        root_obj = builder()
        if root_obj is None:
            raise RuntimeError(f"builder {filename} did not return a root object")
        export_glb(root_obj, EXPORT_DIR / f"{filename}.glb")
        print(f"[fleet-office] exported {filename}.glb")


if __name__ == "__main__":
    run()

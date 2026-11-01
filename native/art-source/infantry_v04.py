"""Original procedural infantry kit for the native game; no third-party art.

CPU authoring/export only. No renderer or gameplay code is modified. Art uses
the original game's Y-up/+Z-forward scale (helmet centre about Y=2.74).
Rigid node parts and TEXCOORD_1.x carry the shared shader animation contract.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import zlib

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[2]
PARTS = {"torso": 0, "head": 1, "upperarm.L": 2, "forearm.L": 3,
         "upperarm.R": 4, "forearm.R": 5, "weapon": 6}
PIVOTS = {"torso": (0, 1.22, 0), "head": (0, 2.38, 0),
          "upperarm.L": (-.47, 2.15, .02), "forearm.L": (-.45, 1.83, .43),
          "upperarm.R": (.47, 2.15, .02), "forearm.R": (.65, 1.70, .35),
          "weapon": (.22, 1.94, .56)}
PARENTS = {"torso": None, "head": "torso", "upperarm.L": "torso",
           "forearm.L": "upperarm.L", "upperarm.R": "torso",
           "forearm.R": "upperarm.R", "weapon": "forearm.R"}
BUDGETS = {0: (1500, 2500), 1: (700, 1000), 2: (250, 400)}
LEG_PAIR_BUDGETS = {0: 500, 1: 200, 2: 80}
ROLES = ("infantry", "atrifle", "machinegunner", "sniper", "assault",
         "engineer", "operator", "mog", "atgm", "medic")
SWATCH = {"fabric": 0, "webbing": 1, "armor": 2, "boot": 3, "skin": 4,
          "steel": 5, "polymer": 6, "optic": 7, "medical": 8, "rescue": 9,
          "insignia": 10, "radio": 11, "khaki": 12, "helmet": 13,
          "camo": 14, "rubber": 15}


def args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/native/infantry-v04")
    parser.add_argument("--roles", nargs="+", choices=ROLES, default=list(ROLES))
    parser.add_argument("--lods", nargs="+", type=int, choices=BUDGETS, default=[0, 1, 2])
    parser.add_argument("--texture-size", type=int, choices=[512], default=512)
    parser.add_argument("--save-blend", action="store_true")
    parser.add_argument("--strict-budgets", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def game_vector(point):
    x, y, z = point
    return (x, -z, y)


def source_catalog():
    program = ("import {GROUND_UNITS,isInfantry} from './src/game/config.js';"
               "console.log(JSON.stringify(Object.entries(GROUND_UNITS).filter(([k])=>isInfantry(k))"
               ".map(([key,d])=>({key,name:d.name,members:d.members||1,support:d.support||false,role:d.role}))));")
    result = subprocess.run(["node", "--input-type=module", "-e", program], cwd=ROOT,
                            check=True, capture_output=True, encoding="utf-8")
    catalog = json.loads(result.stdout)
    if {entry["key"] for entry in catalog} != set(ROLES):
        raise RuntimeError("Original infantry catalogue changed; update the art roles explicitly")
    return catalog


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


def write_png(path, width, height, raw):
    rows = b"".join(b"\x00" + raw[y * width * 4:(y + 1) * width * 4] for y in range(height))
    payload = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
    path.write_bytes(payload)


def textures(output, size):
    # These are sRGB byte colours for albedo and linear bytes for data maps.
    palette = [(76, 88, 61), (55, 67, 43), (56, 66, 46), (23, 29, 25),
               (135, 112, 89), (38, 45, 42), (22, 28, 25), (23, 48, 53),
               (184, 190, 177), (157, 60, 37), (185, 188, 173), (37, 51, 43),
               (107, 102, 73), (65, 77, 51), (49, 62, 39), (15, 21, 18)]
    maps = {name: bytearray(size * size * 4) for name in ("albedo", "orm", "normal")}
    cell = size // 4
    for y in range(size):
        for x in range(size):
            index = y // cell * 4 + x // cell
            seed = ((x * 73856093) ^ (y * 19349663) ^ 81604) & 0xffffffff
            grain = ((seed >> 10) & 31) - 15
            weave = (1 if (x + y) % 4 == 0 else -1) if index in (0, 1, 2, 12, 14) else 0
            camouflage = -7 if index in (0, 14) and math.sin(x * .085 + math.sin(y * .04)) + math.cos(y * .065) > .75 else 0
            rgb = tuple(max(0, min(255, c + int(grain * .18) + weave + camouflage)) for c in palette[index])
            pixel = (y * size + x) * 4
            maps["albedo"][pixel:pixel + 4] = bytes((*rgb, 255))
            rough = 222 if index in (0, 1, 2, 3, 12, 13, 14, 15) else 153 if index == 5 else 102 if index == 7 else 204
            metal = 180 if index == 5 else 0
            maps["orm"][pixel:pixel + 4] = bytes((255, max(0, min(255, rough + grain // 3)), metal, 255))
            bump = weave if index in (0, 1, 2, 12, 14) else 0
            maps["normal"][pixel:pixel + 4] = bytes((128 + bump, 128 - bump, 255, 255))
    result, loaded = [], {}
    for name, data in maps.items():
        raw_path = output / ("infantry_atlas_" + name + ".RGBA8.bin")
        png_path = output / ("infantry_atlas_" + name + ".png")
        raw_path.write_bytes(data)
        write_png(png_path, size, size, data)
        image = bpy.data.images.load(str(png_path), check_existing=False)
        image.colorspace_settings.name = "sRGB" if name == "albedo" else "Non-Color"
        image.pack()
        loaded[name] = image
        result.append(dict(name="infantry_atlas_" + name, rgba=raw_path.name, png=png_path.name,
                           width=size, height=size, channels=4, rowOrder="top-to-bottom",
                           colorSpace="sRGB" if name == "albedo" else "linear",
                           sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)))
    return result, loaded


def material(images):
    mat = bpy.data.materials.new("infantry_v04_shared_opaque_pbr")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    albedo = nodes.new("ShaderNodeTexImage"); albedo.image = images["albedo"]
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    packed = nodes.new("ShaderNodeTexImage"); packed.image = images["orm"]
    separate = nodes.new("ShaderNodeSeparateColor"); links.new(packed.outputs["Color"], separate.inputs[0])
    links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    normal_tex = nodes.new("ShaderNodeTexImage"); normal_tex.image = images["normal"]
    normal = nodes.new("ShaderNodeNormalMap"); normal.inputs["Strength"].default_value = .18
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Alpha"].default_value = 1
    mat["vertex_color_alpha"] = "team insignia mask, not transparency"
    return mat


def empty(name, parent, world_pivot, parent_pivot=(0, 0, 0), rigid_id=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = game_vector(tuple(a - b for a, b in zip(world_pivot, parent_pivot)))
    obj["pivot_game"] = list(world_pivot)
    if rigid_id is not None:
        obj["rigidPartID"] = rigid_id
    return obj


class Part:
    def __init__(self, name, pivot, parent, material_ref, rigid_id):
        self.name, self.pivot, self.parent = name, Vector(pivot), parent
        self.material, self.rigid_id = material_ref, rigid_id
        self.vertices, self.faces, self.swatches, self.smooth, self.team = [], [], [], [], []

    def add(self, vertices, faces, swatch="fabric", smooth=False, team=0):
        first = len(self.vertices)
        self.vertices.extend([tuple(Vector(v) - self.pivot) for v in vertices])
        self.faces.extend([tuple(first + index for index in face) for face in faces])
        self.swatches.extend([SWATCH[swatch]] * len(faces))
        self.smooth.extend([smooth] * len(faces))
        self.team.extend([team] * len(faces))

    def box(self, center, size, swatch="fabric", bevel=0, team=0):
        x, y, z = center; sx, sy, sz = (v / 2 for v in size)
        if bevel:
            b = min(bevel, sx * .45, sz * .45)
            outline = [(-sx + b, -sz), (sx - b, -sz), (sx, -sz + b), (sx, sz - b),
                       (sx - b, sz), (-sx + b, sz), (-sx, sz - b), (-sx, -sz + b)]
        else:
            outline = [(-sx, -sz), (sx, -sz), (sx, sz), (-sx, sz)]
        n = len(outline)
        vertices = [(x + px, y + end * sy, z + pz) for end in (-1, 1) for px, pz in outline]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.add(vertices, faces, swatch, False, team)

    def tube(self, start, end, radius_a, radius_b=None, segments=8, rings=2, swatch="fabric", profile=None, ellipse=1):
        a, b = Vector(start), Vector(end)
        axis = (b - a).normalized()
        helper = Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((0, 0, 1))
        right = axis.cross(helper).normalized(); forward = axis.cross(right).normalized()
        rb = radius_a if radius_b is None else radius_b
        vertices = []
        for row in range(rings):
            t = row / (rings - 1)
            radius = radius_a * (1 - t) + rb * t
            if profile:
                radius *= profile(t)
            centre = a.lerp(b, t)
            for index in range(segments):
                angle = math.tau * index / segments
                vertices.append(tuple(centre + right * (math.cos(angle) * radius) + forward * (math.sin(angle) * radius * ellipse)))
        faces = [tuple(range(segments - 1, -1, -1)), tuple(range((rings - 1) * segments, rings * segments))]
        for row in range(rings - 1):
            faces += [(row * segments + i, row * segments + (i + 1) % segments,
                       (row + 1) * segments + (i + 1) % segments, (row + 1) * segments + i) for i in range(segments)]
        self.add(vertices, faces, swatch, True)

    def ellipsoid(self, center, radii, segments=10, rings=5, swatch="skin", upper=False):
        c = Vector(center); vertices = []
        if upper:
            # Helmet dome, with a flat lower rim instead of a second sphere.
            for row in range(rings):
                angle = math.pi * .5 * row / rings
                for index in range(segments):
                    a = math.tau * index / segments
                    vertices.append(tuple(c + Vector((math.cos(a) * math.cos(angle) * radii[0], math.sin(angle) * radii[1], math.sin(a) * math.cos(angle) * radii[2]))))
            vertices.append(tuple(c + Vector((0, radii[1], 0))))
            faces = [tuple(range(segments - 1, -1, -1))]
            for row in range(rings - 1):
                faces += [(row * segments + i, row * segments + (i + 1) % segments,
                           (row + 1) * segments + (i + 1) % segments, (row + 1) * segments + i) for i in range(segments)]
            faces += [((rings - 1) * segments + i, (rings - 1) * segments + (i + 1) % segments, len(vertices) - 1) for i in range(segments)]
        else:
            vertices = [tuple(c + Vector((0, -radii[1], 0)))]
            for row in range(1, rings):
                latitude = -math.pi / 2 + math.pi * row / rings
                for index in range(segments):
                    a = math.tau * index / segments
                    vertices.append(tuple(c + Vector((math.cos(a) * math.cos(latitude) * radii[0], math.sin(latitude) * radii[1], math.sin(a) * math.cos(latitude) * radii[2]))))
            vertices.append(tuple(c + Vector((0, radii[1], 0))))
            faces = [(0, 1 + (i + 1) % segments, 1 + i) for i in range(segments)]
            for row in range(rings - 2):
                faces += [(1 + row * segments + i, 1 + row * segments + (i + 1) % segments,
                           1 + (row + 1) * segments + (i + 1) % segments, 1 + (row + 1) * segments + i) for i in range(segments)]
            faces += [(1 + (rings - 2) * segments + i, 1 + (rings - 2) * segments + (i + 1) % segments, len(vertices) - 1) for i in range(segments)]
        self.add(vertices, faces, swatch, True)

    def finish(self):
        data = bpy.data.meshes.new(self.name + "_geometry")
        data.from_pydata([game_vector(v) for v in self.vertices], [], self.faces)
        data.update()
        # Orient all closed primitives consistently. Preserve separate rigid parts.
        bm = bmesh.new(); bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(data); bm.free()
        obj = bpy.data.objects.new(self.name + ".mesh", data)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.parent
        data.materials.append(self.material)
        data.uv_layers.new(name="UVMap")
        data.uv_layers.new(name="RIG_ID")
        data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
        # Creating CustomData layers can invalidate earlier Blender RNA handles.
        # Re-fetch each named layer only after every layer has been allocated.
        uv = data.uv_layers["UVMap"]
        rig_uv = data.uv_layers["RIG_ID"]
        data.uv_layers.active_index = 0
        uv.active_render = True
        rig_uv.active_render = False
        colors = data.color_attributes["Color"]
        data.color_attributes.active_color = colors
        for polygon in data.polygons:
            swatch = self.swatches[polygon.index]
            row, col = divmod(swatch, 4)
            polygon.use_smooth = self.smooth[polygon.index]
            axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
            for loop_index in polygon.loop_indices:
                point = data.vertices[data.loops[loop_index].vertex_index].co
                a, b = ((point.y, point.z) if axis == 0 else (point.x, point.z) if axis == 1 else (point.x, point.y))
                u = (col * 128 + 4 + (a * 1.7 % 1) * 120) / 512
                top_v = (row * 128 + 4 + (b * 1.7 % 1) * 120) / 512
                uv.data[loop_index].uv = (u, 1 - top_v)
                rig_uv.data[loop_index].uv = (self.rigid_id, 0)
                colors.data[loop_index].color = (1, 1, 1, self.team[polygon.index])
        obj["rigidPartID"] = self.rigid_id
        obj["pivot_game"] = list(self.pivot)
        return obj


def body(role, lod, mat):
    seg = [12, 8, 4][lod]
    rings = [5, 3, 2][lod]
    root = empty("InfantryV04", None, (0, 0, 0))
    root["role_key"] = role; root["lod"] = lod
    nodes, parts = {}, {}
    for name, index in PARTS.items():
        parent = PARENTS[name]
        nodes[name] = empty(name, nodes.get(parent, root), PIVOTS[name], PIVOTS[parent] if parent else (0, 0, 0), index)
        parts[name] = Part(name, PIVOTS[name], nodes[name], mat, index)
    torso, head = parts["torso"], parts["head"]
    torso.tube((0, 1.25, 0), (0, 2.18, 0), .39, .44, seg, rings, ellipse=.65,
               profile=(lambda t: .94 + .08 * math.sin(t * math.pi)) if lod < 2 else None)
    torso.box((0, 1.30, 0), (.82, .21, .51), "webbing", .06 if lod < 2 else 0)
    torso.box((0, 1.84, .21), (.76, .70, .25), "armor", .07 if lod < 2 else 0)
    torso.box((0, 1.84, -.23), (.73, .66, .18), "armor", .06 if lod < 2 else 0)
    torso.tube((0, 2.18, 0), (0, 2.43, 0), .13, .13, max(4, seg - 2), 2, "skin")
    # Head/jaw and an actual open-bottom helmet dome.
    head.ellipsoid((0, 2.57, .025), (.215, .265, .23), seg, [6, 4, 3][lod], "skin")
    head.ellipsoid((0, 2.70, -.018), (.30, .255, .325), [14, 8, 6][lod], [4, 3, 2][lod], "helmet", upper=True)
    if lod == 2:
        # Keep the helmet rim and load-bearing silhouette at the far LOD rather
        # than spending these triangles on invisible curved micro detail.
        head.box((0, 2.67, .025), (.62, .05, .64), "webbing")
        for x in (-.255, 0, .255):
            torso.box((x, 1.65, .378), (.20, .265, .13), "webbing")
    if lod < 2:
        head.box((0, 2.67, .025), (.62, .05, .64), "webbing", .08)
        head.box((0, 2.62, .236), (.33, .10, .035), "optic")
        head.box((0, 2.55, .255), (.09, .12, .08), "skin", .015)
        for sign in (-1, 1):
            head.box((sign * .22, 2.53, -.018), (.035, .27, .035), "webbing")
            if lod == 0:
                head.ellipsoid((sign * .213, 2.55, -.02), (.037, .08, .045), 6, 3, "skin")
        if lod == 0:
            head.box((0, 2.77, .30), (.12, .12, .055), "polymer", .01)
            head.box((.24, 2.68, .02), (.07, .04, .22), "steel")
    # Articulated sleeves retain the original forward firing-grip silhouette.
    for side, shoulder, elbow, wrist in [
        ("L", PIVOTS["upperarm.L"], PIVOTS["forearm.L"], (.08, 1.94, .74)),
        ("R", PIVOTS["upperarm.R"], PIVOTS["forearm.R"], (.22, 1.94, .56)),
    ]:
        upper, fore = parts["upperarm." + side], parts["forearm." + side]
        upper.tube(shoulder, elbow, .155, .135, seg, [4, 3, 2][lod], "fabric")
        fore.tube(elbow, wrist, .13, .105, seg, [4, 3, 2][lod], "fabric")
        fore.ellipsoid(wrist, (.11, .095, .13), [8, 6, 4][lod], [4, 3, 2][lod], "webbing")
        if lod < 2:
            upper.box((shoulder[0], shoulder[1] - .08, shoulder[2] + .13), (.19, .23, .075), "armor", .015)
            fore.box((elbow[0], elbow[1], elbow[2] + .08), (.18, .18, .075), "camo", .02)
        if side == "L":
            upper.box((-.60, 2.11, .02), (.035, .13, .17), "insignia", team=1)
    # Distinct equipment is retained at every LOD; micro fittings disappear first.
    pack_height = .80 if role in ("mog", "machinegunner", "engineer", "atgm") else .58
    torso.box((0, 1.86, -.46), (.61, pack_height, .30), "webbing", .065 if lod < 2 else 0)
    if lod < 2:
        for x in (-.255, 0, .255):
            torso.box((x, 1.65, .378), (.20, .265, .13), "webbing", .025)
        for sign in (-1, 1):
            torso.box((sign * .39, 1.45, .08), (.16, .23, .22), "khaki", .025)
            torso.box((sign * .32, 1.96, -.36), (.055, .58, .06), "camo")
        if lod == 0:
            for x in (-.25, 0, .25):
                torso.box((x, 1.80, .447), (.15, .045, .035), "steel")
            for sign in (-1, 1):
                torso.box((sign * .25, 2.05, .36), (.055, .36, .045), "camo")
                torso.box((sign * .28, 1.97, -.64), (.13, .29, .075), "webbing", .02)
            torso.box((.31, 2.10, .36), (.15, .21, .13), "radio", .02)
            torso.tube((.31, 2.19, .36), (.31, 2.46, .36), .012, segments=5, swatch="polymer")
    weapon = parts["weapon"]
    muzzle = None
    if role != "medic":
        if role == "atgm":
            weapon.tube((.48, 1.98, -.45), (.48, 1.98, 1.79), .19, segments=[14, 8, 6][lod], swatch="armor")
            weapon.tube((.48, 1.98, 1.78), (.48, 1.98, 1.89), .17, segments=[12, 8, 4][lod], swatch="polymer")
            weapon.box((.72, 2.10, .42), (.28, .20, .42), "optic", .02 if lod < 2 else 0)
            muzzle = (.48, 1.98, 1.90)
        elif role == "operator":
            weapon.box((0, 1.82, .70), (.58, .10, .36), "polymer", .025 if lod < 2 else 0)
            weapon.box((0, 1.88, .70), (.39, .025, .23), "optic")
            # The original operator can also fire a light ground weapon. Keep a
            # short carbine, rather than making real source shots come from an
            # apparently unarmed controller-only silhouette.
            weapon.box((.22, 1.96, .50), (.12, .16, .40), "polymer", .02 if lod < 2 else 0)
            weapon.box((.22, 1.95, .13), (.12, .17, .34), "armor", .02 if lod < 2 else 0)
            weapon.tube((.22, 2.00, .70), (.22, 2.00, 1.28), .027, segments=[10, 6, 4][lod], swatch="steel")
            weapon.box((.22, 1.75, .54), (.08, .25, .12), "polymer")
            muzzle = (.22, 2.00, 1.305)
            if lod < 2:
                for sign in (-1, 1):
                    weapon.tube((sign * .22, 1.87, .83), (sign * .22, 2.16, .83), .012, segments=5, swatch="steel")
            torso.box((.29, 2.09, -.66), (.17, .22, .12), "radio")
            torso.tube((.29, 2.18, -.66), (.29, 3.03, -.66), .012, segments=5, swatch="steel")
        else:
            heavy = role in ("machinegunner", "mog")
            long = role in ("sniper", "atrifle")
            short = role in ("assault", "engineer")
            weapon.box((.22, 1.96, .54), (.12 if not heavy else .17, .18, .43), "polymer", .02 if lod < 2 else 0)
            weapon.box((.22, 1.95, .16), (.13, .18, .38), "armor", .02 if lod < 2 else 0)
            barrel_end = 1.99 if role == "atrifle" else 1.78 if long else 1.62 if heavy else 1.33 if short else 1.48
            weapon.tube((.22, 2.00, .74), (.22, 2.00, barrel_end), .027 if not heavy else .04,
                        segments=[10, 6, 4][lod], swatch="steel")
            weapon.box((.22, 1.74, .57), (.085, .29, .15), "polymer")
            if heavy:
                weapon.box((.39, 1.82, .64), (.21, .24, .23), "khaki", .02 if lod < 2 else 0)
            if long:
                weapon.tube((.22, 2.16, .37), (.22, 2.16, .84), .065, segments=[10, 6, 4][lod], swatch="optic")
            if lod < 2:
                weapon.box((.22, 2.08, .55), (.09, .035, .40), "steel")
                if heavy or long:
                    for sign in (-1, 1):
                        weapon.tube((.22, 1.98, barrel_end - .28), (.22 + sign * .18, 1.63, barrel_end - .18), .014, segments=5, swatch="steel")
                if lod == 0:
                    for i in range(4):
                        weapon.box((.22, 2.035, .85 + i * .075), (.11, .035, .018), "polymer")
            muzzle = (.22, 2.00, barrel_end + .025)
    else:
        torso.box((0, 1.85, -.64), (.50, .53, .12), "medical", .035 if lod < 2 else 0)
        torso.box((0, 1.85, -.71), (.27, .07, .015), "rescue")
        torso.box((0, 1.85, -.72), (.07, .27, .015), "rescue")
        head.box((0, 2.78, .29), (.24, .14, .035), "medical")
        parts["upperarm.L"].box((-.62, 2.10, .04), (.035, .20, .20), "medical")
        parts["forearm.R"].box((.30, 1.71, .55), (.36, .27, .30), "medical", .03 if lod < 2 else 0)
    if role == "engineer":
        torso.tube((-.28, 1.40, -.68), (-.28, 2.55, -.68), .028, segments=[8, 6, 4][lod], swatch="khaki")
        torso.box((-.28, 2.64, -.68), (.30, .32, .055), "steel", .035 if lod < 2 else 0)
    if role == "sniper":
        for i in range([9, 5, 2][lod]):
            a = math.tau * i / [9, 5, 2][lod]
            head.box((math.cos(a) * .27, 2.60 + (i % 3) * .06, math.sin(a) * .28), (.12, .32, .12), "camo")
        torso.box((0, 2.16, -.56), (.69, .18, .32), "camo", .04 if lod < 2 else 0)
    if role in ("machinegunner", "mog", "atrifle"):
        torso.box((-.30, 1.52, -.49), (.25, .32, .22), "khaki", .025 if lod < 2 else 0)
    if role == "assault":
        for sign in (-1, 1):
            torso.ellipsoid((sign * .27, 1.47, .37), (.075, .11, .07), [8, 6, 4][lod], [4, 3, 2][lod], "armor")
    meshes = [part.finish() for part in parts.values()]
    anchors = {"hip": (0, 1.22, 0), "head": (0, 2.74, 0), "grip.R": (.22, 1.94, .56),
               "handguard.L": (.08, 1.94, .74), "backpack": (0, 1.9, -.46)}
    if muzzle:
        anchors["muzzle"] = muzzle
    for name, point in anchors.items():
        holder = "weapon" if name in ("muzzle", "grip.R", "handguard.L") else "head" if name == "head" else "torso"
        empty("anchor." + name, nodes[holder], point, PIVOTS[holder])
    return root, meshes, anchors


def leg(lod, mat):
    root = empty("InfantryV04Leg", None, (0, 0, 0))
    root["normalized_y"] = [-1, 0]
    result = []
    segments = [10, 6, 4][lod]
    for name, index, pivot in [("thigh", 0, (0, 0, 0)), ("shin", 1, (0, -.5, 0)), ("boot", 2, (0, -.88, 0))]:
        node = empty(name, root, pivot, rigid_id=index)
        p = Part(name, pivot, node, mat, index)
        if name == "thigh":
            p.tube((0, -.01, 0), (0, -.50, .018), .155, .132, segments, [4, 3, 2][lod], "fabric", ellipse=1.19)
            if lod == 0:
                p.box((.11, -.22, -.005), (.08, .19, .19), "webbing", .02)
        elif name == "shin":
            p.tube((0, -.49, .018), (0, -.89, 0), .13, .105, segments, [4, 3, 2][lod], "fabric", ellipse=1.15)
            if lod < 2:
                p.box((0, -.51, .145), (.24, .16, .065), "armor", .025)
        else:
            p.box((0, -.935, .08), (.34, .13, .51), "boot", .045 if lod < 2 else 0)
            if lod == 0:
                p.box((0, -.9825, .08), (.35, .035, .53), "rubber", .035)
        result.append(p.finish())
    return root, result


def triangles(objects):
    count = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        count += len(obj.data.loop_triangles)
    return count


def simplify(objects, target):
    count = triangles(objects)
    if count <= target:
        return
    ratio = target / count
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("lod_topology_budget", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def export(path, root, meshes):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                             export_yup=True, export_apply=False, export_texcoords=True,
                             export_normals=True, export_tangents=False, export_materials="EXPORT",
                             export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                             export_attributes=True, export_extras=True, export_animations=False)
    return dict(file=path.name, bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=triangles(meshes),
                rigidParts=len(meshes))


def validate_glb(path, expected_ids):
    blob = path.read_bytes()
    magic, version, size = struct.unpack_from("<3I", blob)
    if magic != 0x46546c67 or version != 2 or size != len(blob):
        raise RuntimeError("Invalid GLB header")
    offset = 12; document = None; binary = b""
    while offset < len(blob):
        length, kind = struct.unpack_from("<2I", blob, offset); offset += 8
        chunk_data = blob[offset:offset + length]; offset += length
        if kind == 0x4e4f534a: document = json.loads(chunk_data)
        elif kind == 0x004e4942: binary = chunk_data
    if not document or document.get("skins") or document.get("animations"):
        raise RuntimeError("Expected rigid parts without skins or runtime animation clips")
    formats = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def accessor_values(index):
        accessor = document["accessors"][index]
        view = document["bufferViews"][accessor["bufferView"]]
        code, size = formats[accessor["componentType"]]
        count = widths[accessor["type"]]
        stride = view.get("byteStride", count * size)
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        return [struct.unpack_from("<" + code * count, binary, start + i * stride) for i in range(accessor["count"])]

    ids = set(); checked = 0; triangle_count = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh["primitives"]:
            attribute = primitive["attributes"].get("TEXCOORD_1")
            if attribute is None: raise RuntimeError("Missing TEXCOORD_1 rigid IDs")
            accessor = document["accessors"][attribute]; view = document["bufferViews"][accessor["bufferView"]]
            if accessor["componentType"] != 5126 or accessor["type"] != "VEC2":
                raise RuntimeError("Rigid IDs must be float UV2")
            stride = view.get("byteStride", 8)
            start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            for index in range(accessor["count"]):
                value = struct.unpack_from("<f", binary, start + index * stride)[0]
                rounded = round(value)
                if not math.isfinite(value) or abs(value - rounded) > .0001:
                    raise RuntimeError("Noninteger rigid part ID")
                ids.add(rounded); checked += 1
            points = accessor_values(primitive["attributes"]["POSITION"])
            normals = accessor_values(primitive["attributes"]["NORMAL"])
            uv = accessor_values(primitive["attributes"]["TEXCOORD_0"])
            if len(points) != len(normals) or len(points) != len(uv):
                raise RuntimeError("Incomplete mesh vertex channels")
            if any(not math.isfinite(c) for values in (points, normals, uv) for value in values for c in value):
                raise RuntimeError("Nonfinite geometry data")
            if any(abs(sum(c * c for c in normal) - 1) > .015 for normal in normals):
                raise RuntimeError("Nonunit exported normal")
            if any(c < -.0001 or c > 1.0001 for value in uv for c in value):
                raise RuntimeError("Atlas UV escaped its normalized range")
            indices = [value[0] for value in accessor_values(primitive["indices"])]
            if len(indices) % 3 or any(i >= len(points) for i in indices):
                raise RuntimeError("Invalid triangle indices")
            for index in range(0, len(indices), 3):
                a, b, c = (Vector(points[indices[index + i]]) for i in range(3))
                if (b - a).cross(c - a).length_squared <= 1e-14:
                    raise RuntimeError("Degenerate exported triangle")
            triangle_count += len(indices) // 3
    if ids != set(expected_ids):
        raise RuntimeError("Rigid ID coverage mismatch: " + str(ids))
    parent_indices = {child: index for index, node in enumerate(document["nodes"]) for child in node.get("children", [])}
    world_cache = {}

    def node_world(index):
        if index in world_cache: return world_cache[index]
        node = document["nodes"][index]
        if "matrix" in node:
            local = Matrix([node["matrix"][row * 4:(row + 1) * 4] for row in range(4)]).transposed()
        else:
            rotation = node.get("rotation", [0, 0, 0, 1])
            local = (Matrix.Translation(node.get("translation", [0, 0, 0]))
                     @ Quaternion((rotation[3], rotation[0], rotation[1], rotation[2])).to_matrix().to_4x4()
                     @ Matrix.Diagonal((*node.get("scale", [1, 1, 1]), 1)))
        world_cache[index] = node_world(parent_indices[index]) @ local if index in parent_indices else local
        return world_cache[index]

    is_leg = path.name.startswith("infantry_leg_")
    expected_pivots = {"thigh": (0, 0, 0), "shin": (0, -.5, 0), "boot": (0, -.88, 0)} if is_leg else PIVOTS
    found_pivots = set()
    world_points = []
    for index, node in enumerate(document["nodes"]):
        world = node_world(index)
        if node.get("name") in expected_pivots:
            expected = expected_pivots[node["name"]]
            if (world.translation - Vector(expected)).length > .0001:
                raise RuntimeError("Exported Y-up pivot mismatch: " + node["name"])
            found_pivots.add(node["name"])
        if "mesh" in node:
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                world_points += [world @ Vector(point) for point in accessor_values(primitive["attributes"]["POSITION"])]
    if found_pivots != set(expected_pivots):
        raise RuntimeError("Named rigid hierarchy is incomplete")
    bounds = dict(min=[min(point[i] for point in world_points) for i in range(3)],
                  max=[max(point[i] for point in world_points) for i in range(3)])
    if is_leg and (bounds["min"][1] < -1.0001 or bounds["max"][1] > .0001):
        raise RuntimeError("Leg escaped normalized [-1,0] height")
    return dict(passed=True, rigidIDs=sorted(ids), checkedVertices=checked,
                checkedTriangles=triangle_count, bounds=bounds, pivotsVerified=len(found_pivots),
                textures=len(document.get("textures", [])), materials=len(document.get("materials", [])))


def main():
    cli = args(); output = cli.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    catalog = source_catalog()
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
    texture_manifest, images = textures(output, cli.texture_size)
    mat = material(images)
    models, reports, violations = [], [], []
    for role in cli.roles:
        pivot_aliases = dict(PIVOTS, **{"shoulder.L": PIVOTS["upperarm.L"], "shoulder.R": PIVOTS["upperarm.R"],
                                      "elbow.L": PIVOTS["forearm.L"], "elbow.R": PIVOTS["forearm.R"]})
        model = dict(key=role, lods=[], contract=dict(coordinates="Y-up,+Z-forward",
                     root="feet", rigidPartIDs=PARTS, pivots=pivot_aliases, parentRigidParts=PARENTS,
                     teamMask="COLOR_0.a", rigidIDs="TEXCOORD_1.x", originalMembers=next(x["members"] for x in catalog if x["key"] == role)))
        for lod in cli.lods:
            root, meshes, anchors = body(role, lod, mat)
            simplify(meshes, [2380, 960, 380][lod])
            path = output / (role + "_lod" + str(lod) + ".glb")
            result = export(path, root, meshes)
            result.update(role=role, lod=lod, budget=list(BUDGETS[lod]), validation=validate_glb(path, [index for name,index in PARTS.items() if role != "medic" or name != "weapon"]))
            result["withinBudget"] = BUDGETS[lod][0] <= result["triangles"] <= BUDGETS[lod][1]
            if not result["withinBudget"]: violations.append(result)
            model["lods"].append(path.name)
            model["contract"]["anchors"] = anchors
            reports.append(result)
            if cli.save_blend: bpy.ops.wm.save_as_mainfile(filepath=str(output / (role + "_lod" + str(lod) + ".blend")))
            bpy.data.objects.remove(root, do_unlink=True)
            for obj in [obj for obj in list(bpy.data.objects) if obj.type == "MESH" or obj.type == "EMPTY"]:
                bpy.data.objects.remove(obj, do_unlink=True)
        models.append(model)
    leg_model = dict(key="infantry-leg", lods=[], contract=dict(coordinates="Y-up,+Z-forward",
                     normalizedY=[-1, 0], hipPivot=[0, 0, 0], kneePivot=[0, -.5, 0],
                     actualWidthDepth=[.31, .37], bootWidthLength=[.34, .51],
                     runtimeScale=[1, 1.22, 1], runtimeHipHeight=1.22,
                     rigidPartIDs={"thigh": 0, "shin": 1, "boot": 2}, rigidIDs="TEXCOORD_1.x"))
    for lod in cli.lods:
        root, meshes = leg(lod, mat)
        simplify(meshes, LEG_PAIR_BUDGETS[lod] // 2 - 2)
        path = output / ("infantry_leg_lod" + str(lod) + ".glb")
        result = export(path, root, meshes)
        result.update(role="infantry-leg", lod=lod, pairTriangles=result["triangles"] * 2,
                      budget=LEG_PAIR_BUDGETS[lod], validation=validate_glb(path, [0, 1, 2]))
        result["withinBudget"] = result["pairTriangles"] <= LEG_PAIR_BUDGETS[lod]
        if not result["withinBudget"]: violations.append(result)
        reports.append(result); leg_model["lods"].append(path.name)
        for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)
    models.append(leg_model)
    manifest = dict(format="SkyfrontInfantryKitV04", authoredOriginal=True, license="CC0-1.0",
                    models=models, textures=texture_manifest, sourceCatalog=catalog,
                    shaderContract=dict(noPerActorSkeleton=True, pivotsIn="Y-up game coordinates",
                                        bodyRoot="feet", bodyIDs=PARTS,
                                        referenceMotions=["walk", "fire", "reload", "dig"],
                                        motionSource="Actual original unit state; no exported fake gameplay animation"))
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    report = dict(passed=not violations, models=reports, violations=violations,
                  scope="CPU-authored procedural infantry art and GLB contract checks; no GPU or runtime integration claim")
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("INFANTRY_V04_EXPORT " + json.dumps(report, ensure_ascii=False))
    if violations and cli.strict_budgets: raise RuntimeError("Measured LOD budgets need adjustment")


if __name__ == "__main__":
    main()

"""Original procedural game art by this project; no third-party meshes or textures.

Leopard-inspired dark-olive tank study, not an engineering replica or photorealism claim.
Run only when explicitly ready to export: Blender --background --factory-startup --python thisfile -- ...
Authored in game Y-up/+Z-forward coordinates, converted into Blender Z-up before glTF export.
No scene-wide mesh join: hull, turret, gun, recoil, wheels and anchors retain their own nodes.
"""
from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Euler, Vector


ROOT = Path(__file__).resolve().parents[2]
CONFIG = {
    0: dict(bevel=2, wheel=24, tube=20, links=52, detail=2, budget=(12000, 18000)),
    1: dict(bevel=1, wheel=16, tube=12, links=36, detail=1, budget=(5000, 7000)),
    2: dict(bevel=0, wheel=8, tube=8, links=0, detail=0, budget=(0, 1999)),
}


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/native/armor-v03')
    parser.add_argument('--lods', nargs='+', type=int, choices=CONFIG, default=[0, 1, 2])
    parser.add_argument('--texture-size', type=int, choices=[256, 512, 1024], default=512)
    parser.add_argument('--save-blend', action='store_true')
    parser.add_argument('--strict-budgets', action='store_true', help='Fail if measured evaluated geometry misses a provisional LOD band.')
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return parser.parse_args(args)


def game_vector(point):
    x, y, z = point
    return (x, -z, y)


def empty(name, parent=None, position=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = .3
    obj.parent = parent
    obj.location = game_vector(position)
    obj['canonical_game_position'] = list(position)
    return obj


def procedural_images(size):
    """Small, deterministic CPU-authored paint textures; no render engine or baking operation."""
    colors, orm, normals = (array('f'), array('f'), array('f'))
    for y in range(size):
        for x in range(size):
            value = ((x * 73856093) ^ (y * 19349663) ^ 81603) & 0xffffffff
            grain = ((value >> 8) & 255) / 255 - .5
            broad = math.sin(x * .037) * math.sin(y * .029) * .012
            # Sparse tiny chips and hairline scratches, restrained enough to remain olive paint.
            chip = ((value & 8191) < 13)
            scratch = ((x + int(4 * math.sin(y * .05))) % 137 == 0 and value % 7 < 2)
            wear = -.055 if chip else .035 if scratch else 0
            shade = grain * .018 + broad + wear
            colors.extend((max(.02, .24 + shade), max(.02, .285 + shade), max(.02, .175 + shade * .8), 1))
            orm.extend((1, .79 + grain * .06, .28 if chip else .12, 1))
            normals.extend((.5 + grain * .012, .5 + broad * .08, .999, 1))
    result = {}
    for name, data, noncolor in [('paint_albedo', colors, False), ('paint_orm', orm, True), ('paint_normal', normals, True)]:
        image = bpy.data.images.new('armor_v03_' + name, width=size, height=size, alpha=True)
        if noncolor:
            image.colorspace_settings.name = 'Non-Color'
        image.pixels.foreach_set(data)
        image.pack()
        result[name] = image
    return result


def materials(images):
    paint = bpy.data.materials.new('armor_v03_olive_paint')
    paint.use_nodes = True
    nodes, links = paint.node_tree.nodes, paint.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    color = nodes.new('ShaderNodeTexImage'); color.image = images['paint_albedo']
    links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    packed = nodes.new('ShaderNodeTexImage'); packed.image = images['paint_orm']
    channels = nodes.new('ShaderNodeSeparateColor'); links.new(packed.outputs['Color'], channels.inputs[0])
    links.new(channels.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(channels.outputs['Blue'], bsdf.inputs['Metallic'])
    normal_image = nodes.new('ShaderNodeTexImage'); normal_image.image = images['paint_normal']
    normal = nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value = .22
    links.new(normal_image.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    steel = bpy.data.materials.new('armor_v03_dark_steel')
    steel.use_nodes = True
    steel.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.055, .065, .06, 1)
    steel.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value = .55
    steel.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .76
    optic = bpy.data.materials.new('armor_v03_opaque_optics')
    optic.use_nodes = True
    optic.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.025, .065, .073, 1)
    optic.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value = .25
    optic.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .22
    # Opaque optics avoid transparency sorting and transmission in Compatibility.
    return paint, steel, optic


class Author:
    def __init__(self, config, mats):
        self.cfg = config
        self.paint, self.steel, self.optic = mats
        self.merge_groups = {}

    def mesh(self, parent, name, vertices, faces, material=None, bevel=.0, dynamic=False):
        data = bpy.data.meshes.new(name + '_geometry')
        data.from_pydata([game_vector(v) for v in vertices], [], faces)
        data.update()
        bm = bmesh.new(); bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(data); bm.free()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        material = material or self.paint
        data.materials.append(material)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if bevel and self.cfg['bevel']:
            modifier = obj.modifiers.new('machined_edge_profile', 'BEVEL')
            modifier.width = bevel
            modifier.segments = self.cfg['bevel']
            modifier.affect = 'EDGES'
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        uv = obj.data.uv_layers.new(name='UVMap')
        # Plane projection per face gives physical-scale paint grain; no expensive UV unwrap/bake.
        for polygon in obj.data.polygons:
            axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
            for loop_index in polygon.loop_indices:
                point = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
                a, b = ((point.y, point.z) if axis == 0 else (point.x, point.z) if axis == 1 else (point.x, point.y))
                uv.data[loop_index].uv = (a * .23, b * .23)
        obj.select_set(False)
        if not dynamic:
            self.merge_groups.setdefault((parent, material), []).append(obj)
        return obj

    def box(self, parent, name, center, size, material=None, bevel=.04, rotation=(0, 0, 0), dynamic=False):
        c = Vector(center); half = Vector(size) / 2; rotation = Euler(rotation, 'XYZ').to_matrix()
        points = [(sx * half.x, sy * half.y, sz * half.z) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        points = [tuple(c + rotation @ Vector(p)) for p in points]
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        return self.mesh(parent, name, points, faces, material, bevel, dynamic)

    def cylinder(self, parent, name, center, radius, length, axis='Y', segments=None, material=None, dynamic=False):
        n = segments or self.cfg['tube']; points = []
        for end in (-.5, .5):
            for i in range(n):
                a = i * math.tau / n
                p = [radius * math.cos(a), end * length, radius * math.sin(a)]
                if axis == 'X': p = [p[1], p[0], p[2]]
                elif axis == 'Z': p = [p[0], p[2], p[1]]
                points.append(tuple(Vector(center) + Vector(p)))
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        obj = self.mesh(parent, name, points, faces, material, 0, dynamic)
        for polygon in obj.data.polygons:
            polygon.use_smooth = polygon.loop_total == 4
        return obj

    def wedge(self, parent, name, bottom, top, height, center=(0, 0, 0), material=None, bevel=.08):
        bx, bz = bottom; tx, tz, front_offset = top
        points = [(-bx/2, 0, -bz/2), (bx/2, 0, -bz/2), (bx/2, 0, bz/2), (-bx/2, 0, bz/2),
                  (-tx/2, height, -tz/2 + front_offset), (tx/2, height, -tz/2 + front_offset),
                  (tx/2, height, tz/2 + front_offset), (-tx/2, height, tz/2 + front_offset)]
        points = [tuple(Vector(p) + Vector(center)) for p in points]
        return self.mesh(parent, name, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material, bevel)

    def merge_static(self):
        # Join ONLY pieces sharing a pose parent and material. Articulation and wheel nodes stay intact.
        for (parent, material), objects in self.merge_groups.items():
            if not objects: continue
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects: obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            if len(objects) > 1: bpy.ops.object.join()
            combined = bpy.context.view_layer.objects.active
            combined.name = parent.name + '_' + material.name
            combined['part_role'] = parent.name
            combined.select_set(False)


def track_point(distance):
    radius, run = 1.05, 8.4
    arc = math.pi * radius
    d = distance % (2 * run + 2 * arc)
    if d < run: return 1.25 + radius, -run / 2 + d, 0
    d -= run
    if d < arc:
        a = d / radius; return 1.25 + math.cos(a) * radius, run / 2 + math.sin(a) * radius, a
    d -= arc
    if d < run: return 1.25 - radius, run / 2 - d, math.pi
    a = (d - run) / radius + math.pi
    return 1.25 + math.cos(a) * radius, -run / 2 + math.sin(a) * radius, a


def tracks(author, hull, side):
    sign = -1 if side == 'left' else 1
    parent = empty('track_' + side, hull)
    parent['drive_source'] = 'original groundModel.userData.drivePhase; per-instance UV animation at runtime'
    perimeter = 16.8 + math.tau * 1.05
    n = 48 if author.cfg['detail'] else 24
    points = []
    for i in range(n):
        y, z, _ = track_point(perimeter * i / n)
        for x in (sign * 3.55, sign * 5.0): points.append((x, y, z))
    faces = [(2*i, 2*i+1, 2*((i+1)%n)+1, 2*((i+1)%n)) for i in range(n)]
    author.mesh(parent, 'track_belt_' + side, points, faces, author.steel)
    for i in range(author.cfg['links']):
        y, z, angle = track_point(perimeter * i / author.cfg['links'])
        author.box(parent, 'track_shoe_' + side + str(i), (sign*4.275, y, z), (1.52, .14, .36), author.steel, bevel=0, rotation=(angle, 0, 0))
        if author.cfg['detail'] > 1:
            author.box(parent, 'track_pad_' + side + str(i), (sign*4.275, y+.085*math.cos(angle), z+.085*math.sin(angle)), (1.03, .045, .23), author.steel, bevel=0, rotation=(angle, 0, 0))
    # Seven road wheels are authored as shared geometry. Runtime may batch their transforms once per type.
    wheel_template = author.cylinder(hull, 'road_wheel_' + side + '_00', (0, 0, 0), .88, .43, 'X', author.cfg['wheel'], author.steel, True)
    wheel_template.location = game_vector((sign*4.28, 1.23, -3.9))
    wheel_template['wheel_axis'] = 'game +X'
    for i in range(1, 7):
        wheel = wheel_template.copy(); wheel.data = wheel_template.data
        bpy.context.collection.objects.link(wheel)
        wheel.name = 'road_wheel_' + side + f'_{i:02d}'
        wheel.location = game_vector((sign*4.28, 1.23, -3.9+i*1.3))
    if author.cfg['detail']:
        for i in range(7):
            author.cylinder(hull, 'wheel_hub', (sign*4.54, 1.23, -3.9+i*1.3), .35, .08, 'X', author.cfg['wheel'], author.paint)
            if author.cfg['detail'] > 1:
                for bolt in range(6):
                    a = bolt * math.tau / 6
                    author.cylinder(hull, 'hub_fastener', (sign*4.6,1.23+math.cos(a)*.24,-3.9+i*1.3+math.sin(a)*.24), .055, .045, 'X', 6, author.steel)


def build(lod, mats):
    author = Author(CONFIG[lod], mats)
    root = empty('ArmorV03')
    root['asset_version'] = '0.3-source-study'
    root['authorship'] = 'Original procedural project art; no external assets'
    root['game_axes'] = 'Y-up,+Z-forward,+X-right'
    root['lod'] = lod
    root['source_pose_contract'] = 'original Leopard turret(0,4.1,0),gun(0,1.02,2.2),muzzle(0,0,9.56)'
    hull = empty('hull', root)
    turret = empty('turret', hull, (0, 4.1, 0))
    gun = empty('gun', turret, (0, 1.02, 2.2)); gun['source_joint_name'] = 'pitch'
    recoil = empty('recoil', gun)
    muzzle = empty('muzzle', recoil, (0, 0, 9.56)); muzzle['role'] = 'visual_muzzle_anchor'
    proxy = empty('collisionProxy', hull, (0, 3.25, .2))
    proxy['role'] = 'non-rendering bounds only; original CPU picking/physics remain authoritative'
    proxy['box_size_game'] = [10.2, 6.5, 12.3]
    # Sloped lower hull, stepped rear deck and broad angled front glacis.
    author.wedge(hull, 'lower_armored_hull', (7.7, 11.2), (7.15, 9.8, -.25), 2.55, (0, .72, 0), bevel=.16)
    author.wedge(hull, 'upper_glacis', (7.15, 9.8), (6.75, 8.65, -.48), .75, (0, 3.12, -.15), bevel=.095)
    author.box(hull, 'rear_engine_deck', (0, 3.88, -3.75), (6.35, .2, 2.45), bevel=.045)
    for sign in (-1, 1):
        author.box(hull, 'fender', (sign*4.11,2.77,-.1), (1.65,.14,10.6), bevel=.035)
        if lod < 2:
            for i in range(5):
                author.box(hull, 'spaced_side_skirt', (sign*4.26,2.27,-4.1+i*2.05), (.18,1.32,1.93), bevel=.045, rotation=(0,0,sign*.045))
        else:
            author.box(hull, 'continuous_side_skirt', (sign*4.26,2.27,0), (.18,1.32,10.06), bevel=0, rotation=(0,0,sign*.045))
        author.box(hull, 'rear_exhaust', (sign*3.2,2.75,-5.1), (.75,.7,.45), author.steel, bevel=.045)
        if lod < 2:
            author.box(hull, 'headlamp_armored_housing', (sign*2.72,2.74,4.85), (.74,.55,.5), bevel=.045)
            author.box(hull, 'opaque_headlamp', (sign*2.72,2.77,5.115), (.42,.27,.045), author.optic, bevel=0)
            for i in range(4): author.box(hull, 'exhaust_louvre', (sign*3.18,2.65+i*.13,-5.36), (.6,.035,.035), author.steel, bevel=0)
    tracks(author, hull, 'left'); tracks(author, hull, 'right')
    if lod < 2:
        for i in range(20 if lod == 0 else 10):
            author.box(hull, 'engine_air_grille', (-2.75+i*(.29 if lod==0 else .58),4.01,-3.7), (.1,.045,1.75), author.steel, bevel=0)
        author.cylinder(hull, 'driver_hatch', (1.3,3.91,3.15), .65,.12, material=author.paint)
        author.box(hull, 'driver_periscope', (1.3,4.03,3.62), (.6,.14,.16), author.optic, bevel=.02)
        for sign in (-1,1):
            author.box(hull, 'tow_bracket', (sign*2.85,1.15,5.55), (.4,.38,.34), author.steel, bevel=.06)
            author.box(hull, 'stowage_bin', (sign*2.8,3.84,-2.1), (1.05,.42,1.25), bevel=.05)
    # Separate turret with angled cheeks and an overhanging rear bustle.
    author.wedge(turret, 'turret_main_casting', (6.2,6.1), (4.85,5.65,-.25), 1.95, (0,-.06,-.3), bevel=.18)
    for sign in (-1,1):
        author.wedge(turret, 'sloped_turret_cheek', (2.45,3.45), (1.65,2.5,-.35), 1.55, (sign*1.8,.12,1.68), bevel=.12)
        if lod < 2:
            author.box(turret, 'rear_stowage_basket', (sign*1.55,1.25,-3.72), (2.65,.85,.85), bevel=.06)
            for i in range(4):
                author.cylinder(turret, 'smoke_dispenser', (sign*2.89,1.45,-.55-i*.43), .16,.55,'Y',10 if lod==0 else 8,author.steel)
            for x in range(3): author.box(turret,'basket_rail',(sign*1.55+(x-1)*.82,1.78,-3.73),(.075,.12,.95),author.steel,bevel=0)
    author.box(gun, 'mantlet', (0,-.06,0), (1.58,1.13,1.45), bevel=.16)
    author.cylinder(recoil,'barrel_main',(0,0,4.66),.215,9.06,'Z',material=author.steel)
    author.cylinder(recoil,'barrel_thermal_sleeve',(0,0,3.0),.295,3.5,'Z',material=author.paint)
    author.cylinder(recoil,'bore_evacuator',(0,0,5.05),.35,1.25,'Z',material=author.paint)
    author.cylinder(recoil,'muzzle_outer',(0,0,9.38),.265,.36,'Z',material=author.steel)
    author.cylinder(recoil,'muzzle_dark_face',(0,0,9.562),.185,.012,'Z',material=author.steel)
    if lod < 2:
        for z in (1.3,3.5,5.8,8.2): author.cylinder(recoil,'sleeve_retaining_band',(0,0,z),.315,.095,'Z',material=author.paint)
        for x in (-1.12,1.23):
            author.cylinder(turret,'crew_hatch',(x,2.01,-.65),.69,.16,material=author.paint)
            author.box(turret,'hatch_handle',(x,2.16,-.65),(.36,.08,.08),author.steel,bevel=.025)
        author.box(turret,'commander_sight',(1.2,2.14,.48),(.78,.5,.78),bevel=.08)
        author.box(turret,'commander_optic',(1.2,2.18,.89),(.52,.25,.04),author.optic,bevel=0)
        author.box(turret,'gunner_optic',(-1.45,1.3,2.76),(.65,.38,.25),author.optic,bevel=.025)
        author.cylinder(turret,'flexible_antenna',(-2.35,3.05,-2.45),.035,2.75,'Y',6,author.steel)
        if lod == 0:
            for sign in (-1,1):
                for i in range(5):
                    author.box(turret,'welded_cheek_plate',(sign*(1.07+i*.31),1.25,2.54-i*.12),(.2,.035,.65),bevel=.01)
    author.merge_static()
    root['material_count'] = 3
    root['instancing_note'] = 'Share meshes/materials; compile wheel nodes to MultiMesh, do not spawn this full authoring hierarchy for every distant unit.'
    return root


def geometry_report(root):
    result = []; triangles = 0
    for obj in root.children_recursive:
        if obj.type != 'MESH': continue
        obj.data.calc_loop_triangles()
        count = len(obj.data.loop_triangles)
        triangles += count
        result.append(dict(name=obj.name, triangles=count, vertices=len(obj.data.vertices), parent=obj.parent.name))
    return triangles, result


def main():
    args = cli(); args.output.mkdir(parents=True, exist_ok=True)
    images = procedural_images(args.texture_size)
    mats = materials(images)
    reports = []
    for lod in args.lods:
        bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
        for data in list(bpy.data.meshes):
            if data.users == 0: bpy.data.meshes.remove(data)
        root = build(lod, mats)
        triangles, parts = geometry_report(root)
        low, high = CONFIG[lod]['budget']; within = low <= triangles <= high
        root['evaluated_triangles'] = triangles
        root['budget_band'] = [low, high]
        bpy.ops.object.select_all(action='DESELECT')
        for obj in [root, *root.children_recursive]: obj.select_set(True)
        bpy.context.view_layer.objects.active = root
        destination = args.output / f'armor_v03_lod{lod}.glb'
        bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
                                  export_yup=True, export_extras=True, export_animations=False,
                                  export_materials='EXPORT', export_apply=False)
        if args.save_blend: bpy.ops.wm.save_as_mainfile(filepath=str(args.output / f'armor_v03_lod{lod}.blend'))
        reports.append(dict(lod=lod, triangles=triangles, budget=[low,high], within_provisional_budget=within,
                            file=str(destination), bytes=destination.stat().st_size,
                            sha256=hashlib.sha256(destination.read_bytes()).hexdigest(), parts=parts))
        print('ARMOR_V03_EXPORT', json.dumps(reports[-1], ensure_ascii=False))
    report = dict(asset='Original articulated dark-olive tank study', blender=bpy.app.version_string,
                  axes='game Y-up,+Z-forward; authored Blender conversion(x,-z,y); GLB export_yup',
                  runtime_installed=False, photorealism_claim=False, texture_size=args.texture_size,
                  lods=reports)
    (args.output/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    if args.strict_budgets and any(not item['within_provisional_budget'] for item in reports):
        raise RuntimeError('Measured topology misses a provisional LOD budget; inspect report.json before asset acceptance.')


if __name__ == '__main__':
    main()

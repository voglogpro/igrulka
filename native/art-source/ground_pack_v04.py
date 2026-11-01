"""Original articulated ground art. CPU authoring/export only; no game rules or runtime installation.

Uses this project's armor_v03.py primitives and source-compatible tank study.
Game coordinates are Y-up/+Z-forward; Blender authoring converts (x,y,z) to (x,-z,y).
The atlas and all geometry are authored here, with no downloaded third-party assets.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import zlib

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('ground_v04_armor_source', Path(__file__).with_name('armor_v03.py'))
armor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(armor)

KEYS = ['shilka', 'gepard', 'leopard', 'apc', 'mog', 'tankdestroyer', 'howitzer', 'armoredcar',
        'lighttank', 'ifv', 'heavytank', 'mlrs', 'supplytruck', 'tradetruck']
CAPS = {
    'leopard': [15000, 5000, 1000], 'heavytank': [15000, 5000, 1000],
    'shilka': [12000, 4000, 1000], 'gepard': [12000, 4000, 1000],
    'howitzer': [12000, 4500, 1000], 'mlrs': [12000, 4500, 1000],
    'apc': [9000, 3500, 1000], 'ifv': [9000, 3500, 1000],
    'lighttank': [9000, 3500, 1000], 'tankdestroyer': [9000, 3500, 1000],
    'armoredcar': [9000, 3000, 1000], 'supplytruck': [7000, 2800, 1000],
    'tradetruck': [7000, 2600, 1000], 'mog': [4000, 1800, 800],
}
CONFIG = {
    0: dict(bevel=1, wheel=20, tube=16, links=36, detail=2),
    1: dict(bevel=0, wheel=12, tube=10, links=16, detail=1),
    2: dict(bevel=0, wheel=6, tube=6, links=0, detail=0),
}

# Embedded scalar contract is generated from the unchanged ORIGINAL CPU factory.
# It deliberately excludes large instance buffers, and never applies source scale twice.
CANONICAL = json.loads(r'''{"shilka":{"rootScale":[1,1,1],"bounds":{"min":[-5.359999923035502,0.09268667548894882,-5.775000095367432],"max":[5.359999923035502,9.85,7.980000019073486]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1.4,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[-0.55,-0.4,8],[0.55,-0.4,8],[-0.55,0.4,8],[0.55,0.4,8]]},{"name":"dish","parent":"turret","position":[0,3.1,-1],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"gepard":{"rootScale":[1,1,1],"bounds":{"min":[-5.359999923035502,0.09268667548894882,-5.775000095367432],"max":[5.359999923035502,9.85,7.980000019073486]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1.4,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[-2.8,0,8],[2.8,0,8]]},{"name":"dish","parent":"turret","position":[0,3.1,-1],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"leopard":{"rootScale":[1,1,1],"bounds":{"min":[-5.359999923035502,0.09268667548894882,-5.775000095367432],"max":[5.359999923035502,8.6,11.75500030517578]},"joints":[{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1.02,2.2],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0,9.56]]},{"name":"recoil","parent":"pitch","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80}]},"apc":{"rootScale":[1,1,1],"bounds":{"min":[-4.210000038146973,0.05000000074505806,-5.699999809265137],"max":[4.210000038146973,7.599999904632568,5.699999809265137]},"joints":[{"name":"turret","parent":"root","position":[0,4.7,1.1],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"mog":{"rootScale":[1,1,1],"bounds":{"min":[-4.425000190734863,0.2611415982246399,-5.75],"max":[1.649999976158142,2.950000023841858,3.6500000953674316]},"joints":[{"name":"field-position","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"turret","parent":"root","position":[0,1.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"backward":true},{"name":"pitch","parent":"turret","position":[0,1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0.1,-5.8]]}]},"tankdestroyer":{"rootScale":[1,1,1],"bounds":{"min":[-3.8499999046325684,0.10000000149011612,-4.849999904632568],"max":[3.8499999046325684,6.649999952316284,4.974999904632568]},"joints":[{"name":"turret","parent":"root","position":[0,3.85,-1.1],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"howitzer":{"rootScale":[1,1,1],"bounds":{"min":[-5.359999923035502,0.09268667548894882,-5.775000095367432],"max":[5.359999923035502,10.699999904632568,15.724999618530273]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,-1.2],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1.25,3.4],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0,13.6]]},{"name":"recoil","parent":"pitch","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"armoredcar":{"rootScale":[1,1,1],"bounds":{"min":[-3.0299999713897705,0,-4.349999904632568],"max":[3.0299999713897705,4.739999994635582,4.380000114440918]},"joints":[{"name":"turret","parent":"root","position":[0,3.95,-0.6],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,0.55,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0,2.85]]}]},"lighttank":{"rootScale":[0.8,0.8,0.8],"bounds":{"min":[-4.287999938428402,0.07414934039115906,-4.6200000762939455],"max":[4.287999938428402,6.4,5.540000000000001]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0.3,0.72,1.8],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0,5.2]]}]},"ifv":{"rootScale":[0.9,0.9,0.9],"bounds":{"min":[-4.8239999307319525,0.08341800794005394,-5.197500085830689],"max":[4.8239999307319525,7.2,6.2325]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0.3,0.72,1.8],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[0,0,5.2]]}]},"heavytank":{"rootScale":[1.14,1.14,1.14],"bounds":{"min":[-6.110399912260473,0.10566281005740165,-6.583500108718871],"max":[6.110399912260473,10.601999782562256,13.417799652099607]},"joints":[{"name":"road-wheels","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":12},{"name":"drive-spokes","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":24},{"name":"track-links","parent":"root","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"instanceCount":80},{"name":"turret","parent":"root","position":[0,4.1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1.02,2.2],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"recoil","parent":"pitch","position":[0,0,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]}]},"mlrs":{"rootScale":[1,1,1],"bounds":{"min":[-3.009999990463257,-2.3841857821338408e-8,-5.75],"max":[3.009999990463257,6.5899999141693115,5.849999904632568]},"joints":[{"name":"turret","parent":"root","position":[0,2.5,-2],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1]},{"name":"pitch","parent":"turret","position":[0,1,0],"rotation":[0,0,0,"XYZ"],"scale":[1,1,1],"muzzles":[[-1.5750000000000002,0.55,3.06],[-0.525,0.55,3.06],[0.525,0.55,3.06],[1.5750000000000002,0.55,3.06],[-1.5750000000000002,1.58,3.06],[-0.525,1.58,3.06],[0.525,1.58,3.06],[1.5750000000000002,1.58,3.06],[-1.5750000000000002,2.6100000000000003,3.06],[-0.525,2.6100000000000003,3.06],[0.525,2.6100000000000003,3.06],[1.5750000000000002,2.6100000000000003,3.06]]}]},"supplytruck":{"rootScale":[1,1,1],"bounds":{"min":[-2.880000114440918,0,-6.099999904632568],"max":[2.880000114440918,7.888026714324951,6.175000190734863]},"joints":[]},"tradetruck":{"rootScale":[1,1,1],"bounds":{"min":[-2.880000114440918,0,-6.099999904632568],"max":[2.880000114440918,4.849999904632568,6.175000190734863]},"joints":[]}}''')

def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/native/ground-pack-v04')
    parser.add_argument('--keys', nargs='+', choices=KEYS, default=KEYS)
    parser.add_argument('--lods', nargs='+', type=int, choices=CONFIG, default=[0, 1, 2])
    parser.add_argument('--texture-size', type=int, choices=[256, 512, 1024], default=512)
    parser.add_argument('--save-blend', action='store_true')
    parser.add_argument('--strict-budgets', action='store_true')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return parser.parse_args(argv)

def png_bytes(width, height, pixels):
    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)
    rows = b''.join(b'\0' + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 5)) + chunk(b'IEND', b''))

def atlas(output, size):
    directory = output / 'textures'; directory.mkdir(parents=True, exist_ok=True)
    # Two columns by four rows. One shared material shades paint/steel/rubber/
    # optics/canvas by UV region; a second material permits per-team accents.
    roles = [((82, 98, 65), 203, 25), ((43, 51, 46), 194, 167),
             ((26, 30, 27), 235, 0), ((25, 45, 49), 72, 38),
             ((99, 104, 77), 229, 0), ((216, 219, 207), 203, 12),
             ((178, 173, 145), 124, 0), ((108, 113, 100), 160, 183)]
    buffers = {name: bytearray(size * size * 4) for name in ['albedo', 'orm', 'normal']}
    for y in range(size):
        for x in range(size):
            tile = min(3, y * 4 // size) * 2 + min(1, x * 2 // size)
            color, roughness, metal = roles[tile]
            noise = ((x * 73856093) ^ (y * 19349663) ^ 81604) & 0xffffffff
            grain = ((noise >> 9) & 15) - 7
            wear = -9 if noise % 4093 < 4 else 0
            i = (y * size + x) * 4
            buffers['albedo'][i:i + 4] = bytes([max(0, min(255, c + grain + wear)) for c in color] + [255])
            buffers['orm'][i:i + 4] = bytes([255, max(0, min(255, roughness + grain)), metal, 255])
            buffers['normal'][i:i + 4] = bytes([128 + grain // 4, 128 + ((noise >> 16) & 3) - 1, 255, 255])
    images, descriptions = {}, []
    for kind, pixels in buffers.items():
        name = 'ground_v04_' + kind
        png = directory / (name + '.png'); raw = directory / (name + '.rgba8.bin')
        png.write_bytes(png_bytes(size, size, bytes(pixels))); raw.write_bytes(pixels)
        image = bpy.data.images.load(str(png), check_existing=False); image.name = name
        image.colorspace_settings.name = 'sRGB' if kind == 'albedo' else 'Non-Color'
        image.pack(); images[kind] = image
        descriptions.append(dict(name=name, png=png.relative_to(output).as_posix(), rgba=raw.relative_to(output).as_posix(),
                                 width=size, height=size, channels='RGBA8', row_order='top-to-bottom',
                                 color_space='sRGB' if kind == 'albedo' else 'linear',
                                 sha256=hashlib.sha256(pixels).hexdigest()))
    return images, descriptions

def atlas_material(name, images, accent=False):
    material = bpy.data.materials.new(name); material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    diffuse = nodes.new('ShaderNodeTexImage'); diffuse.image = images['albedo']
    if accent:
        multiply = nodes.new('ShaderNodeMixRGB'); multiply.blend_type = 'MULTIPLY'; multiply.inputs[0].default_value = 1
        multiply.inputs[2].default_value = (.28, .53, .68, 1)
        links.new(diffuse.outputs['Color'], multiply.inputs[1]); links.new(multiply.outputs[0], bsdf.inputs['Base Color'])
        material['team_accent'] = True
    else:
        links.new(diffuse.outputs['Color'], bsdf.inputs['Base Color'])
    orm = nodes.new('ShaderNodeTexImage'); orm.image = images['orm']
    channels = nodes.new('ShaderNodeSeparateColor'); links.new(orm.outputs['Color'], channels.inputs[0])
    links.new(channels.outputs['Green'], bsdf.inputs['Roughness']); links.new(channels.outputs['Blue'], bsdf.inputs['Metallic'])
    normal_image = nodes.new('ShaderNodeTexImage'); normal_image.image = images['normal']
    normal = nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value = .24
    links.new(normal_image.outputs['Color'], normal.inputs['Color']); links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    return material

def material_roles(images):
    common = atlas_material('ground_v04_atlas', images)
    accent = atlas_material('ground_v04_team_accent', images, True)
    roles = []
    for index, name in enumerate(['paint', 'steel', 'rubber', 'optic', 'cloth', 'neutral', 'lamp', 'bare']):
        material = bpy.data.materials.new('ground_v04_role_' + name)
        material.diffuse_color = (.25, .3, .2, 1); material['atlas_tile'] = index
        roles.append(material)
    return common, accent, roles

def remap_atlas_and_join(root, common, accent, roles):
    groups, mapped_data = {}, {}
    for obj in list(root.children_recursive):
        if obj.type != 'MESH': continue
        material = obj.data.materials[0] if obj.data.materials else roles[0]
        target = accent if bool(obj.get('team_accent', False)) else common
        data_id = obj.data.as_pointer()
        tile = int(material.get('atlas_tile', 0))
        uv = obj.data.uv_layers.active
        if uv and data_id not in mapped_data:
            # All samples stay inside the role tile, including mip gutters.
            column, row = tile % 2, tile // 2
            for item in uv.data:
                u, v = item.uv
                item.uv = ((column + .04 + (u % 1) * .92) / 2, (3 - row + .04 + (v % 1) * .92) / 4)
        if data_id not in mapped_data:
            obj.data.materials.clear(); obj.data.materials.append(target)
            for polygon in obj.data.polygons: polygon.material_index = 0
            mapped_data[data_id] = target
        else:
            target = mapped_data[data_id]
        if obj.get('wheel_axis') or obj.get('articulated_mesh'):
            obj['dynamic'] = True
            continue
        groups.setdefault((obj.parent, target), []).append(obj)
    for (parent, material), objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1: bpy.ops.object.join()
        combined = bpy.context.view_layer.objects.active
        combined.name = parent.name + ('__accent' if material == accent else '__surface')
        combined['pose_parent'] = parent.name; combined['dynamic'] = True
        combined['material_role'] = 'team_accent' if material == accent else 'atlas'
        combined.select_set(False)

def reset_scene():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0: bpy.data.meshes.remove(mesh)

def primitive_author(lod, roles):
    author = armor.Author(CONFIG[lod], (roles[0], roles[1], roles[3]))
    author.rubber, author.cloth, author.neutral, author.lamp, author.bare = roles[2], roles[4], roles[5], roles[6], roles[7]
    return author

def source_rig(key, lod):
    root = armor.empty('ground_v04_' + key); root['game_key'] = key; root['lod'] = lod
    root['game_axes'] = 'Y-up,+Z-forward'; root['source_root_scale_applied'] = False
    nodes = {'root': root, 'hull': armor.empty('hull', root)}
    for joint in CANONICAL[key]['joints']:
        if joint['name'] in ['road-wheels', 'drive-spokes', 'track-links']: continue
        nodes[joint['name']] = armor.empty(joint['name'], nodes[joint['parent']], joint['position'])
        if joint.get('backward'): nodes[joint['name']]['backward'] = True
        if joint.get('muzzles'):
            nodes[joint['name']]['source_muzzles_json'] = json.dumps(joint['muzzles'])
            for index, position in enumerate(joint['muzzles']):
                anchor = armor.empty(f'muzzle_{index:02d}', nodes[joint['name']], position)
                anchor['source_defined'] = True; anchor['role'] = 'muzzle'
    proxy = armor.empty('collisionProxy', root); proxy['non_rendering'] = True
    proxy['source_bounds_json'] = json.dumps(CANONICAL[key]['bounds'])
    return root, nodes

def leopard_study(lod, roles):
    # Reuse the already validated original articulated project study, with a
    # lower medium-LOD wheel/link budget and the source pitch node spelling.
    previous = dict(armor.CONFIG[lod])
    if lod == 1: armor.CONFIG[lod].update(wheel=12, links=28)
    root = armor.build(lod, (roles[0], roles[1], roles[3]))
    armor.CONFIG[lod] = previous
    root.name = 'ground_v04_leopard'; root['game_key'] = 'leopard'
    root['source_root_scale_applied'] = False
    for obj in root.children_recursive:
        if obj.name == 'gun': obj.name = 'pitch'
        elif obj.name == 'muzzle': obj.name = 'muzzle_00'; obj['source_defined'] = True
        if obj.name.startswith('road_wheel') or obj.name.startswith('track_'):
            obj['drive_source'] = 'original drivePhase'; obj['dynamic'] = True
    hull = next(obj for obj in root.children_recursive if obj.name == 'hull')
    author = primitive_author(lod, roles)
    stripe = author.box(hull, 'team_identifier', (0, 2.0, 5.45), (1.8, .22, .05), roles[5], bevel=0)
    stripe['team_accent'] = True
    root['asset_version'] = '0.4-ground-pack'
    return root

def team_mark(author, parent, center, size):
    marker = author.box(parent, 'team_identifier', center, size, author.neutral, bevel=0)
    marker['team_accent'] = True


def wheel_set(author, hull, xs, zs, radius, width, tracked=False):
    # A stable pivot is retained in every LOD. Wheels rotate about local game X;
    # original gameplay drive proxies stay owned by the source scene factory.
    for sign in (-1, 1):
        for index, z in enumerate(zs):
            pivot = armor.empty(('road_wheel' if tracked else 'wheel') + ('_left_' if sign < 0 else '_right_') + f'{index:02d}',
                                hull, (sign * xs, radius + .08, z))
            pivot['drive_source'] = 'original drivePhase'; pivot['drive_role'] = 'wheel'
            pivot['wheel_axis'] = 'game +X'; pivot['wheel_radius'] = radius
            author.cylinder(pivot, 'rubber_tire', (0, 0, 0), radius, width, 'X', author.cfg['wheel'], author.rubber)
            if author.cfg['detail']:
                author.cylinder(pivot, 'steel_hub', (sign * width * .52, 0, 0), radius * .64, .09, 'X',
                                author.cfg['wheel'], author.paint)
                if author.cfg['detail'] > 1:
                    for bolt in range(6):
                        angle = bolt * math.tau / 6
                        author.cylinder(pivot, 'wheel_fastener', (sign * width * .59, math.cos(angle)*radius*.39,
                                        math.sin(angle)*radius*.39), .055, .05, 'X', 6, author.bare)


def track_belts(author, hull):
    n = 40 if author.cfg['detail'] == 2 else 28 if author.cfg['detail'] else 16
    perimeter = 16.8 + math.tau * 1.05
    for sign in (-1, 1):
        parent = armor.empty('track_left' if sign < 0 else 'track_right', hull)
        parent['drive_source'] = 'original drivePhase'; parent['drive_role'] = 'track_uv'
        vertices, faces = [], []
        for i in range(n):
            y, z, angle = armor.track_point(perimeter * i/n)
            ny, nz = math.cos(angle)*.13, math.sin(angle)*.13
            for x, inside in [(sign*3.58,False),(sign*4.98,False),(sign*3.58,True),(sign*4.98,True)]:
                vertices.append((x,y-ny if inside else y+ny,z-nz if inside else z+nz))
        for i in range(n):
            a, b = i*4, ((i+1)%n)*4
            faces += [(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)]
        author.mesh(parent, 'closed_track_belt', vertices, faces, author.rubber)
        for i in range(author.cfg['links']):
            y, z, angle = armor.track_point(perimeter * i / author.cfg['links'])
            author.box(parent, 'track_shoe', (sign*4.28,y,z), (1.43,.16,.3), author.steel, bevel=0,
                       rotation=(angle,0,0))
    wheel_set(author,hull,4.25,[-3.75,-2.25,-.75,.75,2.25,3.75],.86,.54,True)


def running_details(author, hull, width, length, top):
    detail = author.cfg['detail']
    for sign in (-1, 1):
        author.box(hull,'headlamp_housing',(sign*width*.36,top-.62,length*.46),(.58,.46,.38),bevel=.045)
        if detail:
            author.box(hull,'headlamp_lens',(sign*width*.36,top-.59,length*.477),(.35,.22,.04),author.lamp,bevel=0)
            author.box(hull,'rear_lamp',(sign*width*.4,top-.8,-length*.493),(.26,.21,.05),author.lamp,bevel=0)
            author.box(hull,'tow_bracket',(sign*width*.35,1.35,length*.49),(.3,.3,.2),author.steel,bevel=.04)
    if detail:
        for i in range(12 if detail>1 else 6):
            author.box(hull,'engine_louvre',(-width*.3+i*width*.6/(11 if detail>1 else 5),top+.02,-length*.31),
                       (.1,.045,length*.16),author.steel,bevel=0)
        author.cylinder(hull,'driver_hatch',(width*.16,top+.07,length*.26),.52,.14,'Y',material=author.paint)
        author.box(hull,'driver_periscope',(width*.16,top+.2,length*.31),(.54,.18,.16),author.optic,bevel=.015)
    team_mark(author,hull,(0,top-.5,length*.49),(width*.23,.24,.045))


def tracked_hull(author, hull, key):
    author.wedge(hull,'lower_hull',(7.7,11.2),(7.2,9.9,-.2),2.5,(0,.75,0),bevel=.14)
    author.wedge(hull,'sloped_upper_hull',(7.2,9.9),(6.6,8.8,-.4),.6,(0,3.2,-.15),bevel=.08)
    track_belts(author,hull)
    for sign in (-1,1):
        author.box(hull,'mudguard',(sign*4.05,2.65,0),(1.65,.16,10.7),bevel=.03)
        if key in ['heavytank','ifv','howitzer']:
            count = 5 if author.cfg['detail'] else 1
            for i in range(count):
                z = -4.1+i*2.05 if count>1 else 0
                author.box(hull,'segmented_skirt',(sign*4.4,2.25,z),(.22,1.3,1.95 if count>1 else 10),bevel=.03)
        if author.cfg['detail']:
            author.box(hull,'side_stowage',(sign*3.25,3.85,-3.2),(.7,.45,2.3),bevel=.06)
            author.box(hull,'rear_exhaust',(sign*3.05,2.7,-5.23),(.8,.7,.4),author.steel,bevel=.05)
    running_details(author,hull,7.2,11.2,3.8)


def roof_equipment(author, turret, width, length, top):
    if not author.cfg['detail']: return
    author.cylinder(turret,'commander_hatch',(width*.22,top,-length*.1),.56,.15,'Y',material=author.paint)
    author.box(turret,'armored_sight',(-width*.23,top+.16,length*.24),(.68,.43,.65),bevel=.07)
    author.box(turret,'sight_glass',(-width*.23,top+.17,length*.24+.335),(.42,.19,.035),author.optic,bevel=0)
    author.cylinder(turret,'antenna',(width*.32,top+.9,-length*.31),.035,1.8,'Y',6,author.steel)
    if author.cfg['detail']>1:
        for sign in (-1,1):
            for i in range(3):
                author.cylinder(turret,'smoke_dispenser',(sign*width*.46,top-.3,.7-i*.4),.14,.45,'Y',8,author.steel)


def cannon(author, pitch, recoil, length, radius=.2):
    author.box(pitch,'mantlet',(0,0,.05),(1.4,1.05,1.1),bevel=.1)
    author.cylinder(recoil,'barrel',(0,0,length*.5),radius,length,'Z',material=author.steel)
    if author.cfg['detail']:
        author.cylinder(recoil,'thermal_sleeve',(0,0,length*.28),radius*1.38,length*.42,'Z',material=author.paint)
        author.cylinder(recoil,'bore_evacuator',(0,0,length*.58),radius*1.6,.8,'Z',material=author.paint)
    author.cylinder(recoil,'muzzle_collar',(0,0,length-.17),radius*1.24,.34,'Z',material=author.steel)
    if author.cfg['detail']>1:
        author.cylinder(recoil,'dark_bore',(0,0,length+.006),radius*.74,.018,'Z',material=author.rubber)


def tracked_model(key,lod,roles):
    root,nodes = source_rig(key,lod); author = primitive_author(lod,roles)
    hull,turret,pitch = nodes['hull'],nodes['turret'],nodes['pitch']
    tracked_hull(author,hull,key)
    if key in ['lighttank','ifv']:
        author.wedge(turret,'compact_turret',(4.5,4.8),(3.4,3.8,-.25),1.7,(0,-.04,-.25),bevel=.13)
        cannon(author,pitch,pitch,5.2,.16 if key=='ifv' else .23)
        if key=='ifv':
            author.box(turret,'atgm_sponson',(-2.25,.55,.1),(.95,.9,2.6),bevel=.09)
            author.box(turret,'atgm_dark_cap',(-2.25,.55,1.415),(.69,.64,.03),author.rubber,bevel=0)
            if author.cfg['detail']:
                for z in [-2.1,-.7,.7,2.1]: author.box(hull,'troop_hatch',(0,3.87,z),(2,.1,.85),bevel=.025)
        roof_equipment(author,turret,4.5,4.8,1.72)
    elif key=='heavytank':
        author.wedge(turret,'heavy_cast_turret',(6.7,6.8),(5.6,5.5,-.2),2.2,(0,-.05,-.35),bevel=.17)
        author.box(turret,'rear_bustle',(0,1.1,-3.7),(5.6,1.75,1.7),bevel=.12)
        cannon(author,pitch,nodes['recoil'],9.56,.25)
        # Bulky wedge and spaced ERA silhouette separate it from the Leopard.
        for sign in [-1,1]:
            author.wedge(turret,'angular_cheek',(2.7,3.6),(2.1,2.9,-.3),1.6,(sign*1.85,.2,1.8),bevel=.08)
            for i in range(4 if lod<2 else 1):
                author.box(turret,'reactive_armor',(sign*3.04,1.3,-1.7+i*.92 if lod<2 else -.3),
                           (.35,.68,.78 if lod<2 else 3.4),bevel=.04)
        roof_equipment(author,turret,6.5,6.8,2.23)
    elif key=='howitzer':
        author.wedge(turret,'artillery_casemate',(6.8,7.4),(6.1,6.7,-.25),2.7,(0,-.05,-.4),bevel=.15)
        author.box(turret,'rear_loading_hatch',(0,1.1,-4.17),(2.5,2,.15),bevel=.06)
        cannon(author,pitch,nodes['recoil'],13.6,.3)
        if lod<2:
            author.box(nodes['recoil'],'muzzle_brake',(0,0,13.15),(.9,.75,.9),author.steel,bevel=.08)
            author.box(hull,'rear_spade',(0,.95,-5.7),(3.2,1.6,.3),author.steel,bevel=.04)
            author.cylinder(turret,'loading_hoist',(2.8,3.6,-2.2),.12,2.1,'Y',8,author.steel)
        roof_equipment(author,turret,6.8,7.4,2.72)
    else:
        aa = key=='gepard'
        author.wedge(turret,'aa_turret',(5.9 if aa else 5.3,5.7),(4.7 if aa else 4.5,4.7,-.1),2.2,(0,-.05,-.2),bevel=.12)
        for index,(x,y,z) in enumerate(next(j['muzzles'] for j in CANONICAL[key]['joints'] if j['name']=='pitch')):
            author.box(pitch,'gun_pod',(x,y,1),(1.2 if aa else .7,1.2 if aa else .7,3.7),bevel=.1)
            author.cylinder(pitch,'aa_barrel',(x,y,4.95),.18 if aa else .13,6.1,'Z',material=author.steel)
            author.cylinder(pitch,'flash_hider',(x,y,7.78),.23 if aa else .17,.44,'Z',material=author.steel)
            if lod<2:
                author.cylinder(pitch,'barrel_jacket',(x,y,3.5),.26 if aa else .19,2.3,'Z',material=author.paint)
        dish = nodes['dish']; width=4.7 if aa else 3.1
        author.box(dish,'radar_mast',(0,.62,0),(.38,1.25,.38),bevel=.03)
        # Convex, opaque antenna panel with an elliptical rim, not a flat square.
        segments=16 if lod==0 else 10 if lod==1 else 6
        vertices=[(0,1.6,.34)]+[(math.cos(i*math.tau/segments)*width*.5,1.6+math.sin(i*math.tau/segments)*1.05,0) for i in range(segments)]
        faces=[(0,i+1,(i+1)%segments+1) for i in range(segments)]
        author.mesh(dish,'radar_parabolic_panel',vertices,faces,author.steel)
        if lod<2:
            author.box(dish,'radar_feed',(0,1.6,.68),(.16,.16,.8),author.steel,bevel=0)
            upgrade = armor.empty('upgraded_tracking_optic',turret); upgrade['min_level']=1
            author.box(upgrade,'tracking_optic',(1.4,2.4,1.8),(.9,.62,.8),bevel=.08)
            author.box(upgrade,'tracking_glass',(1.4,2.4,2.22),(.62,.32,.025),author.optic,bevel=0)
        team_mark(author,turret,(0,1.1,2.65),(1.6,.3,.04))
    return root


def wheeled_model(key,lod,roles):
    root,nodes=source_rig(key,lod); author=primitive_author(lod,roles)
    hull,turret=nodes['hull'],nodes['turret']
    if key=='armoredcar':
        width,length,top=4.6,8.4,3.7
        author.wedge(hull,'scout_lower_hull',(4.6,8.4),(4.2,7.9,-.1),1.5,(0,1,0),bevel=.12)
        author.wedge(hull,'sloping_crew_cabin',(4.2,6),(3.5,4.2,-.45),1.2,(0,2.5,.4),bevel=.1)
        wheel_set(author,hull,2.45,[-2.6,2.7],1.05,.84)
        author.box(turret,'remote_weapon_station',(0,.2,0),(1.5,.7,1.4),bevel=.1)
        author.cylinder(nodes['pitch'],'machinegun',(0,0,1.4),.11,2.8,'Z',material=author.steel)
        if lod<2:
            for sign in [-1,1]:
                author.box(hull,'side_window',(sign*1.95,3.1,1.15),(.04,.49,1.8),author.optic,bevel=.025)
                author.box(hull,'cabin_door',(sign*2.05,2.6,.9),(.07,1.45,1.9),bevel=.035)
            author.box(hull,'windshield',(0,3.15,2.58),(2.8,.55,.1),author.optic,bevel=.03)
    elif key=='tankdestroyer':
        width,length,top=6.2,9.7,3.75
        author.wedge(hull,'at_lower_hull',(6.2,9.7),(5.6,8.4,-.1),1.7,(0,1.05,0),bevel=.14)
        author.wedge(hull,'angled_upper_hull',(5.6,8.4),(4.7,6.6,-.3),1,(0,2.75,0),bevel=.1)
        wheel_set(author,hull,3.3,[-3.2,0,3.2],1.1,.9)
        author.box(turret,'atgm_pedestal',(0,.4,0),(2.2,1.2,1.8),bevel=.1)
        for x in [-1.3,1.3]:
            for y in [0,.95]:
                author.box(nodes['pitch'],'missile_container',(x,y,.5),(1.05,.8,4.9),bevel=.08)
                author.box(nodes['pitch'],'sealed_container_cap',(x,y,2.965),(.83,.6,.03),author.rubber,bevel=0)
        if lod<2:
            author.box(turret,'guidance_optic',(0,1.3,1),(.75,.6,.65),bevel=.08)
            author.box(turret,'guidance_lens',(0,1.3,1.34),(.42,.32,.025),author.optic,bevel=0)
    else:
        width,length,top=6.7,11.4,4.65
        author.wedge(hull,'boat_hull',(5.6,10.3),(6.7,11.4,0),1.8,(0,.9,0),bevel=.1)
        author.wedge(hull,'sloped_armored_roof',(6.7,11.4),(5.1,8.9,-.35),1.95,(0,2.7,0),bevel=.12)
        wheel_set(author,hull,3.65,[-3.8,-1.3,1.3,3.8],1.1,1.05)
        author.wedge(turret,'low_command_turret',(2.8,2.9),(1.8,2.1,-.2),1.3,(0,0,0),bevel=.1)
        author.cylinder(turret,'direct_mounted_gun',(0,.6,2),.12,3.3,'Z',material=author.steel)
        if lod<2:
            for z in [-3.4,-1.65,0,1.65]:
                author.box(hull,'troop_roof_hatch',(0,4.69,z),(2.7,.1,1.1),bevel=.025)
            for sign in [-1,1]:
                for z in [-2.7,0,2.7]:
                    author.box(hull,'vision_port',(sign*2.88,3.87,z),(.06,.22,.42),author.optic,bevel=0)
    running_details(author,hull,width,length,top)
    return root


def truck_chassis(author,hull):
    author.box(hull,'ladder_chassis',(0,1.7,0),(4.4,.55,12.2),author.steel,bevel=.06)
    author.box(hull,'armored_cab_lower',(0,2.9,4.25),(4.6,2.15,3.5),bevel=.13)
    author.wedge(hull,'sloped_cab_roof',(4.6,3.5),(4.1,2.8,-.2),.8,(0,3.96,4.25),bevel=.1)
    wheel_set(author,hull,2.3,[-3.8,-1.2,4.3],1.15,1)
    if author.cfg['detail']:
        author.box(hull,'windshield',(0,4.15,5.78),(3.62,.67,.08),author.optic,bevel=.025)
        for sign in [-1,1]:
            author.box(hull,'cab_side_window',(sign*2.29,4.1,4.2),(.06,.68,1.75),author.optic,bevel=.02)
            author.box(hull,'cab_door',(sign*2.32,3.23,4.2),(.05,1.1,1.8),bevel=.025)
            author.box(hull,'mirror_arm',(sign*2.63,4.25,5.0),(.65,.08,.08),author.steel,bevel=0)
            author.box(hull,'side_mirror',(sign*2.9,4.25,5.0),(.08,.42,.3),author.optic,bevel=.02)
    author.box(hull,'front_bumper',(0,1.8,6.02),(4.75,.55,.3),author.steel,bevel=.04)
    running_details(author,hull,4.6,12.2,3.15)


def truck_model(key,lod,roles):
    root,nodes=source_rig(key,lod); author=primitive_author(lod,roles)
    hull=nodes['hull']; truck_chassis(author,hull)
    if key=='mlrs':
        author.box(hull,'launcher_flatbed',(0,2.25,-2),(4.8,.45,7.2),bevel=.07)
        author.cylinder(nodes['turret'],'azimuth_ring',(0,0,0),1.65,.5,'Y',material=author.steel)
        author.box(nodes['turret'],'elevation_cradle',(0,.6,-.1),(2.3,.7,3.7),bevel=.06)
        pitch=nodes['pitch']
        author.box(pitch,'rocket_rack_rear_frame',(0,1.58,-2.74),(4.5,3.23,.3),bevel=.04)
        for row in range(3):
            for col in range(4):
                x,y=(col-1.5)*1.05,.55+row*1.03
                author.cylinder(pitch,'launch_tube',(x,y,0),.43,6.12,'Z',8 if lod==2 else 12 if lod==1 else 16,author.paint)
                if lod<2:
                    author.cylinder(pitch,'dark_tube_mouth',(x,y,3.065),.32,.02,'Z',8 if lod==1 else 12,author.rubber)
        for z in [-1.7,1.5]: author.box(pitch,'tube_retaining_band',(0,1.58,z),(4.55,3.35,.14),author.steel,bevel=0)
        for sign in [-1,1]:
            author.box(hull,'stowed_stabilizer',(sign*2.42,1.68,-4.8),(.3,1.7,.55),author.steel,bevel=.03)
        team_mark(author,pitch,(0,3.27,-2),(1.6,.04,.5))
    else:
        author.box(hull,'cargo_bed',(0,2.28,-1.65),(4.6,.32,7.5),bevel=.07)
        if key=='tradetruck':
            # Rounded canvas silhouette: extruded polygon, opaque and cheap.
            section=[(-2.23,2.45),(-2.23,4.2),(-1.6,4.8),(1.6,4.8),(2.23,4.2),(2.23,2.45)]
            vertices=[(x,y,z) for z in [-5.28,2] for x,y in section]
            n=len(section); faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
            author.mesh(hull,'canvas_cargo_cover',vertices,faces,author.cloth)
            if lod<2:
                for z in [-4.5,-2.6,-.7,1.2]:
                    for sign in [-1,1]: author.box(hull,'canvas_strap',(sign*2.25,3.5,z),(.04,1.5,.09),author.steel,bevel=0)
        else:
            author.box(hull,'support_equipment_cabinet',(0,3.2,-1),(4.4,1.5,5.1),bevel=.12)
            author.box(hull,'repair_crane_base',(1.4,4.5,-4.6),(1,.7,1),bevel=.07)
            author.box(hull,'folded_repair_crane',(1.4,5.7,-4.6),(.6,2.1,.6),bevel=.05)
            author.box(hull,'crane_boom',(.15,6.65,-4.6),(3.1,.48,.5),bevel=.05)
            if lod<2:
                author.cylinder(hull,'crane_hydraulic_ram',(1.1,5.6,-4.25),.13,1.9,'Y',8,author.bare)
                for sign in [-1,1]:
                    for z in [-2.4,-.8,.8]:
                        author.box(hull,'cabinet_access_panel',(sign*2.22,3.22,z),(.04,1.2,1.3),bevel=.025)
                        author.box(hull,'cabinet_handle',(sign*2.26,3.24,z),(.035,.1,.3),author.steel,bevel=0)
        team_mark(author,hull,(0,3.28,-5.43),(1.5,.4,.05))
    return root


def mog_model(lod,roles):
    root,nodes=source_rig('mog',lod); author=primitive_author(lod,roles)
    field,turret,pitch=nodes['field-position'],nodes['turret'],nodes['pitch']
    author.cylinder(turret,'traverse_column',(0,.25,0),.22,.8,'Y',material=author.steel)
    for angle in [0,math.tau/3,math.tau*2/3]:
        author.box(turret,'tripod_leg',(math.sin(angle)*.65,-.15,math.cos(angle)*.65),(.16,.16,1.65),author.steel,
                   bevel=.02,rotation=(.4,angle,0))
    author.box(pitch,'heavy_machinegun_receiver',(0,.1,-.8),(.55,.5,1.7),author.steel,bevel=.05)
    author.cylinder(pitch,'heavy_machinegun_barrel',(0,.1,-3.55),.12,4.5,'Z',material=author.steel)
    author.cylinder(pitch,'barrel_cooling_jacket',(0,.1,-2.2),.19,1.9,'Z',material=author.paint)
    author.cylinder(pitch,'muzzle_brake',(0,.1,-5.66),.17,.28,'Z',material=author.steel)
    author.box(pitch,'ammunition_box',(-.6,.05,-.35),(.65,.62,.95),bevel=.06)
    if lod<2:
        author.box(pitch,'shoulder_stock',(0,.03,.55),(.25,.35,1),bevel=.035)
        author.box(pitch,'optical_sight',(0,.52,-.6),(.18,.25,.48),author.optic,bevel=.025)
    for level in [1,2]:
        fort=armor.empty('fortification_level_'+str(level),field); fort['min_level']=level
        # Two short joined arcs leave an open rear approach for the actual crew.
        count=9 if lod<2 else 6
        for i in range(count):
            angle=-math.pi*.76+i*math.pi*1.52/(count-1)
            x,z=math.sin(angle)*3.0,-math.cos(angle)*3.0
            author.box(fort,'sandbag',(x,.38+(level-1)*.55,z),
                       (1.35,.62,.68),author.cloth,bevel=.14,rotation=(0,-angle,0))
        if level==2 and lod<2:
            author.box(fort,'spare_ammunition_case',(2.1,.45,1.7),(.85,.65,1.4),bevel=.07)
            author.box(fort,'rangefinder_case',(-2.1,.4,1.5),(.65,.5,1.1),bevel=.07)
    team_mark(author,pitch,(-.938,.13,-.35),(.04,.21,.45))
    return root


def build_model(key, lod, roles):
    if key == 'leopard': return leopard_study(lod, roles)
    if key in ['lighttank','ifv','heavytank','howitzer','shilka','gepard']: return tracked_model(key,lod,roles)
    if key in ['apc','tankdestroyer','armoredcar']: return wheeled_model(key,lod,roles)
    if key in ['mlrs','supplytruck','tradetruck']: return truck_model(key,lod,roles)
    if key == 'mog': return mog_model(lod,roles)
    raise ValueError('Unknown source model: '+key)


def triangulate_export_meshes(root):
    # glTF tangent export cannot triangulate arbitrary N-gon barrel caps itself.
    # Do this once after joining, preserving face UVs and authored hard normals.
    done=set()
    for obj in root.children_recursive:
        if obj.type!='MESH' or obj.data.as_pointer() in done: continue
        done.add(obj.data.as_pointer())
        bm=bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='FIXED',ngon_method='EAR_CLIP')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()

def stable_nodes(root, baseline):
    nodes = {obj.name: obj for obj in [root, *root.children_recursive]}
    if baseline is None:
        return [dict(name=obj.name, parent=obj.parent.name if obj.parent else None,
                     location=list(obj.location), rotation=list(obj.rotation_euler), scale=list(obj.scale))
                for obj in [root, *root.children_recursive]]
    for item in baseline:
        if item['name'] in nodes: continue
        parent = nodes.get(item['parent']); placeholder = bpy.data.objects.new(item['name'], None)
        bpy.context.collection.objects.link(placeholder); placeholder.parent = parent
        placeholder.location = item['location']; placeholder.rotation_euler = item['rotation']; placeholder.scale = item['scale']
        placeholder['lod_empty'] = True; nodes[item['name']] = placeholder
    return baseline

def source_hashes():
    names = ['src/game/config.js', 'src/rendering/models/ground.js',
             'src/rendering/models/vehicles/blender-vehicles.js', 'native/art-source/armor_v03.py']
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}

def main():
    args = cli(); args.output.mkdir(parents=True, exist_ok=True)
    images, textures = atlas(args.output, args.texture_size)
    common, accent, roles = material_roles(images)
    manifest = dict(version=4, authored_by='Original procedural project art', runtime_installed=False,
                    visual_acceptance=False, axes='Y-up,+Z-forward', source_hashes=source_hashes(),
                    models=[], textures=textures, expected_keys=KEYS)
    measured = []
    for key in args.keys:
        files, baseline, stats = [], None, []
        for lod in args.lods:
            reset_scene(); root = build_model(key, lod, roles)
            remap_atlas_and_join(root, common, accent, roles)
            triangulate_export_meshes(root)
            baseline = stable_nodes(root, baseline)
            root['authorship'] = 'Original procedural project art; no external assets'
            triangles, parts = armor.geometry_report(root)
            root['evaluated_triangles'] = triangles
            for obj in [root, *root.children_recursive]:
                if obj.type == 'MESH': obj['dynamic'] = True
            bpy.ops.object.select_all(action='DESELECT')
            for obj in [root, *root.children_recursive]: obj.select_set(True)
            bpy.context.view_layer.objects.active = root
            destination = args.output / f'{key}_lod{lod}.glb'
            bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
                                      export_yup=True, export_extras=True, export_animations=False,
                                      export_materials='EXPORT', export_apply=False, export_tangents=True)
            if args.save_blend: bpy.ops.wm.save_as_mainfile(filepath=str(args.output / f'{key}_lod{lod}.blend'))
            item = dict(key=key, lod=lod, triangles=triangles, cap=CAPS[key][lod], within_cap=triangles<=CAPS[key][lod],
                        file=destination.name, bytes=destination.stat().st_size,
                        sha256=hashlib.sha256(destination.read_bytes()).hexdigest(), parts=parts)
            files.append(destination.name); stats.append(item); measured.append(item)
            print('GROUND_V04_EXPORT', json.dumps({k:v for k,v in item.items() if k!='parts'}), flush=True)
        contract = dict(CANONICAL[key]); contract['root_scale_applied'] = False
        contract['material_atlas'] = 'ground_v04_atlas'; contract['team_material'] = 'ground_v04_team_accent'
        contract['drive_source'] = 'original groundModel.userData.drivePhase; retain source drive proxies'
        contract['authored_nodes'] = baseline
        manifest['models'].append(dict(key=key, lods=files, contract=contract, stats=stats))
        (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
        print('GROUND_V04_MODEL_READY',key,flush=True)
    (args.output/'report.json').write_text(json.dumps(dict(models=measured,complete=set(args.keys)==set(KEYS),
                 blender=bpy.app.version_string,photorealism_claim=False),indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    if args.strict_budgets and any(not item['within_cap'] for item in measured):
        raise RuntimeError('Measured art exceeds a provisional cap; inspect report.json')

if __name__ == '__main__':
    main()

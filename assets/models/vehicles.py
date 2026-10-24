"""Blender 4.5: deterministic original low-poly vehicle assets. No external models."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
parts = {}
current = None


def box(p, size, shade=1, bevel=.08, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p, rotation=rotation)
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = o.modifiers.new('machined edges', 'BEVEL')
        m.width = bevel
        m.segments = 1
        bpy.ops.object.modifier_apply(modifier=m.name)
    o['shade'] = shade
    parts[current].append(o)


def cylinder(p, radius, length, shade=.7, axis='Y', vertices=10):
    # Coordinates are deliberately authored in game Y-up/+Z-forward space.
    rot = {'Y': (math.pi/2, 0, 0), 'Z': (0, 0, 0), 'X': (0, math.pi/2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=length,
                                      location=p, rotation=rot)
    o = bpy.context.object
    o['shade'] = shade
    parts[current].append(o)


def part(name):
    global current
    current = name
    parts[name] = []


part('leopard_body')
box((0, 1.65, 0), (7.7, 2.5, 11.3), .9, .32)
box((0, 3.15, .6), (7.1, .8, 8.8), 1, .24)
box((0, 2.7, 4.7), (7.2, .55, 2), 1.08, .12, (.18, 0, 0))
for sign in [-1, 1]:
    box((sign*4.15, 1.2, 0), (1.8, 2.1, 10.4), .28, .42)
    for i in range(5):
        box((sign*4.05, 2.8, -4.1+i*2), (.4, 1.3, 1.9), .82 if i % 2 else 1.05)
    box((sign*2.6, 2.5, 5.6), (.7, .4, .14), 1.65, .02)
    box((sign*2.8, 2.1, -5.7), (.6, .35, .15), .45, .02)
for i in range(9):
    box((-2.7+i*.67, 3.62, -4), (.23, .12, 1.85), .35, .015)
cylinder((1.3, 3.65, 3.2), .65, .17, 1.15)
part('leopard_turret')
cylinder((0, -.12, 0), 2.65, .3, .45, vertices=12)
box((0, .7, -.35), (6.2, 1.9, 6.4), 1, .48)
for sign in [-1, 1]:
    box((sign*1.9, .7, 1.8), (2.3, 1.6, 2.9), 1.12, .28, (0, sign*-.2, 0))
    box((sign*2.7, .6, -2.2), (.5, 1.1, 2), .65)
    for i in range(4):
        cylinder((sign*2.9, 1.6, -.7-i*.4), .15, .55, .35, 'Y', 6)
    cylinder((sign*1.15, 1.85, -.7), .72, .2, 1.12)
box((0, .8, -3.6), (5, 1.1, 1.2), .72)
for x in [-2.1, 0, 2.1]:
    box((x, 1.5, -3.6), (.12, .4, 1.2), 1.4, .02)
box((1.2, 2.15, .5), (.8, .5, .8), .72)
box((1.2, 2.2, .92), (.55, .25, .04), .2, .01)
cylinder((-2.4, 2.9, -2.4), .045, 3.2, .8, 'Y', 6)
part('leopard_pitch')
box((0, -.3, 0), (1.6, 1.1, 1.4), .85, .18)
part('leopard_recoil')
cylinder((0, 0, 4.75), .22, 9, .65, 'Z', 10)
cylinder((0, 0, 2.1), .32, 2.3, 1, 'Z', 10)
cylinder((0, 0, 5.1), .34, 1.35, 1.12, 'Z', 10)
for z in [1, 3.3, 6, 8.7]:
    cylinder((0, 0, z), .26, .1, 1.3, 'Z', 10)
cylinder((0, 0, 9.35), .28, .35, .5, 'Z', 10)
cylinder((0, 0, 9.54), .185, .03, .12, 'Z', 10)

part('mlrs_body')
box((0, 1.7, 0), (4.5, 1.1, 11.5), .6, .15)
box((0, 3.25, 3.5), (4.8, 3.2, 4), 1, .24)
box((0, 2.7, 5.6), (4.8, .55, .3), .5)
box((0, 3.7, 5.52), (3.9, 1, .08), .2, .03)
box((0, 3.65, 5.6), (.14, 1.2, .12), .9, .01)
for sign in [-1, 1]:
    box((sign*2.43, 3.6, 3.9), (.08, 1, 1.8), .24, .02)
    box((sign*2.5, 2.3, 4.4), (.5, .2, 2), .75)
    box((sign*1.6, 2.8, 5.8), (.7, .35, .1), 1.6, .01)
    box((sign*2.3, 1.8, -4.4), (.6, .8, 1.6), .8)
for z in [-4, -1.3, 3.6]:
    cylinder((0, 1.1, z), .2, 5.6, .3, 'X', 8)
part('mlrs_wheel')
cylinder((0, 0, 0), 1.1, .9, .25, 'X', 12)
cylinder((.47, 0, 0), .52, .08, 1.2, 'X', 10)
cylinder((-.47, 0, 0), .52, .08, 1.2, 'X', 10)
part('mlrs_turret')
cylinder((0, 0, 0), 1.5, .5, .5)
box((0, .4, 0), (3.4, .5, 3.7), .85)
for x in [-1.5, 1.5]:
    box((x, 1, 0), (.35, 1.4, 1.5), .7)
part('mlrs_pitch')
box((0, 0, 0), (4.6, .25, 6.3), .65)
for row in range(3):
    for col in range(4):
        x, y = (col-1.5)*1.05, .55+row*1.03
        # Open-looking dark bore with a bright tube rim, without alpha or textures.
        cylinder((x, y, 0), .48, 6, .95 if (row+col)%2 else .8, 'Z', 8)
        cylinder((x, y, 3.04), .39, .03, .12, 'Z', 8)
        cylinder((x, y, -3.04), .4, .03, .3, 'Z', 8)
for z in [-2.5, 1.8]:
    box((0, 1.55, z), (4.5, .13, .2), 1.2, .02)

result = {}
for name, objects in parts.items():
    vertices, indices, table = [], [], {}
    for o in objects:
        mesh = o.data
        mesh.calc_loop_triangles()
        normal_matrix = o.matrix_world.to_3x3().inverted().transposed()
        for tri in mesh.loop_triangles:
            for vi in tri.vertices:
                p = o.matrix_world @ mesh.vertices[vi].co
                n = (normal_matrix @ tri.normal).normalized()
                # A scalar vertex shade gets multiplied by the side paint at runtime.
                key = tuple(round(v, 4) for v in (*p, *n, o['shade']))
                if key not in table:
                    table[key] = len(vertices)//7
                    vertices.extend(key)
                indices.append(table[key])
    assert len(indices) % 3 == 0
    assert all(math.isfinite(v) for v in vertices)
    result[name] = {'vertices': vertices, 'indices': indices}
out = ROOT/'src/rendering/models/generated/vehicle-meshes.js'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text('// Generated by assets/models/vehicles.py using Blender 4.5.14; do not edit.\n'
               '// prettier-ignore\nexport const VEHICLE_MESHES = '+json.dumps(result, separators=(',', ':'))+';\n')
for name, data in result.items():
    print(name, 'vertices', len(data['vertices'])//7, 'triangles', len(data['indices'])//3)

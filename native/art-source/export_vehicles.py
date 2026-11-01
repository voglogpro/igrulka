"""Re-export original repository Blender assets for Godot. Run Blender --background --python thisfile.
No downloaded art. Authoring source: assets/models/vehicles.py. Output is Y-up/+Z-forward GLB.
"""
import bpy, math
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'assets/models/vehicles.py'
scope = {'__file__': str(source)}
# Execute authoring only, avoiding the browser JavaScript export side effect.
exec(compile(source.read_text(encoding='utf-8').split('\nresult = {}')[0], str(source), 'exec'), scope)
parts = scope['parts']
out = ROOT / 'native/Skyfront.Client/Assets/models'
out.mkdir(parents=True, exist_ok=True)
for model in ['leopard', 'mlrs']:
    bpy.ops.object.select_all(action='DESELECT')
    collection = []
    for name, objects in parts.items():
        if not name.startswith(model + '_') or name.endswith('_wheel'):
            continue
        offset = Vector((0,0,0))
        if '_turret' in name or '_pitch' in name or '_recoil' in name:
            offset += Vector((0,4.1 if model=='leopard' else 2.5,0 if model=='leopard' else -2))
        if '_pitch' in name or '_recoil' in name:
            offset += Vector((0,1.02,2.2)) if model=='leopard' else Vector((0,1,0))
        for obj in objects:
            obj.location += offset
            collection.append(obj)
    if model == 'mlrs':
        for x in [-2.5,2.5]:
            for z in [-4,-1.3,3.6]:
                for source_obj in parts['mlrs_wheel']:
                    obj=source_obj.copy(); obj.data=source_obj.data.copy(); bpy.context.collection.objects.link(obj)
                    obj.location += Vector((x,1.1,z)); collection.append(obj)
    else:
        for x in [-4.15,4.15]:
            for z in [-4,-2.4,-.8,.8,2.4,4]:
                bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.9,depth=.3,location=(x,1.2,z),rotation=(0,math.pi/2,0))
                obj=bpy.context.object; obj['shade']=.45; collection.append(obj)
    paint=bpy.data.materials.new(model+'_paint'); paint.use_nodes=True
    bsdf=paint.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value=.82
    vertex=paint.node_tree.nodes.new('ShaderNodeVertexColor'); vertex.layer_name='Col'
    paint.node_tree.links.new(vertex.outputs['Color'],bsdf.inputs['Base Color'])
    for obj in collection:
        shade=round(float(obj.get('shade',1)),2)
        colors=obj.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        for color in colors.data: color.color=(.36*shade,.40*shade,.25*shade,1)
        obj.data.materials.clear(); obj.data.materials.append(paint)
        # Convert authored Y-up to Blender Z-up; glTF exporter converts back.
        obj.matrix_world = Matrix.Rotation(math.pi/2,4,'X') @ obj.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection: obj.select_set(True)
    bpy.context.view_layer.objects.active=collection[0]
    bpy.ops.object.join()
    bpy.context.object.name=model
    bpy.ops.export_scene.gltf(filepath=str(out/(model+'.glb')),export_format='GLB',use_selection=True,export_yup=True)
    print('EXPORTED', model, (out/(model+'.glb')).stat().st_size)

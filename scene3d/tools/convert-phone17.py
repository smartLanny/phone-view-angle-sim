import bpy
import sys
from mathutils import Matrix, Vector
from pathlib import Path

source, output = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(
    filepath=str(Path(source).resolve()),
    prim_path_mask='/uqyXUHbCOHbdqXa/oGOBzWXwJxPkCRE/jqrLJsSCRSFSMip',
    import_cameras=False, import_lights=False,
    import_visible_only=True, apply_unit_conversion_scale=True,
)
origin = Vector((-0.014580001192092897, 0.004518311449161327, 0.006711778144025584))
objects = [(o, o.matrix_world.copy()) for o in bpy.context.scene.objects if o.type == 'MESH']
for obj, world in objects:
    if obj.name.startswith('HkNSnYzBPABcqwM'):
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    obj.parent = None
    obj.data.transform(Matrix.Translation(-origin) @ world)
    obj.matrix_world = Matrix.Identity(4)
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.export_scene.gltf(
    filepath=str(Path(output).resolve()), export_format='GLB',
    export_yup=True, export_cameras=False, export_lights=False,
    export_animations=False, export_extras=False,
)
print('Converted', len(bpy.context.scene.objects), 'meshes to', output)

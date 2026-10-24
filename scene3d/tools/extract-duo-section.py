import argparse
import json
import statistics
from pxr import Usd, UsdGeom

parser = argparse.ArgumentParser()
parser.add_argument('input')
parser.add_argument('-o', '--output')
args = parser.parse_args()
stage = Usd.Stage.Open(args.input)
root = stage.GetDefaultPrim()
root.GetVariantSet('Pose').SetVariantSelection('Landscape')
screen = next(p for p in stage.Traverse() if p.GetName() == 'UXtsBZYlaUvHoEh')
box = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'render']).ComputeWorldBound(screen).ComputeAlignedBox()
width = box.GetSize()[0] * UsdGeom.GetStageMetersPerUnit(stage) * 1000
root.GetVariantSet('Pose').SetVariantSelection('Closed')
screen = next(p for p in stage.Traverse() if p.GetName() == 'UXtsBZYlaUvHoEh')
mesh = UsdGeom.Mesh(screen)
matrix = UsdGeom.Xformable(screen).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
points = [matrix.Transform(p) for p in mesh.GetPointsAttr().Get()]
uv = UsdGeom.PrimvarsAPI(screen).GetPrimvar('st').ComputeFlattened()
scale = UsdGeom.GetStageMetersPerUnit(stage) * 1000
groups = {}
for i, index in enumerate(mesh.GetFaceVertexIndicesAttr().Get()):
    u = float(uv[i][0])
    if .49999 <= u <= .5462:
        groups.setdefault(round(u, 4), []).append((u, points[index][0] * scale, points[index][2] * scale))
rows = [[statistics.median(p[k] for p in values) for k in range(3)] for _, values in sorted(groups.items())]
tip = rows[0][1]
section = [[round(u - .5, 8), round(abs(z), 6), round(x - tip, 6)] for u, x, z in rows]
section[0] = [0, 0, 0]
result = {'units': 'mm', 'restWidth': width, 'columns': ['uMinusHalf', 'halfGapX', 'depthFromTipZ'], 'closedHalfSection': section,
          'flatGap': 2 * section[-1][1], 'maxWaterdropGap': 2 * max(p[1] for p in section), 'restTransitionWidth': 2 * section[-1][0] * width}
text = json.dumps(result, indent=2)
if args.output:
    with open(args.output, 'w') as f:
        f.write(text + '\n')
else:
    print(text)

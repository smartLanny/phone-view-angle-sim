import importlib.util
import json
from pathlib import Path
import pickle
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('converter', ROOT / 'tools/convert_ang2.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConversionTests(unittest.TestCase):
    def test_filename_direction_overrides_stale_internal_label(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / '可视角 120°.ang2'
            table = {'0°': {key: [1., 1., 1.] for key in converter.PRIMARY_KEYS}}
            file.write_bytes(pickle.dumps({'iPhone 18 Pro Max 60°': table}))
            parsed = converter.load(file)
            self.assertEqual(parsed['phi'], 120)
            self.assertEqual(parsed['name'], 'iPhone 18 Pro Max 60°')

    def test_internal_direction_remains_a_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / '测量.ang2'
            table = {'0°': {key: [1., 1., 1.] for key in converter.PRIMARY_KEYS}}
            file.write_bytes(pickle.dumps({'小米 18 Pro Max 垂直': table}))
            self.assertEqual(converter.load(file)['phi'], 0)

    def test_vam_rotation_maps_every_direction_and_primary(self):
        relative, config = next(iter(converter.VAM_SOURCES.items()))
        path = ROOT / relative
        raw = path.read_bytes()
        source = json.loads(raw)
        sets = converter.load_vam(path, **config)
        theta = source['grid']['th']
        self.assertEqual([s['phi'] for s in sets], [0, 30, 60, 90, 120, 150])
        self.assertEqual(sets[0]['angles'], list(range(-70, 71, 2)))
        for index, azimuth in enumerate(source['grid']['az']):
            corrected = (azimuth + 180) % 360
            item = next(s for s in sets if s['phi'] == corrected % 180)
            sign = 1 if corrected < 180 else -1
            for primary in converter.PRIMARY_KEYS.values():
                for j, angle in enumerate(theta):
                    actual = item['data'][primary][item['angles'].index(sign * angle)]
                    self.assertEqual(actual, source['xyz'][primary][index][j])
        self.assertEqual(path.read_bytes(), raw)

    def test_complete_profiles_and_reproducible_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'data.js'
            subprocess.run([sys.executable, str(ROOT / 'tools/convert_ang2.py'), str(ROOT), str(output)], check=True, capture_output=True)
            self.assertEqual(output.read_bytes(), (ROOT / 'web/data.js').read_bytes())
            self.assertEqual(output.read_bytes(), (ROOT / 'scene3d/public/data/ang_data.js').read_bytes())
            payload = json.loads(output.read_text().split('=', 1)[1].strip().rstrip(';'))
            self.assertEqual(payload['angles'], list(range(-70, 71, 2)))
            self.assertEqual([(p['id'], p['device'], p['privacy']) for p in payload['profiles']], [
                ('p0', 'iPhone 18 Pro Max GH3', False), ('p1', 'iPhone 18 Pro Max GH3', True),
                ('p2', '小米 18 Pro Max', False), ('p3', '小米 18 Pro Max', True),
                ('p4', '华为 Mate 90 Pro Max 典藏版', False),
                ('p5', 'iPhone 17 Pro Max GV3', False)])
            self.assertEqual(payload['profiles'][1]['privacyKind'], 'film')
            self.assertEqual(payload['profiles'][3]['privacyKind'], 'mode')
            for profile in payload['profiles']:
                self.assertEqual([s['phi'] for s in profile['sets']], [0, 30, 60, 90, 120, 150])
                for item in profile['sets']:
                    if profile['id'] != 'p5':
                        self.assertEqual(item['phi'], converter.infer_phi(Path(item['file']).stem))
                    for values in item['data'].values():
                        self.assertEqual(len(values), 71)


if __name__ == '__main__':
    unittest.main()

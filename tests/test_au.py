# Australian spots and au.py (IMOS/AODN wave buoys, BoM wind now, BoM ACCESS wind forecast and model tides via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
AU_IDS = ['noosa', 'snapper', 'byron', 'manly', 'bells', 'woolamai', 'margaret', 'trigg']
KEYS = ['zone', 'aodn', 'bomStation', 'buoyKm', 'buoyName', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_au_spots_complete(self):
        au = [s for s in SPOTS if s.get('country') == 'au']
        self.assertEqual([s['id'] for s in au], AU_IDS)
        for s in au:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertRegex(s['bomStation'], r'^ID[NQVW]60801\.\d{5}$')
            self.assertIn(s['zone'], ('Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth'))
        for c in ('tw', 'jp', 'ca', 'hi'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


if __name__ == '__main__':
    unittest.main()

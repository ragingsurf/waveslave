# Hawaii spots and ca.py reading them (NOAA NDBC/CDIP buoys, NDBC and NWS wind, NOAA tides, GFS wind via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
HI_IDS = ['pipeline', 'waikiki', 'makaha', 'sandybeach', 'honolua', 'hookipa', 'hanalei', 'honolii']
KEYS = ['ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_hi_spots_complete(self):
        hi = [s for s in SPOTS if s.get('country') == 'hi']
        self.assertEqual([s['id'] for s in hi], HI_IDS)
        for s in hi:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            ws = s['windStation'] if isinstance(s['windStation'], list) else [s['windStation']]
            for w in ws: self.assertRegex(w, r'^(ndbc|nws):[A-Z0-9]+$')
            self.assertTrue(18 < s['lat'] < 23 and -161 < s['lon'] < -154)
        for c in ('tw', 'jp', 'ca'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


if __name__ == '__main__':
    unittest.main()

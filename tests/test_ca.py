# California spots and ca.py (NOAA NDBC/CDIP buoys, NDBC and NWS wind, NOAA tides, HRRR wind via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
CA_IDS = ['oceanbeach', 'steamerlane', 'rincon', 'malibu', 'huntington', 'trestles', 'swamis', 'blacks']
KEYS = ['ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_ca_spots_complete(self):
        ca = [s for s in SPOTS if s.get('country') == 'ca']
        self.assertEqual([s['id'] for s in ca], CA_IDS)
        for s in ca:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertRegex(s['windStation'], r'^(ndbc|nws):[A-Z0-9]+$')
        self.assertEqual(sum(s.get('country', 'tw') == 'tw' for s in SPOTS), 8)
        self.assertEqual(sum(s.get('country') == 'jp' for s in SPOTS), 8)


if __name__ == '__main__':
    unittest.main()

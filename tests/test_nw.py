# Pacific Northwest spots (Tofino, Washington, Oregon) and ca.py reading them: NOAA NDBC, CDIP and Environment Canada buoys,
# NDBC, NWS and ECCC wind, NOAA and CHS tides, HRRR/GFS wind via Open-Meteo.
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
NW_IDS = ['coxbay', 'longbeach', 'lapush', 'westport', 'seaside', 'shortsands', 'otterrock', 'bastendorff']
KEYS = ['zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_nw_spots_complete(self):
        nw = [s for s in SPOTS if s.get('country') == 'nw']
        self.assertEqual([s['id'] for s in nw], NW_IDS)
        for s in nw:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertIn(s['zone'], ('America/Los_Angeles', 'America/Vancouver'))
            # a buoy's name and distance follow it when a spot falls back to its second buoy
            n = len(s['ndbc'])
            self.assertTrue(n >= 1)
            for v in (s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']): self.assertEqual(len(v), n, s['id'])
            self.assertEqual(len(s['stationName']), len(s['windStation']), s['id'])
            for L in ('zh', 'ja'): self.assertEqual(len(s[L]['stationName']), len(s['windStation']), s['id'] + ' ' + L)
            for w in s['windStation']: self.assertRegex(w, r'^(ndbc|nws|eccc):[A-Z0-9]+$')
            self.assertRegex(s['tideStation'], r'^(\d{7}|chs:\d{5})$')
            self.assertTrue(43 < s['lat'] < 49.5 and -126 < s['lon'] < -123.5)
            bc = s['zone'] == 'America/Vancouver'
            self.assertEqual(s.get('buoyBy'), 'eccc' if bc else None, s['id'])
            self.assertEqual(s['tideStation'].startswith('chs:'), bc, s['id'])
        for c in ('tw', 'jp', 'ca', 'hi', 'au'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


if __name__ == '__main__':
    unittest.main()

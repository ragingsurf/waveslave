# The site keeps up with CWA's buoys: CWA adds the HH:00 readings at about HH:30, the heartbeat starts a build just after :30,
# and buoywait.py makes that build ask CWA again (until :45) while no buoy has this hour's reading yet (Bryan, Nov 8).
# Run: python3 -m unittest discover -s tests -v
import os, sys, datetime, subprocess, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from buoywait import verdict


def doc(*stations):
    # stations: lists of (DateTime, WaveHeight, WavePeriod), shaped like CWA's O-B0075-001.
    return {"Records": {"SeaSurfaceObs": {"Location": [
        {"Station": {"StationID": "B%d" % i}, "StationObsTimes": {"StationObsTime": [
            {"DateTime": t + ":00+08:00", "WeatherElements": {"WaveHeight": h, "WavePeriod": p}} for t, h, p in rows]}}
        for i, rows in enumerate(stations)]}}}


AT = lambda hm: datetime.datetime(2026, 11, 8, int(hm[:2]), int(hm[3:]))
OLD = [("2026-11-08T07:00", "1.7", "6.4")]
NEW = OLD + [("2026-11-08T08:00", "1.8", "6.5")]


class BuoyWait(unittest.TestCase):
    def test_waits_when_no_buoy_has_this_hour(self):
        self.assertEqual(verdict(doc(OLD, OLD), AT("08:31")), "wait")

    def test_one_buoy_with_this_hour_is_enough(self):
        # Chenggong (Donghe) reports an hour after the others, so it must not hold the build.
        self.assertEqual(verdict(doc(OLD, NEW), AT("08:31")), "ok")

    def test_empty_reading_does_not_count(self):
        blank = OLD + [("2026-11-08T08:00", "-", None)]
        self.assertEqual(verdict(doc(blank), AT("08:33")), "wait")

    def test_only_waits_between_30_and_45(self):
        for hm in ("08:05", "08:29", "08:45", "08:59"):
            self.assertEqual(verdict(doc(OLD), AT(hm)), "ok", hm)

    def test_single_reading_not_in_a_list(self):
        d = doc(NEW); loc = d["Records"]["SeaSurfaceObs"]["Location"][0]
        loc["StationObsTimes"]["StationObsTime"] = loc["StationObsTimes"]["StationObsTime"][-1]
        self.assertEqual(verdict(d, AT("08:40")), "ok")


class HeartbeatSlot(unittest.TestCase):
    # The heartbeat's shell arithmetic: a refresh is due when the last one began before the latest HH:30 that is a minute old.
    def slot(self, hm):
        now = int(datetime.datetime(2026, 11, 8, int(hm[:2]), int(hm[3:]), tzinfo=datetime.timezone.utc).timestamp())
        sh = 'now=%d; slot=$(( now - now %% 3600 + 30*60 )); [ $(( now %% 3600 )) -lt $(( 31*60 )) ] && slot=$(( slot - 3600 )); date -u -d @$slot +%%H:%%M' % now
        return subprocess.run(["bash", "-c", sh], capture_output=True, text=True, check=True).stdout.strip()

    def test_slots(self):
        self.assertEqual(self.slot("00:31"), "00:30")
        self.assertEqual(self.slot("00:59"), "00:30")
        self.assertEqual(self.slot("01:00"), "00:30")
        self.assertEqual(self.slot("01:30"), "00:30")
        self.assertEqual(self.slot("01:31"), "01:30")

    def test_workflow_uses_this_arithmetic(self):
        wf = open(os.path.join(ROOT, ".github", "workflows", "heartbeat.yml")).read()
        self.assertIn("slot=$(( now - now % 3600 + 30*60 ))", wf)
        self.assertIn("[ $(( now % 3600 )) -lt $(( 31*60 )) ] && slot=$(( slot - 3600 ))", wf)
        self.assertIn('if [ "$began" -lt "$slot" ]; then', wf)


if __name__ == "__main__":
    unittest.main()

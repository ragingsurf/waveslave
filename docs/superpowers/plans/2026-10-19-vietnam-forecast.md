# Vietnam Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Vietnam spots (My Khe, Non Nuoc, An Bang, Quy Nhon, Hon Chong, Bai Dai, Mui Ne, Vung Tau) to waveslave.tw behind a "Vietnam" country button, with ECMWF's wind from the sea cell, Cam Ranh's airport wind at Bai Dai, Open-Meteo's tide model, a home view, and a separate `log-vn/`.

**Architecture:** No new reader: `kr.py` already fills any country from Open-Meteo's wind and tide replies and NOAA's METAR, as it does for Indonesia. refresh.sh's Korea–Philippines–Indonesia–Hainan loop takes `vn`, with `cell_selection=sea` as for Hainan; log/history/correct run with `vn`; the page adds a sixteenth country after Hainan.

**Tech Stack:** POSIX sh, Python 3 stdlib, vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-vietnam-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- Open-Meteo and NOAA requests go out as today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/vn/`: `openvn.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 8 spots, one day), `tidevn.json` (the tide model, three days), `metar-vn.json` (Cam Ranh's last 3 hours), and a `snap_in.json` with the Vietnam spots as snap.py writes them, next to one spot each from Taiwan, Korea, the Philippines, Hong Kong and Hainan.
- [ ] **2. Tests first.** `tests/test_vn.py`: the 8 spots are complete and last in spots.json, with Bai Dai's airport and My Khe's cam; `kr.fill(..., 'vn')` gives +7, no buoy, wind now at Bai Dai only (none once Cam Ranh's newest report is over 3 hours old), 3-hourly `wind`, the tide model's highs and lows, sun times on Vietnam's dates; the replies follow the spot list; other countries untouched; `kr.py ... vn` runs isolated like refresh.sh; refresh.sh's loop asks for Vietnam's wind from the sea cells and for Cam Ranh's reports. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `vn` touch only Vietnam's spots. `tests/test_mi.py`, `tests/test_hk.py` and `tests/test_hn.py` find their spots before Vietnam's, and Hainan's loop test reads the loop with `vn`.
- [ ] **3. spots.json and kr.py.** The 8 spots after Hainan's, with names and regions in zh and ja; kr.py's comments name Vietnam.
- [ ] **4. refresh.sh and the workflow.** `vn` in the loop, `CS="&cell_selection=sea"` for `hn` and `vn` on both wind requests; history/log/correct lines for `vn`; `log-vn` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after Hainan (越南 / ベトナム), Vietnam's outline in `HOME_ICONS`, `HOMES.vn`, "Model tide", the ECMWF legend, the Typhoon watch panel's NCHMF link, footer credits (ECMWF, the tide model, Cam Ranh's airport), the comments listing the countries.
- [ ] **6. Home view.** Build a page from real downloads and set `HOMES.vn` so the upright width and the sideways height decide the zoom the name fitting starts from, with every dot and name clear of the buttons.
- [ ] **7. Map checks.** Vietnam's home view in `tests/map/check.js` (`HOMES`), its first open and button (`vietnam`), its pressure lines from the West Pacific grid (`vietnamIso`); its view in `tests/map/mapmath.test.js`'s `isoPick` test.
- [ ] **8. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the Vietnam spots in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.

# Hainan Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 Hainan spots (Dadonghai, Houhai, Qingshui Bay, Xiangshui Bay, Riyue Bay, Shimei Bay, Shenzhou) to waveslave.tw behind a "Hainan" country button, with ECMWF's wind from the sea cell, Open-Meteo's tide model, a home view, the island's coast in finer detail on the map, and a separate `log-hn/`.

**Architecture:** No new reader: `kr.py` already fills any country from Open-Meteo's wind and tide replies, as it does for the Philippines. refresh.sh's Korea–Philippines–Indonesia loop takes `hn`, with `cell_selection=sea` for Hainan only; log/history/correct run with `hn`; the page adds a fifteenth country after Hong Kong, and a second DETAIL box holds Natural Earth's 10 m land for the island (`tools/detail_coast.py`).

**Tech Stack:** POSIX sh, Python 3 stdlib, vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-hainan-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- Open-Meteo requests go out as today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/hn/`: `openhn.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 7 spots, one day), `tidehn.json` (the tide model, three days), and a `snap_in.json` with the Hainan spots as snap.py writes them, next to one spot each from Taiwan, Korea, the Philippines and Hong Kong.
- [ ] **2. Tests first.** `tests/test_hn.py`: the 7 spots are complete and last in spots.json; `kr.fill(..., 'hn')` gives +8, no buoy and no wind now, 3-hourly `wind`, the tide model's highs and lows, sun times; the replies follow the spot list; other countries untouched; `kr.py ... hn` runs isolated like refresh.sh; refresh.sh's loop asks for Hainan's wind from the sea cells and sends no METAR request for it. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `hn` touch only Hainan's spots. `tests/test_hk.py` and `tests/test_mi.py` find their spots before Hainan's.
- [ ] **3. spots.json and kr.py.** The 7 spots after Hong Kong's, with names and regions in zh and ja; kr.py's comments name Hainan.
- [ ] **4. refresh.sh and the workflow.** `hn` in the loop, `CS="&cell_selection=sea"` for it on both wind requests; history/log/correct lines for `hn`; `log-hn` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after Hong Kong (海南 / 海南島), Hainan's outline in `HOME_ICONS`, `HOMES.hn`, "Model tide", the ECMWF legend, the Typhoon watch panel's CMA links, footer credits, the comments listing the countries; the second DETAIL box `[108.4371, 111.2629, 17.9517, 20.2483]` and its coast from `python3 -I tools/detail_coast.py <ne_10m_land.geojson> template.html`, with Hong Kong's rings unchanged. A country's first open on its old map slides sideways inside the box until its dots clear the buttons (`offButtons`): on an upright phone the longer country column would cover St Clair and Bells Beach.
- [ ] **6. Map checks.** Hainan's home view in `tests/map/check.js` (`HOMES`), its first open and button (`hainan`), its pressure lines from the West Pacific grid (`hainanIso`); its view in `tests/map/mapmath.test.js`'s `isoPick` test; every old-map first open with its dots clear of the buttons (`firstOpenClear`).
- [ ] **7. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the Hainan spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.

# Testing & Optimization — Harmonic Regime Detector

This document explains how the parameter optimization pipeline works: what ground truth is, how chunks are created, how the optimizer scores configurations, and how to run everything.

---

## Overview

The **Harmonic Regime Detector** (`harmonic_regime_detector.py`) takes a MIDI file and outputs a sequence of harmonic "regimes" — stable harmonic periods separated by **TRANSITION SPIKE!** boundaries. The goal of optimization is to find parameters that make these boundaries align as closely as possible with manually-placed user markers.

The pipeline has three stages:

```
[MIDI + User Markers]  →  [optimize_params.py]  →  [Top-N config JSONs]
                                                     ↓
                                               [Visualizer dropdown]
```

---

## Ground Truth: User Markers

User markers are placed manually in the visualizer (using the T1/T2 marker tool) and saved as JSON files in the `markers/` directory:

| File | Markers | Duration |
|---|---|---|
| `markers/pathetique_full_chunk_markers.json` | ~116 | ~75s |
| `markers/pathetique_64s_chunk_markers.json` | 116 | 64s |
| `markers/pathetique_16s_chunk_markers.json` | 38 | 16s |

Each marker has a `time_ms` (in the **120 BPM tick coordinate space**, see below) and a `tier`:
- **Tier 1** (`tier1`): Major structural boundary — strong harmonic shift, usually coincides with a phrase or section break.
- **Tier 2** (`tier2`): Harmonic spike — notable local dissonance or chord change within a phrase.

> **⚠️ Important: 120 BPM Convention**  
> All time values (note onsets, regime boundaries, marker positions) in this system are computed using the formula:  
> `time_ms = tick × (500.0 / tpq)`  
> This treats all MIDI ticks as if the tempo were 120 BPM (500ms/quarter), regardless of the MIDI file's actual tempo metadata. Do NOT change this constant — all existing markers were placed using this coordinate system.

---

## Creating Test Chunks

Chunks are slices of the full MIDI used as focused test targets. Use `create_chunk.py` to produce a new chunk:

```bash
python3 create_chunk.py \
    --midi    midis/pathetique_full_chunk.mid \
    --markers markers/pathetique_full_chunk_markers.json \
    --duration_ms 64000 \
    --out_name pathetique_64s_chunk
```

This produces:
- `midis/pathetique_64s_chunk.mid` — MIDI sliced to the first 64,000ms (120 BPM ticks)
- `markers/pathetique_64s_chunk_markers.json` — markers with `time_ms ≤ 64000`

**How the tick boundary is computed:**
```python
end_tick = int(end_ms / (500.0 / tpq))   # 120 BPM convention
```

After creating a chunk, run `export_etme_data.py` to generate the ETME JSON that the visualizer loads (see below).

---

## ETME Export

The `export_etme_data.py` script runs the Harmonic Regime Detector on a MIDI and outputs a JSON file that the visualizer loads for the piano roll + regime overlay:

```bash
python3 export_etme_data.py \
    --midi_key    pathetique_64s_chunk \
    --angle_map   dissonance \
    --break_method hybrid \
    --jaccard     0.5
```

Output goes to:
```
visualizer/public/etme_pathetique_64s_chunk_dissonance_hybrid_0.5.json
```

The MIDI key is auto-discovered from `midis/` — any `.mid` file in that directory is available.

**Batch export (all break methods × jaccard values):**
```bash
for method in hybrid hybrid_split jaccard_only jaccard_only_split; do
  for j in 0.3 0.5 0.7; do
    python3 export_etme_data.py --midi_key pathetique_16s_chunk \
        --angle_map dissonance --break_method $method --jaccard $j
  done
done
```

---

## The Optimizer

`optimize_params.py` performs a **grid search** over 7 parameters of the Harmonic Regime Detector, scoring each configuration against a set of user markers.

### Scoring Logic

The scoring exactly mirrors the visualizer's **Compare vs Model** panel:

1. Extract all **TRANSITION SPIKE!** regime start times from the detector output → `model_boundaries`
2. Load user marker `time_ms` values → `ground_truth`
3. For each model boundary, check if a user marker exists within `±tolerance_ms` (default: 100ms)
   - **TP** (True Positive): model boundary matched by a nearby user marker
   - **FP** (False Positive): model boundary with no marker nearby
4. For each user marker, check if a model boundary exists within `±tolerance_ms`
   - **FN** (False Negative): user marker with no model boundary nearby

**Objective:** minimize `FP + FN` (total errors). Tiebreak: fewer FP (prefer missing boundaries over hallucinating them).

**Recall floor:** configs must achieve `≥ min_recall %` (default: 50%) to be considered — prevents the degenerate solution of detecting almost nothing (0 FP, all FN).

### Parameter Search Space (Full Grid — 12,960 trials)

| Parameter | Values searched |
|---|---|
| `break_angle` | 15°, 25°, 35°, 45°, 55°, 65° |
| `min_break_mass` | 0.25, 0.5, 0.75, 1.0, 1.25 |
| `merge_angle` | 5°, 10°, 15°, 20°, 25°, 30° |
| `debounce_ms` | 10, 25, 50, 75, 100, 150ms |
| `jaccard_threshold` | 0.125, 0.25, 0.375, 0.5, 0.625, 0.75 |
| `break_method` | `hybrid`, `hybrid_split` |
| `angle_map` | `dissonance` (fixed) |

### Running the Optimizer

**Full grid search on the 64s chunk (default):**
```bash
python3 optimize_params.py
```

**Quick grid (288 trials, ~1s) for sanity checks:**
```bash
python3 optimize_params.py --quick
```

**On the 16s chunk (canonical optimization target):**
```bash
python3 optimize_params.py --chunk pathetique_16s_chunk
```

**Custom tolerance or recall floor:**
```bash
python3 optimize_params.py --tolerance 150 --min_recall 40
```

**Export top-10 instead of top-5:**
```bash
python3 optimize_params.py --top_n 10
```

### Outputs

| File | Contents |
|---|---|
| `optimize_results.csv` | Full ranked table of all 12,960 configurations |
| `visualizer/public/etme_<chunk>_optimized_1.json` | Top config, ready to load in visualizer |
| `visualizer/public/etme_<chunk>_optimized_2-5.json` | Configs 2–5 |
| `optimize_heatmap.png` | 2D sensitivity landscape (requires `pip install matplotlib`) |

The optimized JSONs automatically appear in the visualizer's MIDI dropdown labeled  
`🏆 Opt #1 — errors=N (FP=X FN=Y) P=Z% R=W%`

---

## Cross-Chunk Validation

After finding the best parameters on the 16s chunk, you can validate they generalize to the 64s chunk:

```bash
# 1. Run optimizer on 16s chunk to find top 5
python3 optimize_params.py --chunk pathetique_16s_chunk

# 2. Manually export those 5 configs applied to the 64s MIDI
python3 -c "
from export_etme_data import export_analysis
export_analysis('midis/pathetique_64s_chunk.mid',
    'visualizer/public/etme_pathetique_64s_chunk_16s_opt_1.json',
    break_method='hybrid', break_angle=25, merge_angle=20,
    min_break_mass=0.75, debounce_ms=10, jaccard_threshold=0.125,
    angle_map='dissonance')
"
```

Cross-validated JSONs appear in the dropdown labeled  
`✅ 16s-Opt #N — K spikes  (16s: P=X% R=Y%)`

---

## Benchmark Results

Run date: **2026-04-01**  
Full-grid results saved in `optimizer_runs/`:
- `pathetique_16s_chunk_20260401_1840.csv` — 12,960 trials on 16s chunk
- `pathetique_64s_chunk_20260401_1843.csv` — 12,960 trials on 64s chunk

---

### 16s Chunk — Summary

| Metric | Value |
|---|---|
| Ground truth markers | 38 (28 Tier1, 10 Tier2) |
| Keyframes extracted | 129 |
| **Best errors (FP+FN)** | **11** |
| Best TP | 34 / 38 |
| Best FP | 7 |
| Best FN | 4 |
| Best Precision | 82.9% |
| Best Recall | 89.5% |
| Best F1 | **86.1%** |
| Configs passing recall floor (≥50%) | 12,960 / 12,960 |

**Top 5 configs (all tied at errors=11):**

| # | break_method | BA | MA | MBM | D | J | Errors | P | R | F1 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | hybrid | 25° | 20° | 0.75 | 10ms | 0.125 | 11 | 82.9% | 89.5% | 86.1% |
| 2 | hybrid_split | 25° | 20° | 0.75 | 10ms | 0.125 | 11 | 82.9% | 89.5% | 86.1% |
| 3 | hybrid | 25° | 20° | 0.75 | 25ms | 0.125 | 11 | 82.9% | 89.5% | 86.1% |
| 4 | hybrid_split | 25° | 20° | 0.75 | 25ms | 0.125 | 11 | 82.9% | 89.5% | 86.1% |
| 5 | hybrid | 25° | 20° | 0.75 | 50ms | 0.125 | 11 | 82.9% | 89.5% | 86.1% |

---

### 64s Chunk — Summary

| Metric | Value |
|---|---|
| Ground truth markers | 116 (96 Tier1, 20 Tier2) |
| Keyframes extracted | 617 |
| **Best errors (FP+FN)** | **54** |
| Best TP | 91 / 116 |
| Best FP | 29 |
| Best FN | 25 |
| Best Precision | 75.8% |
| Best Recall | 78.4% |
| Best F1 | **77.1%** |
| Configs passing recall floor (≥50%) | 10,116 / 12,960 |

**Top 5 configs:**

| # | break_method | BA | MA | MBM | D | J | Errors | P | R | F1 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | hybrid | 25° | 20° | 0.75 | 100ms | 0.250 | 54 | 75.8% | 78.4% | 77.1% |
| 2 | hybrid | 35° | 20° | 0.75 | 100ms | 0.375 | 55 | 75.6% | 77.6% | 76.6% |
| 3 | hybrid | 35° | 20° | 0.75 | 100ms | 0.250 | 56 | 75.9% | 75.9% | 75.9% |
| 4 | hybrid | 25° | 20° | 0.75 | 100ms | 0.375 | 57 | 73.6% | 79.3% | 76.3% |
| 5 | hybrid | 25° | 20° | 0.75 | 100ms | 0.125 | 58 | 75.9% | 73.3% | 74.6% |

---

### Side-by-Side Comparison

| Metric | 16s chunk | 64s chunk |
|---|---|---|
| Errors (FP+FN) | **11** | **54** (46.6% error rate vs 29% on 16s) |
| Precision | 82.9% | 75.8% |
| Recall | 89.5% | 78.4% |
| F1 | 86.1% | 77.1% |
| Optimal debounce | 10–50ms | **100ms** |
| Optimal Jaccard | 0.125 | **0.25–0.375** |

**Key insight — parameter divergence between chunks:**  
The 64s chunk prefers a higher Jaccard threshold (0.25 vs 0.125) and longer debounce (100ms vs 10ms). This is consistent with the detector needing to suppress rapid re-triggering across longer musical phrases. The `break_angle` and `min_break_mass` converge on the same values (25°, 0.75), suggesting those control the fundamental detection sensitivity while debounce/jaccard control temporal spacing.

The visual dropdown in the visualizer shows all results under:
- `🏆 Opt #1–5` — chunk-specific optimizer winners
- `✅ 16s-Opt #1–5` — 16s winners applied to the 64s piece (cross-validation)

---

## Marker Data Integrity Guidelines

- **Never hand-edit `time_ms` values** in a marker file — they must come from the visualizer UI.
- **New chunks must use `create_chunk.py`** — do not manually copy-paste marker files, as the `midiFile` key must match the chunk name.
- **The 120 BPM convention is global** — any script that reads ticks and converts to ms must use `tick_to_ms = 500.0 / tpq`.
- **The full chunk markers are the source of truth** — chunk marker files are always slices of `pathetique_full_chunk_markers.json`.

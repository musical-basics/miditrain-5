# Deep Analysis Brief — Harmonic Regime Detector V2.2

This document provides context for analyzing the current state of the detector, its known limitations, and areas for improvement. The goal is to reduce both FP and FN equally.

---

## System Overview

The **Harmonic Regime Detector** processes MIDI note data (no audio, no tempo metadata) and identifies harmonic "regimes" — stable harmonic periods separated by **TRANSITION SPIKE** boundaries. These boundaries represent moments where the harmonic content shifts meaningfully (chord changes, key changes, structural downbeats).

The system bootstraps downbeat detection from harmonic content — the MIDI file provides no bar lines, no downbeats, no tempo. All timing is derived from the note data using the harmonic color wheel.

### Core Architecture

1. **Keyframe extraction** — MIDI notes within 50ms of each other are grouped into "keyframes" (simultaneous attack groups)
2. **Particle building** — Each note becomes a weighted particle with:
   - `angle` from the **dissonance map** (maps intervals to angles on a color wheel)
   - `mass` = `(velocity/127) × duration_boost × register_boost`
   - Duration boost: linear, clamped to [0.5, 2.0] from `duration_ms / 1000`
   - Register boost: `1.0 + (|octave - 4| × 0.15)`
3. **State machine** — Each keyframe is evaluated against the current regime's **anchor** (persistent pitch-class profile) and assigned to one of:
   - **Stable** — compatible with anchor, merged into regime
   - **TRANSITION SPIKE** — confirmed regime break
   - **Pending Spike** — in probation, awaiting debounce confirmation
   - **Swallowed Spike** — entered probation but resolved back to regime
   - **Limbo** — divergent but insufficient mass to break

### Dissonance Map (Interval → Angle)

```
1:0°  b2:180°  2:120°  b3:270°  3:60°  4:330°
#4:210°  5:30°  b6:300°  6:90°  b7:240°  7:150°
```

Notes are represented as pitch classes (interval from root). The vector average of all particles gives the regime's "harmonic color" (hue + saturation).

---

## Break Decision Logic (`_should_break`, hybrid method)

For the `hybrid` break method (used by all top configs), a break triggers when ALL of:

1. **Mass gate**: `pmass > min_break_mass` (0.75) — prevents single quiet notes from triggering breaks
2. **Not a subset**: the pending group's pitch classes are NOT a subset of the anchor's pitch classes
3. **Either** angle divergence OR set divergence:
   - `diff > break_angle` (angle between pending group vector and anchor vector exceeds threshold), OR
   - `jaccard < jaccard_threshold` (Jaccard similarity of pitch-class sets falls below threshold)

### Anchor Profile

The anchor is a `{interval: weight}` dictionary that persists across the regime:
- **Reinforcement**: When a frame merges, present notes get `+mass` (capped at 3.0)
- **Decay**: Absent notes get `×0.95` per frame, removed below 0.05
- **Reset**: On confirmed regime break, anchor rebuilds from the spike's notes

### Debounce / Probation

When `_should_break` returns True, the frame enters **probation** (`pending_spike_frames`):
- If the spike persists for `≥ debounce_ms` (100ms), it's **confirmed**
- If a compatible frame arrives within the debounce window, the spike is **swallowed** (resolved back to the regime)
- If a silence gap ≥ `debounce_ms` occurs, the spike is confirmed via gap

### Limbo Contamination Guard (NEW — 2026-04-01)

When accumulated limbo frames contaminate the evaluation of a compatible frame:
- Before triggering a break, check if the current frame's pitch classes are a **subset** of the anchor's pitch classes
- If yes, the current frame is a regime note being dragged into a false break by divergent limbo — suppress the break, merge instead
- This eliminated ~50% of false positives on both test chunks

---

## Current Top 5 Configurations (64s chunk, 116 markers)

All 5 share: `hybrid` method, `dissonance` map, `MBM=0.75`, `D=100ms`, **errors=48**

| # | BA | MA | J | FP | FN | TP | P% | R% | F1% |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 25° | 20° | 0.25 | 16 | 32 | 84 | 84.0 | 72.4 | 77.8 |
| 2 | 35° | 20° | 0.375 | 17 | 31 | 85 | 83.3 | 73.3 | 78.0 |
| 3 | 25° | 20° | 0.375 | 19 | 29 | 87 | 82.1 | 75.0 | 78.4 |
| 4 | 15° | 20° | 0.5 | 23 | 25 | 91 | 79.8 | 78.4 | 79.1 |
| 5 | 15° | 25° | 0.5 | 23 | 25 | 91 | 79.8 | 78.4 | 79.1 |

---

## Known FN Failure Modes (Missed Boundaries)

### Mode 1: Swallowed Spike — spike enters probation but resolves too quickly

**Example: 51500ms** (user marker at 51506ms, tier1)
```
51500 | Swallowed Spike | R88 | diff=76.3° | pmass=1.41 | rmass=10.95
       notes: 1(oct5), 1(oct4), b6(oct2), b6(oct3)
51582 | Stable          | R88 | diff=23.5° | pmass=0.24
       notes: b3(oct4)  ← single regime note resolves the spike
```

The spike at 51500 has strong divergence (76.3° > break_angle 25°) and sufficient mass (1.41 > 0.75). It enters probation. But just 82ms later, a single `b3` note arrives. Since `b3` is an anchor note and is NOT a subset of the spike's PCs ({1, b6}), `is_resolution = True` → the spike gets swallowed.

**The problem**: A single quiet returning note (mass 0.24) resolves an entire 4-note, high-mass spike. The resolution check doesn't consider the mass asymmetry — a whisper shouldn't cancel a shout.

### Mode 2: Subset suppression — notes present in the anchor can't trigger breaks

**Example: 52000ms** (user marker at 52004ms, tier1)
```
52000 | Stable | R88 | diff=54.7° | pmass=0.83 | rmass=9.96
       notes: b7(oct4), 5(oct4), b2(oct4)
       anchor PCs: {b3, b6, 5, b7, 1, 2, 4, 3, b2, 7}
```

The notes {b7, 5, b2} are all present in the anchor profile (accumulated over R88's long life). `is_subset_anchor = True` → `_should_break` returns False immediately. The break is suppressed even though the angle divergence (54.7°) is very high.

**The problem**: Long-lived regimes accumulate many pitch classes in their anchor. Eventually, almost any combination of notes becomes a "subset" of the anchor, and the subset rule prevents breaking. This creates an asymmetry: the longer a regime survives, the harder it becomes to break out of it.

### Mode 3: Mass gate blocks legitimate multi-note chords

**Example: 29875ms** (user marker nearby)
```
29875 | Stable | R67 | diff=50.2° | pmass=0.56 | notes: b7(oct4), 5(oct3)
30000 | SPIKE  | R68 | diff=6.0°  | pmass=0.80 | notes: b3(oct4)  ← fires 125ms late
```

Two notes with clear harmonic divergence (50.2° >> 25°) but combined mass 0.56 < 0.75. The break fires one frame late when accumulated mass crosses the threshold. (The limbo contamination guard fixed the *cascade* that followed, but the timing offset remains.)

---

## Known FP Failure Modes (False Boundaries)

### Mode 1: Narrow anchor cascade (largely fixed by guard)

After a legitimate regime break, the new anchor is built from just 1-2 frames of notes. Subsequent frames fail the Jaccard check against this narrow anchor, triggering cascading false breaks. The limbo contamination guard fixed most instances of this, but it can still occur when the incoming frame's notes are genuinely not in the anchor.

### Mode 2: Accompaniment pattern misidentification

In passages with alternating bass/treble patterns (e.g., left hand plays root on beat 1, right hand plays chord on beat 2), the detector can interpret the alternation as regime changes because each "beat" has different pitch-class content. The debounce helps but doesn't fully solve this for patterns wider than 100ms.

---

## Potential Improvement Directions

### For FN reduction:

1. **Mass-weighted resolution**: When a pending spike is about to be swallowed, compare the mass of the resolving frame against the spike's mass. If `resolve_mass / spike_mass < threshold`, don't swallow — a quiet single note shouldn't cancel a loud multi-note spike.

2. **Anchor diversity cap / accelerated decay**: Limit the number of pitch classes in the anchor profile (e.g., top 6 by mass), or use faster decay for rarely-reinforced intervals. This prevents the "everything is a subset" problem in long regimes.

3. **Minimum regime duration before subset suppression**: Only apply the `is_subset_anchor` suppression after the regime has been stable for N frames. Newly formed regimes shouldn't benefit from subset protection.

### For FP reduction:

4. **Anchor maturity requirement**: After a confirmed regime break, require N frames of stability before allowing another break. This prevents narrow-anchor cascades that the guard doesn't catch (when the incoming frame's notes truly aren't in the new anchor).

5. **Temporal context in break decisions**: Consider not just the current frame but a short window (e.g., 2-3 frames) for break decisions. A single divergent frame surrounded by stable frames is more likely a passing tone than a real regime change.

### For both:

6. **Separate treatment of bass vs. treble registers**: The lowest sounding note often defines harmonic function more than inner voices. Weighting the bass note more heavily (or treating it separately) could improve both precision and recall for detecting harmonic rhythm at the downbeat level.

7. **Duration-aware mass revisited**: The current duration boost is linear and capped at 2.0. Sustained notes (e.g., a held bass note across a bar) could receive additional anchoring weight, making them harder to dislodge from the regime and easier to detect when they change.

---

## Test Data

- **Full piece**: Beethoven Pathétique Sonata, 1st movement exposition (~75s of material)
- **16s chunk**: First 16s, 38 markers (28 T1 + 10 T2), F1=88.9%
- **64s chunk**: First 64s + 3s buffer, 116 markers (96 T1 + 20 T2), F1=77.8%
- **Grid search**: 12,960 parameter combinations per chunk (6 BA × 5 MBM × 6 MA × 6 D × 6 J × 2 methods)
- **Scoring**: TP/FP/FN with ±100ms tolerance, objective = minimize FP+FN

### Files

- `harmonic_regime_detector.py` — the detector (V2.2 + limbo guard)
- `optimize_params.py` — grid search optimizer
- `optimize_params_v1.py` — pre-guard backup
- `optimized_configs.json` — top 5 parameter sets
- `export_etme_data.py` — generates visualizer JSON from MIDI
- `create_chunk.py` — slices MIDI + markers with optional buffer
- `markers/pathetique_*_markers.json` — ground truth
- `optimizer_runs/*.csv` — full grid search results

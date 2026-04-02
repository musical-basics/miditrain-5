# Bug Fix Notes — MidiTrain-5

---

## Bug 1: Canvas truncates long pieces (content clipped at ~32s)

**Date:** 2026-04-01  
**Files:** `visualizer/app/components/ETMEVisualizer.js`

### Symptom
When loading the "Pathetique Full Chunk" (75s), the piano roll canvas stopped rendering at approximately 32 seconds. Notes, model boundaries, and markers beyond 32s were invisible.

### Root Cause
A hardcoded constant at the top of the file:
```js
const MAX_CANVAS_PX = 16000;
```
Canvas width was capped at 16,000px. At the default H-Zoom=100 (`0.005 * 100 = 0.5 px/ms`):
```
16,000px / 0.5 px/ms = 32,000ms = exactly 32s
```
Any content beyond that was silently clipped by the browser's canvas API.

### Failed Fixes
None — root cause was identified immediately.

### Final Solution
1. Raised `MAX_CANVAS_PX` to `32,000` (safe browser canvas limit is ~32,767px).
2. Added an **auto-fit H-Zoom** on data load: when a piece's full width at the current zoom would exceed `MAX_CANVAS_PX`, H-Zoom is automatically reduced to the largest value that renders the full piece without clipping.
3. Added a `console.warn` when clipping is still triggered (e.g., user manually zooms in past the limit).

**Why it works:** The auto-fit only ever _reduces_ zoom (never increases uninvited) and only when necessary. Users can still manually zoom in and scroll horizontally.

---

## Bug 2: symusic `.to('second').clip().to('tick')` corrupts MIDI note timings

**Date:** 2026-04-01  
**Files:** `create_chunk.py`

### Symptom
After slicing `pathetique_full_chunk.mid` to 64 seconds using symusic's second-domain clip and converting back to ticks, the resulting MIDI appeared to play at ~4× the correct speed. Notes that should be at 535ms appeared at ~135ms, and the entire note layout was compressed into the first ~15 seconds of the playback.

Crucially, `symusic`'s own `.end()` verification reported "64.00s" for the clipped file — masking the bug.

### Root Cause
The `symusic` conversion chain:
```python
score.to('second').clip(0, 64.0).to('tick')
```
When converting _back_ from second-domain to tick-domain, symusic recalculates ticks assuming a **default 120 BPM** tempo. The Pathetique Sonata is actually **28 BPM** (mspq = 2,142,857). This caused all tick values to be approximately 4.3× too small, meaning notes appeared much earlier than their true musical position.

The `.end()` check still returned 64s because symusic applied the same incorrect BPM assumption consistently when converting _back_ to seconds for verification.

### Failed Fixes
- **Attempt 1:** Trusted the `.end()` verification output (`64.00s`) and assumed the MIDI was correct. Proceeded to export ETME JSONs, which appeared short in the UI.

### Final Solution
Replaced the round-trip conversion with a **direct tick-level clip** that never changes time domains:

1. Built a `ms_to_ticks(score, ms)` function that walks the score's actual tempo map segment by segment, accumulating elapsed time in both ticks and milliseconds. Computes the exact tick boundary for the target `end_ms`.
2. Filters all note/control/tempo events at the tick level directly — no symusic format round-trip involved.
3. Added a post-save verification using `Score(out_path).to('second').end()` to double-check the clipped duration.

```python
def ms_to_ticks(score, ms):
    # Walk tempo map, compute exact end tick for ms target
    ...
```

**Why it works:** Working entirely in tick space preserves the exact original tempo map without any BPM assumption. The physical tick values and tempo events remain untouched.

---

## Bug 3: `create_chunk.py` sliced to wrong tick boundary (MIDI shows only 15s of 64s)

**Date:** 2026-04-01  
**Files:** `create_chunk.py`

### Symptom
After applying the Bug 2 fix (tick-level clip using real tempo), the 64s chunk MIDI only contained ~15 seconds of notes when loaded in the visualizer. The initial `.to('second')` verification reported the correct 64s, masking the issue.

### Root Cause
The system uses a **system-wide 120 BPM convention**: `tick_to_ms = 500.0 / tpq`. All markers are stored in this coordinate space (i.e., "ticks × 0.521ms per tick"). The Pathetique MIDI's actual tempo is 28 BPM (~2143ms/quarter), but the system ignores this and treats every tick as if the tempo were 120 BPM.

The Bug 2 "fix" computed the end tick using the **real** tempo (28 BPM), resulting in:
```
64,000ms at 28 BPM = 28,672 ticks
```
But the system renders 28,672 ticks as:
```
28,672 × (500 / 960) = 14,933ms ≈ 15s
```
So the chunk contained only 15 seconds of content in the system's coordinate space.

### Failed Fix
Attempted to "fix" `export_etme_data.py` to use the real tempo map — this caused the opposite problem: note durations bloated to 4× their expected width in the UI, misaligning with all user-placed markers.

### Final Solution
Reverted both `create_chunk.py` and `export_etme_data.py` to use the 120 BPM convention consistently:
```python
tick_to_ms_120 = 500.0 / tpq        # system convention, not real tempo
end_tick = int(end_ms / tick_to_ms_120)
```
At 120 BPM: `64,000ms → 122,879 ticks`, yielding 1,406 notes spanning the full 63.9s window.

**Key lesson:** The `tick_to_ms = 500.0 / tpq` constant in `export_etme_data.py` is **intentional and must not be changed**. The entire system's time axis (notes, markers, regime boundaries) is built on the 120 BPM tick interpretation. Any MIDI slicing or export must respect this convention, regardless of the actual MIDI tempo metadata.

---

## Bug 4: `pathetique_64s_chunk_markers.json` had wrong `midiFile` key

**Date:** 2026-04-01  
**Files:** `create_chunk.py`, `markers/pathetique_64s_chunk_markers.json`

### Symptom
The `load-markers` API returned the correct markers when queried with `?midiFile=pathetique_64s_chunk`, but the _saved_ `midiFile` field inside the JSON still read `"pathetique_full_chunk"`. This meant any future save/load cycle initiated from the UI while on the 64s chunk view would use the wrong key for file storage, potentially overwriting the wrong markers file.

### Root Cause
`create_chunk.py`'s `slice_markers()` was doing a shallow copy of the full chunk's JSON wrapper:
```python
out_data = {**wrapper, "markers": kept}
# wrapper["midiFile"] was still "pathetique_full_chunk"
```

### Final Solution
Added an `out_name` parameter to `slice_markers()` that explicitly overwrites the `midiFile` field:
```python
out_data = {"midiFile": out_name, "markers": kept, "savedAt": ...}
```

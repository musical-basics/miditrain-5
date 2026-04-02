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

## Bug 3: ETME export uses hardcoded 120 BPM for tick→ms conversion

**Date:** 2026-04-01  
**Files:** `export_etme_data.py` — `midi_to_particles()`, `extract_keyframes()`

### Symptom
After correctly slicing the 64s MIDI (Bug 2 fixed), loading the 64s chunk in the visualizer still only showed notes up to ~15 seconds. The piano roll canvas appeared as if the piece was only 15s long despite the MIDI being 64s. Markers (stored in true milliseconds) appeared to fall at completely wrong positions relative to the notes.

### Root Cause
Both `midi_to_particles()` and `extract_keyframes()` used a hardcoded tick→ms conversion:
```python
tick_to_ms = 500.0 / tpq  # assumes 120 BPM = 500ms per quarter
```
The Pathetique is at 28 BPM (2143ms per quarter). The correct ratio is `2142.857 / tpq`, approximately **4.3× larger** than the hardcoded value.

Result: a note at tick 28,672 (= 64,000ms at 28 BPM) was reported as:
```
28672 * (500 / 960) = 14,933ms ≈ 15s
```
instead of 64,000ms. The entire 64-second piece appeared compressed into ~15 seconds.

### Why This Wasn't Caught Earlier
- The 16s chunk has the same 28 BPM tempo, so the _relative_ spacing of notes within the chunk was still consistent. The UI appeared correct because markers and notes compressed proportionally together.
- The bug only became visible when using a known-64s piece alongside markers stored in true ms from the full chunk.

### Failed Fixes
- **Attempt 1:** Assumed the issue was the MIDI file corruption from Bug 2 and regenerated the MIDI. The ETME JSON was still wrong after the MIDI was fixed.
- **Attempt 2:** Verified note timings in the raw MIDI via symusic (which correctly reports 64s) — the MIDI was clean. Narrowed the issue to the export script.

### Final Solution
Replaced the hardcoded constant with a proper **tempo-map-aware tick→ms conversion**:

1. `build_tempo_map(score)` — builds a list of `(start_tick, start_ms, ms_per_tick)` segments by walking the score's `tempos` list in order.
2. `ticks_to_ms(tick, segments)` — binary-searches the segment list and interpolates the exact millisecond value for any tick position.

Both `midi_to_particles()` and `extract_keyframes()` were updated to call these helpers instead of the hardcoded ratio.

```python
def build_tempo_map(score):
    segments = []
    for tempo in sorted(score.tempos, key=lambda t: t.time):
        ms_per_tick = tempo.mspq / 1000.0 / score.ticks_per_quarter
        ...
    return segments

def ticks_to_ms(tick, segments):
    # binary search + interpolate
    ...
```

**Why it works:** The tempo map correctly handles mid-piece tempo changes. The Pathetique has 3 tempo events; the conversion now accounts for all of them. Any MIDI with any tempo or tempo-change pattern will now export correctly.

**After fix:** The 64s ETME JSON contains 253 notes with `max_onset = 63,749ms` (63.7s) — covering the full piece as expected.

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

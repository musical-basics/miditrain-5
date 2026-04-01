"""
Creates pathetique_16s_chunk.mid by slicing the first 16000ms
from pathetique_full_chunk.mid, preserving all notes that start
within that window (clipping their duration at 16000ms).

Also copies the full_chunk markers (filtered to <= 16000ms)
into pathetique_16s_chunk_markers.json.
"""
import json
import os
from symusic import Score, Note, Track

FULL_PATH = 'midis/pathetique_full_chunk.mid'
OUTPUT_PATH = 'midis/pathetique_16s_chunk.mid'
CLIP_MS = 16000

score = Score(FULL_PATH)
tpq = score.ticks_per_quarter
# Default symusic uses tpq ticks = 1 quarter note.
# The script uses tick_to_ms = 500.0 / tpq (assumes 120bpm = 500000us/beat)
tick_to_ms = 500.0 / tpq
ms_to_tick = tpq / 500.0

clip_ticks = int(CLIP_MS * ms_to_tick)

print(f"TPQ: {tpq}, tick_to_ms: {tick_to_ms:.4f}, clip_ticks: {clip_ticks}")

# Count notes before
total_before = sum(len(t.notes) for t in score.tracks)
print(f"Notes before clip: {total_before}")

# Clip each track: keep notes that START within the window
for track in score.tracks:
    clipped = []
    for note in track.notes:
        if note.start <= clip_ticks:
            # Clip duration so note doesn't extend past clip boundary
            end = min(note.start + note.duration, clip_ticks)
            new_dur = max(1, end - note.start)
            note.duration = new_dur
            clipped.append(note)
    track.notes = clipped

total_after = sum(len(t.notes) for t in score.tracks)
print(f"Notes after clip: {total_after}")

# Check actual time range
all_ends = []
for t in score.tracks:
    for n in t.notes:
        all_ends.append((n.start + n.duration) * tick_to_ms)
if all_ends:
    print(f"Actual duration after clip: {max(all_ends):.1f}ms")

score.dump_midi(OUTPUT_PATH)
print(f"Saved: {OUTPUT_PATH}")

# ---- Copy markers from full_chunk, filtered to <= CLIP_MS ----
full_markers_path = 'markers/pathetique_full_chunk_markers.json'
chunk_markers_path = 'markers/pathetique_16s_chunk_markers.json'

with open(full_markers_path) as f:
    full_data = json.load(f)

kept = [m for m in full_data['markers'] if m['time_ms'] <= CLIP_MS]
chunk_data = {
    "midiFile": "pathetique_16s_chunk",
    "markers": kept
}
with open(chunk_markers_path, 'w') as f:
    json.dump(chunk_data, f, indent=2)

print(f"Copied {len(kept)}/{len(full_data['markers'])} markers -> {chunk_markers_path}")

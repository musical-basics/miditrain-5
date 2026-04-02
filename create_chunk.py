"""
create_chunk.py  —  Slice a MIDI + marker JSON to a target duration.

Usage:
    python3 create_chunk.py \
        --midi   midis/pathetique_full_chunk.mid \
        --markers markers/pathetique_full_chunk_markers.json \
        --duration_ms 64000 \
        --out_name  pathetique_64s_chunk
"""
import argparse
import json
import shutil
from pathlib import Path
from symusic import Score

REPO_ROOT   = Path(__file__).parent
MIDIS_DIR   = REPO_ROOT / "midis"
MARKERS_DIR = REPO_ROOT / "markers"


def slice_midi(src_path: Path, out_path: Path, end_ms: int) -> None:
    """Trim MIDI to [0, end_ms] using the system-wide 120 BPM tick convention.
    
    IMPORTANT: This system interprets all tick values at 120 BPM (500ms/quarter),
    regardless of the MIDI file's actual tempo metadata. All markers and note
    positions are stored in this 120 BPM coordinate space.
    tick_to_ms = 500.0 / tpq
    """
    score = Score(str(src_path))
    tpq = score.ticks_per_quarter
    tick_to_ms_120 = 500.0 / tpq           # system convention, not real tempo
    end_tick = int(end_ms / tick_to_ms_120)
    print(f"  end_ms={end_ms} → end_tick={end_tick}  (tpq={tpq}, 120 BPM convention)")

    for track in score.tracks:
        keep = []
        for note in track.notes:
            if note.start >= end_tick:
                continue
            if note.start + note.duration > end_tick:
                note.duration = end_tick - note.start
            keep.append(note)
        track.notes = keep

        for attr in ("controls", "pitch_bends", "pedals"):
            events = getattr(track, attr, [])
            setattr(track, attr, [e for e in events if e.time < end_tick])

    score.tempos = [t for t in score.tempos if t.time <= end_tick]
    score.time_signatures = [ts for ts in score.time_signatures if ts.time <= end_tick]

    score.dump_midi(str(out_path))

    # Verify via 120 BPM convention
    verify = Score(str(out_path))
    tpq_v = verify.ticks_per_quarter
    all_notes = [n for t in verify.tracks for n in t.notes]
    max_tick_v = max((n.start + n.duration for n in all_notes), default=0)
    max_ms_120 = max_tick_v * (500.0 / tpq_v)
    print(f"  MIDI saved → {out_path}  ({len(all_notes)} notes, verified end: {max_ms_120:.0f}ms at 120 BPM)")




def slice_markers(src_path: Path, out_path: Path, end_ms: int, out_name: str) -> None:
    """Keep only markers whose time_ms <= end_ms. Updates the midiFile key to out_name."""
    with open(src_path) as f:
        raw = json.load(f)

    markers = raw.get("markers", raw) if isinstance(raw, dict) else raw
    kept = [m for m in markers if m.get("time_ms", 0) <= end_ms]
    print(f"  Markers: {len(markers)} total → {len(kept)} within {end_ms}ms")

    out_data = {"midiFile": out_name, "markers": kept, "savedAt": raw.get("savedAt", "") if isinstance(raw, dict) else ""}
    with open(out_path, "w") as f:
        json.dump(out_data, f, indent=2)
    print(f"  Markers saved → {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Slice MIDI + markers to a target duration")
    parser.add_argument("--midi",        default="midis/pathetique_full_chunk.mid")
    parser.add_argument("--markers",     default="markers/pathetique_full_chunk_markers.json")
    parser.add_argument("--duration_ms", type=int, default=64000,
                        help="Target end time in ms (default: 64000 = 1m04s)")
    parser.add_argument("--out_name",    default="pathetique_64s_chunk",
                        help="Base name for output files (no extension)")
    args = parser.parse_args()

    src_midi    = REPO_ROOT / args.midi
    src_markers = REPO_ROOT / args.markers
    out_midi    = MIDIS_DIR   / f"{args.out_name}.mid"
    out_markers = MARKERS_DIR / f"{args.out_name}_markers.json"

    assert src_midi.exists(),    f"MIDI not found: {src_midi}"
    assert src_markers.exists(), f"Markers not found: {src_markers}"

    print(f"\nSlicing '{src_midi.name}' to {args.duration_ms}ms ({args.duration_ms/1000:.1f}s)")
    print(f"Output name: {args.out_name}\n")

    slice_midi(src_midi, out_midi, args.duration_ms)
    slice_markers(src_markers, out_markers, args.duration_ms, args.out_name)

    print(f"\nDone! Now run export_etme_data.py on:")
    print(f"  {out_midi}")


if __name__ == "__main__":
    main()

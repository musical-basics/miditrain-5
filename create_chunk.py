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
    """Trim MIDI to [0, end_ms] using symusic's tempo-aware second conversion."""
    score = Score(str(src_path))
    end_sec = end_ms / 1000.0

    # Convert to second-based time, clip, convert back to tick for saving
    clipped = score.to('second').clip(0, end_sec).to('tick')

    clipped.dump_midi(str(out_path))
    print(f"  MIDI saved → {out_path}  (ends at {clipped.to('second').end():.2f}s)")


def slice_markers(src_path: Path, out_path: Path, end_ms: int) -> None:
    """Keep only markers whose time_ms <= end_ms, preserve structure."""
    with open(src_path) as f:
        raw = json.load(f)

    if isinstance(raw, list):
        markers = raw
        wrapper = None
    else:
        markers = raw.get("markers", [])
        wrapper = raw

    kept = [m for m in markers if m.get("time_ms", 0) <= end_ms]
    print(f"  Markers: {len(markers)} total → {len(kept)} within {end_ms}ms")

    if wrapper is None:
        out_data = kept
    else:
        out_data = {**wrapper, "markers": kept}

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
    slice_markers(src_markers, out_markers, args.duration_ms)

    print(f"\nDone! Now run export_etme_data.py on:")
    print(f"  {out_midi}")


if __name__ == "__main__":
    main()

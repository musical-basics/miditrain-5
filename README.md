# miditrain-5

Testing environment for **Phase 1 (Harmonic Regime Detection)** via a manual marking system.

## Purpose

Each model variant gets some harmonic regime detections right and some wrong. Instead of ad-hoc hypothesis testing, this repo provides a ground-truth annotation system for systematic accuracy measurement.

## How to Run

```bash
cd visualizer
pnpm install
pnpm dev
```

Open `http://localhost:3000` in your browser.

## Default Data

The app auto-loads the Pathetique full chunk with `dissonance/hybrid/0.5` parameters. Pre-computed data is included -- you can use the visualizer immediately without running the Python engine.

## Marker System

### Tier 1 Markers (Red) -- Downbeat + Harmonic Change
The most common type. Place these where a new downbeat coincides with a harmonic change. These have the highest signal and should be targeted for 100% model accuracy first.

### Tier 2 Markers (Amber) -- Harmonic Spike (No Downbeat)
Secondary markers for harmonic changes that occur mid-measure. These are edge cases to tackle after Tier 1 is perfected.

### How to Use
- **Place marker**: Click in the ruler area (bottom of piano roll) to place a marker at that time
- **Switch tier**: Use the T1/T2 buttons in the marker toolbar
- **Delete marker**: Right-click near a marker in the ruler area
- **Save markers**: Click "Save" to persist to disk
- **Export**: Click "Export JSON" to download markers as a file
- **Compare**: Toggle "Compare vs Model" to see accuracy metrics

### Comparison Mode
When enabled, the model's detected regime boundaries appear as cyan dashed lines. The comparison panel shows:
- **Precision**: What % of your markers match a model boundary
- **Recall**: What % of model boundaries have a matching user marker
- **F1 Score**: Harmonic mean of precision and recall
- **Tolerance slider**: Adjust matching tolerance (default 100ms)
- Detailed breakdown of matches, false positives, and false negatives

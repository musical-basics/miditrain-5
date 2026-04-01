'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';

// ===== CONSTANTS =====
const PITCH_MIN = 21;
const PITCH_MAX = 108;
const MAX_CANVAS_PX = 16000;
const RULER_HEIGHT = 40; // Taller ruler for marker click zone
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK_KEYS = [1,3,6,8,10];
const NOTE_NAMES_FLAT = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

function midiNoteName(pitch) {
  const name = NOTE_NAMES_FLAT[pitch % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

function formatTime(ms) {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}:${sec.toFixed(1).padStart(4, '0')}` : `${sec.toFixed(1)}s`;
}

// ===== COLOR HELPERS =====
function hsl(h, s, l, a = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// ===== MAIN COMPONENT =====
export default function ETMEVisualizer() {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const keyboardRef = useRef(null);

  const [data, setData] = useState(null);
  const [currentView, setCurrentView] = useState('phase1');
  const [midiFile, setMidiFile] = useState('pathetique_full_chunk');
  const [angleMap, setAngleMap] = useState('dissonance');
  const [breakModel, setBreakModel] = useState('hybrid');
  const [jaccardThreshold, setJaccardThreshold] = useState(0.5);
  const [minBreakMass, setMinBreakMass] = useState(0.75);
  const [hZoom, setHZoom] = useState(10);
  const [vZoom, setVZoom] = useState(10);
  const [tooltip, setTooltip] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [isEngineDone, setIsEngineDone] = useState(false);
  const [engineLogs, setEngineLogs] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [isUploading, setIsUploading] = useState(false);
  const [midiOptions, setMidiOptions] = useState([
    { label: 'Pathetique Full Chunk', value: 'pathetique_full_chunk' }
  ]);

  // Marker state
  const [markers, setMarkers] = useState([]);
  const [markerHistory, setMarkerHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedMarkerIds, setSelectedMarkerIds] = useState(new Set());
  const [markerMode, setMarkerMode] = useState('tier1');
  const [showComparison, setShowComparison] = useState(false);
  const [compTolerance, setCompTolerance] = useState(100);

  // Drag-select state
  const [dragSelect, setDragSelect] = useState(null); // { startX, currentX, y, active }

  const fileInputRef = useRef(null);
  const effectiveScaleRef = useRef(0.05);
  const logsEndRef = useRef(null);
  const markerIdCounter = useRef(0);
  const handlersRef = useRef({});
  const dragSelectRef = useRef(null); // mirrors dragSelect for mouse handlers

  const getBaseKey = useCallback(() => {
    if (midiFile && midiFile.startsWith('midis/')) return midiFile.split('/').pop().replace('.mid', '');
    return midiFile;
  }, [midiFile]);

  // Marker history management
  const updateMarkersWithHistory = useCallback((newMarkers) => {
    const newHistory = markerHistory.slice(0, historyIndex + 1);
    newHistory.push(newMarkers);
    setMarkerHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setMarkers(newMarkers);
    setSelectedMarkerIds(new Set());
  }, [markerHistory, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setMarkers(markerHistory[newIndex]);
      setSelectedMarkerIds(new Set());
    }
  }, [historyIndex, markerHistory]);

  const redo = useCallback(() => {
    if (historyIndex < markerHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setMarkers(markerHistory[newIndex]);
      setSelectedMarkerIds(new Set());
    }
  }, [historyIndex, markerHistory]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < markerHistory.length - 1;

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView();
  }, [engineLogs]);

  const runEngine = useCallback(async () => {
    setIsEngineRunning(true);
    setIsEngineDone(false);
    setEngineLogs([`Starting Phase 1 Engine for ${midiFile} (${angleMap}, ${breakModel}, ${jaccardThreshold}, mass=${minBreakMass})...`]);

    const runScript = async (script, args) => {
      const resp = await fetch('/api/run-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, args })
      });
      if (!resp.body) return false;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = '';
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const dataMatch = part.match(/data: (.*)/);
            const eventMatch = part.match(/event: (.*)/);
            if (dataMatch) {
              const msg = JSON.parse(dataMatch[1]);
              const eventPattern = eventMatch ? eventMatch[1].trim() : '';
              if (eventPattern === 'done') return msg.code === 0;
              if (msg.text) setEngineLogs(prev => [...prev, msg.text.trim()]);
              else if (msg.type === 'error' || eventPattern === 'error')
                setEngineLogs(prev => [...prev, 'ERROR: ' + (msg.text || JSON.stringify(msg))]);
            }
          }
        }
      }
      return false;
    };

    setEngineLogs(prev => [...prev, '\n[1/1] Running Phase 1 (export_etme_data.py)...']);
    const s1 = await runScript('export_etme_data.py', [
      '--midi_key', midiFile,
      '--angle_map', angleMap,
      '--break_method', breakModel,
      '--jaccard', jaccardThreshold.toString(),
      '--min_break_mass', minBreakMass.toString()
    ]);
    if (!s1) {
      setEngineLogs(prev => [...prev, '\nPipeline failed. Check logs above.']);
      setIsEngineDone(true);
      return;
    }

    setEngineLogs(prev => [...prev, '\nPipeline Complete! Dismiss to view results.']);
    setRefreshTrigger(prev => prev + 1);
    setIsEngineDone(true);
  }, [midiFile, angleMap, breakModel, jaccardThreshold, minBreakMass]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload-midi', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.filepath) {
        setMidiFile(data.filepath);
        setRefreshTrigger(prev => prev + 1);
      }
    } catch(err) { console.error(err); }
    finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = null;
    }
  };

  // Load midi options
  useEffect(() => {
    fetch('/api/list-midis')
      .then(r => r.json())
      .then(d => { if (d.midis) setMidiOptions(d.midis); })
      .catch(console.error);
  }, [refreshTrigger]);

  // Load data when any selector changes
  useEffect(() => {
    const baseKey = getBaseKey();
    const etmeFile = (['hybrid', 'hybrid_split', 'jaccard_only', 'jaccard_only_split', 'hybrid_v2', 'hybrid_v2_split'].includes(breakModel))
      ? `etme_${baseKey}_${angleMap}_${breakModel}_${jaccardThreshold}.json`
      : `etme_${baseKey}_${angleMap}_${breakModel}.json`;

    fetch(`/${etmeFile}?t=${Date.now()}_${refreshTrigger}`)
      .then(r => { if (!r.ok) return null; return r.json(); })
      .then(setData)
      .catch(() => setData(null));
  }, [midiFile, angleMap, breakModel, jaccardThreshold, refreshTrigger, getBaseKey]);

  // Load saved markers
  useEffect(() => {
    const baseKey = getBaseKey();
    fetch(`/api/load-markers?midiFile=${baseKey}`)
      .then(r => r.json())
      .then(d => { if (d.markers && d.markers.length) setMarkers(d.markers); })
      .catch(() => {});
  }, [getBaseKey]);

  // Sync scroll between keyboard and canvas
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const keyboard = keyboardRef.current;
    if (!wrapper || !keyboard) return;
    const onScroll = () => { keyboard.scrollTop = wrapper.scrollTop; };
    wrapper.addEventListener('scroll', onScroll);
    return () => wrapper.removeEventListener('scroll', onScroll);
  }, []);

  // Rendering
  const noteHeight = vZoom;
  const msPxInput = 0.005 * hZoom;

  const render = useCallback(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const notes = data.notes;
    const regimes = data.regimes;
    const pitchRange = PITCH_MAX - PITCH_MIN + 1;

    const maxTime = Math.max(...notes.map(n => n.onset + n.duration)) + 500;
    const effectiveScale = msPxInput;
    effectiveScaleRef.current = effectiveScale;
    const canvasW = Math.min(Math.max(maxTime * effectiveScale, 1200), MAX_CANVAS_PX);
    const rollH = pitchRange * noteHeight;
    const canvasH = rollH + RULER_HEIGHT;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Grid rows
    for (let p = PITCH_MIN; p <= PITCH_MAX; p++) {
      const y = (PITCH_MAX - p) * noteHeight;
      const pc = p % 12;
      const isBlack = BLACK_KEYS.includes(pc);
      ctx.fillStyle = isBlack ? 'transparent' : 'rgba(255,255,255,0.015)';
      ctx.fillRect(0, y, canvasW, noteHeight);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasW, y); ctx.stroke();
    }

    // Beat grid + timestamp ruler
    ctx.fillStyle = '#111118';
    ctx.fillRect(0, rollH, canvasW, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, rollH); ctx.lineTo(canvasW, rollH); ctx.stroke();

    for (let t = 0; t < maxTime; t += 100) {
      const x = t * effectiveScale;
      if (t % 1000 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
      } else if (t % 500 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 0.75;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
      }
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke();

      const isMajor = t % 1000 === 0;
      const isMid = t % 500 === 0;
      if (isMajor || isMid) {
        const tickH = isMajor ? 8 : 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, rollH); ctx.lineTo(x, rollH + tickH); ctx.stroke();
      }
      if (isMajor) {
        ctx.font = '9px Inter';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.textAlign = 'center';
        ctx.fillText(formatTime(t), x, rollH + 18);
        ctx.textAlign = 'start';
      }
    }

    // Marker click zone label
    ctx.font = '8px Inter';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillText('Click here to place markers', 8, rollH + RULER_HEIGHT - 4);

    // Phase 1: Regime blocks
    if (currentView === 'phase1') {
      for (const r of regimes) {
        const x = r.start_time * effectiveScale;
        const w = Math.max((r.end_time - r.start_time) * effectiveScale, 1);
        const avgHue = r.hue || 0;
        const avgSat = r.saturation || 0;

        if (r.state === 'Silence' || r.state === 'Undefined / Gray Void') {
          ctx.fillStyle = 'rgba(30,30,40,0.15)';
        } else {
          ctx.fillStyle = `hsla(${avgHue}, ${Math.min(avgSat, 80)}%, 45%, 0.06)`;
        }
        ctx.fillRect(x, 0, w, rollH);

        ctx.strokeStyle = `hsla(${avgHue}, ${Math.min(avgSat, 70)}%, 55%, 0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke();

        let stateColor, stateLabel;
        if (r.state === 'TRANSITION SPIKE!') {
          stateColor = 'hsla(60, 95%, 60%, 0.8)';
          stateLabel = 'Spike';
        } else if (r.state === 'Regime Locked') {
          stateColor = 'hsla(120, 80%, 50%, 0.8)';
          stateLabel = 'Locked';
        } else if (r.state === 'Silence' || r.state === 'Undefined / Gray Void') {
          stateColor = 'rgba(80, 80, 100, 0.4)';
          stateLabel = r.state === 'Silence' ? 'Silence' : 'Void';
        } else {
          stateColor = `hsla(${avgHue}, 70%, 55%, 0.6)`;
          stateLabel = 'Stable';
        }
        ctx.fillStyle = stateColor;
        ctx.fillRect(x, 0, w, 3);

        if (w > 30) {
          ctx.font = '9px Inter';
          ctx.fillStyle = stateColor;
          ctx.fillText(stateLabel, x + 4, 14);
        }
      }
    }

    // Draw notes
    for (const n of notes) {
      const x = n.onset * effectiveScale;
      const w = Math.max(n.duration * effectiveScale, 2);
      const y = (PITCH_MAX - n.pitch) * noteHeight;

      let fillColor, strokeColor;

      if (currentView === 'raw') {
        const velAlpha = 0.4 + (n.velocity / 127) * 0.6;
        fillColor = hsl(220, 70, 60, velAlpha);
        strokeColor = hsl(220, 80, 70, 0.7);
      } else if (currentView === 'phase1') {
        const h = n.hue || 0;
        const s = Math.min(n.sat || 30, 100);
        const rawL = n.lightness || 50;
        const l = 20 + (rawL / 100) * 60;

        if (n.regime_state === 'TRANSITION SPIKE!') {
          fillColor = `hsla(${h}, ${Math.max(s, 70)}%, ${l}%, 0.95)`;
          strokeColor = `hsla(${h}, 95%, ${Math.min(l + 15, 85)}%, 1)`;
          ctx.shadowColor = `hsla(${h}, 90%, 50%, 0.4)`;
          ctx.shadowBlur = 4;
        } else if (n.regime_state === 'Regime Locked') {
          fillColor = `hsla(${h}, ${s}%, ${l}%, 0.9)`;
          strokeColor = `hsla(${h}, ${s}%, ${Math.min(l + 10, 80)}%, 0.95)`;
        } else if (n.regime_state === 'Silence' || n.regime_state === 'Undefined / Gray Void') {
          fillColor = 'rgba(80, 80, 100, 0.4)';
          strokeColor = 'rgba(100, 100, 130, 0.6)';
        } else {
          fillColor = `hsla(${h}, ${s}%, ${l}%, 0.8)`;
          strokeColor = `hsla(${h}, ${s}%, ${Math.min(l + 10, 80)}%, 0.9)`;
        }
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, w, noteHeight - 2, 2);
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Debug labels on Phase 1
      if (currentView === 'phase1' && n.debug && n.debug.particles) {
        ctx.font = '9px monospace';
        const noteName = midiNoteName(n.pitch);
        const parts = n.debug.particles;
        const label = parts.map(p => {
          const iv = p.int || p.interval;
          return `${iv}:${(p.m ?? p.mass)?.toFixed(2)}`;
        }).join(' ');
        const diffLabel = `d${n.debug.diff} pm=${n.debug.pmass?.toFixed(2)} rm=${n.debug.rmass?.toFixed(2)} th=${n.debug.threshold?.toFixed(2)}`;
        ctx.fillStyle = 'rgba(100,220,255,0.9)';
        ctx.fillText(noteName, x + 2, y - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(label, x + 2 + ctx.measureText(noteName + ' ').width, y - 2);
        ctx.fillStyle = 'rgba(255,200,100,0.6)';
        ctx.fillText(diffLabel, x + 2, y - 10);
      }
    }

    // ===== Draw comparison: model regime boundaries as cyan lines =====
    if (showComparison && data.regimes) {
      const modelBoundaries = getModelBoundaries(data.regimes);
      for (const mb of modelBoundaries) {
        const x = mb * effectiveScale;
        ctx.strokeStyle = 'rgba(0, 220, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke();
        ctx.setLineDash([]);

        // Small diamond at top
        ctx.fillStyle = 'rgba(0, 220, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(x, 4); ctx.lineTo(x + 4, 8); ctx.lineTo(x, 12); ctx.lineTo(x - 4, 8);
        ctx.closePath(); ctx.fill();
      }
    }

    // ===== Draw markers =====
    for (const marker of markers) {
      const x = marker.time_ms * effectiveScale;
      const isTier1 = marker.tier === 'tier1';
      const isSelected = selectedMarkerIds.has(marker.id);

      if (isTier1) {
        // Tier 1: solid red line, full height
        const baseColor = isSelected ? '#ffff00' : '#ff4444';
        ctx.strokeStyle = isSelected ? 'rgba(255, 255, 0, 1.0)' : 'rgba(255, 68, 68, 0.85)';
        ctx.lineWidth = isSelected ? 3.5 : 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke();

        // Triangle handle in ruler (larger if selected)
        ctx.fillStyle = isSelected ? '#ffff00' : '#ff4444';
        const handleSize = isSelected ? 8 : 6;
        ctx.beginPath();
        ctx.moveTo(x, rollH + 2);
        ctx.lineTo(x - handleSize, rollH + 14);
        ctx.lineTo(x + handleSize, rollH + 14);
        ctx.closePath(); ctx.fill();

        // Selection glow
        if (isSelected) {
          ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke();
        }

        // T1 label
        ctx.font = isSelected ? 'bold 10px Inter' : 'bold 8px Inter';
        ctx.fillStyle = baseColor;
        ctx.textAlign = 'center';
        ctx.fillText(isSelected ? 'T1✓' : 'T1', x, rollH + 24);
        ctx.textAlign = 'start';
      } else {
        // Tier 2: dashed amber line, 80% height
        ctx.strokeStyle = isSelected ? 'rgba(255, 255, 0, 0.85)' : 'rgba(255, 136, 68, 0.65)';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, rollH * 0.2); ctx.lineTo(x, rollH); ctx.stroke();
        ctx.setLineDash([]);

        // Circle handle in ruler (larger if selected)
        ctx.fillStyle = isSelected ? '#ffff00' : '#ff8844';
        const radius = isSelected ? 7 : 5;
        ctx.beginPath();
        ctx.arc(x, rollH + 8, radius, 0, Math.PI * 2);
        ctx.fill();

        // Selection glow
        if (isSelected) {
          ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, rollH + 8, radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // T2 label
        ctx.font = isSelected ? 'bold 10px Inter' : 'bold 8px Inter';
        ctx.fillStyle = isSelected ? '#ffff00' : '#ff8844';
        ctx.textAlign = 'center';
        ctx.fillText(isSelected ? 'T2✓' : 'T2', x, rollH + 24);
        ctx.textAlign = 'start';
      }
    }

    // ===== Draw drag-select rectangle =====
    if (dragSelect?.active) {
      const dsMinX = Math.min(dragSelect.startX, dragSelect.currentX);
      const dsMaxX = Math.max(dragSelect.startX, dragSelect.currentX);
      const dsW = dsMaxX - dsMinX;
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(dsMinX, 0, dsW, rollH);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(100, 180, 255, 0.08)';
      ctx.fillRect(dsMinX, 0, dsW, rollH);
    }

  }, [data, currentView, msPxInput, noteHeight, markers, selectedMarkerIds, showComparison, dragSelect]);

  useEffect(() => { render(); }, [render]);

  // Update handlers ref for keyboard shortcuts
  useEffect(() => {
    handlersRef.current = { undo, redo, selectedMarkerIds, markerHistory, historyIndex };
  }, [undo, redo, selectedMarkerIds, markerHistory, historyIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const handlers = handlersRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handlers.undo?.();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handlers.redo?.();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (handlers.selectedMarkerIds?.size > 0 && !e.target.matches('input, textarea, select')) {
          e.preventDefault();
          const ids = handlers.selectedMarkerIds;
          setMarkers(prev => {
            const newMarkers = prev.filter(m => !ids.has(m.id));
            const newHistory = handlers.markerHistory.slice(0, handlers.historyIndex + 1);
            newHistory.push(newMarkers);
            setMarkerHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
            setSelectedMarkerIds(new Set());
            return newMarkers;
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Drag-select mouse handlers
  const handleCanvasMouseDown = useCallback((e) => {
    if (!data || e.button !== 0) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pitchRange = PITCH_MAX - PITCH_MIN + 1;
    const rollH = pitchRange * noteHeight;

    // Only start drag in the piano roll area (not ruler)
    if (my >= rollH) return;

    // Check if clicking near an existing marker
    let nearestMarker = null;
    let nearestDist = Infinity;
    for (const m of markers) {
      const markerX = m.time_ms * effectiveScaleRef.current;
      const dist = Math.abs(markerX - mx);
      if (dist < nearestDist) { nearestMarker = m; nearestDist = dist; }
    }

    if (nearestMarker && nearestDist < 12) {
      // Shift-click: toggle marker in/out of selection
      if (e.shiftKey) {
        setSelectedMarkerIds(prev => {
          const next = new Set(prev);
          if (next.has(nearestMarker.id)) next.delete(nearestMarker.id);
          else next.add(nearestMarker.id);
          return next;
        });
      } else {
        // Normal click on marker: select only this one
        setSelectedMarkerIds(new Set([nearestMarker.id]));
      }
      return;
    }

    // Start drag selection
    const ds = { startX: mx, currentX: mx, y: my, active: true };
    dragSelectRef.current = ds;
    setDragSelect({ ...ds });
    if (!e.shiftKey) setSelectedMarkerIds(new Set());
  }, [data, noteHeight, markers]);

  const handleCanvasMouseMove2 = useCallback((e) => {
    if (!dragSelectRef.current?.active) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    dragSelectRef.current = { ...dragSelectRef.current, currentX: mx };
    setDragSelect(prev => prev ? { ...prev, currentX: mx } : null);
  }, []);

  const handleCanvasMouseUp = useCallback((e) => {
    const ds = dragSelectRef.current;
    if (!ds?.active) return;
    dragSelectRef.current = null;

    const minX = Math.min(ds.startX, ds.currentX);
    const maxX = Math.max(ds.startX, ds.currentX);
    const dragWidth = maxX - minX;

    if (dragWidth < 5) {
      // Treat as a click — place new marker in ruler area? No, this is in piano roll.
      // Just clear drag rect.
      setDragSelect(null);
      return;
    }

    // Select all markers whose x falls within [minX, maxX]
    const minTime = minX / effectiveScaleRef.current;
    const maxTime = maxX / effectiveScaleRef.current;
    const inRange = markers.filter(m => m.time_ms >= minTime && m.time_ms <= maxTime).map(m => m.id);

    if (e.shiftKey) {
      setSelectedMarkerIds(prev => {
        const next = new Set(prev);
        inRange.forEach(id => next.add(id));
        return next;
      });
    } else {
      setSelectedMarkerIds(new Set(inRange));
    }
    setDragSelect(null);
  }, [markers]);

  // Click handler for placing markers (ruler area only)
  const handleCanvasClick = useCallback((e) => {
    if (!data) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pitchRange = PITCH_MAX - PITCH_MIN + 1;
    const rollH = pitchRange * noteHeight;

    // Only place markers in the ruler area
    if (my < rollH) return;

    const timeMs = mx / effectiveScaleRef.current;

    // Check if clicking near an existing marker handle in ruler
    let nearestMarker = null;
    let nearestDist = Infinity;
    for (const m of markers) {
      const markerX = m.time_ms * effectiveScaleRef.current;
      const dist = Math.abs(markerX - mx);
      if (dist < nearestDist) { nearestMarker = m; nearestDist = dist; }
    }

    if (nearestMarker && nearestDist < 15) {
      if (e.shiftKey) {
        setSelectedMarkerIds(prev => {
          const next = new Set(prev);
          if (next.has(nearestMarker.id)) next.delete(nearestMarker.id);
          else next.add(nearestMarker.id);
          return next;
        });
      } else {
        setSelectedMarkerIds(new Set([nearestMarker.id]));
      }
      return;
    }

    // Place new marker
    markerIdCounter.current += 1;
    const newMarker = {
      id: `m_${markerIdCounter.current}_${Date.now()}`,
      time_ms: Math.round(timeMs),
      tier: markerMode
    };
    updateMarkersWithHistory([...markers, newMarker].sort((a, b) => a.time_ms - b.time_ms));
  }, [data, noteHeight, markerMode, markers, updateMarkersWithHistory]);


  // Right-click to delete nearest marker
  const handleCanvasContextMenu = useCallback((e) => {
    e.preventDefault();
    if (!data || markers.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const timeMs = mx / effectiveScaleRef.current;

    // Find nearest marker within 200ms
    let nearest = null;
    let nearestDist = Infinity;
    for (const m of markers) {
      const dist = Math.abs(m.time_ms - timeMs);
      if (dist < nearestDist) { nearest = m; nearestDist = dist; }
    }
    const pxDist = nearestDist * effectiveScaleRef.current;
    if (nearest && pxDist < 20) {
      updateMarkersWithHistory(markers.filter(m => m.id !== nearest.id));
    }
  }, [data, markers, updateMarkersWithHistory]);

  // Tooltip handler
  const handleMouseMove = useCallback((e) => {
    if (!data) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const timeMs = mx / effectiveScaleRef.current;
    const pitch = PITCH_MAX - Math.floor(my / noteHeight);

    const hit = data.notes.find(n =>
      pitch === n.pitch && timeMs >= n.onset && timeMs <= n.onset + n.duration
    );

    if (hit) {
      const noteName = NOTE_NAMES[hit.pitch % 12] + (Math.floor(hit.pitch / 12) - 1);
      setTooltip({
        x: e.clientX + 14, y: e.clientY + 14,
        noteName, pitch: hit.pitch, velocity: hit.velocity,
        onset: hit.onset, duration: hit.duration,
        hue: hit.hue, sat: hit.sat, lightness: hit.lightness, tonal_distance: hit.tonal_distance
      });
    } else {
      setTooltip(null);
    }
  }, [data, noteHeight]);

  // Save markers
  const saveMarkers = async () => {
    const baseKey = getBaseKey();
    await fetch('/api/save-markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ midiFile: baseKey, markers })
    });
  };

  // Export markers as JSON download
  const exportMarkers = () => {
    const blob = new Blob([JSON.stringify(markers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `markers_${getBaseKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyboard
  const keyboardKeys = [];
  for (let p = PITCH_MAX; p >= PITCH_MIN; p--) {
    const pc = p % 12;
    const octave = Math.floor(p / 12) - 1;
    const isBlack = BLACK_KEYS.includes(pc);
    const isC = pc === 0;
    keyboardKeys.push(
      <div key={p} className={`key ${isBlack ? 'black' : 'white'} ${isC ? 'c-note' : ''}`} style={{ height: noteHeight }}>
        {isC ? `C${octave}` : ''}
      </div>
    );
  }

  // Legend
  const legendContent = () => {
    if (currentView === 'raw') return (
      <>
        <h3>Piano Roll</h3>
        <div className="legend-item"><div className="legend-swatch" style={{ background: hsl(220,70,60,0.5) }} />Quiet Note</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: hsl(220,70,60,1) }} />Loud Note</div>
      </>
    );
    return (
      <>
        <h3>Phase 1 -- Harmonic Regimes</h3>
        <div className="legend-item"><div className="legend-swatch" style={{ background: 'hsla(0,70%,45%,0.6)' }} />Stable (by hue)</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: 'hsla(120,80%,50%,0.75)' }} />Locked</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: 'hsla(60,95%,60%,0.9)', boxShadow: '0 0 6px hsla(60,90%,50%,0.5)' }} />Spike</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: 'rgba(80,80,100,0.4)' }} />Silence / Void</div>
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
          <div className="legend-item"><div className="legend-swatch" style={{ background: '#ff4444' }} />T1 Marker (Downbeat+Harmonic)</div>
          <div className="legend-item"><div className="legend-swatch" style={{ background: '#ff8844' }} />T2 Marker (Harmonic Spike)</div>
          {showComparison && (
            <div className="legend-item"><div className="legend-swatch" style={{ background: 'rgba(0,220,255,0.7)' }} />Model Boundary</div>
          )}
        </div>
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 4 }}>
            Min Break Mass: <strong style={{ color: '#fff' }}>{minBreakMass}</strong>
          </label>
          <input
            type="range" min="0.1" max="1.5" step="0.05"
            value={minBreakMass}
            onChange={e => setMinBreakMass(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-green)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
            <span>0.1 (sensitive)</span>
            <span>1.5 (conservative)</span>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            Re-run engine to apply
          </div>
        </div>
      </>
    );
  };

  const views = [
    { id: 'raw', label: 'Piano Roll', color: 'var(--accent-blue)' },
    { id: 'phase1', label: 'Phase 1 -- Harmonic Regimes', color: 'var(--accent-green)' },
  ];

  // Comparison logic
  const comparisonStats = computeComparison(markers, data?.regimes, compTolerance);

  return (
    <>
      {/* HEADER */}
      <div className="header">
        <h1><span>ETME</span> Phase 1 Tester</h1>
        <div className="stats">
          <div>Notes<span className="stat-value">{data?.stats?.total_notes ?? '--'}</span></div>
          <div>Regimes<span className="stat-value">{data?.stats?.total_regimes ?? '--'}</span></div>
          <div>Markers<span className="stat-value">{markers.length}</span></div>
        </div>
      </div>

      {/* TABS + CONTROLS */}
      <div className="view-tabs">
        {views.map(v => (
          <button
            key={v.id}
            className={`view-tab ${currentView === v.id ? 'active' : ''}`}
            onClick={() => setCurrentView(v.id)}
          >
            <span className="dot" style={{ background: v.color }} />
            {v.label}
          </button>
        ))}

        <button
          onClick={runEngine}
          style={{
            marginLeft: '16px', padding: '4px 12px', fontSize: '11px',
            background: '#2e7d32', color: '#fff', border: '1px solid #1b5e20',
            borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          Run Engine
        </button>
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          style={{
            marginLeft: '8px', padding: '4px 8px',
            background: '#1a1a2e', color: '#fff', border: '1px solid #333',
            borderRadius: '4px', cursor: 'pointer'
          }}
        >
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <div style={{ position: 'relative', marginLeft: '8px' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '4px 12px', fontSize: '11px',
              background: '#0277bd', color: '#fff', border: '1px solid #01579b',
              borderRadius: '4px', cursor: isUploading ? 'not-allowed' : 'pointer', fontWeight: 'bold'
            }}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Import MIDI'}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".mid,.midi" style={{ display: 'none' }} />
        </div>
        <select value={midiFile} onChange={e => setMidiFile(e.target.value)}
          style={{ marginLeft: '8px', padding: '4px 8px', fontSize: '11px', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
        >
          {midiOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={angleMap} onChange={e => setAngleMap(e.target.value)}
          style={{ marginLeft: '4px', padding: '4px 8px', fontSize: '11px', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
        >
          <option value="dissonance">Dissonance Map</option>
          <option value="fifths">Circle of 5ths</option>
        </select>
        <select value={breakModel} onChange={e => setBreakModel(e.target.value)}
          style={{ marginLeft: '4px', padding: '4px 8px', fontSize: '11px', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
        >
          <option value="centroid">Centroid (Angle)</option>
          <option value="histogram">Histogram (Cosine)</option>
          <option value="hybrid">Hybrid (Angle+Jaccard)</option>
          <option value="hybrid_split">Hybrid-Split</option>
          <option value="hybrid_v2">Hybrid-V2</option>
          <option value="hybrid_v2_split">Hybrid-V2 Split</option>
          <option value="jaccard_only">Jaccard-Only</option>
          <option value="jaccard_only_split">Jaccard-Only Split</option>
        </select>
        {(['hybrid', 'hybrid_split', 'jaccard_only', 'jaccard_only_split', 'hybrid_v2', 'hybrid_v2_split'].includes(breakModel)) && (
          <select value={jaccardThreshold} onChange={e => setJaccardThreshold(+e.target.value)}
            style={{ marginLeft: '4px', padding: '4px 8px', fontSize: '11px', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}
          >
            <option value={0.3}>J: 0.3</option>
            <option value={0.5}>J: 0.5</option>
            <option value={0.7}>J: 0.7</option>
          </select>
        )}
      </div>

      {/* MARKER TOOLBAR */}
      <div className="marker-toolbar">
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 8 }}>MARKERS:</span>
        <button
          className={`marker-mode-btn ${markerMode === 'tier1' ? 'active tier1' : ''}`}
          onClick={() => setMarkerMode('tier1')}
        >
          T1 Downbeat+Harmonic
        </button>
        <button
          className={`marker-mode-btn ${markerMode === 'tier2' ? 'active tier2' : ''}`}
          onClick={() => setMarkerMode('tier2')}
        >
          T2 Harmonic Spike
        </button>
        <div style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 8px' }} />
        <button
          onClick={undo}
          disabled={!canUndo}
          className="marker-action-btn"
          style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="marker-action-btn"
          style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
          title="Redo (Ctrl+Y)"
        >
          ↷ Redo
        </button>
        <div style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 8px' }} />
        <button onClick={saveMarkers} className="marker-action-btn">Save</button>
        <button onClick={exportMarkers} className="marker-action-btn">Export JSON</button>
        {selectedMarkerIds.size > 0 && (
          <button
            onClick={() => {
              const ids = selectedMarkerIds;
              const newMarkers = markers.filter(m => !ids.has(m.id));
              const newHistory = markerHistory.slice(0, historyIndex + 1);
              newHistory.push(newMarkers);
              setMarkerHistory(newHistory);
              setHistoryIndex(newHistory.length - 1);
              setMarkers(newMarkers);
              setSelectedMarkerIds(new Set());
            }}
            className="marker-action-btn"
            style={{ color: '#ff6b35' }}
            title={`Delete ${selectedMarkerIds.size} selected marker(s)`}
          >
            Delete Selected ({selectedMarkerIds.size})
          </button>
        )}
        <button
          onClick={() => updateMarkersWithHistory([])}
          className="marker-action-btn"
          style={{ color: '#ef4444' }}
        >
          Clear All
        </button>
        <div style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 8px' }} />
        <button
          className={`marker-mode-btn ${showComparison ? 'active compare' : ''}`}
          onClick={() => setShowComparison(!showComparison)}
        >
          Compare vs Model
        </button>
        {showComparison && comparisonStats && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#00ddff' }}>
            P:{comparisonStats.precision}% R:{comparisonStats.recall}% F1:{comparisonStats.f1}%
            (TP:{comparisonStats.tp} FP:{comparisonStats.fp} FN:{comparisonStats.fn})
          </span>
        )}
      </div>

      {/* ZOOM */}
      <div className="zoom-bar">
        <div className="zoom-group">
          <label>H-Zoom</label>
          <input type="range" min="1" max="100" value={hZoom} onChange={e => setHZoom(+e.target.value)} />
          <span className="zoom-value">{hZoom}</span>
        </div>
        <div className="zoom-group">
          <label>V-Zoom</label>
          <input type="range" min="4" max="30" value={vZoom} onChange={e => setVZoom(+e.target.value)} />
          <span className="zoom-value">{vZoom}</span>
        </div>
        {showComparison && (
          <div className="zoom-group">
            <label>Tolerance</label>
            <input type="range" min="25" max="500" step="25" value={compTolerance} onChange={e => setCompTolerance(+e.target.value)} />
            <span className="zoom-value">{compTolerance}ms</span>
          </div>
        )}
      </div>

      {/* PIANO ROLL */}
      <div className="roll-container" style={{ position: 'relative' }}>
        <div className="keyboard" ref={keyboardRef}>{keyboardKeys}</div>
        <div className="canvas-wrapper" ref={wrapperRef}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={(e) => { handleMouseMove(e); handleCanvasMouseMove2(e); }}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={(e) => { setTooltip(null); handleCanvasMouseUp(e); }}
            onClick={handleCanvasClick}
            onContextMenu={handleCanvasContextMenu}
            style={{ cursor: dragSelect?.active ? 'col-resize' : 'crosshair' }}
          />
        </div>
      </div>

      {/* LEGEND */}
      <div className="legend">{legendContent()}</div>

      {/* COMPARISON PANEL */}
      {showComparison && comparisonStats && (
        <div className="comparison-panel">
          <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Comparison: User vs Model
          </h3>
          <div style={{ fontSize: 11, marginBottom: 12, padding: '8px', background: 'rgba(0,220,255,0.05)', borderRadius: 6, border: '1px solid rgba(0,220,255,0.15)' }}>
            <div>Precision: <strong style={{ color: '#00ddff' }}>{comparisonStats.precision}%</strong></div>
            <div>Recall: <strong style={{ color: '#00ddff' }}>{comparisonStats.recall}%</strong></div>
            <div>F1 Score: <strong style={{ color: '#00ddff' }}>{comparisonStats.f1}%</strong></div>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 10 }}>
              TP:{comparisonStats.tp} | FP:{comparisonStats.fp} | FN:{comparisonStats.fn}
            </div>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
            {comparisonStats.details.map((d, i) => (
              <div key={i} style={{
                fontSize: 10, padding: '4px 6px', marginBottom: 2, borderRadius: 4,
                background: d.type === 'tp' ? 'rgba(16,185,129,0.1)' : d.type === 'fp' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                color: d.type === 'tp' ? '#10b981' : d.type === 'fp' ? '#ef4444' : '#f59e0b',
                borderLeft: `3px solid ${d.type === 'tp' ? '#10b981' : d.type === 'fp' ? '#ef4444' : '#f59e0b'}`
              }}>
                {d.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TOOLTIP */}
      {tooltip && (
        <div className="tooltip" style={{ display: 'block', left: tooltip.x, top: tooltip.y }}>
          <div className="tt-label">{tooltip.noteName} (MIDI {tooltip.pitch})</div>
          <div className="tt-detail">
            Velocity: {tooltip.velocity}<br />
            Onset: {tooltip.onset}ms<br />
            Duration: {tooltip.duration}ms<br />
            <br />
            <strong>4D Chord Color:</strong><br />
            H: {tooltip.hue} | S: {tooltip.sat}% | L: {tooltip.lightness}%<br />
            Tension: {tooltip.tonal_distance}
          </div>
        </div>
      )}

      {/* ENGINE MODAL */}
      {isEngineRunning && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#0d0d12', width: '800px', height: '600px',
            border: '1px solid #333', borderRadius: '8px',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '12px 16px', background: '#111118', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '14px' }}>ETME Engine Output</h3>
              {!isEngineDone ? (
                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)', borderTop: '2px solid #4caf50', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              ) : (
                <button
                  onClick={() => setIsEngineRunning(false)}
                  style={{ background: '#d32f2f', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 16px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Dismiss
                </button>
              )}
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', flex: 1, fontFamily: 'monospace', fontSize: '12px', color: '#a0a0b0', whiteSpace: 'pre-wrap' }}>
              {engineLogs.map((log, i) => <div key={i} style={{ marginBottom: '4px' }}>{log}</div>)}
              <div ref={logsEndRef} />
            </div>
          </div>
          <style dangerouslySetInnerHTML={{__html: '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'}} />
        </div>
      )}
    </>
  );
}


// ===== COMPARISON UTILITIES =====

function getModelBoundaries(regimes) {
  if (!regimes) return [];
  const boundaries = [];
  for (let i = 1; i < regimes.length; i++) {
    const curr = regimes[i];
    // Every regime boundary is a model boundary, excluding Silence/Void (matches what Phase 1 view draws)
    if (curr.state !== 'Silence' && curr.state !== 'Undefined / Gray Void') {
      boundaries.push(curr.start_time);
    }
  }
  return boundaries;
}

function computeComparison(markers, regimes, tolerance) {
  if (!markers.length || !regimes) return null;

  const modelBounds = getModelBoundaries(regimes);
  const userTimes = markers.map(m => m.time_ms);

  // MODEL boundaries = predictions, USER markers = ground truth
  // TP: model boundary that matches a user marker (within tolerance)
  // FP: model boundary with NO user marker nearby  ← penalizes noisy/overcalling models
  // FN: user marker with NO model boundary nearby  ← penalizes models that miss boundaries

  const matchedUser = new Set();
  const matchedModel = new Set();
  const details = [];

  // Find true positives: for each model boundary, find its best matching user marker
  for (let mi = 0; mi < modelBounds.length; mi++) {
    let bestDist = Infinity;
    let bestUi = -1;
    for (let ui = 0; ui < userTimes.length; ui++) {
      if (matchedUser.has(ui)) continue;
      const dist = Math.abs(modelBounds[mi] - userTimes[ui]);
      if (dist < bestDist) { bestDist = dist; bestUi = ui; }
    }
    if (bestDist <= tolerance && bestUi >= 0) {
      matchedModel.add(mi);
      matchedUser.add(bestUi);
      details.push({
        type: 'tp',
        label: `MATCH: Model @${modelBounds[mi]}ms <-> User ${markers[bestUi].tier.toUpperCase()} @${userTimes[bestUi]}ms (${bestDist}ms)`
      });
    }
  }

  // False positives: model boundaries with no user marker nearby (the model overcalled)
  for (let mi = 0; mi < modelBounds.length; mi++) {
    if (!matchedModel.has(mi)) {
      details.push({
        type: 'fp',
        label: `FP: Model boundary @${modelBounds[mi]}ms -- no user marker nearby`
      });
    }
  }

  // False negatives: user markers with no model boundary nearby (the model missed this boundary)
  for (let ui = 0; ui < userTimes.length; ui++) {
    if (!matchedUser.has(ui)) {
      details.push({
        type: 'fn',
        label: `FN: User ${markers[ui].tier.toUpperCase()} @${userTimes[ui]}ms -- no model boundary nearby`
      });
    }
  }

  const tp = matchedModel.size;
  const fp = modelBounds.length - tp;   // model boundaries that didn't match any user marker
  const fn = userTimes.length - matchedUser.size; // user markers that no model boundary covered
  const precision = tp + fp > 0 ? Math.round(tp / (tp + fp) * 100) : 0; // of model boundaries, how many were correct
  const recall = tp + fn > 0 ? Math.round(tp / (tp + fn) * 100) : 0;    // of user markers, how many did model find
  const f1 = precision + recall > 0 ? Math.round(2 * precision * recall / (precision + recall)) : 0;

  return { tp, fp, fn, precision, recall, f1, details };
}


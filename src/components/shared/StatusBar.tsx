'use client';

import React from 'react';
import { Minus, Plus, Maximize, Focus, Grid3X3, Magnet, Crosshair } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { useUIStore } from '@/store/ui-store';
import { getElementBBox } from '@/lib/utils/geometry';

export function StatusBar() {
  const viewport = useCanvasStore(state => state.viewport);
  const elements = useCanvasStore(state => state.elements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const setZoom = useCanvasStore(s => s.setZoom);
  const zoomToFit = useCanvasStore(s => s.zoomToFit);
  const zoomToSelection = useCanvasStore(s => s.zoomToSelection);
  const scrollToContent = useCanvasStore(s => s.scrollToContent);

  // Excalidraw's "scroll back to content": only offered when you have actually
  // lost the drawing off the edge of the viewport.
  const all = Object.values(elements);
  const isLost = all.length > 0 && !all.some((el) => {
    const b = el.bbox ?? getElementBBox(el);
    const left = (b.minX * viewport.zoom) + viewport.x;
    const top = (b.minY * viewport.zoom) + viewport.y;
    const right = (b.maxX * viewport.zoom) + viewport.x;
    const bottom = (b.maxY * viewport.zoom) + viewport.y;
    return right > 0 && bottom > 0
      && left < (viewport.width || window.innerWidth)
      && top < (viewport.height || window.innerHeight);
  });

  const grid = useUIStore(state => state.grid);
  const snap = useUIStore(state => state.snap);
  const updateGrid = useUIStore(s => s.updateGrid);
  const updateSnap = useUIStore(s => s.updateSnap);

  const handleZoom = (factor: number) => {
    setZoom(viewport.zoom * factor);
  };

  const resetZoom = () => setZoom(1);

  return (
    <div
      // Tucked into the bottom-left corner instead of floating across the
      // middle of the canvas, where it sat on top of the drawing.
      className="fixed left-3 z-40 bg-white/90 dark:bg-[#1a1a1e]/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 p-1.5 rounded-xl shadow-lg flex items-center gap-2 max-w-[calc(100vw-24px)] overflow-x-auto no-scrollbar"
      style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
      // The counts are no longer shown, but automated checks still need to see
      // them; attributes keep that observable without cluttering the bar.
      data-status-bar
      data-elements={Object.keys(elements).length}
      data-selected={selectedIds.size}
    >
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900/50 rounded-lg p-0.5 px-2">
        <button
          onClick={() => handleZoom(1 / 1.25)}
          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground"
          title="Zoom Out (Ctrl+-)"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={resetZoom}
          className="text-xs font-mono w-14 text-center text-zinc-600 dark:text-zinc-300 hover:text-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded py-0.5"
          title="Reset Zoom (Ctrl+0)"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button
          onClick={() => handleZoom(1.25)}
          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground"
          title="Zoom In (Ctrl++)"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800" />

      <button
        onClick={zoomToFit}
        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground"
        title="Fit All (Shift+1)"
      >
        <Maximize size={14} />
      </button>

      <button
        onClick={zoomToSelection}
        disabled={selectedIds.size === 0}
        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
        title="Fit Selection (Shift+2)"
      >
        <Focus size={14} />
      </button>

      {isLost && (
        <button
          onClick={scrollToContent}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-foreground text-background text-[11px] font-medium whitespace-nowrap"
          title="Scroll back to content"
        >
          <Crosshair size={13} /> Back to content
        </button>
      )}

      <button
        onClick={() => updateGrid({ enabled: !grid.enabled })}
        className={`p-1.5 rounded transition-colors ${grid.enabled ? 'bg-foreground text-background' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground'}`}
        title="Toggle Grid"
      >
        <Grid3X3 size={14} />
      </button>

      <button
        onClick={() => updateSnap({ enabled: !snap.enabled })}
        className={`p-1.5 rounded transition-colors ${snap.enabled ? 'bg-foreground text-background' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground'}`}
        title="Toggle Snapping"
      >
        <Magnet size={14} />
      </button>
    </div>
  );
}

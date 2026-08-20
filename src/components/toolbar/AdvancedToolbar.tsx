'use client';

import React, { useState, useEffect } from 'react';
import { useDragControls } from 'framer-motion';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvas-store';
import { useUIStore } from '@/store/ui-store';
import { ColorPicker, PRESET_COLORS } from './ColorPicker';
import {
  Square,
  Circle,
  Triangle,
  Minus,
  Type,
  Pencil,
  Eraser,
  Image as ImageIcon,
  MousePointer,
  Hand,
  ArrowRight,
  Star,
  Hexagon,
  Diamond,
  Undo2,
  Redo2,
  GripHorizontal,
  LayoutList,
  LayoutDashboard,
  X,
  Plus,
  Highlighter,
} from 'lucide-react';
import { ShapeType } from '@/types';

/* ─────────────────────────────────────────────────────────
   Pen Settings Panel (rendered in a fixed top-right portal)
───────────────────────────────────────────────────────── */
function PenPanel({
  penType,
  stroke,
  onPenType,
  onColor,
  onClose,
}: {
  penType: string;
  stroke: string;
  onPenType: (p: string) => void;
  onColor: (c: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="fixed top-4 right-4 z-[200] bg-white dark:bg-[#1a1a1e] border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-4 w-[200px]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Pen Type</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-foreground transition-colors p-0.5 rounded">
          <X size={13} />
        </button>
      </div>

      {/* Pen type list */}
      <div className="flex flex-col gap-0.5 mb-3">
        {(['pen', 'pencil', 'fountain', 'marker', 'highlighter'] as const).map((pt) => (
          <button
            key={pt}
            onClick={(e) => { e.stopPropagation(); onPenType(pt); }}
            className={`text-left text-xs px-2 py-1.5 rounded-md capitalize transition-colors ${
              penType === pt
                ? 'bg-foreground text-background font-medium'
                : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {pt.charAt(0).toUpperCase() + pt.slice(1)}
          </button>
        ))}
      </div>

      <div className="w-full h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

      {/* Color section */}
      <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Color</div>
      <div className="grid grid-cols-6 gap-1.5 justify-items-center">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={(e) => { e.stopPropagation(); onColor(c); }}
            className={`w-5 h-5 rounded-md border transition-all ${
              stroke === c
                ? 'border-foreground scale-125 shadow-[0_0_0_2px_var(--foreground)] relative z-10'
                : 'border-zinc-300 dark:border-zinc-700 hover:scale-110'
            }`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Eraser Settings Panel (rendered in a fixed top-right portal)
───────────────────────────────────────────────────────── */
function EraserPanel({
  mode,
  size,
  onMode,
  onSize,
  onClose,
}: {
  mode: string;
  size: number;
  onMode: (m: 'object' | 'partial') => void;
  onSize: (s: number) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="fixed top-4 right-4 z-[200] bg-white dark:bg-[#1a1a1e] border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-4 w-[200px]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Eraser Mode</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-foreground transition-colors p-0.5 rounded">
          <X size={13} />
        </button>
      </div>

      {/* Mode buttons */}
      <div className="flex flex-col gap-1.5 mb-3">
        <button
          onClick={(e) => { e.stopPropagation(); onMode('object'); }}
          className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
            mode === 'object'
              ? 'bg-foreground text-background font-medium'
              : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent'
          }`}
        >
          <div className="font-medium">🧹 Object</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Remove whole element</div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMode('partial'); }}
          className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
            mode === 'partial'
              ? 'bg-foreground text-background font-medium'
              : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent'
          }`}
        >
          <div className="font-medium">✂️ Partial</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Erase where you drag</div>
        </button>
      </div>

      <div className="w-full h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

      {/* Size */}
      <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Size</div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>Radius</span>
          <span>{size}px</span>
        </div>
        <input
          type="range"
          min="5"
          max="80"
          step="5"
          value={size}
          onChange={(e) => { e.stopPropagation(); onSize(parseInt(e.target.value)); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="accent-foreground w-full"
        />
        <div className="flex gap-1">
          {[10, 20, 40, 60].map((sz) => (
            <button
              key={sz}
              onClick={(e) => { e.stopPropagation(); onSize(sz); }}
              className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                size === sz
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-zinc-300 dark:border-zinc-700 text-foreground hover:border-zinc-500'
              }`}
            >
              {sz}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Quick colour strip — sits either side of the pen tool so a
   colour can be picked before reaching for the pen and again
   once the pen is already selected.
───────────────────────────────────────────────────────── */
const QUICK_COLORS = ['#e2e8f0', '#f43f5e', '#22c55e', '#3b82f6', '#eab308'];

function QuickColors({
  vertical,
  stroke,
  onColor,
}: {
  vertical: boolean;
  stroke: string;
  onColor: (c: string) => void;
}) {
  return (
    <div
      // Two columns when vertical: five stacked swatches would push the tools
      // below the fold on a tablet-height toolbar.
      className={`${vertical ? 'grid grid-cols-2 place-items-center py-1' : 'flex flex-row items-center px-1'} gap-1 shrink-0`}
    >
      {QUICK_COLORS.map((c) => (
        <button
          key={c}
          onClick={(e) => { e.stopPropagation(); onColor(c); }}
          className={`w-3.5 h-3.5 rounded-full border transition-transform ${
            stroke === c
              ? 'border-foreground scale-125 shadow-[0_0_0_1.5px_var(--foreground)]'
              : 'border-zinc-300 dark:border-zinc-600 hover:scale-110'
          }`}
          style={{ backgroundColor: c }}
          title={c}
          aria-label={`Colour ${c}`}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Toolbar
═══════════════════════════════════════════════════════ */
export function AdvancedToolbar() {
  // One selector per value. Destructuring `useCanvasStore()` subscribes to the
  // whole store, so the toolbar re-rendered on every single store write — every
  // pointermove of a drag, and setIsInteracting() at pen-down, which is exactly
  // the moment the first points of a stroke are arriving.
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  // Derived as booleans rather than calling canUndo()/canRedo() during render,
  // so the buttons still update without subscribing to the history array.
  const canUndo = useCanvasStore((s) => s.historyIndex > 0);
  const canRedo = useCanvasStore((s) => s.historyIndex < s.history.length - 1);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const isInteracting = useCanvasStore((s) => s.isInteracting);
  const eraserSettings = useCanvasStore((s) => s.eraserSettings);
  const setEraserMode = useCanvasStore((s) => s.setEraserMode);
  const setEraserSize = useCanvasStore((s) => s.setEraserSize);
  const currentStyle = useUIStore((state) => state.currentStyle);
  const penType = currentStyle.penType || 'pen';
  const updateCurrentStyle = useUIStore((state) => state.updateCurrentStyle);

  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const dragControls = useDragControls();

  // Which tool panel is open: 'pen' | 'eraser' | null
  const [openPanel, setOpenPanel] = useState<'pen' | 'eraser' | null>(null);

  // Close panel when user starts drawing or switches to a non-panel tool
  useEffect(() => {
    if (isInteracting) {
      setOpenPanel(null);
    }
  }, [isInteracting]);

  useEffect(() => {
    if (tool !== ShapeType.FREEHAND && openPanel === 'pen') setOpenPanel(null);
    if (tool !== 'eraser' && openPanel === 'eraser') setOpenPanel(null);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleColorChange = (c: string) => {
    updateCurrentStyle({ stroke: c });
    // Read on click instead of subscribing: the toolbar has no other use for
    // the element map, and subscribing to it re-rendered the whole toolbar on
    // every change to any element on the board.
    const { selectedIds, elements } = useCanvasStore.getState();
    selectedIds.forEach((id) => {
      const el = elements[id];
      if (el) updateElement(id, { style: { ...el.style, stroke: c } });
    });
  };

  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select (V)' },
    { id: 'hand', icon: Hand, label: 'Hand (H)' },
    null,
    { id: ShapeType.RECTANGLE, icon: Square, label: 'Rectangle (R)' },
    { id: ShapeType.CIRCLE, icon: Circle, label: 'Circle (O)' },
    { id: ShapeType.TRIANGLE, icon: Triangle, label: 'Triangle' },
    { id: ShapeType.DIAMOND, icon: Diamond, label: 'Diamond' },
    { id: ShapeType.STAR, icon: Star, label: 'Star' },
    { id: ShapeType.HEXAGON, icon: Hexagon, label: 'Hexagon' },
    null,
    { id: ShapeType.LINE, icon: Minus, label: 'Line (L)' },
    { id: ShapeType.ARROW, icon: ArrowRight, label: 'Arrow (A)' },
    null,
    { id: ShapeType.FREEHAND, icon: Pencil, label: 'Pen (P)' },
    { id: ShapeType.TEXT, icon: Type, label: 'Text (T)' },
    { id: ShapeType.IMAGE, icon: ImageIcon, label: 'Image' },
    { id: 'icon-picker', icon: Plus, label: 'Icons' },
    { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
    { id: 'laser', icon: Highlighter, label: 'Laser pointer (K)' },
  ];

  const isVertical = orientation === 'vertical';

  const isIconPickerOpen = useCanvasStore((state) => state.iconPickerOpen);
  const setIconPickerOpen = useCanvasStore((state) => state.setIconPickerOpen);

  /* ── Shared button renderer ───────────────────────────────── */
  const renderToolButton = (t: { id: string; icon: React.ElementType; label: string } | null, i: number) => {
    if (!t) {
      return isVertical
        ? <div key={i} className="w-full h-px bg-zinc-200 dark:bg-zinc-800 my-0.5 shrink-0" />
        : <div key={i} className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />;
    }

    const Icon = t.icon;
    
    // For icon picker, it's not a persistent "tool" in the same way, but it behaves like an open modal
    const isActive = t.id === 'icon-picker' ? isIconPickerOpen : tool === t.id;

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      
      if (t.id === 'icon-picker') {
        setIconPickerOpen(!isIconPickerOpen);
        return;
      }
      
      setTool(t.id as import('@/types').Tool);

      if (t.id === ShapeType.FREEHAND) {
        setOpenPanel((prev) => (prev === 'pen' ? null : 'pen'));
      } else if (t.id === 'eraser') {
        setOpenPanel((prev) => (prev === 'eraser' ? null : 'eraser'));
      } else {
        setOpenPanel(null);
      }
    };

    const tooltipClass = isVertical
      ? 'absolute left-full ml-2 top-1/2 -translate-y-1/2'
      : 'absolute bottom-full mb-2 left-1/2 -translate-x-1/2';

    const button = (
      <button
        key={t.id}
        onClick={handleClick}
        className={`p-1.5 rounded transition-colors relative group shrink-0 flex items-center justify-center ${
          isActive ? 'bg-foreground text-background' : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
        title={t.label}
      >
        <Icon size={18} />
        <div className={`${tooltipClass} bg-zinc-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50`}>
          {t.label}
        </div>
      </button>
    );

    // Colour swatches flank the pen so one is always in reach, whether you
    // pick the colour first or the pen first.
    if (t.id === ShapeType.FREEHAND) {
      return (
        <React.Fragment key={t.id}>
          <QuickColors vertical={isVertical} stroke={currentStyle.stroke} onColor={handleColorChange} />
          {button}
          <QuickColors vertical={isVertical} stroke={currentStyle.stroke} onColor={handleColorChange} />
        </React.Fragment>
      );
    }

    return button;
  };

  /* ── Portalled panels ─────────────────────────────────────── */
  const panels = (
    <AnimatePresence>
      {openPanel === 'pen' && (
        <PenPanel
          key="pen-panel"
          penType={penType}
          stroke={currentStyle.stroke}
          onPenType={(pt) => { updateCurrentStyle({ penType: pt as 'pen' | 'pencil' | 'fountain' | 'marker' | 'highlighter' }); setTool(ShapeType.FREEHAND); }}
          onColor={(c) => { handleColorChange(c); setTool(ShapeType.FREEHAND); }}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === 'eraser' && (
        <EraserPanel
          key="eraser-panel"
          mode={eraserSettings.mode}
          size={eraserSettings.size}
          onMode={(m) => setEraserMode(m)}
          onSize={(s) => setEraserSize(s)}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </AnimatePresence>
  );

  /* ── Vertical layout ──────────────────────────────────────── */
  if (isVertical) {
    return (
      <>
        <motion.div
          key="vertical-toolbar"
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          className="fixed left-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 z-50 pointer-events-auto outline-none overflow-y-auto no-scrollbar"
          style={{ width: '44px', top: '72px', maxHeight: 'calc(var(--app-height, 100vh) - 100px)' }}
        >
          {/* Drag handle — only this initiates drag */}
          <div
            className="w-full flex justify-center py-0.5 text-zinc-400 hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <GripHorizontal size={14} />
          </div>

          {/* All other content stops propagation so clicks don't trigger drag */}
          <div onPointerDown={(e) => e.stopPropagation()}>
            {/* Orientation toggle */}
            <button
              onClick={() => setOrientation('horizontal')}
              className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-500 shrink-0 relative group flex justify-center w-full"
              title="Switch to horizontal toolbar"
            >
              <LayoutDashboard size={14} />
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-zinc-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                Horizontal mode
              </div>
            </button>

            <div className="w-full h-px bg-zinc-200 dark:bg-zinc-800 my-0.5 shrink-0" />

            {/* Undo/Redo */}
            <button
              onClick={() => canUndo && undo()}
              className={`p-1.5 rounded transition-colors shrink-0 flex justify-center w-full ${canUndo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={() => canRedo && redo()}
              className={`p-1.5 rounded transition-colors shrink-0 flex justify-center w-full ${canRedo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
              title="Redo (Ctrl+Y)"
              disabled={!canRedo}
            >
              <Redo2 size={18} />
            </button>

            <div className="w-full h-px bg-zinc-200 dark:bg-zinc-800 my-0.5 shrink-0" />

            {/* Tools */}
            <div className="flex flex-col gap-0.5">
              {tools.map((t, i) => renderToolButton(t, i))}
            </div>

            {/* Global Color */}
            <div className="w-full h-px bg-zinc-200 dark:bg-zinc-800 my-0.5 shrink-0" />
            <div className="flex flex-col items-center py-0.5 shrink-0">
              <ColorPicker
                color={currentStyle.stroke}
                onChange={handleColorChange}
                position="right"
                size="lg"
              />
            </div>
          </div>
        </motion.div>

        {/* Tool settings panels — always fixed top-right */}
        {typeof window !== 'undefined' && createPortal(panels, document.body)}
      </>
    );
  }

  /* ── Horizontal layout ────────────────────────────────────── */
  return (
    <>
      <motion.div
        key="horizontal-toolbar"
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        className="fixed left-0 right-0 mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg px-2 py-1.5 flex flex-row items-center gap-0.5 z-50 pointer-events-auto outline-none max-w-[calc(100vw-32px)] overflow-x-auto no-scrollbar"
        style={{ width: 'max-content', bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Drag handle — only this initiates drag */}
        <div
          className="flex items-center pr-1 text-zinc-400 hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <GripHorizontal size={14} />
        </div>

        {/* All other content stops propagation so clicks don't trigger drag */}
        <div className="flex flex-row items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

          {/* Orientation toggle */}
          <button
            onClick={() => setOrientation('vertical')}
            className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-500 shrink-0 relative group"
            title="Switch to vertical toolbar"
          >
            <LayoutList size={14} />
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Vertical mode
            </div>
          </button>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

          {/* Undo/Redo */}
          <button
            onClick={() => canUndo && undo()}
            className={`p-1.5 rounded transition-colors shrink-0 ${canUndo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={() => canRedo && redo()}
            className={`p-1.5 rounded transition-colors shrink-0 ${canRedo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
            title="Redo (Ctrl+Y)"
            disabled={!canRedo}
          >
            <Redo2 size={16} />
          </button>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

          {/* Tools */}
          <div className="flex flex-row items-center gap-0.5">
            {tools.map((t, i) => renderToolButton(t, i))}
          </div>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

          {/* Global Color */}
          <div className="flex items-center px-0.5 shrink-0">
            <ColorPicker
              color={currentStyle.stroke}
              onChange={handleColorChange}
              position="top"
              size="lg"
            />
          </div>
        </div>
      </motion.div>

      {/* Tool settings panels — always fixed top-right */}
      {typeof window !== 'undefined' && createPortal(panels, document.body)}
    </>
  );
}

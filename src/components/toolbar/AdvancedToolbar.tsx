'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDragControls } from 'framer-motion';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
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
  Pentagon,
  Ellipse as EllipseIcon,
  Undo2,
  Redo2,
  GripHorizontal,
  X,
  Plus,
  Highlighter,
  Lasso,
  StickyNote,
  RotateCcw,
} from 'lucide-react';
import { ShapeType } from '@/types';

/* ─────────────────────────────────────────────────────────
   Pen Settings Panel (rendered in a fixed top-right portal)
───────────────────────────────────────────────────────── */
function PenPanel({
  penType,
  stroke,
  variability,
  strokeWidth,
  onPenType,
  onColor,
  onVariability,
  onStrokeWidth,
  onClose,
}: {
  penType: string;
  stroke: string;
  variability: 'variable' | 'constant';
  strokeWidth: number;
  onPenType: (p: string) => void;
  onColor: (c: string) => void;
  onVariability: (v: 'variable' | 'constant') => void;
  onStrokeWidth: (w: number) => void;
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

      {/* Size — set before you start writing, not only after selecting a stroke */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Size</span>
        <span className="text-[10px] text-zinc-400 tabular-nums">{strokeWidth}px</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        {[1, 2, 4, 8, 16].map((w) => (
          <button
            key={w}
            onClick={(e) => { e.stopPropagation(); onStrokeWidth(w); }}
            title={`${w}px`}
            className={`flex-1 h-8 rounded-md flex items-center justify-center transition-colors ${
              strokeWidth === w
                ? 'bg-foreground'
                : 'border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {/* The swatch is the actual thickness, so the choice is visual */}
            <span
              className={`block rounded-full ${strokeWidth === w ? 'bg-background' : 'bg-foreground'}`}
              style={{ width: '60%', height: `${Math.min(w, 12)}px` }}
            />
          </button>
        ))}
      </div>
      <input
        type="range"
        min={1}
        max={32}
        step={1}
        value={strokeWidth}
        onChange={(e) => { e.stopPropagation(); onStrokeWidth(parseInt(e.target.value, 10)); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="accent-foreground w-full mb-3"
        aria-label="Stroke width"
      />

      <div className="w-full h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

      {/* Width variability */}
      <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Stroke style</div>
      <div className="flex gap-1.5 mb-3">
        {([
          { id: 'variable' as const, label: 'Variable', hint: 'Tapers with pressure' },
          { id: 'constant' as const, label: 'Constant', hint: 'One width throughout' },
        ]).map((v) => (
          <button
            key={v.id}
            onClick={(e) => { e.stopPropagation(); onVariability(v.id); }}
            title={v.hint}
            className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${
              variability === v.id
                ? 'bg-foreground text-background font-medium'
                : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700'
            }`}
          >
            {v.label}
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
   Lasso Settings Panel
───────────────────────────────────────────────────────── */
function LassoPanel({
  mode,
  onMode,
  onClose,
}: {
  mode: 'contain' | 'intersect';
  onMode: (m: 'contain' | 'intersect') => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="fixed top-4 right-4 z-[200] bg-white dark:bg-[#1a1a1e] border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-4 w-[210px]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Lasso</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-foreground transition-colors p-0.5 rounded">
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onMode('contain'); }}
          className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
            mode === 'contain'
              ? 'bg-foreground text-background font-medium'
              : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent'
          }`}
        >
          <div className="font-medium">Enclose</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Only what the loop surrounds</div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMode('intersect'); }}
          className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
            mode === 'intersect'
              ? 'bg-foreground text-background font-medium'
              : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent'
          }`}
        >
          <div className="font-medium">Touch</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Anything the loop crosses too</div>
        </button>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Quick colour strip — sits just before the pen, so a colour is
   in reach without opening the full picker (which sits after the
   tools and covers the "after the pen" case).
───────────────────────────────────────────────────────── */
const QUICK_COLORS = ['#e2e8f0', '#f43f5e', '#22c55e', '#3b82f6'];

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
      // 2×2 when vertical. Five stacked swatches — let alone the two strips
      // this had either side of the pen — ran the toolbar off the screen.
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

/* ─────────────────────────────────────────────────────────
   Shape picker — one button standing in for six.
───────────────────────────────────────────────────────── */
const SHAPE_TOOLS = [
  { id: ShapeType.RECTANGLE, icon: Square, label: 'Rectangle (R)' },
  { id: ShapeType.CIRCLE, icon: Circle, label: 'Circle (O)' },
  { id: ShapeType.ELLIPSE, icon: EllipseIcon, label: 'Ellipse' },
  { id: ShapeType.TRIANGLE, icon: Triangle, label: 'Triangle' },
  { id: ShapeType.DIAMOND, icon: Diamond, label: 'Diamond' },
  { id: ShapeType.PENTAGON, icon: Pentagon, label: 'Pentagon' },
  { id: ShapeType.STAR, icon: Star, label: 'Star' },
  { id: ShapeType.HEXAGON, icon: Hexagon, label: 'Hexagon' },
] as const;

function ShapePicker({
  vertical,
  activeShape,
  isActive,
  onPick,
}: {
  vertical: boolean;
  activeShape: (typeof SHAPE_TOOLS)[number];
  isActive: boolean;
  onPick: (id: ShapeType) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Portalled, because the toolbar scrolls and would clip an absolute child.
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(
      vertical
        ? { top: rect.top, left: rect.right + 8 }
        : { top: rect.top - 8 - 44, left: rect.left }
    );
  }, [vertical]);

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const Icon = activeShape.icon;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          onPick(activeShape.id);
          setOpen((v) => !v);
        }}
        className={`p-2 rounded transition-colors relative shrink-0 flex items-center justify-center ${
          isActive ? 'bg-foreground text-background' : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
        title="Shapes"
      >
        <Icon size={18} />
        {/* Corner nub marking this as a group of tools */}
        <span className="absolute bottom-0.5 right-0.5 w-1 h-1 rounded-full bg-current opacity-50" />
      </button>

      {open && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed z-[200] flex flex-row gap-0.5 p-1 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl"
          style={{ top: pos.top, left: pos.left }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {SHAPE_TOOLS.map((s) => {
            const SIcon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => { onPick(s.id); setOpen(false); }}
                title={s.label}
                className={`p-2 rounded transition-colors ${
                  activeShape.id === s.id
                    ? 'bg-foreground text-background'
                    : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <SIcon size={18} />
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
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
  const toolbarDock = useUIStore((s) => s.toolbarDock);
  const setToolbarDock = useUIStore((s) => s.setToolbarDock);

  const [lastShape, setLastShape] = useState<ShapeType>(ShapeType.RECTANGLE);
  const dragControls = useDragControls();
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Cycle order: left → top → right → bottom → left
  const DOCK_CYCLE: Array<'left' | 'top' | 'right' | 'bottom'> = ['left', 'top', 'right', 'bottom'];
  const cycleDock = useCallback(() => {
    const idx = DOCK_CYCLE.indexOf(toolbarDock);
    setToolbarDock(DOCK_CYCLE[(idx + 1) % DOCK_CYCLE.length]!);
  }, [toolbarDock, setToolbarDock]);

  // On drag end, snap to the nearest edge
  const handleDragEnd = useCallback((_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const { x, y } = info.point;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dLeft = x;
    const dRight = W - x;
    const dTop = y;
    const dBottom = H - y;
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min === dLeft) setToolbarDock('left');
    else if (min === dRight) setToolbarDock('right');
    else if (min === dTop) setToolbarDock('top');
    else setToolbarDock('bottom');
  }, [setToolbarDock]);

  const orientation = toolbarDock === 'left' || toolbarDock === 'right' ? 'vertical' : 'horizontal';

  // Which tool panel is open
  const [openPanel, setOpenPanel] = useState<'pen' | 'eraser' | 'lasso' | null>(null);
  const lassoMode = useUIStore((s) => s.lassoMode);
  const setLassoMode = useUIStore((s) => s.setLassoMode);

  // Close panel when user starts drawing or switches to a non-panel tool
  useEffect(() => {
    if (isInteracting) {
      setOpenPanel(null);
    }
  }, [isInteracting]);

  useEffect(() => {
    if (tool !== ShapeType.FREEHAND && openPanel === 'pen') setOpenPanel(null);
    if (tool !== 'eraser' && openPanel === 'eraser') setOpenPanel(null);
    if (tool !== 'lasso' && openPanel === 'lasso') setOpenPanel(null);
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

  // Sets the width for the next stroke, and applies it to anything selected —
  // same contract as the colour swatches.
  const handleStrokeWidthChange = (w: number) => {
    updateCurrentStyle({ strokeWidth: w });
    const { selectedIds, elements } = useCanvasStore.getState();
    selectedIds.forEach((id) => {
      const el = elements[id];
      if (el) updateElement(id, { style: { ...el.style, strokeWidth: w } });
    });
  };

  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select (V)' },
    { id: 'lasso', icon: Lasso, label: 'Lasso select (Q)' },
    { id: 'hand', icon: Hand, label: 'Hand (H)' },
    null,
    // The six shapes live behind one button now — as a flat list they were a
    // third of the toolbar's height on their own.
    { id: 'shapes', icon: Square, label: 'Shapes' },
    { id: ShapeType.LINE, icon: Minus, label: 'Line (L)' },
    { id: ShapeType.ARROW, icon: ArrowRight, label: 'Arrow (A)' },
    null,
    { id: ShapeType.FREEHAND, icon: Pencil, label: 'Pen (P)' },
    { id: ShapeType.TEXT, icon: Type, label: 'Text (T)' },
    { id: ShapeType.IMAGE, icon: ImageIcon, label: 'Image' },
    { id: 'icon-picker', icon: Plus, label: 'Icons' },
    { id: 'sticky', icon: StickyNote, label: 'Sticky note (N)' },
    { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
    { id: 'laser', icon: Highlighter, label: 'Laser pointer (K)' },
  ];

  // Remember which shape the picker last used, so its button keeps that icon.
  const activeShape =
    SHAPE_TOOLS.find((s) => s.id === tool) ??
    SHAPE_TOOLS.find((s) => s.id === lastShape) ??
    SHAPE_TOOLS[0];

  const isVertical = orientation === 'vertical';

  const isIconPickerOpen = useCanvasStore((state) => state.iconPickerOpen);
  const setIconPickerOpen = useCanvasStore((state) => state.setIconPickerOpen);

  /* ── Shared button renderer ───────────────────────────────── */
  const renderToolButton = (t: { id: string; icon: React.ElementType; label: string } | null, i: number) => {
    if (!t) {
      return isVertical
        ? <div key={i} className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800 mx-auto my-0.5 shrink-0" />
        : <div key={i} className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />;
    }

    if (t.id === 'shapes') {
      return (
        <ShapePicker
          key="shapes"
          vertical={isVertical}
          activeShape={activeShape}
          isActive={SHAPE_TOOLS.some((s) => s.id === tool)}
          onPick={(id) => {
            setLastShape(id);
            setTool(id);
            setOpenPanel(null);
          }}
        />
      );
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
      } else if (t.id === 'lasso') {
        setOpenPanel((prev) => (prev === 'lasso' ? null : 'lasso'));
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
        className={`p-2 rounded transition-colors relative group shrink-0 flex items-center justify-center ${
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

    // Quick colours immediately before the pen; the full picker sits after the
    // tools, so a colour is reachable on either side of choosing the pen.
    if (t.id === ShapeType.FREEHAND) {
      return (
        <React.Fragment key={t.id}>
          <QuickColors vertical={isVertical} stroke={currentStyle.stroke} onColor={handleColorChange} />
          {button}
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
          variability={currentStyle.strokeVariability ?? 'variable'}
          strokeWidth={currentStyle.strokeWidth ?? 2}
          onPenType={(pt) => { updateCurrentStyle({ penType: pt as 'pen' | 'pencil' | 'fountain' | 'marker' | 'highlighter' }); setTool(ShapeType.FREEHAND); }}
          onColor={(c) => { handleColorChange(c); setTool(ShapeType.FREEHAND); }}
          onVariability={(v) => { updateCurrentStyle({ strokeVariability: v }); setTool(ShapeType.FREEHAND); }}
          onStrokeWidth={handleStrokeWidthChange}
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
      {openPanel === 'lasso' && (
        <LassoPanel
          key="lasso-panel"
          mode={lassoMode}
          onMode={(m) => setLassoMode(m)}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </AnimatePresence>
  );

  /* ── Dock-position styles ─────────────────────────────────── */
  // Compute the fixed-position style for each dock position.
  // Left/Right → vertical bar; Top/Bottom → horizontal bar.
  const dockStyle: React.CSSProperties = (() => {
    switch (toolbarDock) {
      case 'left':
        return {
          left: '12px',
          top: 0,
          bottom: 0,
          marginTop: 'auto',
          marginBottom: 'auto',
          height: 'max-content',
          maxHeight: 'calc(var(--app-height, 100vh) - 140px)',
          width: '46px',
        };
      case 'right':
        return {
          right: '12px',
          top: 0,
          bottom: 0,
          marginTop: 'auto',
          marginBottom: 'auto',
          height: 'max-content',
          maxHeight: 'calc(var(--app-height, 100vh) - 140px)',
          width: '46px',
        };
      case 'top':
        return {
          top: '12px',
          left: 0,
          right: 0,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: 'max-content',
          maxWidth: 'calc(100vw - 16px)',
        };
      case 'bottom':
      default:
        return {
          bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
          left: 0,
          right: 0,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: 'max-content',
          maxWidth: 'calc(100vw - 16px)',
        };
    }
  })();

  const isVert = isVertical;

  /* ── Shared inner content ─────────────────────────────────── */
  const headerControls = (
    <div
      className={`flex shrink-0 ${isVert ? 'flex-col items-center gap-0.5' : 'flex-row items-center gap-1'}`}
    >
      {/* Grip — initiates drag */}
      <div
        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
        onPointerDown={(e) => dragControls.start(e)}
        title="Drag toolbar"
      >
        <GripHorizontal size={12} />
      </div>
      {/* Cycle dock position */}
      <button
        onClick={cycleDock}
        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-500 shrink-0"
        title="Cycle toolbar position (Left → Top → Right → Bottom)"
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );

  const divider = isVert
    ? <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800 mx-auto my-1 shrink-0" />
    : <div className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />;

  const undoRedo = (
    <div className={`flex shrink-0 ${isVert ? 'flex-col gap-0.5' : 'flex-row gap-0.5 items-center'}`}>
      <button
        onClick={() => canUndo && undo()}
        className={`p-2 rounded transition-colors shrink-0 ${canUndo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={() => canRedo && redo()}
        className={`p-2 rounded transition-colors shrink-0 ${canRedo ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'}`}
        title="Redo (Ctrl+Y)"
        disabled={!canRedo}
      >
        <Redo2 size={16} />
      </button>
    </div>
  );

  const toolList = (
    <div className={`flex shrink-0 ${isVert ? 'flex-col gap-1' : 'flex-row gap-1 items-center'}`}>
      {tools.map((t, i) => renderToolButton(t, i))}
    </div>
  );

  const colorPickerEl = (
    <div className={`flex shrink-0 ${isVert ? 'flex-col items-center pb-0.5' : 'flex-row items-center px-0.5'}`}>
      <ColorPicker
        color={currentStyle.stroke}
        onChange={handleColorChange}
        position={toolbarDock === 'right' ? 'left' : toolbarDock === 'top' ? 'bottom' : 'right'}
        size="lg"
      />
    </div>
  );

  return (
    <>
      <motion.div
        ref={toolbarRef}
        key="toolbar"
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        className={`fixed bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-lg z-50 pointer-events-auto outline-none ${
          isVert
            ? 'p-1 flex flex-col gap-1 overflow-y-auto no-scrollbar'
            : 'px-1.5 py-1 flex flex-row items-center gap-1 overflow-x-auto no-scrollbar'
        }`}
        style={dockStyle}
      >
        {/* Header: grip + cycle button */}
        {headerControls}

        {/* All interactive content — stops propagation so clicks don't trigger drag */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className={`flex shrink-0 ${isVert ? 'flex-col gap-1' : 'flex-row gap-1 items-center'}`}
        >
          {divider}
          {undoRedo}
          {divider}
          {toolList}
          {divider}
          {colorPickerEl}
        </div>
      </motion.div>

      {/* Tool settings panels — always fixed top-right */}
      {typeof window !== 'undefined' && createPortal(panels, document.body)}
    </>
  );
}

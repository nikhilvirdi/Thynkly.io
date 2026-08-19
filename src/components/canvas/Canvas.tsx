'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvas-store';
import { useUIStore } from '@/store/ui-store';
import { renderCanvas, type ErasePreview } from '@/lib/canvas/renderer';
import { renderFreehand } from '@/lib/canvas/freehand';
import { Point, ShapeType, WhiteboardElement, FreehandElement, ShapeElement, TextElement, ConnectorElement, ImageElement, StickyElement, BoundingBox } from '@/types';
import { isPointInBox, getElementBBox } from '@/lib/utils/geometry';
import { computeSnap, drawGuides, type SmartGuide } from '@/lib/canvas/smart-guides';
import { hitStickyClose, hitStickyDot, STICKY_INK } from '@/lib/canvas/sticky';
import { getLassoSelectedIds, drawLassoPath } from '@/lib/canvas/lasso';
import { SelectionBox } from './SelectionBox';
import { IconPicker } from './IconPicker';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { ResizeHandle } from '@/lib/utils/transforms';
import { resizeElement as calcResizedBounds } from '@/lib/utils/transforms';
import { v4 as uuidv4 } from 'uuid';
import { SpatialIndex } from '@/lib/canvas/spatial-index';
import { ImageHandler } from '@/lib/canvas/image-handler';
import { EraserManager } from '@/lib/canvas/eraser-manager';
import { ConnectorManager } from '@/lib/canvas/connectors';
import { debounce } from '@/lib/utils/debounce';
import { getElementsInSelectionBox } from '@/lib/canvas/hit-test';
import { hitTestPoint, hitTestConnectorHandles } from '@/lib/canvas/hit-testing';
import { extractRawCoalescedPoints } from '@/lib/input/pointer-utils';
import { gestureHandler } from '@/lib/input/gesture-handler';
import { gatePointerEvent } from '@/lib/input/input-gate';
import { isPenPointer } from '@/lib/input/pen-detect';
import { getDeviceCapabilities } from '@/lib/input/device-detection';
import { createActiveStroke, clearStrokeTimeout, type ActiveStroke, type CompletionReason } from '@/lib/canvas/stroke-state';
import { LaserTrail } from '@/lib/canvas/laser';
import { FREEDRAW } from '@/lib/canvas/freehand';
import { layoutText, measureLine, FONT_FAMILIES } from '@/lib/canvas/text';
import { PenCursor } from './PenCursor';

const NO_ERASE_PREVIEW: ErasePreview = { faded: new Set(), hidden: new Set() };

type InteractionMode =
  | 'idle'
  | 'panning'
  | 'selecting'
  | 'drawing'
  | 'freehand'
  | 'dragging'
  | 'resizing'
  | 'rotating'
  | 'text-editing'
  | 'erasing'
  | 'connector-draw'
  | 'connector-reshaping'
  | 'connector-endpoint-drag'
  | 'lasso';


export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live stroke draws here, on its own layer, so an in-progress stroke never
  // forces a repaint of the whole board (see the native pointer handlers).
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const elements = useCanvasStore(state => state.elements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const viewport = useCanvasStore(state => state.viewport);
  const tool = useCanvasStore(state => state.tool);
  const canvasBackground = useCanvasStore(state => state.canvasBackground);
  const inputMode = useCanvasStore(state => state.inputMode);
  // Per-action selectors rather than a whole-store destructure, which would
  // re-render the canvas on every write including ones it doesn't care about.
  const addElement = useCanvasStore(s => s.addElement);
  const updateElement = useCanvasStore(s => s.updateElement);
  const deleteElements = useCanvasStore(s => s.deleteElements);
  const selectElements = useCanvasStore(s => s.selectElements);
  const clearSelection = useCanvasStore(s => s.clearSelection);
  const updateViewport = useCanvasStore(s => s.updateViewport);
  const saveSnapshot = useCanvasStore(s => s.saveSnapshot);
  const setTool = useCanvasStore(s => s.setTool);
  const setIsInteracting = useCanvasStore(s => s.setIsInteracting);

  const currentStyle = useUIStore(state => state.currentStyle);
  const grid = useUIStore(state => state.grid);
  const theme = useUIStore(state => state.theme);

  // Only needed as a repaint trigger now: the renderer takes an explicit
  // background colour and no longer resolves the theme itself.
  const resolvedTheme: 'light' | 'dark' = theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  const eraserSettings = useCanvasStore(state => state.eraserSettings);
  const setInputState = useCanvasStore(state => state.setInputState);
  // Subscribed (not read via getState) so the connector-binding highlight
  // actually triggers a repaint now that rendering is dirty-flag driven.
  const hoveredBindTarget = useCanvasStore(state => state.hoveredBindTarget);

  // Tablet / iPad pointers
  const rejectedPointers = useRef(new Set<number>());

  // Interaction state
  const modeRef = useRef<InteractionMode>('idle');
  const [mode, setModeState] = useState<InteractionMode>('idle');
  const setMode = useCallback((m: InteractionMode) => { modeRef.current = m; setModeState(m); }, []);

  const [selectionBox, setSelectionBox] = useState<{ start: Point; end: Point } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Text editing
  const [textEditingId, setTextEditingId] = useState<string | null>(null);
  const [textEditorStyle, setTextEditorStyle] = useState<React.CSSProperties>({});
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Image Upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentElementRef = useRef<WhiteboardElement | null>(null);
  const lastPointerPos = useRef<Point>({ x: 0, y: 0 }); // screen coords
  const lastPointerWorldPos = useRef<Point | null>(null); // world coords for sweep testing
  const spatialIndexRef = useRef<SpatialIndex>(new SpatialIndex());
  const eraserRef = useRef<EraserManager | null>(null);
  const dragStartElementPositions = useRef<Record<string, Point>>({});
  // Drag origin and the selection's bounds at that moment — snapping corrects a
  // proposed absolute position, so it needs both.
  const dragStartWorldRef = useRef<Point | null>(null);
  const dragStartBoundsRef = useRef<BoundingBox | null>(null);
  const activeGuidesRef = useRef<SmartGuide[]>([]);
  // Element under the cursor with the select tool, for the hover outline.
  const hoveredElementRef = useRef<string | null>(null);
  // A click (not a drag) that landed on an open sticky note — resolved on
  // pointerup, so the note can still be dragged by its body.
  const stickyClickRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const resizeHandleRef = useRef<ResizeHandle | null>(null);
  const resizeStartBounds = useRef<{ x: number; y: number; width: number; height: number; fontSize?: number } | null>(null);
  const resizeGroupStartBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const activeGroupBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const resizeElementStartBoundsRef = useRef<Record<string, { x: number; y: number; width: number; height: number; type: string; fontSize?: number; controlPoints?: { x: number; y: number }[] }>>({});
  const resizeElementIdRef = useRef<string | null>(null);
  const rotateStartAngle = useRef<number>(0);
  const rotateCenter = useRef<Point>({ x: 0, y: 0 });
  const rotateElementIdRef = useRef<string | null>(null);
  const connectorHandleIndexRef = useRef<number | null>(null);
  const connectorEndpointRef = useRef<'start' | 'end' | null>(null);

  // ── Native freehand stroke tracking (bypasses React synthetic events) ──
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  // Style/geometry shell for the stroke being drawn. It is deliberately NOT in
  // the store until the pen lifts — see handleNativeFreehandDown.
  const liveStrokeElRef = useRef<FreehandElement | null>(null);
  const overlayDirtyRef = useRef(false);
  // Element id whose stroke is still on the overlay, waiting for the main
  // canvas to paint it before we clear the overlay (prevents a 1-frame blink).
  const overlayHandoffRef = useRef<string | null>(null);
  // Minimum distance between points (world units) to prevent jitter
  const MIN_POINT_DISTANCE = 0.5;

  // ── Eraser gesture state ────────────────────────────────────────────────
  // Nothing reaches the store while the eraser is down. The manager only marks
  // what has been touched, the board ghosts those elements through
  // erasePreviewRef, and the whole gesture commits once on pointer-up as a
  // single undo step. The previous version deleted (and in partial mode
  // re-created, with fresh ids) elements on every pointermove, which meant a
  // store write plus a full re-render per sample — the reason erasing stuttered
  // on tablets and phones.
  const erasePointerRef = useRef<number | null>(null);
  const erasePreviewRef = useRef<ErasePreview>(NO_ERASE_PREVIEW);
  const eraseOverlayDirtyRef = useRef(false);

  // Laser pointer: overlay-only, never enters the document.
  const laserRef = useRef(new LaserTrail());
  const laserPointerRef = useRef<number | null>(null);

  // Lasso: a freehand selection loop, drawn on the overlay and never committed.
  const lassoPathRef = useRef<Point[]>([]);
  const lassoPointerRef = useRef<number | null>(null);
  const lassoDirtyRef = useRef(false);

  // Space held = temporary hand tool, as in Excalidraw. A ref because the
  // native drawing listeners need to see it without re-registering.
  const spaceDownRef = useRef(false);

  // Two-finger pinch/pan is in progress — the drawing listeners must stand down.
  const gestureActiveRef = useRef(false);
  // Pen mode auto-enables once, on the first stylus contact.
  const penAutoDetectedRef = useRef(false);

  // Initialize EraserManager
  useEffect(() => {
    eraserRef.current = new EraserManager(spatialIndexRef.current);
  }, []);

  // Initialize device capabilities for input mode
  useEffect(() => {
    const caps = getDeviceCapabilities();

    let savedMode: 'pen' | 'hand' = 'hand';
    try {
      const stored = localStorage.getItem('drawer_input_mode');
      if (stored === 'pen' || stored === 'hand') savedMode = stored;
    } catch {}

    if (caps.isTablet && !localStorage.getItem('drawer_input_mode')) {
      savedMode = 'pen';
    }

    useCanvasStore.setState(state => {
      state.inputMode.isTouchDevice = caps.isTouchCapable;
      state.inputMode.isTablet = caps.isTablet || caps.isMobile;
      state.inputMode.mode = savedMode;
    });
  }, []);

  const clearOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const ctx = ov?.getContext('2d');
    if (!ov || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);
  }, []);

  // ── Finalize stroke helper ──────────────────────────────────────────────
  // All completion paths (pointerup, pointercancel, lostpointercapture,
  // timeout, force-complete) funnel through this single function.
  //
  // This is the ONLY place a freehand stroke reaches the store. Committing
  // points on every pointermove meant each move rebuilt the element record,
  // re-rendered every store subscriber, and repainted the entire board —
  // O(all points on the board) per move. Writing quickly saturated the main
  // thread, which is what made the next pen-down get delivered late or dropped.
  const finalizeActiveStroke = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _reason: CompletionReason
  ) => {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;

    clearStrokeTimeout(stroke);
    stroke.phase = 'completing';

    const shell = liveStrokeElRef.current;
    activeStrokeRef.current = null;
    liveStrokeElRef.current = null;
    overlayDirtyRef.current = false;

    if (shell && stroke.points.length >= 2) {
      const store = useCanvasStore.getState();
      // addElement already snapshots history, so one stroke = one undo step.
      store.addElement({ ...shell, points: stroke.points });
      store.selectElements([shell.id]);
      // Hand the pixels over to the main canvas before wiping the overlay.
      overlayHandoffRef.current = shell.id;
    } else {
      // Single-point tap — nothing worth keeping, and nothing to hand off.
      clearOverlay();
    }

    if (modeRef.current === 'freehand') {
      currentElementRef.current = null;
      setMode('idle');
      setIsInteracting(false);
    }
  }, [clearOverlay, setIsInteracting, setMode]);

  // ── Eraser preview plumbing ─────────────────────────────────────────────
  // Shared by the native eraser listeners and the React gesture path.
  const syncErasePreview = useCallback(() => {
    const mgr = eraserRef.current;
    if (!mgr) return;
    erasePreviewRef.current = { faded: mgr.getMarkedIds(), hidden: mgr.getHiddenIds() };
    dirtyRef.current = true;
    eraseOverlayDirtyRef.current = true;
  }, []);

  const clearErasePreview = useCallback(() => {
    erasePreviewRef.current = NO_ERASE_PREVIEW;
    dirtyRef.current = true;
    eraseOverlayDirtyRef.current = false;
    clearOverlay();
  }, [clearOverlay]);

  /** Apply the whole wipe as a single undo step. */
  const commitErase = useCallback(() => {
    const mgr = eraserRef.current;
    erasePointerRef.current = null;
    if (mgr?.hasChanges()) {
      const { toDelete, toAdd } = mgr.getResult();
      const store = useCanvasStore.getState();
      store.saveSnapshot();
      store.batchErase(toDelete, toAdd);
    }
    mgr?.endErase();
    clearErasePreview();
    if (modeRef.current === 'erasing') {
      setMode('idle');
      setIsInteracting(false);
    }
  }, [clearErasePreview, setIsInteracting, setMode]);

  /** Drop the wipe without applying it (a second finger took the gesture). */
  const cancelErase = useCallback(() => {
    if (erasePointerRef.current === null) return;
    erasePointerRef.current = null;
    eraserRef.current?.endErase();
    clearErasePreview();
    if (modeRef.current === 'erasing') {
      setMode('idle');
      setIsInteracting(false);
    }
  }, [clearErasePreview, setIsInteracting, setMode]);

  // Throw the in-progress stroke away (two-finger gesture took over, etc.)
  const abortActiveStroke = useCallback(() => {
    const stroke = activeStrokeRef.current;
    if (stroke) clearStrokeTimeout(stroke);
    activeStrokeRef.current = null;
    liveStrokeElRef.current = null;
    overlayDirtyRef.current = false;
    clearOverlay();
    if (modeRef.current === 'freehand') {
      currentElementRef.current = null;
      setMode('idle');
      setIsInteracting(false);
    }
  }, [clearOverlay, setIsInteracting, setMode]);

  // ── Native freehand pointer listeners (bypass React synthetic events) ──
  // React's synthetic event system processes one event per render cycle and
  // does NOT expose getCoalescedEvents(). Attaching raw native listeners
  // directly to the canvas DOM node fixes stroke skipping on iPad.
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current; // TS narrows: HTMLCanvasElement

    // ── Touch gestures ────────────────────────────────────────────────────
    // Registered first, and native rather than React, so pinch/pan can never be
    // swallowed by the pen-mode gate or by the early returns that hand drawing
    // tools off to the native listeners.
    const applyPinch = (scale: number, cx: number, cy: number) => {
      const store = useCanvasStore.getState();
      // Excalidraw pins the scale factor to 1 while the freedraw tool is active
      // in pen mode: two fingers resting on the screen next to the stylus
      // should move the page, not resize the drawing under it.
      if (store.tool === ShapeType.FREEHAND && store.inputMode.mode === 'pen') return;

      const vp = store.viewport;
      // Same clamp as the wheel path; pinch used to stop at 5× while the wheel
      // went to 10×, so a tablet simply could not zoom as far as a laptop.
      const zoom = Math.max(0.05, Math.min(vp.zoom * scale, 10));
      const k = zoom / vp.zoom;
      useCanvasStore.getState().updateViewport({
        zoom,
        x: cx - (cx - vp.x) * k,
        y: cy - (cy - vp.y) * k,
      });
    };

    const applyPan = (dx: number, dy: number) => {
      const vp = useCanvasStore.getState().viewport;
      useCanvasStore.getState().updateViewport({ x: vp.x + dx, y: vp.y + dy });
    };

    // Fires once, the first time a real stylus touches the screen: pen mode
    // turns itself on, exactly as Excalidraw does (App.tsx — "fires only once,
    // if pen is detected, penMode is enabled"). The user can still toggle it
    // back off, and that choice sticks because it is what gets persisted.
    function handleFirstPenContact(e: PointerEvent) {
      if (penAutoDetectedRef.current) return;
      if (!isPenPointer(e)) return;
      penAutoDetectedRef.current = true;
      const store = useCanvasStore.getState();
      if (store.inputMode.mode !== 'pen') store.setInputMode('pen');
    }

    function handleNativeTouchDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      const store = useCanvasStore.getState();

      const decision = gestureHandler.onPointerDown(e);

      if (decision === 'reject') {
        rejectedPointers.current.add(e.pointerId);
        return;
      }

      if (decision === 'gesture') {
        e.preventDefault();
        // A second finger means the first one was never a stroke.
        abortActiveStroke();
        cancelErase();
        laserRef.current.clear();
        gestureActiveRef.current = true;
        setMode('panning');
        return;
      }

      // A single finger the gate won't let draw is simply ignored — in pen mode
      // Excalidraw drops the event and leaves the canvas still; panning is the
      // two-finger gesture. (An earlier version of this made one finger pan,
      // which is Procreate's behaviour, not Excalidraw's.)
      const im = store.inputMode;
      if (gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool) !== 'allow') {
        e.preventDefault();
      }
    }

    function handleNativeTouchMove(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;

      if (gestureHandler.onPointerMove(e, applyPinch, applyPan)) {
        e.preventDefault();
      }
    }

    function handleNativeTouchUp(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;

      gestureHandler.onPointerUp(e);
      rejectedPointers.current.delete(e.pointerId);

      if (!gestureHandler.isGestureActive()) {
        gestureActiveRef.current = false;
        if (modeRef.current === 'panning') {
          setMode('idle');
          setIsInteracting(false);
        }
      }
    }

    function handleNativeFreehandDown(e: PointerEvent) {
      // Space held is a temporary hand tool — pan, don't draw.
      if (spaceDownRef.current) return;
      // A finger that is scrolling or pinching is not drawing.
      if (gestureActiveRef.current) return;

      const store = useCanvasStore.getState();
      const currentTool = store.tool;

      // A second contact during a finger/stylus stroke is a pinch or a pan,
      // not a stroke. Drop what was drawn and let the gesture handler take it.
      if (activeStrokeRef.current && !e.isPrimary && activeStrokeRef.current.pointerType !== 'pen') {
        abortActiveStroke();
        return;
      }

      const isPen = isPenPointer(e);

      // Automatically switch to FREEHAND drawing tool when pen touches the screen
      // and we are in select/hand mode — BUT only if pen is on empty space.
      // If pen is touching an existing element, let the React handler manage
      // selection, dragging, and resizing instead.
      if (isPen && (currentTool === 'select' || currentTool === 'hand')) {
        if (modeRef.current !== 'text-editing') {
          // Hit-test: is the pen touching an existing element?
          const vp = store.viewport;
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const wx = (sx - vp.x) / vp.zoom;
          const wy = (sy - vp.y) / vp.zoom;

          // Check connector handles of selected elements first
          const selectedArr = Array.from(store.selectedIds);
          const connHandleHit = hitTestConnectorHandles(wx, wy, store.elements, selectedArr, vp.zoom);

          // Check if pen is touching any element
          const elementHit = hitTestPoint(wx, wy, store.elements, vp);

          // Also check if pen is touching a resize/rotate handle of the
          // currently selected element (SelectionBox handles sit outside
          // the element bbox, so hitTestPoint won't find them).
          let hittingResizeHandle = false;
          if (selectedArr.length > 0) {
            const padding = 10 / vp.zoom;
            const handleRadius = 12 / vp.zoom;
            for (const sid of selectedArr) {
              const sel = store.elements[sid];
              if (!sel || sel.type === ShapeType.CONNECTOR) continue;
              const minX = sel.x - padding;
              const minY = sel.y - padding;
              const maxX = sel.x + sel.width + padding;
              const maxY = sel.y + sel.height + padding;
              const midX = (minX + maxX) / 2;
              const midY = (minY + maxY) / 2;
              const rotateY = minY - 30 / vp.zoom;
              const handlePositions = [
                { x: minX, y: minY }, { x: midX, y: minY }, { x: maxX, y: minY },
                { x: maxX, y: midY }, { x: maxX, y: maxY }, { x: midX, y: maxY },
                { x: minX, y: maxY }, { x: minX, y: midY }, { x: midX, y: rotateY },
              ];
              for (const hp of handlePositions) {
                if (Math.hypot(wx - hp.x, wy - hp.y) < handleRadius) {
                  hittingResizeHandle = true;
                  break;
                }
              }
              if (hittingResizeHandle) break;
            }
          }

          if (!connHandleHit && !elementHit && !hittingResizeHandle) {
            // Pen is on empty space — auto-switch to freehand drawing
            store.setTool(ShapeType.FREEHAND);
          } else {
            // Pen is touching an existing element or handle — let React handler manage it
            return;
          }
        }
      }

      // Re-read currentTool after possible auto-switch
      const activeTool = store.tool;
      if (activeTool !== ShapeType.FREEHAND) return;

      // Only intercept pen/touch events that would draw freehand
      // Let the React handler manage everything else
      const im = store.inputMode;
      const decision = gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool);
      if (decision !== 'allow') return;

      // Don't intercept right-click or if already in a non-idle/non-freehand mode
      if (e.button === 2) return;
      const currentMode = modeRef.current;
      if (currentMode !== 'idle' && currentMode !== 'freehand') return;

      // CRITICAL: preventDefault stops browser gestures/scrolling from intercepting active drawing
      e.preventDefault();

      // If a stroke is already open (e.g. missed pointerup), finalize it
      if (activeStrokeRef.current) {
        finalizeActiveStroke('force-complete');
      }

      // Capture the pointer so move/up fire on canvas even if pointer leaves bounds
      try { canvas.setPointerCapture(e.pointerId); } catch {}

      const vp = store.viewport;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldX = (screenX - vp.x) / vp.zoom;
      const worldY = (screenY - vp.y) / vp.zoom;
      // Excalidraw's test, and it is a better one than "is this a pen?":
      // a device with no pressure sensor reports exactly 0.5, so that value —
      // and only that value — means "synthesise pressure from speed". A stylus
      // that reports a flat 0.5 gets simulated pressure instead of a dead
      // constant-width line, and an Android finger reporting real analog
      // pressure gets to use it.
      const simulatePressure = e.pressure === 0.5;
      const pressure = e.pressure > 0 ? e.pressure : 0.5;
      // Pen and touch track the tip closely; a mouse is noisier and wants more
      // input smoothing.
      const streamline = e.pointerType !== 'mouse'
        ? FREEDRAW.STREAMLINE_PRECISE
        : FREEDRAW.STREAMLINE;

      // Build the element but keep it OUT of the store until the pen lifts.
      // store.addElement() clones the whole board for the undo snapshot, and
      // doing that on pointerdown stalled the main thread at the exact moment
      // the first points of the stroke were arriving.
      const id = uuidv4();
      const newEl: FreehandElement = {
        id,
        type: ShapeType.FREEHAND,
        x: worldX,
        y: worldY,
        width: 0,
        height: 0,
        rotation: 0,
        locked: false,
        zIndex: Date.now(),
        style: { ...useUIStore.getState().currentStyle },
        points: [[worldX, worldY, pressure]],
        simulatePressure,
        streamline,
        variability: useUIStore.getState().currentStyle.strokeVariability ?? 'variable',
      };
      liveStrokeElRef.current = newEl;
      currentElementRef.current = newEl;
      overlayDirtyRef.current = true;
      setMode('freehand');
      setIsInteracting(true);

      // Create active stroke tracking
      const stroke = createActiveStroke(e.pointerId, e.pointerType, id, worldX, worldY, pressure);
      activeStrokeRef.current = stroke;

      // Safety timeout: if pen-up never fires within 10s, auto-complete
      stroke.timeoutHandle = setTimeout(() => {
        if (activeStrokeRef.current?.pointerId === e.pointerId) {
          console.warn('[Drawer] Pen-up safety timeout — force completing stroke');
          finalizeActiveStroke('timeout');
        }
      }, 10_000);
    }

    function handleNativeFreehandMove(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      if (stroke.phase !== 'drawing' && stroke.phase !== 'pen-down') return;

      const store = useCanvasStore.getState();
      const im = store.inputMode;
      const decision = gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool);
      if (decision !== 'allow') return;

      // Prevent browser gestures/scrolling from cancelling active drawing
      e.preventDefault();

      // Transition from pen-down to drawing on first move
      if (stroke.phase === 'pen-down') {
        stroke.phase = 'drawing';
      }

      // Process ALL coalesced points — critical for smooth fast strokes
      const vp = store.viewport;
      const newPoints = extractRawCoalescedPoints(e, canvas, vp);

      // Deduplication: skip points too close to the last point (prevents micro-jitter)
      const minDist = MIN_POINT_DISTANCE / vp.zoom;
      for (const pt of newPoints) {
        const dx = pt[0] - stroke.lastX;
        const dy = pt[1] - stroke.lastY;
        if (Math.hypot(dx, dy) >= minDist || stroke.points.length < 2) {
          stroke.points.push(pt);
          stroke.lastX = pt[0];
          stroke.lastY = pt[1];
        }
      }

      stroke.lastEventTime = performance.now();

      // Repaint the overlay only — one stroke, not the whole board, and no
      // store write, so nothing re-renders while the pen is down.
      overlayDirtyRef.current = true;
    }

    function handleNativeFreehandUp(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;

      e.preventDefault();

      // Add the lift position. Carry the last real pressure over instead of
      // writing 0 — a zero-pressure sample collapses the stroke to zero width
      // on top of the renderer's end taper, leaving a whisker on every stroke.
      const vp = useCanvasStore.getState().viewport;
      const rect = canvas.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - vp.x) / vp.zoom;
      const worldY = (e.clientY - rect.top - vp.y) / vp.zoom;
      const dx = worldX - stroke.lastX;
      const dy = worldY - stroke.lastY;
      if (Math.hypot(dx, dy) > 0.1) {
        const lastPressure = stroke.points[stroke.points.length - 1]?.[2] ?? 0.5;
        stroke.points.push([worldX, worldY, lastPressure]);
      }

      finalizeActiveStroke('pointer-up');
    }

    // CRITICAL: iOS fires pointercancel instead of pointerup when Scribble
    // or system gestures steal the pointer. DO NOT discard — save the stroke.
    function handleNativeFreehandCancel(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      e.preventDefault();
      console.warn('[Drawer] pointercancel — completing stroke with existing points');
      finalizeActiveStroke('pointer-cancel');
    }

    function handleLostPointerCapture(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      if (stroke.phase === 'drawing' || stroke.phase === 'pen-down') {
        console.warn('[Drawer] lostpointercapture — completing open stroke');
        finalizeActiveStroke('lost-capture');
      }
    }

    // ── Eraser ────────────────────────────────────────────────────────────
    // On the same native path as freehand, and for the same reasons: React's
    // synthetic events don't expose getCoalescedEvents(), so a fast wipe was
    // being sampled once per frame and skipped straight over strokes between
    // two samples.
    const worldFromEvent = (e: PointerEvent): Point => {
      const vp = useCanvasStore.getState().viewport;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left - vp.x) / vp.zoom,
        y: (e.clientY - rect.top - vp.y) / vp.zoom,
      };
    };

    function handleNativeEraserDown(e: PointerEvent) {
      if (spaceDownRef.current) return;
      if (gestureActiveRef.current) return;
      const store = useCanvasStore.getState();
      if (store.tool !== 'eraser' || e.button === 2) return;
      // A second contact is a pinch or a pan, never a wipe.
      if (!e.isPrimary) return;

      const im = store.inputMode;
      if (gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool) !== 'allow') return;

      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}

      // The spatial index is rebuilt on a 200ms debounce, so anything drawn in
      // the last moment would be invisible to the eraser without this.
      spatialIndexRef.current.rebuild(store.elements);

      const mgr = eraserRef.current;
      if (!mgr) return;

      erasePointerRef.current = e.pointerId;
      const world = worldFromEvent(e);
      mgr.startErase(world);
      mgr.extend([world], store.elements, store.eraserSettings, store.viewport.zoom);
      syncErasePreview();
      setMode('erasing');
      setIsInteracting(true);
    }

    function handleNativeEraserMove(e: PointerEvent) {
      if (erasePointerRef.current !== e.pointerId) return;
      const store = useCanvasStore.getState();
      const im = store.inputMode;
      if (gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool) !== 'allow') return;

      e.preventDefault();
      const mgr = eraserRef.current;
      if (!mgr) return;

      const samples = extractRawCoalescedPoints(e, canvas, store.viewport)
        .map(([x, y]) => ({ x, y }));
      if (mgr.extend(samples, store.elements, store.eraserSettings, store.viewport.zoom)) {
        syncErasePreview();
      }
    }

    function handleNativeEraserUp(e: PointerEvent) {
      if (erasePointerRef.current !== e.pointerId) return;
      e.preventDefault();
      commitErase();
    }

    // ── Laser pointer ─────────────────────────────────────────────────────
    function handleNativeLaserDown(e: PointerEvent) {
      if (spaceDownRef.current) return;
      if (gestureActiveRef.current) return;
      const store = useCanvasStore.getState();
      if (store.tool !== 'laser' || e.button === 2) return;
      if (!e.isPrimary) return;

      // The laser had no input gating at all, so on a tablet a palm or a
      // pinching finger painted a trail while every other tool correctly
      // ignored it.
      const im = store.inputMode;
      if (gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool) !== 'allow') return;

      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      laserPointerRef.current = e.pointerId;
      laserRef.current.clear();
      const w = worldFromEvent(e);
      laserRef.current.add(w.x, w.y, store.viewport.zoom);
    }

    function handleNativeLaserMove(e: PointerEvent) {
      if (laserPointerRef.current !== e.pointerId) return;
      if (gestureActiveRef.current) return;
      e.preventDefault();
      const vp = useCanvasStore.getState().viewport;
      for (const [x, y] of extractRawCoalescedPoints(e, canvas, vp)) {
        laserRef.current.add(x, y, vp.zoom);
      }
    }

    function handleNativeLaserUp(e: PointerEvent) {
      if (laserPointerRef.current !== e.pointerId) return;
      laserPointerRef.current = null;
      // The tail is left to fade on its own rather than snapping away.
    }

    // ── Lasso selection ───────────────────────────────────────────────────
    function handleNativeLassoDown(e: PointerEvent) {
      if (spaceDownRef.current || gestureActiveRef.current) return;
      const store = useCanvasStore.getState();
      if (store.tool !== 'lasso' || e.button === 2) return;
      if (!e.isPrimary) return;

      const im = store.inputMode;
      if (gatePointerEvent(e, im.mode, im.isTouchDevice, store.tool) !== 'allow') return;

      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}

      lassoPointerRef.current = e.pointerId;
      lassoPathRef.current = [worldFromEvent(e)];
      lassoDirtyRef.current = true;
      if (!e.shiftKey) store.clearSelection();
      setMode('lasso');
      setIsInteracting(true);
    }

    function handleNativeLassoMove(e: PointerEvent) {
      if (lassoPointerRef.current !== e.pointerId) return;
      if (gestureActiveRef.current) return;
      e.preventDefault();

      const store = useCanvasStore.getState();
      for (const [x, y] of extractRawCoalescedPoints(e, canvas, store.viewport)) {
        lassoPathRef.current.push({ x, y });
      }
      lassoDirtyRef.current = true;

      // Live selection, as Excalidraw does — you can see what the loop has
      // caught before committing to it.
      const ids = getLassoSelectedIds(
        lassoPathRef.current,
        store.elements,
        store.viewport.zoom,
        useUIStore.getState().lassoMode
      );
      store.selectElements(ids);
    }

    function handleNativeLassoUp(e: PointerEvent) {
      if (lassoPointerRef.current !== e.pointerId) return;
      lassoPointerRef.current = null;
      lassoPathRef.current = [];
      lassoDirtyRef.current = false;
      clearOverlay();

      // Hand the selection over to the select tool. Keeping the lasso active
      // would mean the very next drag started another loop instead of moving
      // what you just caught, so the selection was unusable without a trip to
      // the toolbar. (Excalidraw keeps its lasso active and routes the drag
      // internally; this is the same outcome with far less machinery.)
      const store = useCanvasStore.getState();
      if (store.selectedIds.size > 0) store.setTool('select');

      if (modeRef.current === 'lasso') {
        setMode('idle');
        setIsInteracting(false);
      }
    }

    // Pen detection first, so pen mode is already on for this very contact.
    canvas.addEventListener('pointerdown', handleFirstPenContact, { passive: true });
    // Gestures next: they decide whether the contact is a stroke at all.
    canvas.addEventListener('pointerdown', handleNativeTouchDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativeTouchMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativeTouchUp, { passive: true });
    canvas.addEventListener('pointercancel', handleNativeTouchUp, { passive: true });

    // Use { passive: false } so we can call preventDefault() to block Scribble
    canvas.addEventListener('pointerdown', handleNativeFreehandDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativeFreehandMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativeFreehandUp, { passive: false });
    canvas.addEventListener('pointercancel', handleNativeFreehandCancel, { passive: false });
    canvas.addEventListener('lostpointercapture', handleLostPointerCapture, { passive: true });

    canvas.addEventListener('pointerdown', handleNativeLaserDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativeLaserMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativeLaserUp, { passive: true });
    canvas.addEventListener('pointercancel', handleNativeLaserUp, { passive: true });

    canvas.addEventListener('pointerdown', handleNativeLassoDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativeLassoMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativeLassoUp, { passive: true });
    canvas.addEventListener('pointercancel', handleNativeLassoUp, { passive: true });
    canvas.addEventListener('lostpointercapture', handleNativeLassoUp, { passive: true });

    canvas.addEventListener('pointerdown', handleNativeEraserDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativeEraserMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativeEraserUp, { passive: false });
    // A cancelled or stolen pointer must still commit — losing the gesture
    // would silently throw away everything the user just wiped.
    canvas.addEventListener('pointercancel', handleNativeEraserUp, { passive: false });
    canvas.addEventListener('lostpointercapture', handleNativeEraserUp, { passive: true });

    return () => {
      canvas.removeEventListener('pointerdown', handleFirstPenContact);
      canvas.removeEventListener('pointerdown', handleNativeTouchDown);
      canvas.removeEventListener('pointermove', handleNativeTouchMove);
      canvas.removeEventListener('pointerup', handleNativeTouchUp);
      canvas.removeEventListener('pointercancel', handleNativeTouchUp);
      canvas.removeEventListener('pointerdown', handleNativeFreehandDown);
      canvas.removeEventListener('pointermove', handleNativeFreehandMove);
      canvas.removeEventListener('pointerup', handleNativeFreehandUp);
      canvas.removeEventListener('pointercancel', handleNativeFreehandCancel);
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture);
      canvas.removeEventListener('pointerdown', handleNativeEraserDown);
      canvas.removeEventListener('pointermove', handleNativeEraserMove);
      canvas.removeEventListener('pointerup', handleNativeEraserUp);
      canvas.removeEventListener('pointercancel', handleNativeEraserUp);
      canvas.removeEventListener('lostpointercapture', handleNativeEraserUp);
      canvas.removeEventListener('pointerdown', handleNativeLaserDown);
      canvas.removeEventListener('pointermove', handleNativeLaserMove);
      canvas.removeEventListener('pointerup', handleNativeLaserUp);
      canvas.removeEventListener('pointercancel', handleNativeLaserUp);
      canvas.removeEventListener('pointerdown', handleNativeLassoDown);
      canvas.removeEventListener('pointermove', handleNativeLassoMove);
      canvas.removeEventListener('pointerup', handleNativeLassoUp);
      canvas.removeEventListener('pointercancel', handleNativeLassoUp);
      canvas.removeEventListener('lostpointercapture', handleNativeLassoUp);
    };
  }, [finalizeActiveStroke, abortActiveStroke, setIsInteracting, setMode, syncErasePreview, commitErase, cancelErase, clearOverlay]);

  // ── Live-stroke overlay loop ────────────────────────────────────────────
  // Redraws only the stroke currently under the pen, and only when new points
  // arrived. Idle cost is one no-op rAF callback.
  useEffect(() => {
    let frame = 0;

    /** Reset the overlay to the current viewport transform and clear it. */
    const prepareOverlay = () => {
      const ov = overlayRef.current;
      const ctx = ov?.getContext('2d');
      if (!ov || !ctx) return null;
      const vp = useCanvasStore.getState().viewport;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ov.width, ov.height);
      ctx.scale(dpr, dpr);
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.zoom, vp.zoom);
      return ctx;
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);

      // The laser fades on a timer rather than on input, so while it is alive
      // the overlay repaints every frame — the one place a continuous loop is
      // actually earning its keep.
      const laser = laserRef.current;
      if (laser.isAlive()) {
        const stillAlive = laser.prune();
        // prepareOverlay() clears first, so the frame where the last point
        // expires is also the frame that wipes the trail off the screen.
        const ctx = prepareOverlay();
        if (ctx && stillAlive) laser.draw(ctx, useCanvasStore.getState().viewport.zoom);
        return;
      }

      // Lasso loop in progress.
      if (lassoDirtyRef.current) {
        lassoDirtyRef.current = false;
        // prepareOverlay clears first, so an emptied path wipes the loop rather
        // than leaving the last frame of it painted on the overlay.
        const ctx = prepareOverlay();
        if (ctx && lassoPathRef.current.length > 1) {
          drawLassoPath(ctx, lassoPathRef.current, useCanvasStore.getState().viewport.zoom);
        }
        return;
      }

      // Partial erase in progress: the board hides the originals and the
      // surviving fragments are previewed here, so the stroke visibly parts
      // under the eraser without a single store write.
      if (eraseOverlayDirtyRef.current) {
        eraseOverlayDirtyRef.current = false;
        const ctx = prepareOverlay();
        const survivors = eraserRef.current?.getSurvivors();
        if (ctx && survivors) {
          for (const piece of survivors) renderFreehand(ctx, piece);
        }
        return;
      }

      if (!overlayDirtyRef.current) return;
      overlayDirtyRef.current = false;

      const stroke = activeStrokeRef.current;
      const shell = liveStrokeElRef.current;
      if (!stroke || !shell) return;
      const ctx = prepareOverlay();
      if (!ctx) return;
      // Same renderer as the committed stroke, so nothing shifts on commit.
      renderFreehand(ctx, { ...shell, points: stroke.points } as FreehandElement);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  // ── Window-level fallback listeners for missed pen-up events ───────────
  // iOS sometimes delivers pointerup to window instead of canvas
  useEffect(() => {
    function handleWindowPointerUp(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      if (stroke.phase === 'drawing' || stroke.phase === 'pen-down') {
        console.warn('[Drawer] window pointerup caught missed canvas pointerup');
        finalizeActiveStroke('pointer-up');
      }
    }

    function handleWindowPointerCancel(e: PointerEvent) {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      if (stroke.phase === 'drawing' || stroke.phase === 'pen-down') {
        finalizeActiveStroke('pointer-cancel');
      }
    }

    // visibilitychange: user switches app mid-stroke (iPad multitasking)
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && activeStrokeRef.current) {
        finalizeActiveStroke('force-complete');
      }
    }

    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [finalizeActiveStroke]);

  // Abandon any half-drawn lasso when the tool changes. Without this, a loop
  // interrupted by a toolbar click (rather than a pointerup on the canvas)
  // stayed painted on the overlay over everything drawn afterwards.
  useEffect(() => {
    if (tool === 'lasso') return;
    if (lassoPathRef.current.length === 0 && lassoPointerRef.current === null) return;
    lassoPointerRef.current = null;
    lassoPathRef.current = [];
    lassoDirtyRef.current = false;
    clearOverlay();
  }, [tool, clearOverlay]);

  // ── Space to pan ────────────────────────────────────────────────────────
  // Held space is a temporary hand tool. Tracked separately from the shortcut
  // handler below because it has to survive keyrepeat and window blur.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code !== 'Space' || spaceDownRef.current) return;
      spaceDownRef.current = true;
      // Stop the page scrolling under us while space is held.
      e.preventDefault();
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDownRef.current = false;
      if (containerRef.current) containerRef.current.style.cursor = '';
    };
    // Alt-tabbing away with space held would otherwise leave it stuck down.
    const onBlur = () => {
      spaceDownRef.current = false;
      if (containerRef.current) containerRef.current.style.cursor = '';
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip if a text input is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'Escape':
          // Deselect all and return to select tool
          clearSelection();
          setTool('select');
          break;

        case 'Delete':
        case 'Backspace': {
          // Delete selected elements
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          if (ids.length > 0) {
            saveSnapshot();
            deleteElements(ids);
          }
          break;
        }

        case 'v':
        case 'V':
          if (!e.metaKey && !e.ctrlKey) {
            setTool('select');
          }
          break;

        case 'a':
        case 'A':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            useCanvasStore.getState().selectAll();
          }
          break;
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      // Skip if a text input is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      let imageFound = false;

      if (e.clipboardData && e.clipboardData.items) {
        const items = Array.from(e.clipboardData.items);
        for (const item of items) {
          if (item.type.indexOf('image') !== -1) {
            imageFound = true;
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const imageHandler = new ImageHandler();
              const state = useCanvasStore.getState();
              // Place in center of viewport
              const cx = state.viewport.x + (state.viewport.width || window.innerWidth) / 2 / state.viewport.zoom;
              const cy = state.viewport.y + (state.viewport.height || window.innerHeight) / 2 / state.viewport.zoom;
              try {
                const element = await imageHandler.handleImageDrop(file, cx, cy);
                state.addElement(element);
                state.selectElements([element.id]);
              } catch (err) {
                console.error('Failed to paste image', err);
              }
            }
            break;
          }
        }
      }

      if (!imageFound) {
        e.preventDefault();
        const world = lastPointerWorldPos.current || undefined;
        useCanvasStore.getState().paste(world);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [clearSelection, setTool, deleteElements, saveSnapshot]);

  // Keep spatial index up to date (debounced for non-eraser updates)
  const debouncedUpdateIndex = useMemo(
    () => debounce((els: Record<string, WhiteboardElement>) => {
      spatialIndexRef.current.rebuild(els);
    }, 200),
    []
  );

  useEffect(() => {
    debouncedUpdateIndex(elements);
  }, [elements, debouncedUpdateIndex]);

  // Handle resize setup
  const updateCanvasSize = useCallback(() => {
    if (canvasRef.current && containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvasRef.current.width = width * dpr;
      canvasRef.current.height = height * dpr;
      canvasRef.current.style.width = `${width}px`;
      canvasRef.current.style.height = `${height}px`;

      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);

      if (overlayRef.current) {
        overlayRef.current.width = width * dpr;
        overlayRef.current.height = height * dpr;
        overlayRef.current.style.width = `${width}px`;
        overlayRef.current.style.height = `${height}px`;
      }

      updateViewport({ width, height });
    }
  }, [updateViewport]);

  useEffect(() => {
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [updateCanvasSize]);

  // ── Main render loop ────────────────────────────────────────────────────
  // Repaints only when something changed. This loop used to call renderCanvas()
  // on every animation frame forever: on a completely idle board it still
  // re-sorted every element and re-tesselated every freehand stroke through
  // perfect-freehand 60×/second. That permanent main-thread load is why the pen
  // and the eraser felt laggy on tablets and phones — the work was being done
  // whether or not anything had actually moved.
  const dirtyRef = useRef(true);
  // Any React render of this component means a subscribed value moved
  // (elements, viewport, selection, grid, theme, …), so the board is stale.
  useEffect(() => { dirtyRef.current = true; });

  useEffect(() => {
    if (!canvasRef.current) return;

    let frameId: number;
    const render = () => {
      frameId = requestAnimationFrame(render);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const assetsPending = renderCanvas(
        canvasRef.current!,
        Object.values(elements),
        selectedIds,
        viewport,
        grid,
        canvasBackground,
        erasePreviewRef.current,
        textEditingId
      );
      // An image or icon bitmap is still decoding — try again next frame.
      if (assetsPending) dirtyRef.current = true;

      // The just-finished stroke is now on the main canvas, so the overlay copy
      // can go. Doing this any earlier blinks the stroke for a frame.
      if (overlayHandoffRef.current && elements[overlayHandoffRef.current]) {
        overlayHandoffRef.current = null;
        clearOverlay();
      }

      // Draw rubber-band selection rectangle (Excalidraw style)
      if (selectionBox && modeRef.current === 'selecting') {
        const ctx = canvasRef.current!.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.translate(viewport.x, viewport.y);
          ctx.scale(viewport.zoom, viewport.zoom);

          const x = Math.min(selectionBox.start.x, selectionBox.end.x);
          const y = Math.min(selectionBox.start.y, selectionBox.end.y);
          const w = Math.abs(selectionBox.end.x - selectionBox.start.x);
          const h = Math.abs(selectionBox.end.y - selectionBox.start.y);

          // Left→Right = contain mode (solid blue), Right→Left = crossing mode (dashed purple)
          const isCrossing = selectionBox.end.x < selectionBox.start.x;

          if (isCrossing) {
            // Crossing / intersect mode — dashed purple (like AutoCAD crossing selection)
            ctx.fillStyle = 'rgba(100, 80, 200, 0.07)';
            ctx.strokeStyle = 'rgba(120, 80, 220, 0.8)';
            ctx.setLineDash([6 / viewport.zoom, 3 / viewport.zoom]);
          } else {
            // Contain mode — solid blue
            ctx.fillStyle = 'rgba(30, 100, 255, 0.07)';
            ctx.strokeStyle = 'rgba(30, 100, 255, 0.8)';
            ctx.setLineDash([]);
          }

          ctx.lineWidth = 1.5 / viewport.zoom;
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
          ctx.restore();
        }
      }

      // Hover outline (select tool, nothing else going on)
      const hoveredId = hoveredElementRef.current;
      if (hoveredId && modeRef.current === 'idle' && !selectedIds.has(hoveredId)) {
        const el = elements[hoveredId];
        const ctx = canvasRef.current!.getContext('2d');
        if (el && ctx) {
          const b = el.bbox ?? getElementBBox(el);
          const pad = 4 / viewport.zoom;
          ctx.save();
          ctx.translate(viewport.x, viewport.y);
          ctx.scale(viewport.zoom, viewport.zoom);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.65)';
          ctx.lineWidth = 1.5 / viewport.zoom;
          ctx.strokeRect(b.minX - pad, b.minY - pad, (b.maxX - b.minX) + pad * 2, (b.maxY - b.minY) + pad * 2);
          ctx.restore();
        }
      }

      // Alignment guides for the element being dragged
      if (activeGuidesRef.current.length > 0 && modeRef.current === 'dragging') {
        const ctx = canvasRef.current!.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.translate(viewport.x, viewport.y);
          ctx.scale(viewport.zoom, viewport.zoom);
          drawGuides(ctx, activeGuidesRef.current, viewport);
          ctx.restore();
        }
      }

      // Draw binding highlight
      if (hoveredBindTarget) {
        const el = elements[hoveredBindTarget];
        if (el) {
          const ctx = canvasRef.current!.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.translate(viewport.x, viewport.y);
            ctx.scale(viewport.zoom, viewport.zoom);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2 / viewport.zoom;
            ctx.fillRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
            ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
            
            // Draw small anchor dots
            const manager = new ConnectorManager();
            const anchors = manager.getAnchorPoints(el);
            ctx.fillStyle = '#ffffff';
            for (const [key, pos] of Object.entries(anchors)) {
              if (key === 'center') continue;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, 4 / viewport.zoom, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [elements, selectedIds, viewport, grid, selectionBox, canvasBackground, resolvedTheme, clearOverlay, hoveredBindTarget, textEditingId]);

  // Screen → world
  const screenToWorld = (sx: number, sy: number): Point => ({
    x: (sx - viewport.x) / viewport.zoom,
    y: (sy - viewport.y) / viewport.zoom,
  });

  // Get all selected elements as array
  const getSelectedElements = () =>
    Array.from(selectedIds)
      .map(id => elements[id])
      .filter(Boolean) as WhiteboardElement[];


  const handlePointerDown = (e: React.PointerEvent) => {
    const nativeEvent = e.nativeEvent;

    if (e.button === 2) return; // ignore right-click

    // Touch gestures and finger-panning are handled by the native listeners
    // above, which run first and have already claimed this contact.
    if (nativeEvent.pointerType === 'touch') {
      if (gestureActiveRef.current) {
        // Cancel a shape drag that a second finger interrupted.
        if (modeRef.current === 'drawing') {
          const lastEl = elements[currentElementRef.current?.id || ''];
          if (lastEl) deleteElements([lastEl.id]);
        }
        return;
      }
      if (rejectedPointers.current.has(e.pointerId)) return;
    }

    const decision = gatePointerEvent(nativeEvent, inputMode.mode, inputMode.isTouchDevice, tool);
    if (decision === 'block-touch' || decision === 'block-pen') return;

    // Space held, middle button, or the hand tool: pan, whatever tool is active.
    if (spaceDownRef.current || e.button === 1 || tool === 'hand') {
      (e.target as Element).setPointerCapture(e.pointerId);
      lastPointerPos.current = { x: e.clientX, y: e.clientY };
      setMode('panning');
      setIsInteracting(true);
      return;
    }

    // Freehand, eraser and laser run on the native listeners above (they need
    // the coalesced sub-frame samples React's synthetic events throw away).
    if (tool === ShapeType.FREEHAND || tool === 'eraser' || tool === 'laser' || tool === 'lasso') {
      return;
    }

    // Update Input State
    setInputState({
      activePointerType: e.pointerType as 'mouse' | 'pen' | 'touch',
      lastPressure: e.pressure,
    });

    // Close text editing
    if (textEditingId && modeRef.current === 'text-editing') {
      commitTextEdit();
    }

    (e.target as Element).setPointerCapture(e.pointerId);
    setIsInteracting(true);
    const screen: Point = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(e.clientX, e.clientY);
    lastPointerPos.current = screen;
    lastPointerWorldPos.current = world;

    // Sticky note tool → drop a note here and start typing in it.
    if (tool === 'sticky') {
      const id = useCanvasStore.getState().addSticky(world);
      selectElements([id]);
      setTool('select');
      const note = useCanvasStore.getState().elements[id];
      if (note) openTextEditor(note as StickyElement);
      return;
    }

    // A sticky's own controls come before generic selection, so clicking the ×
    // or a collapsed dot acts on the note instead of just selecting it.
    if (tool === 'select') {
      const sorted = Object.values(elements)
        .filter((el): el is StickyElement => el.type === ShapeType.STICKY && !el.locked)
        .sort((a, b) => b.zIndex - a.zIndex);
      for (const note of sorted) {
        if (hitStickyClose(note, world) || hitStickyDot(note, world)) {
          useCanvasStore.getState().toggleStickyCollapsed(note.id);
          selectElements([note.id]);
          return;
        }
      }

      // Clicking the body of an open note starts writing in it. Recorded here
      // and acted on at pointerup only if the pointer didn't move, so dragging
      // the note by its paper still works.
      const bodyHit = sorted.find(
        (note) =>
          !note.collapsed &&
          world.x >= note.x && world.x <= note.x + Math.abs(note.width) &&
          world.y >= note.y && world.y <= note.y + Math.abs(note.height)
      );
      stickyClickRef.current = bodyHit
        ? { id: bodyHit.id, x: e.clientX, y: e.clientY }
        : null;
    } else {
      stickyClickRef.current = null;
    }

    // Image tool -> trigger file upload
    if (tool === ShapeType.IMAGE) {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
      // Delay tool switch to let dialog open instantly
      setTimeout(() => setTool('select'), 0);
      return;
    }

    // Text tool → click to create text element
    if (tool === 'text') {
      // Check if clicking on existing text element
      const sortedEls = Object.values(elements).sort((a, b) => b.zIndex - a.zIndex);
      let hitEl: WhiteboardElement | null = null;
      for (const el of sortedEls) {
        const box = { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
        if (isPointInBox(world, box)) { hitEl = el; break; }
      }

      if (hitEl?.type === ShapeType.TEXT) {
        // Edit existing text
        selectElements([hitEl.id]);
        openTextEditor(hitEl as TextElement);
        return;
      }

      // Create new text element
      const id = uuidv4();
      const newText: TextElement = {
        id,
        type: ShapeType.TEXT,
        x: world.x,
        y: world.y,
        width: 200,
        height: 40,
        rotation: 0,
        locked: false,
        zIndex: Date.now(),
        style: { ...currentStyle },
        text: '',
        fontSize: 60,
        fontFamily: 'Inter, sans-serif',
        color: currentStyle.stroke,
      };
      addElement(newText);
      selectElements([id]);
      openTextEditor(newText);
      return;
    }

    // ─── UNIVERSAL CLICK-TO-SELECT ───────────────────────────────────────
    const isActiveDraw = modeRef.current === 'drawing' || modeRef.current === 'connector-draw';

    if (!isActiveDraw) {
      const connectorHandleHit = hitTestConnectorHandles(world.x, world.y, elements, Array.from(selectedIds), viewport.zoom);

      if (connectorHandleHit) {
        setMode('connector-reshaping');
        useCanvasStore.getState().setActiveHandle(connectorHandleHit);
        resizeElementIdRef.current = connectorHandleHit.connectorId;
        
        if (connectorHandleHit.handleType === 'control-point') {
           connectorHandleIndexRef.current = connectorHandleHit.controlPointIndex ?? 0;
        } else if (connectorHandleHit.handleType === 'midpoint') {
           connectorHandleIndexRef.current = -1;
        } else {
           setMode('connector-endpoint-drag');
           connectorEndpointRef.current = connectorHandleHit.handleType === 'start-endpoint' ? 'start' : 'end';
        }
        return;
      }

      const hit = hitTestPoint(world.x, world.y, elements, viewport);

      if (hit) {
        const isAlreadySelected = selectedIds.has(hit.elementId);
        
        // Select logic
        if (e.shiftKey) {
          const newSet = new Set(selectedIds);
          if (newSet.has(hit.elementId)) {
            newSet.delete(hit.elementId);
          } else {
            newSet.add(hit.elementId);
          }
          selectElements(Array.from(newSet));
        } else if (!isAlreadySelected) {
          selectElements([hit.elementId]);
        }

        // Alt+drag leaves the original behind and drags a copy, as in
        // Excalidraw. The copy is pasted centred on the selection it came from,
        // so it starts exactly on top of the original instead of offset.
        if (e.altKey && tool === 'select') {
          const store = useCanvasStore.getState();
          const sel = Array.from(store.selectedIds)
            .map(id => store.elements[id])
            .filter(Boolean) as WhiteboardElement[];
          if (sel.length > 0) {
            const minX = Math.min(...sel.map(el => Math.min(el.x, el.x + el.width)));
            const maxX = Math.max(...sel.map(el => Math.max(el.x, el.x + el.width)));
            const minY = Math.min(...sel.map(el => Math.min(el.y, el.y + el.height)));
            const maxY = Math.max(...sel.map(el => Math.max(el.y, el.y + el.height)));
            store.copy();
            store.paste({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
          }
        }

        // Setup drag start positions (re-read: an Alt+drag just replaced the
        // selection with the freshly pasted copies).
        dragStartElementPositions.current = {};
        const liveElements = useCanvasStore.getState().elements;
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        useCanvasStore.getState().selectedIds.forEach(id => {
          const el = liveElements[id];
          if (!el) return;
          dragStartElementPositions.current[id] = { x: el.x, y: el.y };
          const b = el.bbox ?? getElementBBox(el);
          bMinX = Math.min(bMinX, b.minX); bMinY = Math.min(bMinY, b.minY);
          bMaxX = Math.max(bMaxX, b.maxX); bMaxY = Math.max(bMaxY, b.maxY);
        });
        dragStartWorldRef.current = world;
        dragStartBoundsRef.current = bMinX === Infinity
          ? null
          : { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };

        // Enter drag mode if using select tool
        if (tool === 'select') {
           setMode('dragging');
           return;
        } else if (tool === ShapeType.CONNECTOR || tool === ShapeType.ARROW || tool === ShapeType.LINE) {
           // Connectors/arrows/lines must be allowed to start on existing elements!
           // Fall through to the connector drawing logic below.
        } else {
           // We clicked an element while holding a shape tool. We just selected it, but we don't start drawing.
           return;
        }
      } else {
        // Clicked empty space
        if (tool === 'select') {
          if (!e.shiftKey) clearSelection();
          setSelectionBox({ start: world, end: world });
          setMode('selecting');
          return;
        } else {
          if (!e.shiftKey) clearSelection();
        }
      }
    }
    // ─── END UNIVERSAL CLICK-TO-SELECT ───────────────────────────────────

    // Connector / Arrow / Line drawing
    if (tool === ShapeType.CONNECTOR || tool === ShapeType.ARROW || tool === ShapeType.LINE) {
      const id = uuidv4();
      const manager = new ConnectorManager();
      const nearest = manager.findNearestAnchor(world.x, world.y, elements);
      
      const newConnector: ConnectorElement = {
        id,
        type: ShapeType.CONNECTOR,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        rotation: 0,
        locked: false,
        zIndex: Date.now(),
        style: { ...currentStyle },
        seed: Math.floor(Math.random() * 100000),
        startX: nearest ? nearest.position.x : world.x,
        startY: nearest ? nearest.position.y : world.y,
        endX: world.x,
        endY: world.y,
        startElementId: nearest ? nearest.elementId : null,
        startAnchorPoint: nearest ? nearest.anchorPoint : undefined,
        // LINE tool draws a straight connector with no arrowheads
        routingMode: tool === ShapeType.LINE ? 'straight' : 'curved',
        ...(tool === ShapeType.LINE ? { endArrowhead: null, startArrowhead: null } : {}),
      };
      
      addElement(newConnector as unknown as WhiteboardElement);
      selectElements([id]);
      currentElementRef.current = newConnector as unknown as WhiteboardElement;
      setMode('connector-draw');
      return;
    }

    // Shape drawing
    const id = uuidv4();
    const shapeType = tool as Exclude<ShapeType, ShapeType.FREEHAND | ShapeType.TEXT | ShapeType.IMAGE | ShapeType.CONNECTOR>;
    const newShape: ShapeElement = {
      id,
      type: shapeType,
      x: world.x,
      y: world.y,
      width: 0,
      height: 0,
      rotation: 0,
      locked: false,
      zIndex: Date.now(),
      style: { ...currentStyle },
      seed: Math.floor(Math.random() * 100000),
    };
    addElement(newShape as unknown as WhiteboardElement);
    selectElements([id]);
    currentElementRef.current = newShape as unknown as WhiteboardElement;
    setMode('drawing');
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const nativeEvent = e.nativeEvent;

    // Skip rejected (palm) pointers
    if (rejectedPointers.current.has(e.pointerId)) return;

    // Pinch/pan and finger scrolling are applied by the native listeners.
    if (gestureActiveRef.current) return;

    // Freehand and eraser moves belong to the native listeners.
    if ((tool === ShapeType.FREEHAND || tool === 'eraser' || tool === 'laser' || tool === 'lasso') && modeRef.current !== 'panning') {
      return;
    }

    const decision = gatePointerEvent(nativeEvent, inputMode.mode, inputMode.isTouchDevice, tool);
    if (decision === 'block-touch' || decision === 'block-pen') return;

    const screen: Point = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(e.clientX, e.clientY);
    const dx = screen.x - lastPointerPos.current.x;
    const dy = screen.y - lastPointerPos.current.y;

    if (modeRef.current === 'idle' || modeRef.current === 'resizing') {
      const hoverHit = hitTestConnectorHandles(world.x, world.y, elements, Array.from(selectedIds), viewport.zoom);

      // Highlight whatever the select tool would pick up, so it is obvious what
      // a click is about to grab — Excalidraw outlines the element under the
      // cursor rather than leaving you to guess.
      let hoveredId: string | null = null;
      if (tool === 'select' && modeRef.current === 'idle' && !hoverHit) {
        hoveredId = hitTestPoint(world.x, world.y, elements, viewport)?.elementId ?? null;
      }
      if (hoveredElementRef.current !== hoveredId) {
        hoveredElementRef.current = hoveredId;
        dirtyRef.current = true;
      }

      if (containerRef.current) {
        if (hoverHit) {
          containerRef.current.style.cursor = hoverHit.handleType === 'midpoint' ? 'grab' : 'crosshair';
        } else if (tool === 'select') {
          containerRef.current.style.cursor = hoveredId ? 'move' : 'default';
        } else {
          containerRef.current.style.cursor = ''; // Let React handle it
        }
      }
    }

    switch (modeRef.current) {
      case 'panning': {
        const vp = useCanvasStore.getState().viewport;
        useCanvasStore.getState().updateViewport({ x: vp.x + dx, y: vp.y + dy });
        break;
      }

      case 'selecting': {
        if (selectionBox) {
          setSelectionBox(prev => prev ? { ...prev, end: world } : null);
          // Excalidraw-style rubber-band:
          // Left→Right drag = contain mode (element fully inside)
          // Right→Left drag = crossing mode (element just needs to intersect)
          const inBox = getElementsInSelectionBox(elements, selectionBox.start, world);
          if (inBox.length > 0) selectElements(inBox);
          else if (!selectionBox.start || Math.hypot(world.x - selectionBox.start.x, world.y - selectionBox.start.y) > 4 / viewport.zoom) clearSelection();
        }
        break;
      }

      case 'dragging': {
        const start = dragStartWorldRef.current;
        const startBounds = dragStartBoundsRef.current;
        const movedIds = Object.keys(dragStartElementPositions.current);
        if (!start || !startBounds) break;

        // Absolute offset from the drag origin rather than a per-move delta:
        // the incremental version accumulated rounding drift, and snapping
        // needs a proposed position it can correct rather than nudge.
        let dx = world.x - start.x;
        let dy = world.y - start.y;

        // Shift locks the drag to whichever axis you have moved furthest along.
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
        }

        const snapSettings = useUIStore.getState().snap;
        const gridSettings = useUIStore.getState().grid;
        let guides: SmartGuide[] = [];

        if (snapSettings.enabled && !e.ctrlKey && !e.metaKey) {
          const freshElements = useCanvasStore.getState().elements;
          const moving = new Set(movedIds);
          const others = Object.values(freshElements).filter((el) => !moving.has(el.id));
          const proposed = {
            minX: startBounds.minX + dx, minY: startBounds.minY + dy,
            maxX: startBounds.maxX + dx, maxY: startBounds.maxY + dy,
          };
          const snap = computeSnap(proposed, others, viewport.zoom, {
            snapToObjects: snapSettings.snapToObjects,
            snapToGrid: snapSettings.snapToGrid && gridSettings.enabled,
            gridSize: gridSettings.size,
            snapDistance: snapSettings.snapDistance,
          });
          dx += snap.dx;
          dy += snap.dy;
          if (snapSettings.showGuides) guides = snap.guides;
        }

        activeGuidesRef.current = guides;

        movedIds.forEach((id) => {
          const from = dragStartElementPositions.current[id];
          if (from) updateElement(id, { x: from.x + dx, y: from.y + dy });
        });
        // Trigger connector updates for all moved elements at once
        useCanvasStore.getState().updateAttachedConnectors(movedIds, useCanvasStore.getState().getElementsMap());
        break;
      }

      case 'resizing': {
        const elId = resizeElementIdRef.current;
        const handle = resizeHandleRef.current;
        if (!elId || !handle) break;

        // Incremental world-space delta
        const prevWorld = screenToWorld(lastPointerPos.current.x, lastPointerPos.current.y);
        const wdx = world.x - prevWorld.x;
        const wdy = world.y - prevWorld.y;

        if (elId === 'group') {
          const gb = activeGroupBounds.current;
          const startGb = resizeGroupStartBounds.current;
          if (!gb || !startGb) break;

          const preserveRatio = e.shiftKey;
          const newGb = calcResizedBounds(handle, gb.x, gb.y, gb.width, gb.height, wdx, wdy, preserveRatio);
          activeGroupBounds.current = newGb;

          const scaleX = startGb.width === 0 ? 1 : newGb.width / startGb.width;
          const scaleY = startGb.height === 0 ? 1 : newGb.height / startGb.height;

          const movedIds: string[] = [];
          Object.entries(resizeElementStartBoundsRef.current).forEach(([id, startEl]) => {
            const newX = newGb.x + (startEl.x - startGb.x) * scaleX;
            const newY = newGb.y + (startEl.y - startGb.y) * scaleY;
            const newW = startEl.width * scaleX;
            const newH = startEl.height * scaleY;
            const updates: Partial<WhiteboardElement> & { fontSize?: number; controlPoints?: { x: number; y: number }[] } = { x: newX, y: newY, width: newW, height: newH };
            
            if (startEl.type === ShapeType.TEXT && startEl.height > 0) {
              const scaleFactor = newH / startEl.height;
              const startFontSize = startEl.fontSize ?? 16;
              updates.fontSize = Math.max(8, Math.round(startFontSize * scaleFactor));
            }

            if (startEl.type === ShapeType.CONNECTOR && startEl.controlPoints) {
              updates.controlPoints = startEl.controlPoints.map((cp: Point) => ({
                x: newGb.x + (cp.x - startGb.x) * scaleX,
                y: newGb.y + (cp.y - startGb.y) * scaleY,
              }));
            }
            updateElement(id, updates);
            movedIds.push(id);
          });

          useCanvasStore.getState().updateAttachedConnectors(movedIds, useCanvasStore.getState().getElementsMap());
          break;
        }

        const el = useCanvasStore.getState().elements[elId];
        if (!el) break;

        const preserveRatio = e.shiftKey || (el.type === ShapeType.IMAGE && (el as ImageElement).lockAspectRatio) || el.type === ShapeType.ICON;
        const newBounds = calcResizedBounds(handle, el.x, el.y, el.width, el.height, wdx, wdy, preserveRatio);

        if (el.type === ShapeType.TEXT) {
          const start = resizeStartBounds.current;
          const startHeight = start?.height || el.height;
          const startFontSize = start?.fontSize ?? (el as TextElement).fontSize ?? 16;
          if (startHeight > 0) {
            const scaleFactor = newBounds.height / startHeight;
            const newFontSize = Math.max(8, Math.round(startFontSize * scaleFactor));
            updateElement(elId, { ...newBounds, fontSize: newFontSize });
            break;
          }
        }

        if (el.type === ShapeType.TEXT && resizeStartBounds.current?.fontSize !== undefined) {
  const start = resizeStartBounds.current;
  const scaleFactor = newBounds.height / start.height;
  const newFontSize = Math.max(8, Math.round((start.fontSize ?? 16) * scaleFactor));
  updateElement(elId, { ...newBounds, fontSize: newFontSize });
} else {
  updateElement(elId, newBounds);
}
        break;
      }


      case 'rotating': {
        const elId = rotateElementIdRef.current;
        if (!elId) break;
        const cx = rotateCenter.current.x;
        const cy = rotateCenter.current.y;
        const angle = Math.atan2(world.y - cy, world.x - cx);
        let rotation = angle - rotateStartAngle.current;
        // Snap to 15° increments if shift
        if (e.shiftKey) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
        updateElement(elId, { rotation });
        break;
      }

      case 'freehand': {
        // Freehand move is handled by native event listeners (handleNativeFreehandMove)
        // which process coalesced sub-frame points for smooth fast strokes.
        // This React handler is intentionally empty — native takes precedence.
        break;
      }

      case 'drawing': {
        if (!currentElementRef.current) break;
        const el = currentElementRef.current;
        let width = world.x - el.x;
        let height = world.y - el.y;
        if (e.shiftKey) {
          const max = Math.max(Math.abs(width), Math.abs(height));
          width = width < 0 ? -max : max;
          height = height < 0 ? -max : max;
        }
        updateElement(el.id, { width, height });
        currentElementRef.current = { ...el, width, height };
        break;
      }

      case 'connector-draw': {
        if (!currentElementRef.current) break;
        const el = currentElementRef.current as ConnectorElement;
        const manager = new ConnectorManager();
        const nearest = manager.findNearestAnchor(world.x, world.y, useCanvasStore.getState().elements, el.startElementId || undefined);
        useCanvasStore.getState().setHoveredBindTarget(nearest ? nearest.elementId : null);
        
        const updates: Partial<ConnectorElement> = {
          endX: nearest ? nearest.position.x : world.x,
          endY: nearest ? nearest.position.y : world.y,
          endElementId: nearest ? nearest.elementId : null,
          endAnchorPoint: nearest ? nearest.anchorPoint : undefined,
        };

        const tempConn = { ...el, ...updates } as ConnectorElement;
        manager.computeConnectorPath(tempConn, useCanvasStore.getState().getElementsMap());
        updates.controlPoints = tempConn.controlPoints;

        updateElement(el.id, updates);
        currentElementRef.current = tempConn as unknown as WhiteboardElement;
        break;
      }

      case 'connector-endpoint-drag': {
        const elId = resizeElementIdRef.current;
        const endpoint = connectorEndpointRef.current;
        if (!elId || !endpoint) break;
        
        const store = useCanvasStore.getState();
        const connector = store.getElement(elId) as ConnectorElement;
        if (!connector) break;

        const manager = new ConnectorManager();
        const excludeId = endpoint === 'end' ? connector.startElementId ?? undefined : connector.endElementId ?? undefined;
        const anchorHit = manager.findNearestAnchor(world.x, world.y, store.elements, excludeId);

        store.setHoveredBindTarget(anchorHit?.elementId ?? null);

        const updates: Partial<ConnectorElement> = {
          isManuallyRouted: false,
        };
        
        if (endpoint === 'end') {
          updates.endX = anchorHit ? anchorHit.position.x : world.x;
          updates.endY = anchorHit ? anchorHit.position.y : world.y;
          updates.endElementId = anchorHit?.elementId ?? null;
          updates.endAnchorPoint = anchorHit?.anchorPoint ?? undefined;
        } else {
          updates.startX = anchorHit ? anchorHit.position.x : world.x;
          updates.startY = anchorHit ? anchorHit.position.y : world.y;
          updates.startElementId = anchorHit?.elementId ?? null;
          updates.startAnchorPoint = anchorHit?.anchorPoint ?? undefined;
        }

        const tempConn = { ...connector, ...updates } as ConnectorElement;
        const path = manager.computeConnectorPath(tempConn, store.getElementsMap());
        updates.controlPoints = path.controlPoints;

        updateElement(elId, updates);
        break;
      }

      case 'connector-reshaping': {
        const elId = resizeElementIdRef.current;
        const hIdx = connectorHandleIndexRef.current;
        if (!elId || hIdx === null) break;
        
        const el = useCanvasStore.getState().elements[elId] as ConnectorElement;
        if (!el) break;
        
        const manager = new ConnectorManager();
        let newCp = el.controlPoints ? [...el.controlPoints] : [];
        
        if (hIdx === -1) {
            const resolved = manager.resolveConnectorEndpoints(el, useCanvasStore.getState().getElementsMap());
            const { startX, startY, endX, endY } = resolved;
            
            // Re-import to avoid conflict? It's exported from connectors.ts
            // But I didn't import reshapeConnectorFromMidpoint in Canvas.tsx! 
            // Wait, connectorManager can just expose it or I can import it.
            // Wait, we can just do the math inline here or import it.
            // Oh, I can just do the math inline:
            const cpX = (4 * world.x - startX - endX) / 2;
            const cpY = (4 * world.y - startY - endY) / 2;
            const tangentX = (endX - startX) * 0.1;
            const tangentY = (endY - startY) * 0.1;
            
            newCp = [
              { x: cpX - tangentX, y: cpY - tangentY },
              { x: cpX + tangentX, y: cpY + tangentY }
            ];
        } else {
            const wdx = world.x - lastPointerWorldPos.current!.x;
            const wdy = world.y - lastPointerWorldPos.current!.y;
            
            if (newCp.length === 0) {
              const path = manager.computeConnectorPath(el, useCanvasStore.getState().getElementsMap());
              if (path.controlPoints && path.controlPoints.length >= 2) {
                newCp = [...path.controlPoints];
              } else {
                const resolved = manager.resolveConnectorEndpoints(el, useCanvasStore.getState().getElementsMap());
                const { startX, startY, endX, endY } = resolved;
                newCp = [
                  { x: startX + (endX - startX) / 3, y: startY + (endY - startY) / 3 },
                  { x: startX + 2 * (endX - startX) / 3, y: startY + 2 * (endY - startY) / 3 }
                ];
              }
            }

            if (hIdx === 0 && newCp[0]) {
               newCp[0].x += wdx; newCp[0].y += wdy;
            } else if (hIdx === 1 && newCp[1]) {
               newCp[1].x += wdx; newCp[1].y += wdy;
            }
        }
        
        updateElement(elId, { 
          controlPoints: newCp, 
          isManuallyRouted: true,
          routingMode: (!el.routingMode || el.routingMode === 'straight') ? 'curved' : el.routingMode
        });
        break;
      }

      // 'erasing' is driven entirely by the native listeners above, which get
      // the coalesced sub-frame samples React's synthetic events discard.

      default:
        break;
    }

    lastPointerPos.current = screen;
    lastPointerWorldPos.current = world;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handlePointerUp = (e: React.PointerEvent) => {
    // Touch lifecycle (including gesture teardown) is owned by the native
    // listeners; a non-touch pointer never enters them, so clean up here.
    if (e.nativeEvent.pointerType !== 'touch') {
      rejectedPointers.current.delete(e.pointerId);
      gestureHandler.onPointerUp(e.nativeEvent);
    } else if (gestureActiveRef.current) {
      return;
    }

    if ((tool === ShapeType.FREEHAND || tool === 'eraser' || tool === 'laser' || tool === 'lasso') && modeRef.current !== 'panning') {
      return;
    }

    const decision = gatePointerEvent(e.nativeEvent, inputMode.mode, inputMode.isTouchDevice, tool);
    if (decision === 'block-touch' || decision === 'block-pen') return;

    const prevMode = modeRef.current;

    if (prevMode === 'selecting') {
      setSelectionBox(null);
    }
    
    if (prevMode === 'drawing' || prevMode === 'freehand') {
      const el = currentElementRef.current;
      // Remove zero-size elements (just a click) — shape drawing only
      if (el && Math.abs(el.width) < 2 && Math.abs(el.height) < 2 && el.type !== ShapeType.FREEHAND) {
        deleteElements([el.id]);
        clearSelection();
      }
      // Freehand completion is handled by native listeners (finalizeActiveStroke).
      // If we arrive here with an active stroke still open, finalize it as a safety fallback.
      if (prevMode === 'freehand' && activeStrokeRef.current) {
        finalizeActiveStroke('pointer-up');
        return; // finalizeActiveStroke handles mode reset
      }
      currentElementRef.current = null;
    }

    if (prevMode === 'connector-draw') {
      useCanvasStore.getState().setHoveredBindTarget(null);
      const el = currentElementRef.current as ConnectorElement;
      if (el && Math.hypot(el.endX - el.startX, el.endY - el.startY) < 5) {
        deleteElements([el.id]);
        clearSelection();
      }
      saveSnapshot();
      currentElementRef.current = null;
      resizeElementIdRef.current = null;
      connectorHandleIndexRef.current = null;
    } else if (prevMode === 'connector-reshaping') {
      saveSnapshot();
      currentElementRef.current = null;
      resizeElementIdRef.current = null;
      connectorHandleIndexRef.current = null;
    } else if (prevMode === 'connector-endpoint-drag') {
      const store = useCanvasStore.getState();
      const elId = resizeElementIdRef.current;
      const endpoint = connectorEndpointRef.current;
      
      if (elId && endpoint) {
        const connector = store.getElement(elId) as ConnectorElement;
        if (connector) {
          const manager = new ConnectorManager();
          const excludeId = endpoint === 'end' ? connector.startElementId ?? undefined : connector.endElementId ?? undefined;
          const worldPos = lastPointerWorldPos.current!;
          const anchorHit = manager.findNearestAnchor(worldPos.x, worldPos.y, store.elements, excludeId);
          
          const updates: Partial<ConnectorElement> = {};
          if (endpoint === 'end') {
            updates.endX = anchorHit ? anchorHit.position.x : worldPos.x;
            updates.endY = anchorHit ? anchorHit.position.y : worldPos.y;
            updates.endElementId = anchorHit?.elementId ?? null;
            updates.endAnchorPoint = anchorHit?.anchorPoint ?? undefined;
          } else {
            updates.startX = anchorHit ? anchorHit.position.x : worldPos.x;
            updates.startY = anchorHit ? anchorHit.position.y : worldPos.y;
            updates.startElementId = anchorHit?.elementId ?? null;
            updates.startAnchorPoint = anchorHit?.anchorPoint ?? undefined;
          }
          store.updateElement(elId, updates);
        }
      }
      
      store.setHoveredBindTarget(null);
      saveSnapshot();
      resizeElementIdRef.current = null;
      connectorEndpointRef.current = null;
    }

    // A press and release on an open note, with no drag in between, means
    // "write in it" — no second click needed.
    const stickyClick = stickyClickRef.current;
    stickyClickRef.current = null;
    if (stickyClick) {
      const moved = Math.hypot(e.clientX - stickyClick.x, e.clientY - stickyClick.y);
      if (moved < 4) {
        const note = useCanvasStore.getState().elements[stickyClick.id];
        if (note?.type === ShapeType.STICKY) {
          selectElements([note.id]);
          openTextEditor(note as StickyElement);
          setMode('idle');
          setIsInteracting(false);
          return;
        }
      }
    }

    if (prevMode === 'dragging') {
      // Save snapshot after move
      saveSnapshot();
      dragStartElementPositions.current = {};
      dragStartWorldRef.current = null;
      dragStartBoundsRef.current = null;
      activeGuidesRef.current = [];
    }

    if (prevMode === 'resizing' || prevMode === 'rotating') {
      saveSnapshot();
      resizeHandleRef.current = null;
      resizeStartBounds.current = null;
      resizeGroupStartBounds.current = null;
      activeGroupBounds.current = null;
      resizeElementStartBoundsRef.current = {};
      resizeElementIdRef.current = null;
      rotateElementIdRef.current = null;
    }

    setMode('idle');
    setIsInteracting(false);
  };

  // ── Wheel / Zoom handling ────────────────────────────────────────────────
  // Keep a ref so the non-passive callbacks always see the latest viewport
  // without needing to be recreated on every render.
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // 1. GLOBAL guard: block browser page-zoom everywhere on the page.
  //    Without this, the browser zooms the entire page (sidebar, panels, etc.)
  useEffect(() => {
    const blockBrowserZoom = (e: WheelEvent) => {
      // Block Ctrl+scroll (browser zoom) and also plain scroll when over canvas
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    // Must be { passive: false } — passive listeners cannot call preventDefault()
    document.addEventListener('wheel', blockBrowserZoom, { passive: false });
    return () => document.removeEventListener('wheel', blockBrowserZoom);
  }, []);

  // 2. CANVAS-level handler: translates wheel events into viewport pan / zoom.
  //    Plain scroll = zoom (smooth, around cursor). Shift+scroll = pan.
  //    Ctrl+scroll / pinch = also zoom (trackpad). This keeps selection stable.
  const handleWheelNative = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const vp = useCanvasStore.getState().viewport;

    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift+scroll → horizontal pan
      updateViewport({ x: vp.x - e.deltaY, y: vp.y - e.deltaX });
    } else {
      // Default scroll / Ctrl+scroll / pinch → smooth zoom around cursor
      // Use a sensitivity that works well for both mice and trackpads.
      // Ctrl+scroll (trackpad pinch) sends small deltaY, plain mouse scroll
      // sends larger deltaY (typically ±100). Normalise both cases.
      const isTrackpadPinch = e.ctrlKey || e.metaKey;
      // Trackpads send smaller deltaY continuously, mice send large jumps (e.g. 100-120 per notch)
      const sensitivity = isTrackpadPinch ? 300 : 1000;
      const zoomFactor = Math.exp(-e.deltaY / sensitivity);
      const newZoom = Math.max(0.05, Math.min(vp.zoom * zoomFactor, 10));
      const scale = newZoom / vp.zoom;
      const newX = e.clientX - (e.clientX - vp.x) * scale;
      const newY = e.clientY - (e.clientY - vp.y) * scale;
      updateViewport({ zoom: newZoom, x: newX, y: newY });
    }
  }, [updateViewport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, [handleWheelNative]);
  // ─────────────────────────────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestPoint(world.x, world.y, elements, viewport);

    // Right-clicking an unselected element selects it first, so the menu always
    // acts on what you pointed at. Right-clicking inside an existing selection
    // leaves that selection alone.
    if (hit) {
      if (!selectedIds.has(hit.elementId)) selectElements([hit.elementId]);
    } else {
      clearSelection();
    }

    setContextMenu({ x: e.clientX, y: e.clientY, elementId: hit?.elementId ?? null });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (tool === 'select') {
      const world = screenToWorld(e.clientX, e.clientY);
      const selectedArray = getSelectedElements();
      
      if (selectedArray.length === 1 && selectedArray[0].type === ShapeType.CONNECTOR) {
         const conn = selectedArray[0] as ConnectorElement;
         const handleHit = hitTestConnectorHandles(world.x, world.y, elements, [conn.id], viewport.zoom);

         // Double-clicking the midpoint resets a manual reshape — but only if
         // there is a reshape to undo. The midpoint handle sits exactly where
         // you double-click to label an arrow, so on an ordinary connector this
         // branch was swallowing the gesture and no label could ever be added.
         if (handleHit?.handleType === 'midpoint' && conn.isManuallyRouted) {
             useCanvasStore.getState().setActiveHandle(null);
             updateElement(conn.id, { isManuallyRouted: false, controlPoints: undefined, routingMode: 'curved' });
             return;
         }
      }

      const hit = hitTestPoint(world.x, world.y, elements, viewport);
      if (hit) {
        const el = elements[hit.elementId]!;

        if (el.type === ShapeType.TEXT) {
          selectElements([el.id]);
          openTextEditor(el as TextElement);
          return;
        }

        // An arrow/connector carries its label on the line itself, not as a
        // separate bound element — double-click writes in the middle of it.
        if (el.type === ShapeType.CONNECTOR) {
          selectElements([el.id]);
          openTextEditor(el as ConnectorElement);
          return;
        }

        if (el.type === ShapeType.STICKY) {
          const note = el as StickyElement;
          // Double-clicking a collapsed note opens it rather than editing text
          // you cannot see.
          if (note.collapsed) {
            useCanvasStore.getState().toggleStickyCollapsed(note.id);
            return;
          }
          selectElements([note.id]);
          openTextEditor(note);
          return;
        }

        // Double-clicking any other shape edits its label, creating one on
        // first use — Excalidraw's bound-text behaviour.
        if (el.type !== ShapeType.IMAGE && el.type !== ShapeType.ICON) {
          const existing = Object.values(elements).find(
            (e) => e.type === ShapeType.TEXT && (e as TextElement).containerId === el.id
          ) as TextElement | undefined;

          if (existing) {
            openTextEditor(existing);
            return;
          }

          const label: TextElement = {
            id: uuidv4(),
            type: ShapeType.TEXT,
            x: el.x,
            y: el.y,
            width: Math.abs(el.width),
            height: 0,
            rotation: 0,
            locked: false,
            zIndex: el.zIndex + 0.5,
            style: { ...currentStyle },
            text: '',
            fontSize: 60,
            fontFamily: FONT_FAMILIES[0].value,
            color: currentStyle.stroke,
            textAlign: 'center',
            containerId: el.id,
          };
          addElement(label);
          openTextEditor(label);
          return;
        }
      }

      // Empty space: double-click starts a new text element, as Excalidraw does.
      const id = uuidv4();
      const newText: TextElement = {
        id,
        type: ShapeType.TEXT,
        x: world.x,
        y: world.y,
        width: 0,
        height: 60 * 1.4,
        rotation: 0,
        locked: false,
        zIndex: Date.now(),
        style: { ...currentStyle },
        text: '',
        fontSize: 60,
        fontFamily: FONT_FAMILIES[0].value,
        color: currentStyle.stroke,
        textAlign: 'left',
      };
      addElement(newText);
      selectElements([id]);
      openTextEditor(newText);
    }
  };

  // --- Text editing helpers ---
  const openTextEditor = (
    el: TextElement | ConnectorElement | StickyElement,
    /** False re-lays-out an already-open editor without touching the caret. */
    takeFocus = true
  ) => {
    setTextEditingId(el.id);
    setMode('text-editing');

    let screenX: number, screenY: number, screenW: number, screenH: number;
    let fontSize: number, fontFamily: string, color: string, text: string;
    // Defaults match the plain text renderer; each branch overrides as needed.
    let lineHeight = 1.4;
    let textAlign: 'left' | 'center' | 'right' = 'left';

    if (el.type === ShapeType.TEXT) {
      // A bound label is edited over its container, where it is drawn.
      const container = el.containerId ? elements[el.containerId] : undefined;
      const box = container
        ? {
            x: Math.min(container.x, container.x + container.width),
            y: Math.min(container.y, container.y + container.height),
            w: Math.abs(container.width),
            h: Math.abs(container.height),
          }
        : { x: el.x, y: el.y, w: el.width, h: el.height };

      screenX = box.x * viewport.zoom + viewport.x;
      screenY = box.y * viewport.zoom + viewport.y;
      screenW = Math.max(box.w * viewport.zoom, 100);
      screenH = Math.max(box.h * viewport.zoom, 40);
      fontSize = el.fontSize || 18;
      fontFamily = el.fontFamily || FONT_FAMILIES[0].value;
      color = el.color || el.style.stroke;
      text = el.text;
      textAlign = container ? 'center' : (el.textAlign ?? 'left');
    } else if (el.type === ShapeType.STICKY) {
      // Edit in place, inside the paper, with the note's own padding.
      const pad = 12;
      screenX = (el.x + pad) * viewport.zoom + viewport.x;
      screenY = (el.y + pad) * viewport.zoom + viewport.y;
      screenW = (Math.abs(el.width) - pad * 2) * viewport.zoom;
      screenH = (Math.abs(el.height) - pad * 2) * viewport.zoom;
      fontSize = el.fontSize || 16;
      fontFamily = el.fontFamily;
      color = STICKY_INK;
      text = el.text;
      lineHeight = 1.35;   // matches LINE_RATIO in sticky.ts
    } else if (el.type === ShapeType.CONNECTOR) {
      const manager = new ConnectorManager();
      const resolved = manager.resolveConnectorEndpoints(el, useCanvasStore.getState().getElementsMap());
      const mid = manager.getPointOnCurve(0.5, resolved.startX, resolved.startY, resolved.endX, resolved.endY, el.controlPoints);

      fontSize = el.labelFontSize || 16;
      fontFamily = 'Inter, sans-serif';
      lineHeight = 1.25;   // matches the connector label renderer
      textAlign = 'center';
      color = el.style.stroke;
      text = el.label || '';

      // Sized to the text and centred on the line, rather than a fixed 100×40
      // box hung off the midpoint — that box was the rectangle you could see,
      // and it wrapped short labels onto two lines.
      const lines = (text || ' ').split('\n');
      const widest = Math.max(
        40,
        ...lines.map((l) => measureLine(l || ' ', fontSize, fontFamily))
      );
      const blockH = lines.length * fontSize * lineHeight;
      screenW = (widest + 12) * viewport.zoom;
      screenH = blockH * viewport.zoom;
      screenX = mid.x * viewport.zoom + viewport.x - screenW / 2;
      screenY = mid.y * viewport.zoom + viewport.y - screenH / 2;
    } else {
      return;
    }

    // The editor has to be invisible furniture sitting exactly where the text
    // is drawn: same font, size, colour, line height and origin, no border, no
    // padding of its own. Anything else and the text appears to jump when you
    // start and stop editing.
    setTextEditorStyle({
      position: 'fixed',
      left: screenX,
      top: screenY,
      width: screenW,
      height: screenH,
      fontSize: fontSize * viewport.zoom,
      fontFamily,
      color,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      resize: 'none',
      padding: 0,
      margin: 0,
      overflow: 'hidden',
      zIndex: 9999,
      lineHeight,
      textAlign,
      whiteSpace: 'pre-wrap',
      // Caret only — the selection highlight would otherwise be the only thing
      // separating the editor from the drawing.
      caretColor: color,
    });

    if (!takeFocus) return;

    setTimeout(() => {
      const ta = textAreaRef.current;
      if (!ta) return;
      ta.value = text;
      ta.focus();
      // Caret at the end, not select-all: selecting the existing text meant the
      // first character typed replaced the whole note instead of adding to it.
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    }, 10);
  };

  /**
   * Push each keystroke onto the element so the drawing keeps up with the
   * editor: an arrow's gap opens as the label grows, and a note reflows as you
   * type. Writes bypass history — one undo step is added on commit.
   */
  const handleTextEditorInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!textEditingId) return;
    const value = e.target.value;
    const el = useCanvasStore.getState().elements[textEditingId];
    if (!el) return;

    if (el.type === ShapeType.CONNECTOR) {
      updateElement(textEditingId, { label: value });
      // The gap is measured from the label, so the editor has to keep pace as
      // the text grows. Re-laid out without stealing the caret.
      const fresh = useCanvasStore.getState().elements[textEditingId];
      if (fresh) openTextEditor(fresh as ConnectorElement, false);
    } else if (el.type === ShapeType.STICKY) {
      updateElement(textEditingId, { text: value });
    }
  };

  const commitTextEdit = () => {
    if (!textEditingId || !textAreaRef.current) return;
    const textValue = textAreaRef.current.value;
    const el = elements[textEditingId];
    if (!el) {
      setTextEditingId(null);
      return;
    }

    if (el.type === ShapeType.CONNECTOR) {
      updateElement(textEditingId, { label: textValue });
      saveSnapshot();
    } else if (el.type === ShapeType.STICKY) {
      // An empty note is still a note — it keeps its place on the board.
      updateElement(textEditingId, { text: textValue });
      saveSnapshot();
    } else if (textValue.trim() === '') {
      deleteElements([textEditingId]);
    } else {
      const textEl = el as TextElement;
      const container = textEl.containerId ? elements[textEl.containerId] : undefined;
      // Size from the actual glyphs. The old `text.length * 10` guess left the
      // selection box and hit area disagreeing with what was drawn.
      const { width, height } = layoutText({ ...textEl, text: textValue }, container);
      updateElement(textEditingId, {
        text: textValue,
        width: container ? Math.abs(container.width) : width,
        height,
      });
      saveSnapshot();
    }
    setTextEditingId(null);
    setMode('idle');
    setTool('select');
  };

  // --- Resize handle hit detection (for SelectionBox element) ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getHandleAtPoint = (world: Point, el: WhiteboardElement, zoom: number): ResizeHandle | null => {
    const padding = 10 / zoom;
    const handleRadius = 8 / zoom;
    const minX = el.x - padding;
    const minY = el.y - padding;
    const maxX = el.x + el.width + padding;
    const maxY = el.y + el.height + padding;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const rotateY = minY - 30 / zoom;

    const handles: [ResizeHandle, Point][] = [
      [ResizeHandle.NW, { x: minX, y: minY }],
      [ResizeHandle.N, { x: midX, y: minY }],
      [ResizeHandle.NE, { x: maxX, y: minY }],
      [ResizeHandle.E, { x: maxX, y: midY }],
      [ResizeHandle.SE, { x: maxX, y: maxY }],
      [ResizeHandle.S, { x: midX, y: maxY }],
      [ResizeHandle.SW, { x: minX, y: maxY }],
      [ResizeHandle.W, { x: minX, y: midY }],
      [ResizeHandle.ROTATION, { x: midX, y: rotateY }],
    ];

    for (const [h, pos] of handles) {
      const dist = Math.hypot(world.x - pos.x, world.y - pos.y);
      if (dist < handleRadius) return h;
    }
    return null;
  };

  // Compute selection box data for the DOM overlay
  let activeSelectionBox = null as {
    box: { minX: number; minY: number; maxX: number; maxY: number };
    rotation: number;
    isMultiple: boolean;
  } | null;

  // The lasso is a selection tool, so it must show the selection it made.
  // Gating this on 'select' alone meant a lasso selected the elements — the
  // status bar even said so — while nothing appeared on the canvas and there
  // were no handles to drag, which reads as the tool doing nothing at all.
  const showsSelection = tool === 'select' || tool === 'lasso';

  if (selectedIds.size > 0 && showsSelection && modeRef.current !== 'text-editing') {
    const selectedArray = Array.from(selectedIds).map(id => elements[id]).filter(Boolean) as WhiteboardElement[];
    if (selectedArray.length === 1) {
      const el = selectedArray[0]!;
      if (el.type !== ShapeType.CONNECTOR) {
        activeSelectionBox = {
          box: { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height },
          rotation: el.rotation || 0,
          isMultiple: false,
        };
      }
    } else if (selectedArray.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      selectedArray.forEach(el => {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + el.width);
        maxY = Math.max(maxY, el.y + el.height);
      });
      activeSelectionBox = { box: { minX, minY, maxX, maxY }, rotation: 0, isMultiple: true };
    }
  }

  // Cursor
  const getCursor = () => {
    if (tool === 'hand' || mode === 'panning') return 'grabbing';
    if (tool === 'laser' || tool === 'lasso') return 'crosshair';
    if (tool === 'eraser') return 'none'; // we draw a custom cursor
    if (tool === 'text') return 'text';
    if (mode === 'dragging') return 'move';
    if (mode === 'resizing') return 'nwse-resize';
    if (mode === 'rotating') return 'grabbing';
    if (tool === ShapeType.IMAGE) return 'crosshair';
    // The select tool is a pointer, not a crosshair — a crosshair reads as
    // "about to draw", which is the one thing select does not do.
    if (tool === 'select') return 'default';
    return 'crosshair';
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const world = lastPointerWorldPos.current || { x: 0, y: 0 };
      const imageHandler = new ImageHandler();
      try {
        const element = await imageHandler.handleImageDrop(file, world.x, world.y);
        addElement(element);
        selectElements([element.id]);
      } catch (err) {
        console.error('Failed to load image', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file && file.type.indexOf('image') !== -1) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
          const imageHandler = new ImageHandler();
          try {
            const element = await imageHandler.handleImageDrop(file, world.x, world.y);
            addElement(element);
            selectElements([element.id]);
          } catch (err) {
            console.error('Failed to load dropped image', err);
          }
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-background touch-none"
      style={{ cursor: getCursor(), overflow: 'hidden' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      // Tells iPadOS this region is not a text input area — disables Scribble
      inputMode="none"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-canvas-container
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        hidden 
        accept=".png,.jpg,.jpeg,.gif,.webp,.svg" 
        onChange={handleImageFileSelect} 
      />
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className="absolute inset-0"
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          // Inherit, don't override: the canvas covers the whole container, so
          // a hardcoded crosshair here meant the select/move/hand cursors the
          // container sets were never actually visible.
          cursor: 'inherit',
        }}
      />

      {/* Live stroke layer — repainted alone while the pen is down.
          pointer-events: none so every event still lands on the canvas above. */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'none', touchAction: 'none' }}
      />

      {/* Selection box overlay */}
      {activeSelectionBox && (
        <SelectionBox
          box={activeSelectionBox.box}
          viewport={viewport}
          rotation={activeSelectionBox.rotation}
          isMultiple={activeSelectionBox.isMultiple}
          onResizeStart={(e, handle) => {
            e.stopPropagation();
            // Capture pointer on the container so move/up events keep firing
            // even if the pointer leaves the window during a drag.
            containerRef.current?.setPointerCapture(e.pointerId);
            const selectedArray = getSelectedElements();
            if (selectedArray.length === 0) return;
            resizeHandleRef.current = handle;
            
            if (selectedArray.length === 1) {
              const el = selectedArray[0]!;
              resizeStartBounds.current = { x: el.x, y: el.y, width: el.width, height: el.height, fontSize: el.type === ShapeType.TEXT ? (el as TextElement).fontSize : undefined };
              resizeElementIdRef.current = el.id;
            } else {
              resizeElementIdRef.current = 'group';
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              const startBounds: Record<string, { x: number; y: number; width: number; height: number; type: string; fontSize?: number; controlPoints?: { x: number; y: number }[] }> = {};
              selectedArray.forEach(el => {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                maxX = Math.max(maxX, el.x + el.width);
                maxY = Math.max(maxY, el.y + el.height);
                startBounds[el.id] = { 
                  x: el.x, 
                  y: el.y, 
                  width: el.width, 
                  height: el.height, 
                  type: el.type, 
                  fontSize: el.type === ShapeType.TEXT ? (el as TextElement).fontSize : undefined,
                  controlPoints: el.type === ShapeType.CONNECTOR ? (el as ConnectorElement).controlPoints : undefined 
                };
              });
              const gb = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
              resizeGroupStartBounds.current = gb;
              activeGroupBounds.current = { ...gb };
              resizeElementStartBoundsRef.current = startBounds;
            }
            
            lastPointerPos.current = { x: e.clientX, y: e.clientY };
            setMode('resizing');
          }}
          onRotateStart={(e) => {
            e.stopPropagation();
            // Capture pointer on the container so move/up events keep firing
            containerRef.current?.setPointerCapture(e.pointerId);
            const world = screenToWorld(e.clientX, e.clientY);
            const el = getSelectedElements()[0];
            if (!el) return;
            const cx = el.x + el.width / 2;
            const cy = el.y + el.height / 2;
            rotateCenter.current = { x: cx, y: cy };
            rotateStartAngle.current = Math.atan2(world.y - cy, world.x - cx) - (el.rotation || 0);
            rotateElementIdRef.current = el.id;
            lastPointerPos.current = { x: e.clientX, y: e.clientY };
            setMode('rotating');
          }}
        />
      )}

      <PenCursor 
        canvasRef={canvasRef} 
        activeTool={tool} 
        color={currentStyle.stroke} 
        strokeSize={currentStyle.strokeWidth} 
      />

      <IconPicker />

      {/* Inline text editor */}
      {textEditingId && (
        <textarea
          ref={textAreaRef}
          style={textEditorStyle}
          onBlur={commitTextEdit}
          onChange={handleTextEditorInput}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              commitTextEdit();
            }
            e.stopPropagation(); // Prevent keyboard shortcuts from firing
          }}
          // No placeholder: the editor sits on the drawing, so ghost text there
          // reads as content that is already on the board.
        />
      )}

      {/* Custom eraser cursor */}
      {tool === 'eraser' && <EraserCursor size={eraserSettings.size} />}

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onPasteAt={(sx, sy) => useCanvasStore.getState().paste(screenToWorld(sx, sy))}
        />
      )}
    </div>
  );
}

/* ─── Eraser Cursor Component ─────────────────────────────────────────────── */
// `size` is the eraser diameter in SCREEN pixels — the erase radius is
// size/2/zoom in world units, so on screen it is always size/2 whatever the
// zoom. The ring used to be drawn at size*zoom, so at any zoom other than 100%
// it showed an area the eraser did not actually cover.
function EraserCursor({ size }: { size: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Pointer events, not mouse events: a tablet or phone never fires
    // mousemove, so the ring was invisible on exactly the devices where the
    // canvas cursor is set to 'none' and there is no other feedback at all.
    const handleMove = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target && (target.tagName === 'CANVAS' || target.closest('.canvas-container'))) {
        el.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
        el.style.opacity = '1';
      } else {
        el.style.opacity = '0';
      }
    };
    // On touch the ring has no hover state to live in, so it fades with the lift.
    const handleUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') el.style.opacity = '0';
    };
    const handleLeave = () => { el.style.opacity = '0'; };

    document.addEventListener('pointermove', handleMove, { passive: true });
    document.addEventListener('pointerdown', handleMove, { passive: true });
    document.addEventListener('pointerup', handleUp, { passive: true });
    document.addEventListener('pointercancel', handleUp, { passive: true });
    document.addEventListener('pointerleave', handleLeave);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerdown', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      document.removeEventListener('pointerleave', handleLeave);
    };
  }, [size]);

  const screenSize = size;
  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 pointer-events-none z-[9999]"
      style={{
        width: screenSize,
        height: screenSize,
        borderRadius: '50%',
        border: '2px solid rgba(0,0,0,0.5)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.5)',
        backgroundColor: 'rgba(128,128,128,0.1)',
        opacity: 0,
        willChange: 'transform',
        transition: 'width 0.15s, height 0.15s',
      }}
    />
  );
}






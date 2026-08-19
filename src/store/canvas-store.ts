import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { WhiteboardElement, ConnectorElement, Viewport, Tool, ShapeType, IconElement, FreehandElement, ImageElement, TextElement, StickyElement, StyleProperties, Point } from '@/types';
import type { CanvasInputMode, InputModeState } from '@/types/input';
import { getElementBBox } from '@/lib/utils/geometry';
import { STICKY_COLORS, STICKY_INK, STICKY_DOT_SIZE } from '@/lib/canvas/sticky';
import { ConnectorManager } from '@/lib/canvas/connectors';
import { ConnectorHandleHit } from '@/lib/canvas/hit-testing';
import { useUIStore } from '@/store/ui-store';

// Enable Immer MapSet plugin for using Set/Map in Immer state
enableMapSet();

interface HistorySnapshot {
  elements: Record<string, WhiteboardElement>;
  canvasBackground: string;
}

export interface InputState {
  activePointerType: 'pen' | 'touch' | 'mouse';
  isPenHovering: boolean;
  lastPressure: number;
}

interface CanvasState {
  elements: Record<string, WhiteboardElement>;
  selectedIds: Set<string>;
  activeHandle: ConnectorHandleHit | null;
  viewport: Viewport;
  tool: Tool;
  clipboard: WhiteboardElement[];
  isInteracting: boolean;
  canvasBackground: string;
  isCanvasBackgroundCustomized: boolean;
  iconPickerOpen: boolean;
  inputState: InputState;
  inputMode: InputModeState;

  // History for proper undo/redo
  history: HistorySnapshot[];
  historyIndex: number;

  // Actions
  setInputMode: (mode: CanvasInputMode) => void;
  toggleInputMode: () => void;
  setInputState: (patch: Partial<InputState>) => void;
  setActiveHandle: (handle: ConnectorHandleHit | null) => void;
  setCanvasBackground: (color: string) => void;
  setIsCanvasBackgroundCustomized: (val: boolean) => void;
  invertElementColors: (fromTheme: 'light' | 'dark', toTheme: 'light' | 'dark') => void;
  setIsInteracting: (val: boolean) => void;
  setTool: (tool: Tool) => void;
  addElement: (element: WhiteboardElement) => void;
  updateElement: (id: string, updates: Partial<WhiteboardElement>) => void;
  deleteElements: (ids: string[]) => void;
  selectElements: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;
  updateViewport: (viewport: Partial<Viewport>) => void;

  setIconPickerOpen: (open: boolean) => void;
  addIconElement: (iconName: string, iconLibrary: 'material-symbols') => void;
  updateIconElement: (id: string, patch: Partial<IconElement>) => void;

  // Undo/redo
  saveSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Clipboard
  copy: () => void;
  /** `at` (world coords) centres the pasted copy there, as Excalidraw does. */
  paste: (at?: Point) => void;
  duplicate: () => void;

  // Z-index management
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  // Alignment
  alignElements: (alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;

  /** Drop a sticky note at a world point and return its id. */
  addSticky: (at: Point) => string;
  toggleStickyCollapsed: (id: string) => void;

  // Grouping
  groupSelected: () => void;
  ungroupSelected: () => void;

  // Locking
  setLocked: (ids: string[], locked: boolean) => void;
  toggleLockSelected: () => void;

  // Flipping
  flipSelected: (axis: 'horizontal' | 'vertical') => void;

  // Style clipboard (Ctrl+Alt+C / Ctrl+Alt+V)
  styleClipboard: StyleProperties | null;
  copyStyle: () => void;
  pasteStyle: () => void;

  // Zoom helpers
  zoomToFit: () => void;
  zoomToSelection: () => void;
  setZoom: (zoom: number) => void;
  scrollToContent: () => void;

  /** Replace the whole scene (opening a file). Undoable. */
  loadScene: (elements: WhiteboardElement[], background?: string) => void;

  // Eraser Settings
  eraserSettings: {
    mode: 'object' | 'partial';
    size: number;
  };
  setEraserMode: (mode: 'object' | 'partial') => void;
  setEraserSize: (size: number) => void;

  // Batch erase (no history — caller manages snapshot)
  batchErase: (deleteIds: string[], addElements?: WhiteboardElement[]) => void;

  // Connectors
  connectorsByElement: Map<string, Set<string>>;
  hoveredBindTarget: string | null;
  setHoveredBindTarget: (id: string | null) => void;
  draftConnector: ConnectorElement | null;
  beginDrawingConnector: (connector: ConnectorElement) => void;
  updateDraftConnector: (updates: Partial<ConnectorElement>) => void;
  commitConnector: (connector: ConnectorElement) => void;
  cancelDraftConnector: () => void;
  getElementsMap: () => Map<string, WhiteboardElement>;
  getElement: (id: string) => WhiteboardElement | undefined;
  updateAttachedConnectors: (movedElementIds: string[], elementsMap: Map<string, WhiteboardElement>) => void;
  detachConnectorsFromElement: (elementId: string) => void;
  finalizeConnectorReshape: (connectorId: string) => void;
  setConnectorRoutingMode: (connectorId: string, mode: 'straight' | 'curved' | 'orthogonal') => void;
}

const cloneElements = (elements: Record<string, WhiteboardElement>): Record<string, WhiteboardElement> => {
  const clone: Record<string, WhiteboardElement> = {};
  for (const id in elements) {
    if (Object.prototype.hasOwnProperty.call(elements, id)) {
      const el = elements[id]!;
      
      // Point arrays are never mutated in place — updateElement always assigns
      // a fresh array — so snapshots can share the reference. Copying them made
      // every undo snapshot cost O(all points on the board), which is what made
      // each finished stroke stall on a page full of handwriting.
      let points: [number, number, number?][] | undefined;
      if (el.type === ShapeType.FREEHAND) {
        points = (el as FreehandElement).points;
      }

      let controlPoints: { x: number; y: number }[] | undefined;
      if (el.type === ShapeType.CONNECTOR) {
        const conn = el as ConnectorElement;
        if (conn.controlPoints) {
          controlPoints = conn.controlPoints.map((cp) => ({ ...cp }));
        }
      }

      clone[id] = {
        ...el,
        style: el.style ? { ...el.style } : el.style,
        ...(points ? { points } : {}),
        ...(controlPoints ? { controlPoints } : {}),
        bbox: el.bbox ? { ...el.bbox } : undefined,
      } as WhiteboardElement;
    }
  }
  return clone;
};

/**
 * Widen a selection so that picking any member of a group brings in every
 * element sharing its outermost group id.
 */
const expandToGroups = (
  ids: string[],
  elements: Record<string, WhiteboardElement>
): string[] => {
  const groups = new Set<string>();
  for (const id of ids) {
    const outermost = elements[id]?.groupIds?.[0];
    if (outermost) groups.add(outermost);
  }
  if (groups.size === 0) return ids;

  const out = new Set(ids);
  for (const id in elements) {
    const outermost = elements[id]!.groupIds?.[0];
    if (outermost && groups.has(outermost)) out.add(id);
  }
  return Array.from(out);
};

/**
 * Push the current elements onto the undo stack, dropping any redo future.
 * This block was copy-pasted into six actions; a seventh copy is how the two
 * that quietly disagreed about the 100-entry cap came about.
 */
const pushHistory = (state: {
  history: HistorySnapshot[];
  historyIndex: number;
  elements: Record<string, WhiteboardElement>;
  canvasBackground: string;
}) => {
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push({ elements: cloneElements(state.elements), canvasBackground: state.canvasBackground });
  if (newHistory.length > 100) newHistory.shift();
  state.history = newHistory;
  state.historyIndex = newHistory.length - 1;
};

const fitToElements = (
  state: { elements: Record<string, WhiteboardElement>; viewport: Viewport },
  targetIds: string[]
) => {
  const els = targetIds.map(id => state.elements[id]).filter(Boolean) as WhiteboardElement[];

  if (els.length === 0) {
    state.viewport = { ...state.viewport, zoom: 1, x: 0, y: 0 };
    return;
  }

  const minX = Math.min(...els.map(e => e.x));
  const minY = Math.min(...els.map(e => e.y));
  const maxX = Math.max(...els.map(e => e.x + e.width));
  const maxY = Math.max(...els.map(e => e.y + e.height));

  const padding = 80;
  const vw = state.viewport.width || window.innerWidth;
  const vh = state.viewport.height || window.innerHeight;

  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);

  const scaleX = (vw - padding * 2) / contentW;
  const scaleY = (vh - padding * 2) / contentH;
  const zoom = Math.min(scaleX, scaleY, 3);

  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;

  state.viewport = {
    ...state.viewport,
    zoom,
    x: -minX * zoom + (vw - scaledW) / 2,
    y: -minY * zoom + (vh - scaledH) / 2,
  };
};

export const useCanvasStore = create<CanvasState>()(
  persist(
    immer((set, get) => ({
    elements: {},
    selectedIds: new Set(),
    viewport: { x: 0, y: 0, zoom: 1, width: 0, height: 0 },
    tool: 'select',
    clipboard: [],
    isInteracting: false,
    canvasBackground: '#000000',
    isCanvasBackgroundCustomized: false,
    iconPickerOpen: false,
    inputState: {
      activePointerType: 'mouse',
      isPenHovering: false,
      lastPressure: 0.5,
    },
    inputMode: {
      mode: 'hand',
      isTouchDevice: false,
      isTablet: false,
    },
    history: [{ elements: {}, canvasBackground: '#000000' }],
    historyIndex: 0,
    connectorsByElement: new Map(),
    hoveredBindTarget: null,
    draftConnector: null,
    activeHandle: null,
    
    setInputMode: (mode) => set((state) => {
      state.inputMode.mode = mode;
      try {
        localStorage.setItem('drawer_input_mode', mode);
      } catch {}
    }),
    toggleInputMode: () => set((state) => {
      state.inputMode.mode = state.inputMode.mode === 'pen' ? 'hand' : 'pen';
      try {
        localStorage.setItem('drawer_input_mode', state.inputMode.mode);
      } catch {}
    }),
    setInputState: (patch) => set((state) => {
      Object.assign(state.inputState, patch);
    }),
    setActiveHandle: (handle) => set((state) => {
      state.activeHandle = handle;
    }),
    eraserSettings: {
      mode: 'object',
      size: 30,
    },

    setEraserMode: (mode) => set((state) => {
      state.eraserSettings.mode = mode;
    }),

    setEraserSize: (size) => set((state) => {
      state.eraserSettings.size = size;
    }),

    setHoveredBindTarget: (id) => set((state) => {
      state.hoveredBindTarget = id;
    }),

    beginDrawingConnector: (connector) => set((state) => {
      state.draftConnector = connector as typeof state.draftConnector;
    }),

    updateDraftConnector: (updates) => set((state) => {
      if (state.draftConnector) {
        state.draftConnector = { ...state.draftConnector, ...updates };
      }
    }),

    commitConnector: (connector) => {
      get().addElement(connector);
      set((state) => {
        state.draftConnector = null;
      });
    },

    cancelDraftConnector: () => set((state) => {
      state.draftConnector = null;
    }),

    getElementsMap: () => {
      return new Map(Object.entries(get().elements));
    },

    getElement: (id) => {
      return get().elements[id];
    },

    setIconPickerOpen: (open) => set((state) => {
      state.iconPickerOpen = open;
    }),

    addIconElement: (iconName, iconLibrary) => {
      const { viewport } = get();
      const currentStyle = (useUIStore as { getState?: () => { currentStyle: { stroke: string; strokeWidth: number } } }).getState?.()?.currentStyle || { stroke: '#e2e8f0', strokeWidth: 2 };
      
      // Place at center of current viewport in world coordinates
      const worldX = (-viewport.x + window.innerWidth / 2) / viewport.zoom - 32;
      const worldY = (-viewport.y + window.innerHeight / 2) / viewport.zoom - 32;
      
      const zIndices = Object.values(get().elements).map(e => e.zIndex);
      const maxZIndex = zIndices.length > 0 ? Math.max(...zIndices) : 0;

      const element = {
        id: crypto.randomUUID(),
        type: ShapeType.ICON,
        x: worldX,
        y: worldY,
        width: 64,
        height: 64,
        rotation: 0,
        locked: false,
        zIndex: maxZIndex + 1,
        style: {
          stroke: currentStyle.stroke,
          strokeWidth: currentStyle.strokeWidth || 2,
          opacity: 1,
          fill: 'transparent',
          roughness: 0,
          strokeStyle: 'solid',
        },
        iconName,
        iconLibrary,
        color: currentStyle.stroke,
      } as IconElement;

      element.bbox = getElementBBox(element);

      get().saveSnapshot();

      set((state) => {
        state.elements[element.id] = element;
        state.selectedIds = new Set([element.id]);
        state.iconPickerOpen = false;
      });
    },

    updateIconElement: (id, patch) => set((state) => {
      if (state.elements[id] && state.elements[id].type === ShapeType.ICON) {
        Object.assign(state.elements[id], patch);
        state.elements[id].bbox = getElementBBox(state.elements[id]);
      }
    }),

    setIsInteracting: (val) => set((state) => {
      state.isInteracting = val;
    }),

    setCanvasBackground: (color) => set((state) => {
      pushHistory(state);
      state.canvasBackground = color;
    }),

    setIsCanvasBackgroundCustomized: (val) => set((state) => {
      state.isCanvasBackgroundCustomized = val;
    }),

    invertElementColors: (fromTheme, toTheme) => set((state) => {
      // Elements drawn on dark theme typically have stroke: #ffffff or #e2e8f0 (slate-200 default)
      // Elements drawn on light theme typically have stroke: #1e1e1e
      // We swap ONLY these known defaults; custom colors stay unchanged
      const DARK_DEFAULT_STROKES = ['#ffffff', '#e2e8f0']; // white & slate-200
      const LIGHT_DEFAULT_STROKES = ['#1e1e1e', '#000000']; // near-black & black

      const fromDefaults = fromTheme === 'dark' ? DARK_DEFAULT_STROKES : LIGHT_DEFAULT_STROKES;
      const toDefault = toTheme === 'dark' ? '#e2e8f0' : '#1e1e1e';

      let changed = false;
      const newElements = cloneElements(state.elements);

      Object.values(newElements).forEach((el) => {
        // All elements extend BaseElement which has a `style` with `stroke`
        if (el.style?.stroke && fromDefaults.includes(el.style.stroke)) {
          el.style.stroke = toDefault;
          changed = true;
        }
        // TextElements have a top-level `color` property
        if ('color' in el && typeof (el as unknown as { color: string }).color === 'string') {
          const textEl = el as unknown as { color: string };
          if (fromDefaults.includes(textEl.color)) {
            textEl.color = toDefault;
            changed = true;
          }
        }
      });

      if (changed) {
        // Save snapshot so Ctrl+Z can undo the inversion
        pushHistory(state);
        state.elements = newElements;
      }
    }),

    setTool: (tool) => set((state) => {
      state.tool = tool;
      // Reaching for a drawing tool means you are done with the current
      // selection; reaching for select/lasso/hand means you want to work with
      // it. This used to clear on switching TO select, which threw away the
      // selection a lasso had just made and lost the selection every time you
      // pressed V after drawing something.
      const keepsSelection = tool === 'select' || tool === 'lasso' || tool === 'hand';
      if (!keepsSelection) state.selectedIds.clear();
    }),


    saveSnapshot: () => set((state) => {
      pushHistory(state);
    }),

    addElement: (element) => set((state) => {
      pushHistory(state);

      const bbox = getElementBBox(element);
      const elWithBBox = { ...element, bbox } as typeof state.elements[string];

      // A freehand element's x/y/width/height are derived from its points.
      // Only updateElement used to do this, so an element added with its final
      // points (a completed stroke) kept width/height 0 — breaking hit testing,
      // selection bounds, export and viewport culling.
      if (element.type === ShapeType.FREEHAND && (element as FreehandElement).points.length > 0) {
        elWithBBox.x = bbox.minX;
        elWithBBox.y = bbox.minY;
        elWithBBox.width = bbox.maxX - bbox.minX;
        elWithBBox.height = bbox.maxY - bbox.minY;
      }

      state.elements[element.id] = elWithBBox;

      // Update connectors index if it's a connector
      if (element.type === ShapeType.CONNECTOR) {
        const conn = element as ConnectorElement;
        if (conn.startElementId) {
          if (!state.connectorsByElement.has(conn.startElementId)) state.connectorsByElement.set(conn.startElementId, new Set());
          state.connectorsByElement.get(conn.startElementId)!.add(conn.id);
        }
        if (conn.endElementId) {
          if (!state.connectorsByElement.has(conn.endElementId)) state.connectorsByElement.set(conn.endElementId, new Set());
          state.connectorsByElement.get(conn.endElementId)!.add(conn.id);
        }
      }
    }),

    updateElement: (id, updates) => set((state) => {
      const el = state.elements[id];
      if (el) {
        if (el.type === ShapeType.FREEHAND) {
          const fhEl = el as FreehandElement;
          const fhUpdates = updates as Partial<FreehandElement>;
          if (fhUpdates.points) {
            const points = fhUpdates.points;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of points) {
              if (pt[0] < minX) minX = pt[0];
              if (pt[0] > maxX) maxX = pt[0];
              if (pt[1] < minY) minY = pt[1];
              if (pt[1] > maxY) maxY = pt[1];
            }
            if (minX !== Infinity) {
              fhUpdates.x = minX;
              fhUpdates.y = minY;
              fhUpdates.width = maxX - minX;
              fhUpdates.height = maxY - minY;
            }
          } else if (
            fhUpdates.x !== undefined ||
            fhUpdates.y !== undefined ||
            fhUpdates.width !== undefined ||
            fhUpdates.height !== undefined
          ) {
            const oldX = fhEl.x;
            const oldY = fhEl.y;
            const oldW = fhEl.width || 1;
            const oldH = fhEl.height || 1;

            const newX = fhUpdates.x !== undefined ? fhUpdates.x : fhEl.x;
            const newY = fhUpdates.y !== undefined ? fhUpdates.y : fhEl.y;
            const newW = fhUpdates.width !== undefined ? fhUpdates.width : fhEl.width;
            const newH = fhUpdates.height !== undefined ? fhUpdates.height : fhEl.height;

            fhUpdates.points = fhEl.points.map(pt => {
              const rx = (pt[0] - oldX) / oldW;
              const ry = (pt[1] - oldY) / oldH;
              const px = newX + rx * newW;
              const py = newY + ry * newH;
              return [px, py, pt[2]];
            });
          }
        }

        const updated = { ...state.elements[id]!, ...updates } as typeof state.elements[string];
        updated.bbox = getElementBBox(updated);
        
        // Handle connector specific changes
        if (updated.type === ShapeType.CONNECTOR) {
          const oldConn = state.elements[id] as ConnectorElement;
          const newConn = updated as ConnectorElement;
          
          if (oldConn.startElementId !== newConn.startElementId) {
            if (oldConn.startElementId && state.connectorsByElement.has(oldConn.startElementId)) {
              state.connectorsByElement.get(oldConn.startElementId)!.delete(id);
            }
            if (newConn.startElementId) {
              if (!state.connectorsByElement.has(newConn.startElementId)) state.connectorsByElement.set(newConn.startElementId, new Set());
              state.connectorsByElement.get(newConn.startElementId)!.add(id);
            }
          }
          if (oldConn.endElementId !== newConn.endElementId) {
            if (oldConn.endElementId && state.connectorsByElement.has(oldConn.endElementId)) {
              state.connectorsByElement.get(oldConn.endElementId)!.delete(id);
            }
            if (newConn.endElementId) {
              if (!state.connectorsByElement.has(newConn.endElementId)) state.connectorsByElement.set(newConn.endElementId, new Set());
              state.connectorsByElement.get(newConn.endElementId)!.add(id);
            }
          }
        }
        
        state.elements[id] = updated;
      }
    }),

    deleteElements: (ids) => set((state) => {
      pushHistory(state);

      const doomed = new Set(ids);
      
      // A connector bound to a deleted shape is deleted with it
      ids.forEach(id => {
        const connectedIds = state.connectorsByElement.get(id);
        if (connectedIds) {
          connectedIds.forEach(connId => doomed.add(connId));
        }
      });

      // A label has no life of its own — deleting the shape deletes its text.
      Object.values(state.elements).forEach((el) => {
        if (el.type === ShapeType.TEXT) {
          const containerId = (el as TextElement).containerId;
          if (containerId && doomed.has(containerId)) doomed.add(el.id);
        }
      });
      ids = Array.from(doomed);

      ids.forEach(id => {
        
        const el = state.elements[id];
        if (el?.type === ShapeType.CONNECTOR) {
          const conn = el as ConnectorElement;
          if (conn.startElementId && state.connectorsByElement.has(conn.startElementId)) {
            state.connectorsByElement.get(conn.startElementId)!.delete(id);
          }
          if (conn.endElementId && state.connectorsByElement.has(conn.endElementId)) {
            state.connectorsByElement.get(conn.endElementId)!.delete(id);
          }
        }
        
        delete state.elements[id];
        state.selectedIds.delete(id);
      });
    }),

    // Delete + add elements without touching undo history.
    // Used by the eraser during a drag gesture (snapshot is saved once at pointerdown).
    batchErase: (deleteIds, addElements) => set((state) => {
      const doomed = new Set(deleteIds);
      
      deleteIds.forEach(id => {
        const connectedIds = state.connectorsByElement.get(id);
        if (connectedIds) {
          connectedIds.forEach(connId => doomed.add(connId));
        }
      });
      
      const finalDeleteIds = Array.from(doomed);

      finalDeleteIds.forEach(id => {
        
        const el = state.elements[id];
        if (el?.type === ShapeType.CONNECTOR) {
          const conn = el as ConnectorElement;
          if (conn.startElementId && state.connectorsByElement.has(conn.startElementId)) {
            state.connectorsByElement.get(conn.startElementId)!.delete(id);
          }
          if (conn.endElementId && state.connectorsByElement.has(conn.endElementId)) {
            state.connectorsByElement.get(conn.endElementId)!.delete(id);
          }
        }
        
        delete state.elements[id];
        state.selectedIds.delete(id);
      });
      if (addElements) {
        addElements.forEach(el => {
          const elWithBBox = { ...el, bbox: getElementBBox(el) };
          state.elements[el.id] = elWithBBox as typeof state.elements[string];
        });
      }
    }),

    updateAttachedConnectors: (movedElementIds, elementsMap) => set((state) => {
      const visited = new Set<string>();
      const manager = new ConnectorManager();
      
      const processElement = (elementId: string) => {
        if (visited.has(elementId)) return;
        visited.add(elementId);

        const connectorIds = state.connectorsByElement.get(elementId);
        if (!connectorIds) return;

        for (const connectorId of Array.from(connectorIds)) {
          const connector = state.elements[connectorId] as ConnectorElement;
          if (!connector || connector.isManuallyRouted) continue;

          const resolved = manager.resolveConnectorEndpoints(connector, elementsMap);
          
          // Recreate connector to prevent mutating state directly here incorrectly before updateElement, 
          // although we are in immer so we can mutate.
          const tempConnector = { ...connector, ...resolved } as ConnectorElement;
          const path = manager.computeConnectorPath(tempConnector, elementsMap);

          const updatedConnector = {
            ...connector,
            ...resolved,
            controlPoints: path.controlPoints,
            bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } // Recomputed below
          };
          updatedConnector.bbox = getElementBBox(updatedConnector);
          state.elements[connectorId] = updatedConnector as typeof state.elements[string];
        }
      };

      for (const id of movedElementIds) {
        processElement(id);
      }
    }),

    detachConnectorsFromElement: (elementId) => set((state) => {
      const connIds = state.connectorsByElement.get(elementId);
      if (!connIds) return;
      
      const manager = new ConnectorManager();
      // To get live positions we need a Map
      const elementsMap = new Map(Object.entries(state.elements));

      for (const connId of Array.from(connIds)) {
        const conn = state.elements[connId] as ConnectorElement;
        if (!conn) continue;
        
        if (conn.startElementId === elementId) {
          conn.startElementId = null;
          const resolved = manager.resolveConnectorEndpoints(conn, elementsMap);
          conn.startX = resolved.startX;
          conn.startY = resolved.startY;
        }
        if (conn.endElementId === elementId) {
          conn.endElementId = null;
          const resolved = manager.resolveConnectorEndpoints(conn, elementsMap);
          conn.endX = resolved.endX;
          conn.endY = resolved.endY;
        }
      }
      
      state.connectorsByElement.delete(elementId);
    }),

    finalizeConnectorReshape: (connectorId) => set((state) => {
      const conn = state.elements[connectorId] as ConnectorElement;
      if (conn) {
        conn.isManuallyRouted = true;
      }
    }),

    setConnectorRoutingMode: (connectorId, mode) => set((state) => {
      const conn = state.elements[connectorId] as ConnectorElement;
      if (conn) {
        conn.routingMode = mode;
        conn.isManuallyRouted = false; // Reset manual routing
      }
    }),

    selectElements: (ids) => set((state) => {
      // Selecting any member of a group selects the whole group, so dragging
      // one piece moves them all — the point of grouping.
      state.selectedIds = new Set(expandToGroups(ids, state.elements));
    }),

    clearSelection: () => set((state) => {
      state.selectedIds.clear();
    }),

    selectAll: () => set((state) => {
      state.selectedIds = new Set(Object.keys(state.elements));
    }),

    updateViewport: (viewportParams) => set((state) => {
      state.viewport = { ...state.viewport, ...viewportParams };
    }),

    undo: () => set((state) => {
      if (state.historyIndex > 0) {
        state.historyIndex--;
        const snapshot = state.history[state.historyIndex];
        if (snapshot) {
          state.elements = cloneElements(snapshot.elements);
          state.canvasBackground = snapshot.canvasBackground;
          state.selectedIds.clear();
        }
      }
    }),

    redo: () => set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        const snapshot = state.history[state.historyIndex];
        if (snapshot) {
          state.elements = cloneElements(snapshot.elements);
          state.canvasBackground = snapshot.canvasBackground;
          state.selectedIds.clear();
        }
      }
    }),

    canUndo: () => get().historyIndex > 0,
    canRedo: () => get().historyIndex < get().history.length - 1,

    copy: () => set((state) => {
      const toCopy = Array.from(state.selectedIds)
        .map(id => state.elements[id])
        .filter(Boolean) as WhiteboardElement[];
      state.clipboard = JSON.parse(JSON.stringify(toCopy));
    }),

    paste: (at) => set((state) => {
      if (state.clipboard.length === 0) return;
      const newIds: string[] = [];

      pushHistory(state);

      // Default nudge, or centre the whole clipboard on `at` when given.
      let dx = 20;
      let dy = 20;
      if (at) {
        const boxes = state.clipboard.map((el) => getElementBBox(el));
        const minX = Math.min(...boxes.map((b) => b.minX));
        const minY = Math.min(...boxes.map((b) => b.minY));
        const maxX = Math.max(...boxes.map((b) => b.maxX));
        const maxY = Math.max(...boxes.map((b) => b.maxY));
        dx = at.x - (minX + maxX) / 2;
        dy = at.y - (minY + maxY) / 2;
      }

      // A pasted group stays a group, but under fresh ids — otherwise the copy
      // and the original would be welded into one selection.
      const groupRemap = new Map<string, string>();

      state.clipboard.forEach(el => {
        const newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newEl = {
          ...JSON.parse(JSON.stringify(el)),
          id: newId,
          x: el.x + dx,
          y: el.y + dy,
          zIndex: Date.now() + Math.random(),
        } as typeof state.elements[string];
        if (newEl.type === ShapeType.FREEHAND) {
          const fh = newEl as FreehandElement;
          fh.points = fh.points.map(pt => [pt[0] + dx, pt[1] + dy, pt[2]]);
        }
        if (newEl.type === ShapeType.CONNECTOR) {
          const conn = newEl as ConnectorElement;
          conn.startX += dx; conn.endX += dx;
          conn.startY += dy; conn.endY += dy;
          conn.controlPoints = conn.controlPoints?.map((cp) => ({ x: cp.x + dx, y: cp.y + dy }));
        }
        if (newEl.groupIds) {
          newEl.groupIds = newEl.groupIds.map((g: string) => {
            let mapped = groupRemap.get(g);
            if (!mapped) {
              mapped = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
              groupRemap.set(g, mapped);
            }
            return mapped;
          });
        }
        newEl.bbox = getElementBBox(newEl);
        state.elements[newId] = newEl;
        newIds.push(newId);
      });
      state.selectedIds = new Set(newIds);
    }),

    duplicate: () => {
      get().copy();
      get().paste();
    },

    bringToFront: (id) => set((state) => {
      const zIndices = Object.values(state.elements).map(e => e.zIndex);
      const maxZIndex = zIndices.length > 0 ? Math.max(...zIndices) : 0;
      if (state.elements[id]) {
        state.elements[id]!.zIndex = maxZIndex + 1;
      }
    }),

    sendToBack: (id) => set((state) => {
      const zIndices = Object.values(state.elements).map(e => e.zIndex);
      const minZIndex = zIndices.length > 0 ? Math.min(...zIndices) : 0;
      if (state.elements[id]) {
        state.elements[id]!.zIndex = minZIndex - 1;
      }
    }),

    bringForward: (id) => set((state) => {
      if (state.elements[id]) {
        state.elements[id]!.zIndex += 1;
      }
    }),

    sendBackward: (id) => set((state) => {
      if (state.elements[id]) {
        state.elements[id]!.zIndex -= 1;
      }
    }),

    alignElements: (alignment) => set((state) => {
      const ids = Array.from(state.selectedIds);
      if (ids.length < 2) return;
      const els = ids.map(id => state.elements[id]).filter(Boolean) as WhiteboardElement[];
      
      const minX = Math.min(...els.map(e => e.x));
      const minY = Math.min(...els.map(e => e.y));
      const maxX = Math.max(...els.map(e => e.x + e.width));
      const maxY = Math.max(...els.map(e => e.y + e.height));
      
      ids.forEach(id => {
        const el = state.elements[id];
        if (!el) return;
        
        let targetX = el.x;
        let targetY = el.y;

        switch (alignment) {
          case 'left':
            targetX = minX;
            break;
          case 'center-h':
            targetX = (minX + maxX) / 2 - el.width / 2;
            break;
          case 'right':
            targetX = maxX - el.width;
            break;
          case 'top':
            targetY = minY;
            break;
          case 'center-v':
            targetY = (minY + maxY) / 2 - el.height / 2;
            break;
          case 'bottom':
            targetY = maxY - el.height;
            break;
        }

        if (el.type === ShapeType.FREEHAND) {
          const fh = el as FreehandElement;
          const dx = targetX - fh.x;
          const dy = targetY - fh.y;
          fh.points = fh.points.map(pt => [pt[0] + dx, pt[1] + dy, pt[2]]);
        }

        el.x = targetX;
        el.y = targetY;
        el.bbox = getElementBBox(el);
      });
    }),

    // ── Sticky notes ───────────────────────────────────────────────────────
    addSticky: (at) => {
      const id = `sticky-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const width = 180;
      const height = 140;
      const palette = STICKY_COLORS;
      const noteColor = palette[Math.floor(Math.random() * palette.length)]!;

      get().addElement({
        id,
        type: ShapeType.STICKY,
        // Dropped centred on the click, the way a note lands where you point.
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        rotation: 0,
        locked: false,
        zIndex: Date.now(),
        style: {
          fill: noteColor, stroke: STICKY_INK, strokeWidth: 1,
          opacity: 1, roughness: 0, strokeStyle: 'solid',
        },
        text: '',
        noteColor,
        collapsed: false,
        fontSize: 16,
        fontFamily: 'Inter, system-ui, sans-serif',
      } as WhiteboardElement);

      return id;
    },

    toggleStickyCollapsed: (id) => set((state) => {
      const el = state.elements[id] as StickyElement | undefined;
      if (el?.type !== ShapeType.STICKY) return;

      if (el.collapsed) {
        el.width = el.expandedWidth ?? 180;
        el.height = el.expandedHeight ?? 140;
        el.collapsed = false;
      } else {
        // Shrink the element itself, not just what gets drawn. Leaving the full
        // size behind meant a collapsed note still reserved a note-sized hole
        // on the board — its selection box stayed large and it kept blocking
        // anything you drew underneath.
        el.expandedWidth = Math.abs(el.width);
        el.expandedHeight = Math.abs(el.height);
        el.width = STICKY_DOT_SIZE;
        el.height = STICKY_DOT_SIZE;
        el.collapsed = true;
      }

      el.bbox = getElementBBox(el);
    }),

    // ── Grouping ───────────────────────────────────────────────────────────
    groupSelected: () => set((state) => {
      const ids = Array.from(state.selectedIds);
      if (ids.length < 2) return;
      pushHistory(state);

      const groupId = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      ids.forEach((id) => {
        const el = state.elements[id];
        if (!el) return;
        // Appended, not replaced: an element already in a group keeps its inner
        // membership and gains this one as the new outermost.
        el.groupIds = [groupId, ...(el.groupIds ?? [])];
      });
    }),

    ungroupSelected: () => set((state) => {
      const ids = Array.from(state.selectedIds);
      if (ids.length === 0) return;

      // Only drop a group the whole selection actually shares, so ungrouping
      // one member can't quietly tear the rest of the group apart.
      const first = state.elements[ids[0]!];
      const outermost = first?.groupIds?.[0];
      if (!outermost) return;
      if (!ids.every((id) => state.elements[id]?.groupIds?.[0] === outermost)) return;

      pushHistory(state);
      Object.values(state.elements).forEach((el) => {
        if (el.groupIds?.[0] === outermost) {
          el.groupIds = el.groupIds.slice(1);
          if (el.groupIds.length === 0) delete el.groupIds;
        }
      });
    }),

    // ── Locking ────────────────────────────────────────────────────────────
    setLocked: (ids, locked) => set((state) => {
      if (ids.length === 0) return;
      pushHistory(state);
      ids.forEach((id) => {
        const el = state.elements[id];
        if (el) el.locked = locked;
      });
      // A locked element can't be hit-tested, so leaving it selected would
      // strand a selection box you can't dismiss by clicking the element.
      if (locked) state.selectedIds.clear();
    }),

    toggleLockSelected: () => {
      const state = get();
      const ids = Array.from(state.selectedIds);
      if (ids.length === 0) return;
      const allLocked = ids.every((id) => state.elements[id]?.locked);
      state.setLocked(ids, !allLocked);
    },

    // ── Flip ───────────────────────────────────────────────────────────────
    flipSelected: (axis) => set((state) => {
      const ids = Array.from(state.selectedIds);
      const els = ids.map((id) => state.elements[id]).filter(Boolean) as WhiteboardElement[];
      if (els.length === 0) return;
      pushHistory(state);

      // Mirror about the selection's own bounds, so a multi-element flip
      // rearranges the group rather than flipping each piece in place.
      const bounds = els.map((e) => getElementBBox(e));
      const min = axis === 'horizontal'
        ? Math.min(...bounds.map((b) => b.minX))
        : Math.min(...bounds.map((b) => b.minY));
      const max = axis === 'horizontal'
        ? Math.max(...bounds.map((b) => b.maxX))
        : Math.max(...bounds.map((b) => b.maxY));
      const mirror = (v: number) => min + max - v;

      const horizontal = axis === 'horizontal';

      els.forEach((el) => {
        if (el.type === ShapeType.FREEHAND) {
          const fh = el as FreehandElement;
          fh.points = fh.points.map((p) =>
            horizontal ? [mirror(p[0]), p[1], p[2]] : [p[0], mirror(p[1]), p[2]]
          );
          // A freehand element's box is derived from its points, so it has to
          // be recomputed here — selection and hit testing read x/y/w/h.
          const b = getElementBBox(fh);
          fh.x = b.minX; fh.y = b.minY;
          fh.width = b.maxX - b.minX;
          fh.height = b.maxY - b.minY;
        } else if (el.type === ShapeType.CONNECTOR) {
          const c = el as ConnectorElement;
          if (horizontal) {
            c.startX = mirror(c.startX); c.endX = mirror(c.endX);
          } else {
            c.startY = mirror(c.startY); c.endY = mirror(c.endY);
          }
          c.controlPoints = c.controlPoints?.map((cp) =>
            horizontal ? { x: mirror(cp.x), y: cp.y } : { x: cp.x, y: mirror(cp.y) }
          );
        } else if (el.type === ShapeType.LINE || el.type === ShapeType.ARROW) {
          // width/height are a signed delta here, so the sign flips with it.
          if (horizontal) { el.x = mirror(el.x); el.width = -el.width; }
          else { el.y = mirror(el.y); el.height = -el.height; }
        } else {
          // Rect-based: the mirrored left edge is the mirror of the right edge.
          // Sizes are normalised to positive here — a shape dragged out
          // right-to-left carries a negative width, and mirroring that without
          // normalising puts the box in the wrong place.
          if (horizontal) {
            const w = Math.abs(el.width);
            el.x = mirror(Math.min(el.x, el.x + el.width) + w);
            el.width = w;
          } else {
            const h = Math.abs(el.height);
            el.y = mirror(Math.min(el.y, el.y + el.height) + h);
            el.height = h;
          }
          if (el.type === ShapeType.IMAGE) {
            const img = el as ImageElement;
            if (horizontal) img.flipX = !img.flipX; else img.flipY = !img.flipY;
          }
        }
        // A mirrored rotation turns the other way.
        if (el.rotation) el.rotation = -el.rotation;
        el.bbox = getElementBBox(el);
      });
    }),

    // ── Style clipboard ────────────────────────────────────────────────────
    styleClipboard: null,

    copyStyle: () => set((state) => {
      const first = Array.from(state.selectedIds)
        .map((id) => state.elements[id])
        .find(Boolean);
      if (first) state.styleClipboard = { ...first.style };
    }),

    pasteStyle: () => set((state) => {
      const style = state.styleClipboard;
      const ids = Array.from(state.selectedIds);
      if (!style || ids.length === 0) return;
      pushHistory(state);
      ids.forEach((id) => {
        const el = state.elements[id];
        if (el) el.style = { ...style };
      });
    }),

    zoomToFit: () => set((state) => {
      // Always fits the entire board, ignoring selection
      const targetIds = Object.keys(state.elements);
      fitToElements(state, targetIds);
    }),

    zoomToSelection: () => set((state) => {
      if (state.selectedIds.size === 0) return; // no-op, nothing selected
      const targetIds = Array.from(state.selectedIds);
      fitToElements(state, targetIds);
    }),

    loadScene: (loaded, background) => set((state) => {
      pushHistory(state);
      state.elements = {};
      loaded.forEach((el) => {
        state.elements[el.id] = { ...el, bbox: getElementBBox(el) } as typeof state.elements[string];
      });
      state.selectedIds.clear();
      // Bindings are rebuilt from the loaded connectors, not carried in the file.
      state.connectorsByElement = new Map();
      loaded.forEach((el) => {
        if (el.type !== ShapeType.CONNECTOR) return;
        const conn = el as ConnectorElement;
        [conn.startElementId, conn.endElementId].forEach((target) => {
          if (!target) return;
          if (!state.connectorsByElement.has(target)) state.connectorsByElement.set(target, new Set());
          state.connectorsByElement.get(target)!.add(conn.id);
        });
      });
      if (background) {
        state.canvasBackground = background;
        state.isCanvasBackgroundCustomized = true;
      }
    }),

    /** Pan (without zooming) so the drawing is back on screen. */
    scrollToContent: () => set((state) => {
      const els = Object.values(state.elements);
      if (els.length === 0) return;
      const boxes = els.map((el) => el.bbox ?? getElementBBox(el));
      const minX = Math.min(...boxes.map((b) => b.minX));
      const minY = Math.min(...boxes.map((b) => b.minY));
      const maxX = Math.max(...boxes.map((b) => b.maxX));
      const maxY = Math.max(...boxes.map((b) => b.maxY));
      const vw = state.viewport.width || window.innerWidth;
      const vh = state.viewport.height || window.innerHeight;
      state.viewport = {
        ...state.viewport,
        x: vw / 2 - ((minX + maxX) / 2) * state.viewport.zoom,
        y: vh / 2 - ((minY + maxY) / 2) * state.viewport.zoom,
      };
    }),

    setZoom: (zoom) => set((state) => {
      const clampedZoom = Math.max(0.05, Math.min(zoom, 10));
      const cx = (state.viewport.width || window.innerWidth) / 2;
      const cy = (state.viewport.height || window.innerHeight) / 2;
      const scale = clampedZoom / state.viewport.zoom;
      
      state.viewport = {
        ...state.viewport,
        zoom: clampedZoom,
        x: cx - (cx - state.viewport.x) * scale,
        y: cy - (cy - state.viewport.y) * scale,
      };
    }),
  })),
  {
    name: 'drawer-canvas-storage',
    partialize: (state) => ({
      elements: state.elements,
      canvasBackground: state.canvasBackground,
      isCanvasBackgroundCustomized: state.isCanvasBackgroundCustomized,
      viewport: state.viewport,
    }),
    // Re-hydrate Sets/Maps since JSON stringify strips them.
    // If background was never customized, re-derive it from the persisted theme.
    merge: (persistedState: unknown, currentState: CanvasState) => {
      const saved = persistedState as Partial<CanvasState> & { selectedIds?: string[] };
      const merged = { ...currentState, ...saved };
      merged.selectedIds = new Set(saved.selectedIds || []);

      // If user never customized the background, reset it to the correct theme default.
      // Read the saved theme directly from localStorage (ui-store persists it there).
      if (!saved.isCanvasBackgroundCustomized) {
        let savedTheme: 'dark' | 'light' = 'dark';
        try {
          const uiStorage = localStorage.getItem('drawer-ui-storage');
          if (uiStorage) {
            const parsed = JSON.parse(uiStorage) as { state?: { theme?: string } };
            const t = parsed?.state?.theme;
            if (t === 'light' || t === 'dark') savedTheme = t;
            else if (t === 'system') {
              savedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
          }
        } catch { /* ignore */ }
        merged.canvasBackground = savedTheme === 'light' ? '#ffffff' : '#000000';
      }

      return merged;
    }
  }
  )
);

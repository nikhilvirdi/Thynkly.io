import rough from 'roughjs';
import { WhiteboardElement, Viewport, ShapeType, GridSettings, ImageElement, TextElement, ConnectorElement, ShapeElement, StickyElement } from '@/types';
import { renderShape } from './shapes';
import { renderFreehand } from './freehand';
import { ImageHandler } from './image-handler';
import { ConnectorManager } from './connectors';
import { RoughRenderer } from './rough-renderer';
import { drawIconElement, getIconBitmapSync, getIconBitmap } from './icon-renderer';
import { layoutText, measureLine, fontString, textFontString, FONT_FAMILIES } from './text';
import { renderSticky } from './sticky';

// These were re-allocated on every frame — 240 throwaway objects a second at
// 60fps, all of them stateless. Cache them per canvas node instead.
let helperCanvas: HTMLCanvasElement | null = null;
let helpers: {
  rc: ReturnType<typeof rough.canvas>;
  roughRenderer: RoughRenderer;
  imageHandler: ImageHandler;
  connectorManager: ConnectorManager;
} | null = null;

const GHOST_ALPHA = 0.25;

/** Shallow copy with its opacity knocked down, for the eraser's live preview. */
const ghost = (el: WhiteboardElement): WhiteboardElement => ({
  ...el,
  style: { ...el.style, opacity: (el.style?.opacity ?? 1) * GHOST_ALPHA },
  ...(el.type === ShapeType.IMAGE
    ? { opacity: ((el as ImageElement).opacity ?? 100) * GHOST_ALPHA }
    : {}),
} as WhiteboardElement);

const getRenderHelpers = (canvas: HTMLCanvasElement) => {
  if (helperCanvas !== canvas || !helpers) {
    helperCanvas = canvas;
    helpers = {
      rc: rough.canvas(canvas),
      roughRenderer: new RoughRenderer(canvas),
      imageHandler: new ImageHandler(),
      connectorManager: new ConnectorManager(),
    };
  }
  return helpers;
};

/** Elements the eraser is currently working on: `faded` are pending deletion,
 *  `hidden` are being partially erased and are drawn on the overlay instead. */
export interface ErasePreview {
  faded: Set<string>;
  hidden: Set<string>;
}

/**
 * Paints the board. Returns true when an image or icon was still loading, i.e.
 * the caller should schedule one more frame.
 */
export const renderCanvas = (
  canvas: HTMLCanvasElement,
  elements: WhiteboardElement[],
  selectedIds: Set<string>,
  viewport: Viewport,
  grid: GridSettings,
  canvasBackground: string = '#1e1e1e',
  erasePreview?: ErasePreview,
  /**
   * Element currently open in the inline text editor. Its text is left
   * unpainted so the editor is the only copy on screen — drawing both showed
   * the text twice, slightly offset.
   */
  editingId?: string | null
): boolean => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  let assetsPending = false;

  // Draw background (zoom-safe — reset transform first)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (canvasBackground === 'transparent') {
    // Actually transparent, not "theme colour instead": PNG export with a
    // transparent background depends on the alpha channel surviving, and on
    // screen the themed container behind the canvas shows through anyway.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = canvasBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();

  // Apply viewport
  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.zoom, viewport.zoom);

  // Render Grid
  renderGrid(ctx, viewport, canvas.width, canvas.height, grid);

  // Sort elements by z-index
  const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  const { rc, roughRenderer, imageHandler, connectorManager } = getRenderHelpers(canvas);
  const elementsMap = new Map(elements.map(e => [e.id, e]));

  // Viewport culling. Every visible freehand stroke is re-tesselated by
  // perfect-freehand on each frame, so a full page of handwriting costs
  // O(all points on the board) per frame without this.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const viewW = viewport.width || canvas.width / dpr;
  const viewH = viewport.height || canvas.height / dpr;
  const slack = 64 / viewport.zoom; // stroke width + taper overshoot
  const cullMinX = -viewport.x / viewport.zoom - slack;
  const cullMinY = -viewport.y / viewport.zoom - slack;
  const cullMaxX = cullMinX + viewW / viewport.zoom + slack * 2;
  const cullMaxY = cullMinY + viewH / viewport.zoom + slack * 2;

  // Render Elements
  sortedElements.forEach((original) => {

    // Mid-erase: partially-erased elements are drawn on the overlay as their
    // surviving pieces, so the original must not be painted underneath them.
    if (erasePreview?.hidden.has(original.id)) return;

    // Marked for deletion by the eraser — ghost it until the pen lifts.
    // Done by lowering the element's own opacity rather than ctx.globalAlpha,
    // because every renderer below assigns globalAlpha rather than multiplying.
    const element = erasePreview?.faded.has(original.id) ? ghost(original) : original;

    // Connectors are exempt: their x/y/width/height don't bound the drawn path.
    if (element.type !== ShapeType.CONNECTOR) {
      // A rotated element sweeps outside its axis-aligned box, by at most half
      // its diagonal.
      const spin = element.rotation ? Math.hypot(element.width, element.height) / 2 : 0;
      if (
        element.x - spin > cullMaxX ||
        element.y - spin > cullMaxY ||
        element.x + element.width + spin < cullMinX ||
        element.y + element.height + spin < cullMinY
      ) return;
    }

    ctx.save();

    // Marked for deletion by the eraser — show it ghosted until the pen lifts.
    if (erasePreview?.faded.has(element.id)) ctx.globalAlpha = 0.25;

    if (element.rotation) {
      if (element.type !== ShapeType.FREEHAND) {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(element.rotation);
        ctx.translate(-cx, -cy);
      }
    }

    const isEditing = editingId != null && element.id === editingId;

    if (element.type === ShapeType.FREEHAND) {
      renderFreehand(ctx, element);
    } else if (element.type === ShapeType.IMAGE) {
      if (!imageHandler.drawImage(ctx, element as ImageElement)) assetsPending = true;
    } else if (element.type === ShapeType.STICKY) {
      // The paper still draws; only its text is left to the editor.
      renderSticky(ctx, element as StickyElement, isEditing);

    } else if (element.type === ShapeType.TEXT) {
      if (!isEditing) renderText(ctx, element as TextElement, elementsMap);

    } else if (element.type === ShapeType.CONNECTOR) {
      connectorManager.drawConnector(ctx, element as ConnectorElement, elementsMap, roughRenderer, selectedIds.has(element.id), isEditing);
      if (selectedIds.has(element.id)) {
        drawConnectorHandles(ctx, element as ConnectorElement, viewport.zoom);
      }
    } else if (element.type === ShapeType.ICON) {
      const iconEl = element as import('@/types').IconElement;
      const bitmap = getIconBitmapSync(iconEl);
      if (bitmap) {
        drawIconElement(ctx, iconEl, bitmap);
      } else {
        // Trigger fetch, will render on next frame once loaded
        getIconBitmap(iconEl);
        assetsPending = true;
      }
    } else {
      renderShape(rc, element as unknown as ShapeElement);
    }
    
    ctx.restore();
  });

  ctx.restore();
  return assetsPending;
};

/**
 * Draw a text element. A label bound to a shape is laid out against the shape's
 * current box at draw time — nothing has to keep the two in sync when the
 * container is moved or resized.
 */
const renderText = (
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  elementsMap: Map<string, WhiteboardElement>
) => {
  const container = el.containerId ? elementsMap.get(el.containerId) : undefined;
  const { lines, width, height, lineHeight } = layoutText(el, container);
  if (lines.length === 0) return;

  const fontSize = el.fontSize || 18;
  ctx.font = textFontString(el);
  ctx.fillStyle = el.color || el.style.stroke;
  ctx.globalAlpha = el.style.opacity ?? 1;
  ctx.textBaseline = 'top';

  let originX = el.x;
  let originY = el.y;
  if (container) {
    // Centred in the container, both axes.
    const cx = Math.min(container.x, container.x + container.width) + Math.abs(container.width) / 2;
    const cy = Math.min(container.y, container.y + container.height) + Math.abs(container.height) / 2;
    originX = cx;
    originY = cy - height / 2;
  }

  const align = container ? 'center' : (el.textAlign ?? 'left');

  lines.forEach((line, i) => {
    let x = originX;
    if (align === 'center') {
      x = container ? originX - measureLine(line, fontSize, el.fontFamily || FONT_FAMILIES[0].value) / 2
                    : originX + (width - measureLine(line, fontSize, el.fontFamily || FONT_FAMILIES[0].value)) / 2;
    } else if (align === 'right') {
      x = originX + width - measureLine(line, fontSize, el.fontFamily || FONT_FAMILIES[0].value);
    }
    ctx.fillText(line, x, originY + i * lineHeight);
  });

  ctx.globalAlpha = 1;
};

const renderGrid = (
  ctx: CanvasRenderingContext2D, 
  viewport: Viewport, 
  width: number, 
  height: number, 
  grid: GridSettings
) => {
  if (!grid.enabled) return;

  const scaledSize = grid.size * viewport.zoom;
  if (scaledSize < 5) return; // Don't render grid if too zoomed out

  const offsetX = viewport.x % scaledSize;
  const offsetY = viewport.y % scaledSize;

  ctx.save();
  ctx.resetTransform(); // Render grid in screen space
  
  ctx.strokeStyle = grid.color;
  ctx.fillStyle = grid.color;
  ctx.globalAlpha = grid.opacity;
  ctx.lineWidth = 1;

  if (grid.type === 'lines' || grid.type === 'square') {
    ctx.beginPath();
    for (let x = offsetX; x < width; x += scaledSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    if (grid.type === 'square') {
      for (let y = offsetY; y < height; y += scaledSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
    }
    ctx.stroke();
  } else if (grid.type === 'dots') {
    for (let x = offsetX; x < width; x += scaledSize) {
      for (let y = offsetY; y < height; y += scaledSize) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  ctx.restore();
};

import { getConnectorMidpoint } from './connectors';

export function drawConnectorHandles(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  zoom: number
) {
  const HANDLE_RADIUS = Math.max(5, 7 / zoom); 
  const HANDLE_FILL = 'rgba(255, 255, 255, 0.95)';
  const HANDLE_STROKE = '#4f8ef7';
  const HANDLE_STROKE_WIDTH = 1.5 / zoom;

  const mid = getConnectorMidpoint(el);
  drawCircleHandle(ctx, mid.x, mid.y, HANDLE_RADIUS, HANDLE_FILL, HANDLE_STROKE, HANDLE_STROKE_WIDTH);

  drawCircleHandle(ctx, el.startX, el.startY, HANDLE_RADIUS, HANDLE_FILL, HANDLE_STROKE, HANDLE_STROKE_WIDTH);
  drawCircleHandle(ctx, el.endX, el.endY, HANDLE_RADIUS, HANDLE_FILL, HANDLE_STROKE, HANDLE_STROKE_WIDTH);

  if (el.isManuallyRouted && el.controlPoints) {
    for (const cp of el.controlPoints) {
      if (!cp) continue;
      ctx.save();
      ctx.setLineDash([3 / zoom, 3 / zoom]);
      ctx.strokeStyle = 'rgba(79, 142, 247, 0.4)';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(cp.x, cp.y);
      ctx.lineTo(el.endX, el.endY);
      ctx.stroke();
      ctx.restore();

      drawDiamondHandle(ctx, cp.x, cp.y, HANDLE_RADIUS * 0.8, HANDLE_FILL, HANDLE_STROKE, HANDLE_STROKE_WIDTH);
    }
  }
}

function drawCircleHandle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, stroke: string, strokeWidth: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();
}

function drawDiamondHandle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, stroke: string, strokeWidth: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();
}

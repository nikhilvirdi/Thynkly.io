/**
 * SVG export.
 *
 * Shapes go through the same `renderShape` definitions the canvas uses (via
 * roughjs's SVG backend), so an exported diagram is the same drawing rather
 * than a second implementation that slowly drifts from the first.
 */

import rough from 'roughjs';
import {
  WhiteboardElement,
  ShapeType,
  ShapeElement,
  FreehandElement,
  TextElement,
  ImageElement,
  ConnectorElement,
  IconElement,
} from '@/types';
import { renderShape, type RoughLike } from '../canvas/shapes';
import { freehandOutlinePath } from '../canvas/freehand';
import { layoutText, measureLine, FONT_FAMILIES } from '../canvas/text';
import { getArrowheadShape, arrowheadSize, type Arrowhead } from '../canvas/arrowheads';
import { ConnectorManager } from '../canvas/connectors';
import { loadIconComponent } from '../icons/loader';
import { getContentBounds } from './bounds';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgExportOptions {
  elements: WhiteboardElement[];
  background?: string;
  padding?: number;
}

export async function exportToSVGString({
  elements,
  background = 'transparent',
  padding = 20,
}: SvgExportOptions): Promise<string> {
  const bounds = getContentBounds(elements, padding);
  const { minX, minY } = bounds;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  if (background && background !== 'transparent') {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', background);
    svg.appendChild(bg);
  }

  // Everything is authored in world coordinates; one translate puts the
  // content's top-left at the origin.
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('transform', `translate(${-minX} ${-minY})`);
  svg.appendChild(root);

  const rs = rough.svg(svg);
  const connectorManager = new ConnectorManager();
  const elementsMap = new Map(elements.map((e) => [e.id, e]));

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  for (const element of sorted) {
    const group = document.createElementNS(SVG_NS, 'g');
    if (element.rotation && element.type !== ShapeType.FREEHAND) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      group.setAttribute(
        'transform',
        `rotate(${(element.rotation * 180) / Math.PI} ${cx} ${cy})`
      );
    }
    root.appendChild(group);

    switch (element.type) {
      case ShapeType.FREEHAND: {
        appendFreehand(group, element as FreehandElement);
        break;
      }
      case ShapeType.TEXT: {
        const textEl = element as TextElement;
        appendText(group, textEl, textEl.containerId ? elementsMap.get(textEl.containerId) : undefined);
        break;
      }
      case ShapeType.IMAGE: {
        const img = element as ImageElement;
        const node = document.createElementNS(SVG_NS, 'image');
        node.setAttribute('href', img.src);
        node.setAttribute('x', String(img.x));
        node.setAttribute('y', String(img.y));
        node.setAttribute('width', String(img.width));
        node.setAttribute('height', String(img.height));
        node.setAttribute('opacity', String((img.opacity ?? 100) / 100));
        if (img.flipX || img.flipY) {
          const cx = img.x + img.width / 2;
          const cy = img.y + img.height / 2;
          node.setAttribute(
            'transform',
            `translate(${cx} ${cy}) scale(${img.flipX ? -1 : 1} ${img.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
          );
        }
        group.appendChild(node);
        break;
      }
      case ShapeType.CONNECTOR: {
        appendConnector(group, element as ConnectorElement, connectorManager, elementsMap);
        break;
      }
      case ShapeType.ICON: {
        await appendIcon(group, element as IconElement);
        break;
      }
      default: {
        // Shapes: reuse the canvas geometry through roughjs's SVG backend.
        const sink: RoughLike = {
          rectangle: (...a) => group.appendChild(rs.rectangle(...(a as Parameters<typeof rs.rectangle>))),
          ellipse: (...a) => group.appendChild(rs.ellipse(...(a as Parameters<typeof rs.ellipse>))),
          polygon: (...a) => group.appendChild(rs.polygon(...(a as Parameters<typeof rs.polygon>))),
          line: (...a) => group.appendChild(rs.line(...(a as Parameters<typeof rs.line>))),
        };
        renderShape(sink, element as ShapeElement);
        break;
      }
    }
  }

  return new XMLSerializer().serializeToString(svg);
}

function appendFreehand(group: SVGGElement, el: FreehandElement) {
  const penType = el.style.penType || 'pen';
  const color = el.style.stroke;
  const opacity = el.style.opacity ?? 1;

  // Marker and highlighter are wide translucent strokes on canvas rather than
  // a filled outline, so they export as stroked polylines.
  if (penType === 'marker' || penType === 'highlighter' || penType === 'pencil') {
    const path = document.createElementNS(SVG_NS, 'polyline');
    path.setAttribute('points', el.points.map((p) => `${p[0]},${p[1]}`).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-linecap', penType === 'highlighter' ? 'square' : 'round');
    path.setAttribute('stroke-linejoin', 'round');
    const widthScale = penType === 'highlighter' ? 8 : penType === 'marker' ? 5 : 0.7;
    path.setAttribute('stroke-width', String((el.style.strokeWidth || 2) * widthScale));
    path.setAttribute(
      'opacity',
      String(penType === 'highlighter' ? opacity * 0.35 : penType === 'marker' ? opacity * 0.85 : opacity * 0.6)
    );
    group.appendChild(path);
    return;
  }

  const d = freehandOutlinePath(el);
  if (!d) return;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', color);
  path.setAttribute('opacity', String(opacity));
  group.appendChild(path);
}

function appendText(group: SVGGElement, el: TextElement, container?: WhiteboardElement) {
  const fontSize = el.fontSize || 18;
  // Same wrapping and centring the canvas uses, so a bound label exports in
  // the middle of its shape rather than at the element's stale x/y.
  const { lines, width, lineHeight, height } = layoutText(el, container);

  let originX = el.x;
  let originY = el.y;
  if (container) {
    originX = Math.min(container.x, container.x + container.width) + Math.abs(container.width) / 2;
    originY = Math.min(container.y, container.y + container.height) + Math.abs(container.height) / 2 - height / 2;
  }

  const align = container ? 'center' : (el.textAlign ?? 'left');
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const x = align === 'left' ? originX : align === 'right' ? originX + width : (container ? originX : originX + width / 2);

  lines.forEach((line, i) => {
    const node = document.createElementNS(SVG_NS, 'text');
    node.setAttribute('x', String(x));
    // Canvas draws with textBaseline 'top'; SVG's default is the alphabetic
    // baseline, so without this every line sits one ascent too high.
    node.setAttribute('y', String(originY + i * lineHeight));
    node.setAttribute('dominant-baseline', 'text-before-edge');
    node.setAttribute('text-anchor', anchor);
    node.setAttribute('font-family', el.fontFamily || FONT_FAMILIES[0].value);
    node.setAttribute('font-size', String(fontSize));
    node.setAttribute('fill', el.color || el.style.stroke);
    node.setAttribute('opacity', String(el.style.opacity ?? 1));
    node.textContent = line;
    group.appendChild(node);
  });
}

function appendConnector(
  group: SVGGElement,
  el: ConnectorElement,
  manager: ConnectorManager,
  elementsMap: Map<string, WhiteboardElement>
) {
  const { startX, startY, endX, endY } = manager.resolveConnectorEndpoints(el, elementsMap);
  const cp = el.controlPoints;

  const curved = cp && cp.length >= 2 && el.routingMode !== 'straight';

  const strokeAttrs = (node: SVGElement) => {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', el.style.stroke);
    node.setAttribute('stroke-width', String(el.style.strokeWidth || 2));
    node.setAttribute('opacity', String(el.style.opacity ?? 1));
    if (el.style.strokeStyle === 'dashed') node.setAttribute('stroke-dasharray', '8 8');
    if (el.style.strokeStyle === 'dotted') node.setAttribute('stroke-dasharray', '2 4');
  };

  // A label sits in a gap in the line, so the line is emitted as the runs
  // either side of it. Drawing the full path and putting text on top — which
  // this used to do — struck the label through.
  const labelBox = el.label ? connectorLabelBox(el, manager, elementsMap) : null;

  if (labelBox) {
    const pts: { x: number; y: number }[] = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      if (curved) {
        const mt = 1 - t;
        pts.push({
          x: mt ** 3 * startX + 3 * mt ** 2 * t * cp![0]!.x + 3 * mt * t ** 2 * cp![1]!.x + t ** 3 * endX,
          y: mt ** 3 * startY + 3 * mt ** 2 * t * cp![0]!.y + 3 * mt * t ** 2 * cp![1]!.y + t ** 3 * endY,
        });
      } else {
        pts.push({ x: startX + (endX - startX) * t, y: startY + (endY - startY) * t });
      }
    }

    const inside = (p: { x: number; y: number }) =>
      p.x >= labelBox.x && p.x <= labelBox.x + labelBox.w &&
      p.y >= labelBox.y && p.y <= labelBox.y + labelBox.h;

    let run: { x: number; y: number }[] = [];
    const flush = () => {
      if (run.length < 2) return;
      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('points', run.map((p) => `${p.x},${p.y}`).join(' '));
      strokeAttrs(line);
      group.appendChild(line);
    };
    for (const p of pts) {
      if (inside(p)) { flush(); run = []; } else { run.push(p); }
    }
    flush();

  } else {
    const d = curved
      ? `M ${startX} ${startY} C ${cp![0]!.x} ${cp![0]!.y}, ${cp![1]!.x} ${cp![1]!.y}, ${endX} ${endY}`
      : `M ${startX} ${startY} L ${endX} ${endY}`;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    strokeAttrs(path);
    group.appendChild(path);
  }

  // Heads, using the same geometry the canvas draws so an export matches.
  const strokeWidth = el.style.strokeWidth || 2;
  const size = arrowheadSize(strokeWidth);

  const addHead = (type: string, x: number, y: number, angle: number) => {
    const shape = getArrowheadShape(type as Arrowhead, x, y, angle, size);
    if (!shape) return;

    const node = shape.circle
      ? document.createElementNS(SVG_NS, 'circle')
      : document.createElementNS(SVG_NS, shape.closed ? 'polygon' : 'polyline');

    if (shape.circle) {
      node.setAttribute('cx', String(shape.circle.cx));
      node.setAttribute('cy', String(shape.circle.cy));
      node.setAttribute('r', String(shape.circle.r));
    } else {
      node.setAttribute('points', shape.points.map((p) => `${p.x},${p.y}`).join(' '));
    }

    node.setAttribute('fill', shape.filled ? el.style.stroke : 'none');
    node.setAttribute('stroke', el.style.stroke);
    node.setAttribute('stroke-width', String(strokeWidth));
    node.setAttribute('stroke-linejoin', 'round');
    group.appendChild(node);
  };

  const endAngle = Math.atan2(endY - (cp?.[1]?.y ?? startY), endX - (cp?.[1]?.x ?? startX));
  addHead(el.endArrowhead ?? 'triangle', endX, endY, endAngle);

  const startAngle = Math.atan2(startY - (cp?.[0]?.y ?? endY), startX - (cp?.[0]?.x ?? endX));
  addHead(el.startArrowhead ?? 'none', startX, startY, startAngle);

  if (el.label) {
    const mid = manager.getPointOnCurve(0.5, startX, startY, endX, endY, cp);
    const fontSize = el.labelFontSize || 16;
    const lines = el.label.split('\n');
    const lineHeight = fontSize * 1.25;
    lines.forEach((line, i) => {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(mid.x));
      text.setAttribute('y', String(mid.y - (lines.length * lineHeight) / 2 + lineHeight * (i + 0.5)));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', FONT_FAMILIES[0].value);
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute('fill', el.style.stroke);
      text.textContent = line;
      group.appendChild(text);
    });
  }
}

/**
 * The box a connector's label occupies, in world coordinates. Mirrors the
 * canvas renderer's measurement so an export gaps the line in the same place.
 */
function connectorLabelBox(
  el: ConnectorElement,
  manager: ConnectorManager,
  elementsMap: Map<string, WhiteboardElement>
): { x: number; y: number; w: number; h: number } | null {
  if (!el.label) return null;
  const { startX, startY, endX, endY } = manager.resolveConnectorEndpoints(el, elementsMap);
  const mid = manager.getPointOnCurve(0.5, startX, startY, endX, endY, el.controlPoints);

  const fontSize = el.labelFontSize || 16;
  const lines = el.label.split('\n');
  const lineHeight = fontSize * 1.25;
  const widest = Math.max(...lines.map((l) => measureLine(l, fontSize, FONT_FAMILIES[0].value)));
  const padX = 8;
  const padY = 3;
  const h = lines.length * lineHeight;

  return {
    x: mid.x - widest / 2 - padX,
    y: mid.y - h / 2 - padY,
    w: widest + padX * 2,
    h: h + padY * 2,
  };
}

async function appendIcon(group: SVGGElement, el: IconElement) {
  // Icons are Lucide/Tabler React components; render one to markup and inline
  // it, rather than rasterising as the canvas does.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = await import('react');
  const Component = await loadIconComponent(el.iconName, el.iconLibrary);
  if (!Component) return;

  const markup = renderToStaticMarkup(
    React.createElement(Component, {
      color: el.style?.stroke || el.color,
      size: el.width,
    })
  );

  const wrapper = document.createElementNS(SVG_NS, 'g');
  wrapper.setAttribute('transform', `translate(${el.x} ${el.y})`);
  wrapper.setAttribute('opacity', String(el.style?.opacity ?? 1));
  wrapper.innerHTML = markup;
  group.appendChild(wrapper);
}

/** Serialize and hand the browser a download. */
export async function downloadSVG(options: SvgExportOptions, filename: string) {
  const svg = await exportToSVGString(options);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

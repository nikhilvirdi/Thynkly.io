import { WhiteboardElement, ShapeType, FreehandElement, ConnectorElement, ImageElement, TextElement, StickyElement, IconElement } from '@/types';

interface XMLExportOptions {
  elements: WhiteboardElement[];
  background: string;
}

const escapeXML = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Serialize a WhiteboardElement to an XML element string.
 * Primitive fields (string, number, boolean, null) become attributes.
 * Nested object / array fields become child elements to avoid data loss.
 */
const elementToXML = (el: WhiteboardElement): string => {
  // Collect primitive-valued top-level fields as attributes
  const primitiveAttrs = Object.entries(el)
    .filter(([key, value]) => {
      if (key === 'type') return false; // already in the tag
      if (key === 'style') return false; // nested — serialized below
      if (key === 'bbox') return false; // derived — not needed in export
      if (key === 'points') return false; // array — serialized below
      if (key === 'controlPoints') return false; // array — serialized below
      if (key === 'startOffsetFromCenter') return false; // object
      if (key === 'endOffsetFromCenter') return false; // object
      if (key === 'groupIds') return false; // array — serialized below
      // Keep src for ImageElement (base64) as a child to avoid huge attr lines
      if (key === 'src') return false;
      const t = typeof value;
      return t === 'string' || t === 'number' || t === 'boolean' || value === null;
    })
    .map(([key, value]) => `${key}="${escapeXML(String(value))}"`)
    .join(' ');

  const lines: string[] = [];
  lines.push(`  <element type="${el.type}" ${primitiveAttrs}>`);

  // style — always present on BaseElement
  if (el.style) {
    const styleAttrs = Object.entries(el.style)
      .map(([k, v]) => `${k}="${escapeXML(String(v))}"`)
      .join(' ');
    lines.push(`    <style ${styleAttrs} />`);
  }

  // FreehandElement.points — [x, y, pressure?][]
  if (el.type === ShapeType.FREEHAND) {
    const fh = el as FreehandElement;
    lines.push(`    <points>`);
    for (const pt of fh.points) {
      const p = pt[2] !== undefined
        ? `x="${pt[0]}" y="${pt[1]}" pressure="${pt[2]}"`
        : `x="${pt[0]}" y="${pt[1]}"`;
      lines.push(`      <pt ${p} />`);
    }
    lines.push(`    </points>`);
  }

  // ConnectorElement complex fields
  if (el.type === ShapeType.CONNECTOR) {
    const conn = el as ConnectorElement;
    if (conn.controlPoints && conn.controlPoints.length > 0) {
      lines.push(`    <controlPoints>`);
      for (const cp of conn.controlPoints) {
        lines.push(`      <cp x="${cp.x}" y="${cp.y}" />`);
      }
      lines.push(`    </controlPoints>`);
    }
    if (conn.startOffsetFromCenter) {
      lines.push(`    <startOffsetFromCenter x="${conn.startOffsetFromCenter.x}" y="${conn.startOffsetFromCenter.y}" />`);
    }
    if (conn.endOffsetFromCenter) {
      lines.push(`    <endOffsetFromCenter x="${conn.endOffsetFromCenter.x}" y="${conn.endOffsetFromCenter.y}" />`);
    }
  }

  // ImageElement.src — potentially large base64, placed in a child element
  if (el.type === ShapeType.IMAGE) {
    const img = el as ImageElement;
    lines.push(`    <src>${escapeXML(img.src)}</src>`);
  }

  // groupIds — optional array of group id strings
  if (el.groupIds && el.groupIds.length > 0) {
    lines.push(`    <groupIds>`);
    for (const gid of el.groupIds) {
      lines.push(`      <groupId value="${escapeXML(gid)}" />`);
    }
    lines.push(`    </groupIds>`);
  }

  lines.push(`  </element>`);
  return lines.join('\n');
};

export const downloadXML = (
  { elements, background }: XMLExportOptions,
  filename: string
): void => {
  const body = elements.map(elementToXML).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<thynkly-scene version="1" background="${escapeXML(background)}">\n  <elements>\n${body}\n  </elements>\n</thynkly-scene>\n`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

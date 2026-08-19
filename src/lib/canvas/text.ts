/**
 * Text measurement and wrapping.
 *
 * Sizing used to be `Math.max(200, text.length * 10)`, which is wrong for any
 * font size other than the default and for anything but one line — so selection
 * boxes, hit testing and exports all disagreed with what was on screen.
 */

import { TextElement } from '@/types';

export const LINE_HEIGHT = 1.4;
/** Gap between a label and the edge of the shape it is bound to. */
export const CONTAINER_PADDING = 8;

export const FONT_FAMILIES = [
  { label: 'Sans',    value: 'Inter, system-ui, sans-serif' },
  { label: 'Serif',   value: 'Georgia, serif' },
  { label: 'Mono',    value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'Script',  value: "'Comic Sans MS', 'Chalkboard SE', cursive" },
  { label: 'Narrow',  value: "'Arial Narrow', 'Helvetica Neue Condensed', sans-serif" },
] as const;

// One reusable context; creating a canvas per measurement is measurably slow
// when it happens per frame during wrapping.
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export const fontString = (fontSize: number, fontFamily: string, bold?: boolean, italic?: boolean) =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;

/** Build the full CSS font string for a TextElement, respecting bold/italic. */
export const textFontString = (el: TextElement): string =>
  fontString(el.fontSize || 18, el.fontFamily || FONT_FAMILIES[0].value, el.bold, el.italic);

export function measureLine(text: string, fontSize: number, fontFamily: string): number {
  const ctx = getMeasureContext();
  if (!ctx) return text.length * fontSize * 0.6;   // SSR fallback
  ctx.font = fontString(fontSize, fontFamily);
  return ctx.measureText(text).width;
}

/** Size of a block of already-broken lines. */
export function measureText(
  text: string,
  fontSize: number,
  fontFamily: string
): { width: number; height: number } {
  const lines = text.split('\n');
  const width = Math.max(0, ...lines.map((l) => measureLine(l, fontSize, fontFamily)));
  return { width, height: Math.max(1, lines.length) * fontSize * LINE_HEIGHT };
}

/**
 * Break text to fit `maxWidth`, on spaces where possible and mid-word when a
 * single word is itself too long.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string
): string[] {
  if (maxWidth <= 0) return text.split('\n');
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { out.push(''); continue; }

    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureLine(candidate, fontSize, fontFamily) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) out.push(line);

      // A word longer than the whole line has to be cut somewhere.
      if (measureLine(word, fontSize, fontFamily) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (measureLine(chunk + ch, fontSize, fontFamily) > maxWidth && chunk) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    out.push(line);
  }

  return out;
}

/** The lines and box a text element should be drawn with. */
export function layoutText(
  el: TextElement,
  container?: { x: number; y: number; width: number; height: number }
): { lines: string[]; width: number; height: number; lineHeight: number } {
  const fontSize = el.fontSize || 18;
  const fontFamily = el.fontFamily || FONT_FAMILIES[0].value;
  // Use the element's lineHeight multiplier if set, otherwise the global constant.
  const lineHeightMultiplier = el.lineHeight ?? LINE_HEIGHT;
  const lineHeight = fontSize * lineHeightMultiplier;

  const lines = container
    ? wrapText(el.text || '', Math.abs(container.width) - CONTAINER_PADDING * 2, fontSize, fontFamily)
    : (el.text || '').split('\n');

  const width = Math.max(0, ...lines.map((l) => measureLine(l, fontSize, fontFamily)));
  return { lines, width, height: lines.length * lineHeight, lineHeight };
}

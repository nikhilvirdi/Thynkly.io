/**
 * Sticky notes.
 *
 * Two states: an open note (paper + wrapped text + a close affordance) and a
 * collapsed dot. Collapsing keeps the note on the board without it covering the
 * drawing, and the dot is the thing you click to bring it back.
 *
 * The hit regions are computed here rather than in the canvas component so the
 * geometry can be tested without a DOM.
 */

import { StickyElement, Point } from '@/types';
import { wrapText, measureLine } from './text';

/** Radius of the collapsed dot, in world units. */
export const STICKY_DOT_RADIUS = 13;
/** A collapsed note's full footprint — the element shrinks to exactly this. */
export const STICKY_DOT_SIZE = STICKY_DOT_RADIUS * 2;
/** Size of the close hotspot in the note's top-right corner. */
export const STICKY_CLOSE_SIZE = 18;
const PADDING = 12;
const LINE_RATIO = 1.35;

export const STICKY_COLORS = [
  '#fef08a', // yellow
  '#bbf7d0', // green
  '#bfdbfe', // blue
  '#fbcfe8', // pink
  '#fed7aa', // orange
  '#e9d5ff', // purple
];

/** Notes are pale, so text is always the same dark ink. */
export const STICKY_INK = '#1f2937';

/** The dot's centre when collapsed — the note's top-left corner. */
export function stickyDotCentre(el: StickyElement): Point {
  return { x: el.x + STICKY_DOT_RADIUS, y: el.y + STICKY_DOT_RADIUS };
}

/** Is this world point on the collapsed dot? */
export function hitStickyDot(el: StickyElement, p: Point): boolean {
  if (!el.collapsed) return false;
  const c = stickyDotCentre(el);
  return (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= STICKY_DOT_RADIUS ** 2;
}

/** Is this world point on the open note's close button? */
export function hitStickyClose(el: StickyElement, p: Point): boolean {
  if (el.collapsed) return false;
  const right = el.x + Math.abs(el.width);
  return (
    p.x >= right - STICKY_CLOSE_SIZE &&
    p.x <= right &&
    p.y >= el.y &&
    p.y <= el.y + STICKY_CLOSE_SIZE
  );
}

/** Lines of the note's text, wrapped to its width. */
export function stickyLines(el: StickyElement): string[] {
  return wrapText(
    el.text || '',
    Math.abs(el.width) - PADDING * 2,
    el.fontSize || 16,
    el.fontFamily || 'Inter, system-ui, sans-serif'
  );
}

export function renderSticky(
  ctx: CanvasRenderingContext2D,
  el: StickyElement,
  /** Skip the text — the inline editor is drawing it instead. */
  hideText = false
) {
  ctx.save();
  ctx.globalAlpha = el.style?.opacity ?? 1;

  if (el.collapsed) {
    // Collapsed: just the dot, with a subtle ring so it reads as a control.
    const c = stickyDotCentre(el);
    ctx.beginPath();
    ctx.arc(c.x, c.y, STICKY_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = el.noteColor;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // A folded-corner mark, so a collapsed note is not mistaken for a dot the
    // user drew.
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y + 3);
    ctx.lineTo(c.x + 4, c.y + 3);
    ctx.moveTo(c.x - 4, c.y - 1);
    ctx.lineTo(c.x + 4, c.y - 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
    return;
  }

  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  
  // Size of the folded corner (proportional to width, but clamped)
  const foldSize = Math.max(12, Math.min(32, w * 0.15));

  // 1. Drop shadow (only applied to the main paper body)
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.shadowOffsetX = 2;

  // 2. Paper body (drawn with the bottom-right corner cut out for the fold)
  ctx.fillStyle = el.noteColor;
  ctx.beginPath();
  ctx.moveTo(el.x, el.y);
  ctx.lineTo(el.x + w, el.y);
  ctx.lineTo(el.x + w, el.y + h - foldSize);
  ctx.lineTo(el.x + w - foldSize, el.y + h);
  ctx.lineTo(el.x, el.y + h);
  ctx.closePath();
  ctx.fill();

  // Reset shadow so subsequent drawings (fold, pin, text) don't get this huge shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowOffsetX = 0;

  // A slight darker edge for the paper
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. Folded Corner (bottom-right)
  ctx.beginPath();
  ctx.moveTo(el.x + w, el.y + h - foldSize);
  ctx.lineTo(el.x + w - foldSize, el.y + h - foldSize);
  ctx.lineTo(el.x + w - foldSize, el.y + h);
  ctx.closePath();

  // The fold needs some shading to look curled up.
  const gradient = ctx.createLinearGradient(
    el.x + w - foldSize, el.y + h - foldSize,
    el.x + w, el.y + h
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0.02)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.18)');

  ctx.fillStyle = el.noteColor;
  ctx.fill(); // base color
  ctx.fillStyle = gradient;
  ctx.fill(); // shading overlay
  
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 4. Pin at the top
  const pinRadius = 4.5;
  const pinX = el.x + w / 2;
  const pinY = el.y + 12;
  
  // Pin shadow
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  
  ctx.beginPath();
  ctx.arc(pinX, pinY, pinRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444'; // Red pin
  ctx.fill();
  
  ctx.shadowColor = 'transparent';
  
  // Pin highlight
  ctx.beginPath();
  ctx.arc(pinX - 1.5, pinY - 1.5, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();

  // 5. Close affordance — the × that collapses the note
  const cx = el.x + w - STICKY_CLOSE_SIZE / 2;
  const cy = el.y + STICKY_CLOSE_SIZE / 2;
  const arm = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy - arm);
  ctx.lineTo(cx + arm, cy + arm);
  ctx.moveTo(cx + arm, cy - arm);
  ctx.lineTo(cx - arm, cy + arm);
  ctx.stroke();

  if (hideText) {
    ctx.restore();
    return;
  }

  // 6. Text
  const safeFontSize = el.fontSize || 16;
  const safeFontFamily = el.fontFamily || 'Inter, system-ui, sans-serif';
  
  const lines = stickyLines(el);
  ctx.fillStyle = STICKY_INK;
  ctx.font = `${safeFontSize}px ${safeFontFamily}`;
  ctx.textBaseline = 'top';
  
  const lineHeight = safeFontSize * LINE_RATIO;
  
  // We add extra padding at the top so the text doesn't overlap the pin.
  const topPadding = PADDING + 12; 
  const maxLines = Math.max(1, Math.floor((h - topPadding - PADDING) / lineHeight));

  lines.slice(0, maxLines).forEach((line, i) => {
    // The last visible line gets an ellipsis when the note is overfull
    const overflowing = lines.length > maxLines && i === maxLines - 1;
    let out = line;
    if (overflowing) {
      out = line;
      while (
        out.length > 1 &&
        measureLine(out + '…', safeFontSize, safeFontFamily) > w - PADDING * 2
      ) {
        out = out.slice(0, -1);
      }
      out += '…';
    }
    ctx.fillText(out, el.x + PADDING, el.y + topPadding + i * lineHeight);
  });

  ctx.restore();
}

import type { IconElement } from '@/types/canvas';
import { loadIconComponent } from '../icons/loader';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

// Cache rendered icon bitmaps to avoid re-serializing every frame
const bitmapCache = new Map<string, ImageBitmap>();
const fetchingKeys = new Set<string>();

export async function getIconBitmap(element: IconElement): Promise<ImageBitmap | null> {
  const color = element.style?.stroke || element.color || '#e2e8f0';
  const cacheKey = `${element.iconName}-${color}-${element.width}-${element.style?.strokeWidth || 2}`;
  
  if (bitmapCache.has(cacheKey)) return bitmapCache.get(cacheKey)!;
  if (fetchingKeys.has(cacheKey)) return null;

  fetchingKeys.add(cacheKey);

  try {
    const Component = await loadIconComponent(element.iconName, element.iconLibrary);
    if (!Component) return null;

    // Render the Material Symbols icon to an SVG string
    const svgMarkup = renderToStaticMarkup(
      React.createElement(Component, {
        color: color,
        size: element.width,
      })
    );

    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    
    URL.revokeObjectURL(url);
    const bitmap = await createImageBitmap(img);
    bitmapCache.set(cacheKey, bitmap);
    fetchingKeys.delete(cacheKey);
    return bitmap;
  } catch (e) {
    console.error('Failed to create icon bitmap', e);
    fetchingKeys.delete(cacheKey);
    return null;
  }
}

export function getIconBitmapSync(element: IconElement): ImageBitmap | null {
  const color = element.style?.stroke || element.color || '#e2e8f0';
  const cacheKey = `${element.iconName}-${color}-${element.width}-${element.style?.strokeWidth || 2}`;
  return bitmapCache.get(cacheKey) || null;
}

export function drawIconElement(ctx: CanvasRenderingContext2D, element: IconElement, bitmap: ImageBitmap | null) {
  if (!bitmap) return;
  
  ctx.save();
  ctx.globalAlpha = element.style?.opacity ?? 1;
  
  // Apply rotation around element center
  if (element.rotation !== 0) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((element.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  
  ctx.drawImage(bitmap, element.x, element.y, element.width, element.height);
  ctx.restore();
}

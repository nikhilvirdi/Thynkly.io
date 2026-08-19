'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvas-store';
import { Shapes, Search, X, GripHorizontal } from 'lucide-react';
import { searchIcons } from '@/lib/icons/search';
import { ICON_CATEGORIES } from '@/lib/icons/registry';
import { loadIconComponent } from '@/lib/icons/loader';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { IconMeta } from '@/lib/icons/types';

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

const IconRow = React.memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: { results: IconMeta[]; loadedIcons: Record<string, IconComponent>; addIconElement: (n: string, l: "material-symbols") => void; COLUMN_COUNT: number } }) => {
  const { results, loadedIcons, addIconElement, COLUMN_COUNT } = data;
  const startIndex = index * COLUMN_COUNT;
  const rowItems = results.slice(startIndex, startIndex + COLUMN_COUNT);

  return (
    <div style={style} className="grid grid-cols-3 gap-1.5 pr-1.5 pb-1.5">
      {rowItems.map((meta: IconMeta) => {
        const cacheKey = `${meta.library}:${meta.name}`;
        const IconComp = loadedIcons[cacheKey];

        return (
          <button
            key={meta.name}
            id={`icon-item-${meta.slug}`}
            className="flex flex-col items-center justify-center p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/40 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600 hover:scale-105 active:scale-95 transition-all group"
            onClick={() => addIconElement(meta.name, meta.library)}
            title={meta.name}
          >
            {IconComp ? (
              <IconComp
                className="text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white mb-1 transition-colors"
                style={{ width: 22, height: 22 }}
              />
            ) : (
              <div className="w-[22px] h-[22px] mb-1 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
            )}
            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 truncate w-full text-center leading-tight transition-colors">
              {meta.name}
            </span>
          </button>
        );
      })}
    </div>
  );
});
IconRow.displayName = 'IconRow';

export function IconPicker() {
  const isOpen = useCanvasStore((state) => state.iconPickerOpen);
  const setOpen = useCanvasStore((state) => state.setIconPickerOpen);
  const addIconElement = useCanvasStore((state) => state.addIconElement);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [loadedIcons, setLoadedIcons] = useState<Record<string, IconComponent>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state and focus search when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCategory('All');
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [isOpen]);

  const results = useMemo(() => searchIcons(query, category), [query, category]);

  // Async-load all visible icon components into state
  useEffect(() => {
    if (!isOpen || results.length === 0) return;

    let cancelled = false;
    const toLoad = results.filter(
      (meta) => !loadedIcons[`${meta.library}:${meta.name}`]
    );
    if (toLoad.length === 0) return;

    Promise.allSettled(
      toLoad.map(async (meta) => {
        const comp = await loadIconComponent(meta.name, meta.library);
        return { key: `${meta.library}:${meta.name}`, comp };
      })
    ).then((settled) => {
      if (cancelled) return;
      const newEntries: Record<string, IconComponent> = {};
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value.comp) {
          newEntries[result.value.key] = result.value.comp;
        }
      }
      if (Object.keys(newEntries).length > 0) {
        setLoadedIcons((prev) => ({ ...prev, ...newEntries }));
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, results]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="icon-picker-panel"
        drag
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.95, x: -8 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        exit={{ opacity: 0, scale: 0.95, x: -8 }}
        transition={{ duration: 0.15 }}
        // Initial position: left side, offset below the Layers panel.
        // Both are freely draggable after open so this is just the default slot.
        className="fixed left-4 md:left-20 top-[340px] w-56 md:w-64 max-w-[calc(100vw-32px)] bg-white/90 dark:bg-[#1a1a1e]/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl flex flex-col z-30 pointer-events-auto"
        style={{ maxHeight: 'calc(var(--app-height, 100vh) - 360px)', minHeight: '280px' }}
      >
        {/* ── Header (drag handle) ── */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800 cursor-grab active:cursor-grabbing shrink-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <GripHorizontal size={14} className="text-zinc-400 dark:text-zinc-500" />
            <Shapes size={15} className="text-zinc-600 dark:text-zinc-300" />
            Icons
          </h3>
          <button
            id="icon-picker-close"
            onClick={() => setOpen(false)}
            className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 transition-colors"
            title="Close icon picker"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Search bar ── */}
        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/60 shrink-0">
          <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-700/50 focus-within:border-zinc-400 dark:focus-within:border-zinc-500 transition-colors">
            <Search size={13} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search icons…"
              className="bg-transparent border-none outline-none text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-600 flex-1 text-xs min-w-0"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable body: categories + grid ── */}
        <div className="flex-1 min-h-0 flex flex-col">

          {/* Category list — vertical sidebar-style rows */}
          <div className="px-2 pt-2 pb-1 flex flex-col gap-0.5 border-b border-zinc-100 dark:border-zinc-800/50 max-h-32 overflow-y-auto custom-scrollbar shrink-0">
            {ICON_CATEGORIES.map((cat) => {
              const isActive = category === cat;
              return (
                <button
                  key={cat}
                  id={`icon-cat-${cat.toLowerCase()}`}
                  onClick={() => setCategory(cat)}
                  className={`w-full text-left px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Icon grid */}
          <div className="flex-1 min-h-0 p-2">
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-600">
                <Search size={24} className="mb-2 opacity-30" />
                <p className="text-xs">No icons found</p>
              </div>
            ) : (
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => {
                  const COLUMN_COUNT = 3;
                  const ROW_HEIGHT = 68;
                  const rowCount = Math.ceil(results.length / COLUMN_COUNT);
                  const itemData = { results, loadedIcons, addIconElement, COLUMN_COUNT };

                  return (
                    <List
                      height={height}
                      itemCount={rowCount}
                      itemSize={ROW_HEIGHT}
                      width={width}
                      itemData={itemData}
                      className="custom-scrollbar"
                    >
                      {IconRow}
                    </List>
                  );
                }}
              </AutoSizer>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

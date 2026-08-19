'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Download, Copy, Check } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { useUIStore } from '@/store/ui-store';
import { exportToPNG, copyPNGToClipboard } from '@/lib/export/png';
import { downloadSVG } from '@/lib/export/svg';
import { downloadOfflineHtml } from '@/lib/export/offline';
import { downloadXML } from '@/lib/export/xml';

type Format = 'png' | 'svg' | 'html' | 'xml';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const elements = useCanvasStore((s) => s.elements);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const canvasBackground = useCanvasStore((s) => s.canvasBackground);
  const grid = useUIStore((s) => s.grid);

  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState(2);
  const [withBackground, setWithBackground] = useState(true);
  const [onlySelected, setOnlySelected] = useState(selectedIds.size > 0);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exported = onlySelected && selectedIds.size > 0
    ? Array.from(selectedIds).map((id) => elements[id]).filter(Boolean)
    : Object.values(elements);

  const stamp = new Date().toISOString().split('T')[0];

  const handleDownload = async () => {
    if (exported.length === 0) return;
    setBusy(true);
    try {
      if (format === 'png') {
        await exportToPNG({
          elements: exported,
          grid,
          scale,
          background: canvasBackground,
          transparent: !withBackground,
          filename: `drawer-${stamp}.png`,
        });
      } else if (format === 'svg') {
        await downloadSVG(
          {
            elements: exported,
            background: withBackground ? canvasBackground : 'transparent',
          },
          `drawer-${stamp}.svg`
        );
      } else if (format === 'html') {
        await downloadOfflineHtml(
          {
            elements: exported,
            background: withBackground ? canvasBackground : 'transparent',
            title: `Drawer board — ${stamp}`,
          },
          `drawer-${stamp}.html`
        );
      } else {
        await downloadXML(
          {
            elements: exported,
            background: withBackground ? canvasBackground : 'transparent',
          },
          `drawer-${stamp}.xml`
        );
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (exported.length === 0) return;
    setBusy(true);
    const ok = await copyPNGToClipboard({
      elements: exported,
      grid,
      scale,
      background: canvasBackground,
      transparent: !withBackground,
    });
    setBusy(false);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1500);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1a1a1e] shadow-2xl p-5 text-foreground"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Export image</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-foreground p-1 rounded">
            <X size={16} />
          </button>
        </div>

        <Section label="Format">
          <div className="flex gap-2">
            {(['png', 'svg', 'html', 'xml'] as Format[]).map((f) => (
              <Choice key={f} active={format === f} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </Choice>
            ))}
          </div>
          {format === 'html' && (
            <p className="mt-2 text-[11px] text-zinc-500">
              One self-contained file. Open it offline in any browser to pan and
              zoom your board; the scene data rides along inside it.
            </p>
          )}
          {format === 'xml' && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Machine-readable XML containing every element&apos;s properties.
              Useful for programmatic import or archiving.
            </p>
          )}
        </Section>

        {format === 'png' && (
          <Section label="Scale">
            <div className="flex gap-2">
              {[1, 2, 3].map((s) => (
                <Choice key={s} active={scale === s} onClick={() => setScale(s)}>
                  {s}×
                </Choice>
              ))}
            </div>
          </Section>
        )}

        <Section label="Options">
          <div className="flex flex-col gap-2">
            <Toggle checked={withBackground} onChange={setWithBackground} label="Background" />
            <Toggle
              checked={onlySelected}
              onChange={setOnlySelected}
              label={`Only selected (${selectedIds.size})`}
              disabled={selectedIds.size === 0}
            />
          </div>
        </Section>

        <div className="text-[11px] text-zinc-500 mb-4">
          {exported.length === 0
            ? 'Nothing to export.'
            : `${exported.length} element${exported.length === 1 ? '' : 's'}`}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={busy || exported.length === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-foreground text-background py-2 text-sm font-medium disabled:opacity-40"
          >
            <Download size={15} /> Download
          </button>
          {format === 'png' && (
            <button
              onClick={handleCopy}
              disabled={busy || exported.length === 0}
              className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm disabled:opacity-40"
              title="Copy to clipboard"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{label}</div>
      {children}
    </div>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg border py-1.5 text-sm transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background font-medium'
          : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-500'
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-foreground"
      />
      {label}
    </label>
  );
}

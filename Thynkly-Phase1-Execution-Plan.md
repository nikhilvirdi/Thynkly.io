# Thynkly.io — Phase 1 Execution Plan (Agent SSOT)

**This document is the single source of truth for Phase 1. Do not deviate from it, do not re-derive architecture, do not choose your own approach where this document already specifies one. If something in this document conflicts with what you observe in the code, stop and flag it — do not silently improvise a fix.**

Full project context lives in `Thynkly-Roadmap.md` and `Thynkly-System-Architecture.md` in the repo root — read those for background only. This document alone is sufficient to execute Phase 1; you should not need to make any decision this document doesn't already make for you.

---

## 0. Ground Rules (read first, applies to every task below)

1. **Do not touch anything outside the files explicitly listed in each task.** If a task says "edit `X.tsx`," don't also refactor `Y.tsx` because it looked related.
2. **Preserve all currently-working behavior.** Every feature not explicitly named in a task must work identically before and after your changes. If you're unsure whether something you're about to change affects unrelated behavior, stop and ask rather than guessing.
3. **Match the existing visual language exactly.** This app uses: Tailwind utility classes, a dark glassmorphic theme (`bg-[rgba(15,15,25,0.92)]` / `bg-white/95` for light mode, `backdrop-blur-[20px]`), zinc-scale grays (`zinc-100`–`zinc-900`) for neutral UI, and a purple-to-blue gradient (`from-[#7C3AED] to-[#2563EB]`) reserved for primary/accent actions only. Every new UI element must reuse these exact classes/values, copied from the nearest existing sibling component — never invent new colors, spacing scales, border-radii, or shadow values.
4. **No terminal commands.** You (the agent) cannot run `npm install`, `git`, or any shell command in this sandbox. Every task below states exactly which manual commands the human operator must run, and at what point in the sequence. When a task depends on a manual command having been run first, that dependency is called out explicitly — wait for confirmation before proceeding past that point.
5. **TypeScript strict mode is on.** Every change must typecheck cleanly. Do not use `any`, `@ts-ignore`, or loosen `tsconfig.json` to make an error go away.
6. **Follow the task sequence below in order.** Some tasks depend on earlier ones (called out explicitly). Do not reorder.

---

## 1. Task Sequence Overview

| # | Task | Files touched | Depends on |
|---|---|---|---|
| 1 | Fix Ctrl+V paste conflict | `useKeyboardShortcuts.ts`, `Canvas.tsx` | — |
| 2 | Fix icon default insertion size | `canvas-store.ts` | — |
| 3 | Split Zoom-to-Fit into Fit All / Fit Selection | `canvas-store.ts`, `StatusBar.tsx`, `useKeyboardShortcuts.ts` | — |
| 4 | Replace icon set with Material Symbols | `package.json` (manual install), `loader.ts`, `types.ts`, `registry.ts` | Manual `npm install` (see Task 4) |
| 5 | Restyle icon picker modal to match app theme | `IconPicker.tsx` | Task 4 (touches the same file's icon-rendering code) |
| 6 | Remove dead PDF export code, add XML export | `exporters.ts` (delete), `package.json` (manual uninstall), new `xml.ts`, `ExportDialog.tsx` | — |
| 7 | Restyle "Sign up" button to match existing UI | `MainMenu.tsx` | — |

Tasks 1, 2, 3, 6, 7 have no manual-command dependency and can be done in any order relative to each other. Task 4 requires a manual `npm install` before you can import the new package — do not attempt to write import statements for a package that isn't installed yet. Task 5 should come right after Task 4 since it touches the same component.

---

## Task 1 — Fix Ctrl+V Paste Conflict

**Problem (confirmed root cause):** Two competing handlers both act on Ctrl+V. `useKeyboardShortcuts.ts` has a keydown handler that unconditionally calls `e.preventDefault()` and pastes internally-copied Thynkly elements. This `preventDefault()` suppresses the browser's native `paste` `ClipboardEvent`, which is what `Canvas.tsx`'s image-paste listener depends on — so pasting an image from the OS clipboard silently does nothing.

**Fix approach (already decided — do not choose a different one):** Consolidate paste handling into the single native `paste` event listener that already exists in `Canvas.tsx`. Remove the competing keydown-triggered paste entirely.

**Step 1.1 — `src/hooks/useKeyboardShortcuts.ts`**

Find this block (inside the `isCtrl` switch statement):
```ts
          case 'v':
            e.preventDefault();
            paste();
            break;
```
Delete it entirely. Do not replace it with anything — the native `paste` event fires on Ctrl+V automatically without a custom keydown handler; removing this stops it from being suppressed.

If removing this causes an unused-variable lint error on `paste` (the destructured store action) elsewhere in this file, check whether `paste` is still used anywhere else in the file first — if not, remove it from the destructuring at the top of the hook. Do not leave unused imports/variables.

**Step 1.2 — `src/components/canvas/Canvas.tsx`**

Find the existing `onPaste` handler (around line 1111, inside the `useEffect` that also registers `onKeyDown`). It currently only handles the image case and does nothing if no image is found in `clipboardData.items`. Add a fallback: if the loop completes without finding an image, call the store's internal element-paste action instead — this is what the deleted keydown handler used to do, now correctly gated behind the same native paste event so it can never suppress image pasting.

The existing handler structure is:
```ts
    const onPaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.clipboardData && e.clipboardData.items) {
        const items = Array.from(e.clipboardData.items);
        for (const item of items) {
          if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const imageHandler = new ImageHandler();
              const state = useCanvasStore.getState();
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
    };
```

Change it to add an `imageFound` flag and, after the loop, fall back to internal element paste when no image was found:

```ts
    const onPaste = async (e: ClipboardEvent) => {
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
```

`lastPointerWorldPos` is already a ref that exists elsewhere in this same file (used by `handleImageFileSelect`) — reuse it, do not create a new ref.

**Acceptance criteria for Task 1:**
- Copying an image from outside the browser (e.g., a screenshot, or an image copied from a website) and pressing Ctrl+V while the canvas is focused adds that image to the board.
- Copying an element inside Thynkly (Ctrl+C) and pressing Ctrl+V still pastes that element correctly.
- Pasting while a text input, textarea, or select element is focused (e.g., editing a text element's content) is unaffected — native browser paste into that field still works normally.

---

## Task 2 — Fix Icon Default Insertion Size

**Problem:** Icons are inserted at a fixed 48×48 world-unit size regardless of context, which reads as inconsistent next to manually-drawn shapes of arbitrary size.

**Decision (already made — do not change this number):** Icons insert at a fixed **64×64** world-units, independent of current zoom level.

**File: `src/store/canvas-store.ts`**

Find the `addIconElement` function (around line 318). It currently computes the centering offset using `- 24` (half of 48) and sets `width: 48, height: 48`.

Change:
```ts
      const worldX = (-viewport.x + window.innerWidth / 2) / viewport.zoom - 24;
      const worldY = (-viewport.y + window.innerHeight / 2) / viewport.zoom - 24;
```
to:
```ts
      const worldX = (-viewport.x + window.innerWidth / 2) / viewport.zoom - 32;
      const worldY = (-viewport.y + window.innerHeight / 2) / viewport.zoom - 32;
```
(32 = half of the new 64 size, keeps the icon centered in the viewport on insertion — this is not an arbitrary number, it must always be exactly half of whatever width/height you set below.)

And change:
```ts
        width: 48,
        height: 48,
```
to:
```ts
        width: 64,
        height: 64,
```

**Acceptance criteria for Task 2:** Every icon inserted via the icon picker appears at 64×64 world-units, centered in the current viewport, at every zoom level.

---

## Task 3 — Split Zoom-to-Fit into "Fit All" and "Fit Selection"

**Problem (confirmed root cause):** The single "Zoom to Fit" button zooms to the current selection if anything is selected, and to the whole board otherwise. Since whatever was just drawn stays selected by default, pressing this button right after drawing something zooms to just that one element instead of the whole board — confusing, looks like a bug even though it's "working as coded."

**Decision (already made — do not choose a different resolution):** Split into two distinct, separately-triggerable actions:
- **Fit All** — always fits the entire board, ignores selection completely.
- **Fit Selection** — fits only the current selection; disabled/inert when nothing is selected.

**Step 3.1 — `src/store/canvas-store.ts`**

Find the `zoomToFit` function (around line 1090). It currently has this selection-branching logic:
```ts
    zoomToFit: () => set((state) => {
      // Zoom to selected elements if any, otherwise all elements
      const targetIds = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : Object.keys(state.elements);
      const els = targetIds.map(id => state.elements[id]).filter(Boolean) as WhiteboardElement[];
      ...
```

Refactor into two functions that share the fitting math. Extract the body (everything from `const els = ...` through the final `state.viewport = {...}` assignment) into a private helper that takes an explicit array of element IDs, then expose two public actions:

```ts
    zoomToFit: () => set((state) => {
      const targetIds = Object.keys(state.elements);
      fitToElements(state, targetIds);
    }),

    zoomToSelection: () => set((state) => {
      if (state.selectedIds.size === 0) return; // no-op, nothing selected
      const targetIds = Array.from(state.selectedIds);
      fitToElements(state, targetIds);
    }),
```

Where `fitToElements` is a module-level helper function (defined near `pushHistory`, same pattern — a plain function outside the store, not a store action) containing exactly the existing bounds-calculation and viewport-assignment logic that currently lives inside `zoomToFit`, parameterized on `targetIds` instead of computing it internally:

```ts
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
```

Add `zoomToSelection: () => void;` to the store's TypeScript interface, next to the existing `zoomToFit: () => void;` declaration.

**Step 3.2 — `src/components/shared/StatusBar.tsx`**

Currently there is one button bound to `zoomToFit` with the tooltip `"Zoom to Fit (Ctrl+1)"` — note this tooltip is already wrong today (the actual shortcut is Shift+1, not Ctrl+1 — fix this too while you're here, see Step 3.3).

Import `zoomToSelection` from the store alongside the existing `zoomToFit`:
```ts
  const zoomToFit = useCanvasStore(s => s.zoomToFit);
  const zoomToSelection = useCanvasStore(s => s.zoomToSelection);
```

Also pull `selectedIds` (already imported at the top of this file) to determine whether Fit Selection should be enabled.

Replace the single existing button:
```tsx
      <button
        onClick={zoomToFit}
        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground"
        title="Zoom to Fit (Ctrl+1)"
      >
        <Maximize size={14} />
      </button>
```
with two buttons, styled identically to each other and consistent with every other icon button in this same bar (same padding, hover states, disabled-state pattern already used elsewhere in this component for reference):
```tsx
      <button
        onClick={zoomToFit}
        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground"
        title="Fit All (Shift+1)"
      >
        <Maximize size={14} />
      </button>

      <button
        onClick={zoomToSelection}
        disabled={selectedIds.size === 0}
        className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-500 dark:text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
        title="Fit Selection (Shift+2)"
      >
        <Focus size={14} />
      </button>
```

Add `Focus` to the existing `lucide-react` import at the top of the file (`import { Minus, Plus, Maximize, Grid3X3, Magnet, Crosshair } from 'lucide-react';` becomes `import { Minus, Plus, Maximize, Focus, Grid3X3, Magnet, Crosshair } from 'lucide-react';`). `Focus` is a real icon in `lucide-react` — do not substitute a different icon without checking it exists in the installed version first.

**Step 3.3 — `src/hooks/useKeyboardShortcuts.ts`**

Find the existing Shift-block entry:
```ts
          case '1':
          case '!':
            e.preventDefault(); zoomToFit();
            return;
```
Keep this exactly as-is (it's correct — Shift+1 → Fit All, matches the corrected tooltip from Step 3.2). Add a new case directly after it for Fit Selection on Shift+2:
```ts
          case '2':
          case '@':
            e.preventDefault(); zoomToSelection();
            return;
```
You will need to destructure `zoomToSelection` from the store at the top of this hook alongside the existing `zoomToFit`.

**Acceptance criteria for Task 3:**
- Pressing "Fit All" (button or Shift+1) always shows the entire board, regardless of what's selected.
- Pressing "Fit Selection" (button or Shift+2) fits only the currently-selected element(s); the button is visibly disabled and does nothing when nothing is selected.
- Drawing a shape, leaving it selected, and immediately pressing "Fit All" now correctly shows the whole board — this was the originally reported bug and must be verifiably fixed.

---

## Task 4 — Replace Icon Set with Material Symbols

**Decision (already made — do not choose a different package or approach):** Use `@material-symbols-svg/react`. This was verified as the correct choice for this codebase specifically because:
- It exports individual React SVG components (`import { Home } from '@material-symbols-svg/react/icons/home'`), matching the existing `lucide-react` integration pattern exactly — `icon-renderer.ts`'s `renderToStaticMarkup(React.createElement(Component, {...}))` pipeline needs **zero changes**, only the loader needs to import from a different package.
- Apache 2.0 licensed, no attribution required (already confirmed against the "don't copy draw.io's own attributed icons" concern raised earlier).
- Actively maintained, published within the last week as of this writing.

Do not use the `material-symbols` font/CSS package (ligature-based) — that requires a completely different, incompatible rendering approach and is explicitly not what's being used here.

**⚠️ MANUAL COMMAND REQUIRED before continuing this task:**
```
npm install @material-symbols-svg/react
```
The human operator must run this in the project root before you write any import statement referencing this package. Do not proceed with Steps 4.2–4.4 until this has been confirmed done — a `npm install` you cannot run yourself is a hard blocker for this task.

Also add this to `next.config.mjs` to prevent slow dev-mode icon loading (per the package's own documentation) — this part you can do yourself, it's a file edit, not a terminal command:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['@material-symbols-svg/react'],
  },
};

export default nextConfig;
```

**Step 4.1 — `src/lib/icons/types.ts`**

Update the `library` field's type — it currently allows `'lucide' | 'tabler'`. Change to a single fixed value since there is now only one icon source:
```ts
export interface IconMeta {
  name: string;          // PascalCase component export name: 'Home', 'ArrowForward'
  slug: string;          // kebab-case import-path segment: 'home', 'arrow-forward'
  library: 'material-symbols';
  tags: string[];        // search keywords
  category: string;      // e.g. 'Arrows', 'UI', 'Files', 'Communication'
}
```

**Step 4.2 — `src/lib/icons/loader.ts`**

Replace the entire file. The dynamic-import pattern changes because Material Symbols icons are loaded per-icon-path, not from one big module:

```ts
type IconComponent = React.ComponentType<{ size?: number; color?: string; className?: string }>;

const iconCache = new Map<string, IconComponent>();

export async function loadIconComponent(
  name: string,
  library: 'material-symbols'
): Promise<IconComponent | null> {
  const cacheKey = `${library}:${name}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  try {
    // name is the PascalCase export, e.g. "Home"; the slug used for the
    // import path is derived by the caller and passed via the registry's
    // `slug` field — see IconPicker.tsx / registry.ts for the mapping.
    const slug = name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    const mod = await import(`@material-symbols-svg/react/icons/${slug}`);
    const component = mod[name] as IconComponent | undefined;
    if (!component) return null;
    iconCache.set(cacheKey, component);
    return component;
  } catch {
    console.error(`[IconLoader] Failed to load icon: ${name} from ${library}`);
    return null;
  }
}

export function getIconComponentSync(name: string, library: 'material-symbols'): IconComponent | null {
  return iconCache.get(`${library}:${name}`) ?? null;
}

export async function preloadIconBatch(icons: Array<{ name: string; library: 'material-symbols' }>): Promise<void> {
  await Promise.allSettled(icons.map(({ name, library }) => loadIconComponent(name, library)));
}
```

You need `import type React from 'react';` at the top for the `IconComponent` type, or inline the type without the import — match whatever pattern the rest of this codebase uses for React types (check a neighboring file like `icon-renderer.ts` for the convention already in use).

**Step 4.3 — `src/lib/icons/registry.ts`**

Rebuild `ICON_REGISTRY` using real Material Symbols icon names. Requirements:
- Every entry's `name` field must be the exact PascalCase export name that `@material-symbols-svg/react/icons/{slug}` actually exports — verify each one exists in the installed package before including it (check `node_modules/@material-symbols-svg/react/icons/` on disk, or the package's own icon index/documentation) rather than guessing Material-Symbols-style names from memory.
- Cover the same categories as the current registry (UI, People, Communication, Tech, Security, Arrows, Files, Status) plus expand meaningfully beyond the current ~90 icons — this is explicitly meant to be a stronger set than what's being replaced, matching draw.io's breadth of categorized icons, not a 1:1 reskin.
- `library: 'material-symbols'` on every entry.
- `slug` must be the exact kebab-case path segment used in the import (e.g., for `@material-symbols-svg/react/icons/arrow-forward`, `slug: 'arrow-forward'`).
- Keep `tags` populated with the same kind of synonym/keyword coverage the current entries have (see the existing file for the pattern) — this is what search matches against.

Do not touch the `ICON_INDEX` or `ICON_CATEGORIES` exports at the bottom of the file — they're derived automatically from whatever is in `ICON_REGISTRY` and need no changes.

**Step 4.4 — `src/components/canvas/IconPicker.tsx`**

Find this line:
```tsx
import * as LucideIcons from 'lucide-react';
```
Delete it — it's no longer needed. The rendering logic in this component currently does:
```tsx
                const IconComponent = (LucideIcons as unknown as Record<string, React.ElementType>)[meta.name];
                if (!IconComponent) return null;
```
This static-lookup pattern doesn't work for Material Symbols since each icon is its own dynamically-imported module rather than a named export off one giant module. Replace this rendering block to use `loadIconComponent` from Task 4.2 asynchronously with local state, following the same async-load-then-cache pattern already used in `icon-renderer.ts` for the canvas-drawing path — do not invent a different loading strategy. Concretely: maintain a `Record<string, IconComponent>` in component state, populated via `useEffect` that calls `loadIconComponent(meta.name, meta.library)` for each visible result and stores the resolved component, re-rendering once loaded. Only style/layout changes happen in Task 5 below — this step is only about making the icons render correctly with the new library.

**Acceptance criteria for Task 4:**
- Opening the icon picker shows Material Symbols icons, not the old Lucide set.
- Every icon in every category renders without a broken/missing icon placeholder.
- Clicking an icon still correctly inserts it onto the canvas at 64×64 (per Task 2) via the existing `addIconElement` flow — this flow itself does not need to change, only what icon it's inserting.
- Icons already placed on existing boards before this change continue to render (check `icon-renderer.ts`'s `getIconBitmap` still resolves via the new loader without errors for any icon names that exist in the new registry).

---

## Task 5 — Restyle Icon Picker Modal to Match App Theme

**Problem:** The current picker uses a different color palette (`slate-900`, `blue-500` accents) than the rest of the app, which uses `zinc` grays and the `#7C3AED`→`#2563EB` purple-blue gradient. It visibly looks like a different, unstyled component dropped into a themed app.

**Reference for the correct theme:** `src/components/shared/MainMenu.tsx`'s dropdown panel (`bg-white/95 dark:bg-[rgba(15,15,25,0.92)] backdrop-blur-[20px] border border-zinc-200 dark:border-[rgba(255,255,255,0.08)]`) is the canonical example of this app's floating-panel styling. Copy this exact pattern, adapted for a centered modal instead of a corner-anchored dropdown — do not invent new values.

**File: `src/components/canvas/IconPicker.tsx`**

Replace the modal container classes. Current:
```tsx
      <div 
        className="w-full max-w-2xl h-[70vh] flex flex-col bg-slate-900/95 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl"
```
Change to:
```tsx
      <div 
        className="w-full max-w-2xl h-[70vh] flex flex-col bg-white/95 dark:bg-[rgba(15,15,25,0.92)] border border-zinc-200 dark:border-[rgba(255,255,255,0.08)] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-[20px]"
```

Apply the same `slate-* → zinc-*` and `blue-* → purple/blue-gradient` substitution throughout the rest of this file's className strings:
- All `slate-800`, `slate-700`, `slate-900` → the equivalent `zinc-*` shade with light/dark variants (follow the light/dark pairing pattern from `MainMenu.tsx`, e.g. `bg-zinc-100 dark:bg-white/5` for hover states, `text-zinc-500 dark:text-zinc-400` for muted text)
- All `slate-200`/`slate-300` text colors → `zinc-700 dark:text-zinc-300`
- The active-category pill currently uses `bg-blue-500/20 text-blue-400 border-blue-500/30` — change to the app's gradient-accent pattern used for active/selected states elsewhere, e.g. `bg-gradient-to-r from-[#7C3AED]/20 to-[#2563EB]/20 text-[#9d5cff] border border-[#7C3AED]/30` (matches the hover-accent pattern already used in `MainMenu.tsx`'s menu items)
- The search input's focus ring (`focus-within:border-blue-500/50`) → `focus-within:border-[#7C3AED]/50`

Add both light and dark mode variants everywhere — the current file appears to be dark-mode-only (no `dark:` prefixes at all), which is itself part of the bug, since this app supports light mode. Every color class needs a light-mode default and a `dark:` variant, following the pattern in `MainMenu.tsx` throughout.

**Acceptance criteria for Task 5:**
- The icon picker modal is visually indistinguishable in style (colors, blur, border treatment, corner radius) from the Layers/Properties panels and the main menu dropdown.
- The picker correctly adapts to both light and dark theme, matching how every other panel in the app already does.

---

## Task 6 — Remove Dead PDF Export Code, Add XML Export

**Correction to the original brief:** There is no PDF export in the actual live UI. `src/lib/export/exporters.ts` contains a jsPDF-based `Exporter` class, but it is never imported anywhere in `src/` — it's entirely dead code. The real, wired-up export flow is `ExportDialog.tsx`, which already only offers PNG/SVG/HTML. There is nothing to "remove from the UI" — only dead code and an unused dependency to delete, plus the new XML format to add.

**Step 6.1 — Delete dead code**

Delete the file `src/lib/export/exporters.ts` entirely.

**⚠️ MANUAL COMMAND REQUIRED:**
```
npm uninstall jspdf
```
Run this after the file is deleted. You (the agent) may remove the `"jspdf": "..."` line from `package.json`'s dependencies yourself as a text edit, but the human operator still needs to run `npm uninstall jspdf` (or `npm install` after your edit) to actually sync `node_modules` and `package-lock.json` — flag this clearly when you reach this step and wait for confirmation before considering Task 6 complete.

**Step 6.2 — Add XML export module**

**Decision (already made):** XML export mirrors the existing JSON scene format 1:1 — same data (`elements`, `background`), same shape, just serialized as XML tags/attributes instead of JSON. This is not a new schema design — do not invent a different structure.

Create `src/lib/export/xml.ts`, following the exact same function signature and file-download pattern already used in `src/lib/export/svg.ts` (open that file first and match its structure/conventions before writing this one):

```ts
import { WhiteboardElement } from '@/types';

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

const elementToXML = (el: WhiteboardElement): string => {
  const attrs = Object.entries(el)
    .filter(([, value]) => typeof value !== 'object' || value === null)
    .map(([key, value]) => `${key}="${escapeXML(String(value))}"`)
    .join(' ');
  return `    <element type="${el.type}" ${attrs} />`;
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
```

Note: this flat-attribute serialization drops nested object fields (e.g., a `FreehandElement`'s `points` array, or `style` sub-object) since XML attributes can't hold structured data directly. If any element type in `WhiteboardElement` has nested object/array fields beyond `style`, extend `elementToXML` to serialize those as nested child tags instead of dropping them — check `src/types/canvas.ts` for every element type's shape before finalizing this function, and make sure no data is silently lost for any of the 7 element types. This is a correctness requirement, not optional polish.

**Step 6.3 — Wire XML into `ExportDialog.tsx`**

Find:
```tsx
type Format = 'png' | 'svg' | 'html';
```
Change to:
```tsx
type Format = 'png' | 'svg' | 'html' | 'xml';
```

Add the import at the top:
```tsx
import { downloadXML } from '@/lib/export/xml';
```

Find the format button row:
```tsx
            {(['png', 'svg', 'html'] as Format[]).map((f) => (
```
Change to:
```tsx
            {(['png', 'svg', 'html', 'xml'] as Format[]).map((f) => (
```

In `handleDownload`, find the `else` branch that currently handles only `html`:
```tsx
      } else {
        await downloadOfflineHtml(
          {
            elements: exported,
            background: withBackground ? canvasBackground : 'transparent',
            title: `Drawer board — ${stamp}`,
          },
          `drawer-${stamp}.html`
        );
      }
```
Change to explicitly branch on both remaining formats instead of using a catch-all `else`:
```tsx
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
```

**Acceptance criteria for Task 6:**
- `src/lib/export/exporters.ts` no longer exists.
- `jspdf` no longer appears in `package.json` dependencies (after the manual uninstall step is confirmed done).
- The Export dialog shows four format options: PNG, SVG, HTML, XML.
- Selecting XML and downloading produces a valid, well-formed XML file containing every element currently on the board (or currently selected, respecting the existing "Only selected" toggle — this toggle's behavior must keep working unchanged for the new format too).
- No data loss: every field on every element type makes it into the XML output in some form (verify against `src/types/canvas.ts`, per the note in Step 6.2).

---

## Task 7 — Restyle "Sign Up" Button to Match Existing UI

**Problem:** The current Sign Up button uses a standalone purple-blue gradient pill (`bg-gradient-to-r from-[#7C3AED] to-[#2563EB]` with a blurred glow effect) that looks like a separate promotional callout rather than an integrated part of the menu.

**Decision (already made):** Keep it in the exact same location (top of the ACCOUNT section in `MainMenu.tsx`), but restyle it to look like the other menu buttons in this same panel (e.g., the "Preferences" row directly below it in the SETTINGS section) rather than a standalone gradient pill — while still being visually identifiable as the primary/most-important action in the menu, since it is one. This means: same row height, padding, icon-plus-label layout, and hover-accent-bar pattern as every other menu item, with the purple-blue gradient reserved for just the icon or a subtle left accent rather than filling the entire button.

**File: `src/components/shared/MainMenu.tsx`**

Find the current Sign Up block:
```tsx
              <div className="px-5 mb-4">
                <button className="w-full relative group overflow-hidden rounded-full p-[1px]">
                  <div className="absolute inset-0 bg-gradient-to-r from-[#7C3AED] to-[#2563EB] opacity-70 group-hover:opacity-100 transition-opacity duration-300 blur-sm" />
                  <div className="relative flex items-center justify-center gap-2 bg-gradient-to-r from-[#7C3AED] to-[#2563EB] text-white rounded-full py-2.5 px-4 shadow-[0_0_15px_rgba(124,58,237,0.3)] group-hover:shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-shadow">
                    <LogIn size={16} />
                    <span className="text-[14px] font-bold">Sign up</span>
                  </div>
                </button>
              </div>
```

Replace with a button that follows the same structural pattern as the menu items rendered in the `menuSections.map(...)` loop above it in this same file (same `group relative flex items-center` row structure, same hover accent bar, same icon-in-a-rounded-box treatment) — copy that exact pattern rather than writing a new one, keeping only the gradient as a subtle treatment on the icon itself to signal this is the primary action:

```tsx
              <div className="px-2 mb-4">
                <button className="group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-all duration-200">
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#7C3AED] to-[#2563EB] scale-y-0 group-hover:scale-y-100 origin-left transition-transform duration-200 rounded-r-full" />
                  <div className="p-1.5 rounded-md bg-gradient-to-br from-[#7C3AED]/20 to-[#2563EB]/20">
                    <LogIn size={16} className="text-[#9d5cff]" />
                  </div>
                  <span className="text-[14px] font-semibold text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                    Sign up
                  </span>
                </button>
              </div>
```

**Acceptance criteria for Task 7:** The Sign Up button sits in the same place, is still clearly the visually-emphasized item in the menu (via the gradient icon treatment and bold label), but no longer looks like a disconnected promotional element — it reads as part of the same menu as everything above and below it.

---

## 2. Final Verification (manual, after all 7 tasks are complete)

**⚠️ MANUAL COMMANDS — run these in order once every task above is done:**

```
npx tsc --noEmit
```
Must produce zero errors. If it doesn't, do not consider Phase 1 complete — go back and fix whatever task introduced the error before moving on.

```
npm run dev
```
Then manually verify, one by one:
- [ ] Ctrl+V pastes an externally-copied image onto the board
- [ ] Ctrl+C then Ctrl+V still duplicates a selected Thynkly element
- [ ] A newly-inserted icon is visibly consistent in size with other elements, at multiple zoom levels
- [ ] "Fit All" button/Shift+1 always fits the entire board even when something is selected
- [ ] "Fit Selection" button/Shift+2 fits only the current selection, is disabled with nothing selected
- [ ] Icon picker shows Material Symbols icons, themed to match the rest of the app, in both light and dark mode
- [ ] Export dialog offers PNG/SVG/HTML/XML, and an XML export downloads a well-formed file
- [ ] Sign Up button matches the surrounding menu's visual style

```
git add -A
git commit -m "Phase 1: bug fixes, icon set replacement, export format swap"
git push origin main
```

Phase 1 is complete only when the full checklist above passes and the final commit is pushed.

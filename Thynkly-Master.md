# Thynkly.io — Master Project Document

**This is the single source of truth for this project.** Read this file top to bottom before doing anything else, in any future session, with any agent. It replaces the need to read separate roadmap/architecture/QA/reference docs — everything is consolidated here in the order it should be understood.

Stylus/pen architecture is summarized in Part 2a below (folded in from the original `STYLUS_AND_PEN_ARCHITECTURE.md`, now removed from the repo — this is a summary of its key points from earlier review, not a verbatim copy of the original file). For full implementation detail, read `src/lib/input/` and `src/lib/canvas/freehand.ts` directly before touching any input-handling code.

---

## PART 1 — What This Project Is

Thynkly.io: a hand-drawn-style whiteboard and diagramming tool for the browser, positioned as an alternative to Excalidraw (closest stylistic match), draw.io (free/open ethos target), and Eraser.io (dev-focused ambitions). Works across desktop, tablet, and phone with genuine stylus support as a real differentiator, not an afterthought.

**Stack:**

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + TypeScript (strict) |
| State | Zustand |
| Canvas rendering | HTML Canvas + rough.js (hand-drawn style) |
| Freehand strokes | perfect-freehand |
| Spatial indexing | rbush |
| Styling | Tailwind CSS + shadcn/ui |
| Icons | Material Symbols (`@material-symbols-svg/react`), virtualized picker |

**Repo:** `github.com/nikhilvirdi/Thynkly.io`, single repo currently (monorepo with `/backend` planned, not yet created).

---

## PART 2 — Current Codebase: What Actually Exists

Verified from source, not assumed. This is the real file structure as of the last full tree dump:

```
src/
  app/                    Next.js routes — currently only "/" (redirects) and "/board"
  components/
    canvas/               Canvas.tsx (main surface), IconPicker, ContextMenu, TextEditor,
                           SelectionBox, PenCursor, BlockedTouchIndicator
    panels/                LayersPanel, PropertiesPanel
    shared/                MainMenu, ExportDialog, HelpDialog, StatusBar, ThemeProvider
    toolbar/               AdvancedToolbar, ColorPicker, StyleBar, Toolbar, ToolButton
    ui/                    button, InputModeToggle, tooltip
  config/                 shortcuts.ts
  hooks/                  useKeyboardShortcuts.ts
  lib/
    canvas/                Rendering/interaction logic: alignment, arrowheads, connectors,
                            eraser (geometry + manager), freehand, hit-testing, icon-renderer,
                            image-handler, laser, lasso, renderer, rough-renderer, selection,
                            shapes, smart-guides, spatial-index, sticky, text, viewport
                            (several *.check.ts files alongside these — hand-written
                            assertion tests, not wired to a runner yet)
    export/                 bounds, json, offline (HTML export), png, svg, xml
                             (exporters.ts / jsPDF-based — DELETED, was dead code)
    icons/                  loader, registry, search, types (Material Symbols system)
    input/                  device-detection, gesture-handler, palm-rejection, pen-detect,
                             pointer-utils, stylus-buttons, input-gate
    utils/                  debounce, geometry, transforms
  store/                   canvas-store.ts (main state), history-store.ts, ui-store.ts
  types/                   canvas.ts (element types), index.ts, input.ts
scripts/                  generate-icons.mjs (regenerates icon registry from installed package)
```

### Element types (7 total)
`ShapeType` enum: `RECTANGLE, CIRCLE, ELLIPSE, TRIANGLE, DIAMOND, PENTAGON, HEXAGON, STAR, ARROW, LINE, FREEHAND, TEXT, IMAGE, CONNECTOR, ICON, STICKY`

### Features confirmed working (manual QA pass, sections 1–10 of 23 tested)
- Selection: click, lasso (Enclose/Touch modes), hand/pan, multi-select, marquee drag-select
- Shapes: Rectangle, Circle/Ellipse, Triangle, Diamond, Star, Hexagon (toolbar-exposed); Line, Arrow
- Freehand drawing with real pressure sensitivity, palm rejection, mouse/touch/pen all correct
- Text: creation, editing, resize-scales-font-proportionally, Font Size/Align controls
- Image: Ctrl+V paste (fixed, see Part 3), toolbar upload, resize, aspect-ratio lock
- Icons: Material Symbols, category + search filtering, left-docked panel (redesigned, see Part 3)
- Connectors: bind to shapes, follow on drag, straight/curved routing confirmed; orthogonal routing and arrowhead-style controls exist but need retesting on a true bound connector (not a plain Arrow)
- Eraser: Object mode, Partial mode, radius presets + custom slider
- Laser pointer: confirmed working
- Undo/redo, copy/paste/duplicate, export (PNG/SVG/HTML/XML — PDF removed, was dead/unused code)
- Local persistence via Zustand `persist` middleware → `localStorage` (single device/browser only — this is NOT cloud persistence, see Part 4)

### Sections NOT yet tested (11–23 of the original QA pass)
Properties panel (general, non-text), Layers panel, grouping, alignment/smart guides/snapping, undo/redo edge cases, zoom & viewport controls beyond Fit All/Fit Selection, save/open scene file, main menu remaining items, theme & canvas background switching, persistence edge cases, full keyboard shortcut sweep.

---

### PART 2a — Stylus/Pen Architecture (Summary)

Summarized from earlier review of `STYLUS_AND_PEN_ARCHITECTURE.md` before it was removed — this is a high-level summary, not the full original documentation. For exact implementation, read the actual code in `src/lib/input/` and `src/lib/canvas/freehand.ts`.

Key points recalled:
- **Dual-canvas live-stroke rendering** — the in-progress stroke currently being drawn renders on a separate lightweight canvas layer from the committed elements, avoiding a full-board redraw on every pointer-move event during drawing.
- **Palm rejection** — pointer-event gating distinguishes genuine pen/stylus input from incidental palm/hand contact across different device types (Apple Pencil, S-Pen, Wacom), so resting a hand on a touchscreen while drawing doesn't create stray marks.
- **Custom structured-clone undo** — freehand strokes use a specific cloning approach for undo/redo snapshots rather than a naive deep-clone, for performance reasons with potentially large point arrays.
- **Device detection** (`device-detection.ts`, `pen-detect.ts`) distinguishes mouse/touch/pen input modes to apply the right handling per device.
- **Pressure sensitivity** feeds into `perfect-freehand`'s stroke width calculation for real pressure-varied line weight.

This was flagged earlier in the project as genuinely above-average engineering work relative to what similar tools ship, and a real basis for the "best-in-class stylus support" differentiator in Part 5.

---

## PART 3 — Bug Fix Status Tracker

Update this checklist as items are actually confirmed (typecheck + runtime verified, not just agent-reported — this project has repeatedly hit "reported fixed, wasn't" failures, see Part 3a).

- [x] Ctrl+V image paste (was silently blocked by a competing keydown handler calling `preventDefault()`)
- [x] Icon default insertion size (48→64 world-units, centered correctly)
- [x] Zoom-to-Fit split into "Fit All" (Shift+1) and "Fit Selection" (Shift+2) — previously one button with confusing selection-dependent behavior
- [x] Dead PDF export code removed (`exporters.ts` deleted, `jspdf` uninstalled)
- [x] XML export added (mirrors JSON scene format 1:1)
- [x] Sign Up button restyled to match menu theme (was a standalone gradient pill)
- [x] MainMenu: Community section + Language dropdown removed; Canvas background explicitly retained
- [x] Text default font size (18→16→60, final locked value: 60)
- [x] Text resize now scales font size proportionally (was: box resized, font size never changed)
- [x] Icon set fully replaced: Material Symbols, generated programmatically from the installed package (not hand-typed — see Part 3a for why this matters), virtualized grid
- [x] Icon picker redesigned: left-docked vertical panel matching Layers/Properties chrome, replacing the old centered modal with mismatched slate/blue theme
- [ ] Toolbar docking/spacing — attempted, broke Eraser/Laser/color-swatch visibility, **reverted**. Not re-attempted.
- [ ] Connector not deleted when its bound shape is deleted (currently unbinds and freezes in place instead — confirmed root cause: `detachConnectorsFromElement` in `canvas-store.ts` and `batchErase`)
- [ ] Eraser cursor doesn't hide when hovering over toolbar/panels (confirmed root cause: `EraserCursor`'s `pointermove` listener has no `e.target` check)
- [ ] Circle/ellipse resize selection box misaligned with actual rendered shape
- [ ] Arrow endpoints don't bind to shape anchor points (locked design: bind to corners for polygons, edge/perimeter-only for circles/ellipses, no corner-snap on the latter)
- [ ] Lines behave like resizable shapes instead of arrow-style independently-draggable endpoints
- [ ] Pentagon + true Ellipse missing from toolbar (only Circle, labeled "Ellipse," is exposed — naming collision to resolve: relabel Circle back to "Circle" once true Ellipse is added)
- [ ] Font family options limited to Sans/Serif/Mono — add casual/handwriting and condensed/display options
- [ ] Text Properties panel missing Bold/Italic/Line height controls
- [ ] Image upload has a ~10 second delay before the file picker opens — root cause not yet found, needs DevTools Performance-tab profiling, not a guess-fix
- [ ] Sticky notes: typed text doesn't render/isn't visible (root-cause first) + full visual redesign not yet built (pinned top, folded/curled corner, drop shadow — reference image was provided; current implementation is a flat colored rectangle)

### Part 3a — Why "confirmed fixed" isn't good enough on this project

The icon system went through several rounds of being reported fixed when it wasn't, because static/TypeScript reasoning was reported as if it were runtime verification. What actually happened, in order:
1. A fully-dynamic `import(\`.../${slug}\`)` template literal isn't statically analyzable by Webpack → silently failed to bundle → every icon rendered as a blank box. Fixed with an explicit static lookup map.
2. Hand-typed `slug` values in the registry didn't all match real installed package filenames — found in batches (10, then 3 more) because each fix pass only addressed whatever the *next* `tsc` error batch showed, instead of diffing the full registry against the full installed file list up front.
3. **Standing rule as a result:** any data that should match real files/packages must be generated programmatically from what's actually on disk — never hand-typed. This is now how the icon registry works (`scripts/generate-icons.mjs`).
4. **Standing rule:** a fix is not "done" until `npx tsc --noEmit` has actually been run and shown zero errors, AND the actual runtime behavior has been manually checked in the browser. An agent's static code-reading reasoning, however correct-sounding, is not sufficient confirmation on its own.

---

## PART 4 — Architecture: Backend (Locked, Not Yet Built)

Nothing in this section exists in code yet. These are firm decisions, made so building can start without re-litigating them.

**Split:** Next.js stays pure frontend. A separate Express.js backend (new, `/backend` folder, same repo — monorepo, no workspace tooling needed at this scale) owns all business logic, auth, and data access.

**Layered architecture:** `routes → controllers → services → repositories`, Repository pattern strictly enforced (services never import Prisma/Mongoose directly, only repository interfaces — this is what makes Jest unit testing possible without a real DB).

**Two databases, deliberately split by data shape, not for their own sake:**
- **PostgreSQL (Prisma):** User, RefreshToken, Folder, Board, BoardCollaborator, ShareLink — anything relational needing FK integrity and transactions. Full schema already designed (users↔boards↔folders↔collaborators, `Role` enum OWNER/EDITOR/VIEWER, `Permission` enum READ/WRITE).
- **MongoDB (Mongoose):** `BoardSnapshot` (the actual `elements` scene graph — schema-flexible since it's a 7-way discriminated union that changes shape as tools evolve, write-heavy on autosave, never joined) + `ActivityLog` (append-only audit trail).

**Auth:** bcrypt password hashing, JWT access token (short-lived, in-memory on client) + refresh token (httpOnly cookie, rotated on use, hashed copy stored in Postgres for revocation/theft-detection), Google OAuth2. RBAC enforced in middleware via `BoardCollaborator.role` / `ShareLink.permission` before any board-mutating route runs.

**Real-time collaboration:** Socket.io (same process as Express) + Redis adapter (horizontal scaling — without it, users on different backend instances never see each other's events) + Yjs CRDT for actual conflict-free merging. **Offline sync reuses the same Yjs document** via `y-indexeddb` (persists locally while offline) + `y-websocket` (syncs on reconnect) — no separate conflict-resolution system, CRDT math handles both jobs.

**Redis — three distinct jobs, not one vague "cache":** rate-limit store (`express-rate-limit` backend), cache-aside for hot board metadata, Socket.io pub/sub adapter. Live presence (cursors, who's viewing) lives in Redis only with a short TTL, never persisted to a DB.

**Hosting:**
- Frontend → Vercel
- Backend → **Render** (Railway explicitly rejected — dropped its free tier in 2023; Render still has one)
- Postgres → Render managed or Supabase
- MongoDB → **Atlas** free M0 tier
- Redis → Render addon or Upstash
- Files → S3 + CloudFront (Multer handles upload, streams to S3)
- AWS path (EC2 + RDS + Route53 + Nginx + PM2) documented as a scale-up option, not the default running setup — exists mainly to demonstrate that stack is real when needed, not because the project needs that scale now

**Email (Resend):** share invites, password reset, email verification. Nothing beyond this scope yet.

**API:** REST, `/api/v1/`, Zod validation at the route boundary, Swagger/OpenAPI generated from those same Zod schemas so docs can't drift from reality, Postman collection alongside. GraphQL explicitly deferred — add only if nested-read REST waterfalls become a real, measured problem, not preemptively.

**Testing:** Jest (unit, mocked repositories) + Supertest (integration, real Dockerized test Postgres/Mongo/Redis).

**CI/CD:** GitHub Actions — lint + typecheck + test on every PR, build + deploy on merge to main. Docker + Docker Compose for local dev parity (one `docker compose up` gets a new contributor a working backend with zero manual setup).

**ML (shape recognition, a locked differentiator):** TensorFlow.js CNN trained on Google's Quick, Draw! dataset, fully client-side inference — zero network cost/latency, fits the offline-first goal. Geometric heuristic fallback for shapes Quick Draw doesn't cover well (diamond, hexagon, pentagon, star, arrow).

**Explicitly dropped from scope:** handwriting-OCR search (was considered as a "Find on canvas" enhancement, cut), animated GIF export.

---

## PART 5 — Full Feature Backlog, Dependency-Ordered

### Tier A — Independent, no backend needed, can build in any order right now
- Frames/sections (labeled containers grouping elements; groundwork for a future presentation/slideshow mode)
- Embeds (paste a link → live interactive preview card, not just a static image)
- Mermaid diagram-as-code import (paste Mermaid syntax → real editable Thynkly shapes)
- Shape recognition (rough freehand sketch → clean shape, via the locked TensorFlow.js approach above)
- PWA + offline-first (installable, works with no connection, syncs via the same Yjs mechanism once backend exists)
- Focus/zen mode (hide all panels, canvas only)
- Custom stencil/shape library import (drawio-XML compatible)
- Markdown split-view editor (~70/30 whiteboard/notes split, notes exportable separately from the board)
- Templates

### Tier B — Blocked on backend (Part 4), nothing built yet
- Authentication (Google OAuth + email/password)
- Cloud persistence (replaces the current single-device `localStorage`-only save)
- Multi-board management, each board with a thumbnail generated as a **whole-board-fit render** (not a snapshot of wherever the viewport happened to be last — decided specifically because a random last-viewport thumbnail defeats the purpose of recognizing a board at a glance)
- Folders (unlimited nesting depth — decided)
- Trash/recovery (15-day retention before permanent delete — decided). "Clear board" becomes soft-delete with a confirm dialog, recoverable from Trash, instead of the current instant hard-delete.
- Share links + permissions (Read Only / Read & Write)
- Real-time collaboration (wiring the Socket.io + Yjs stack that's architected but not connected)
- Starred/favorites
- Notifications (tied to share links — someone shared/commented)
- Settings (name, password, profile picture — needs auth to have anything to actually persist)

### Tier C — Dashboard (spec locked, build blocked on one open question — see Part 6)

---

## PART 6 — Dashboard Spec (Locked, Build Blocked on One Decision)

New landing route (`/` or `/dashboard`), **replacing the current auto-redirect straight to `/board`.** Canva-style layout, matching existing dark theme — not the wireframe's literal placeholder-box styling, just its structure.

**Left sidebar, final locked list:**
```
Recent
All boards
Starred
Folders
Templates
Shared with me
Notifications
Import
Trash
Search
—
Settings (name / password / profile picture)
Theme
Preferences
Account / Sign up  (merges into one "Account" entry once logged in)
Storage/usage indicator (passive display, bottom, not a nav item)
```

**Center content:**
- Big transparent logo/wordmark hero with background animation, roughly covering the top half of the screen
- "+ New board" primary action
- Recent boards grid: thumbnail (whole-board-fit, per Tier B above), name, last-edited timestamp
- Hover/right-click on a board card: rename, delete, move-to-folder

**Reality check on build order:** most sidebar items (Recent, Folders, Trash, Shared, Notifications) have nothing real to show until Postgres + auth exist (Tier B). The frontend shell — routing, layout, styling, static placeholder content — can be built now, same treatment as the current non-functional "Sign up" stub. Wiring it to real data is Tier B work.

**⚠️ BLOCKING QUESTION, not yet answered — resolve before writing the dashboard build prompt:**
`/board`'s own current menu (Find on canvas, Help, Reset canvas, Canvas background) holds board-editing actions that don't belong in an account-level dashboard sidebar — they can't just disappear once Sign up/Theme/Account/Preferences move to the dashboard. Two options on the table:
1. A small leftover icon-only menu still on `/board` for these four items
2. Fold them into `StatusBar.tsx` instead of a menu

Canvas background specifically is a second, related open question — it's board-level, not account-level, so it may not belong in the dashboard sidebar at all (moved to the Properties panel instead?). Folders is a third open question — separate full nav page (Google-Drive-style) vs. a section within the dashboard home screen — changes routing structure either way.

---

## PART 7 — Ground Rules for Any Agent Working On This Codebase

1. Do not touch files outside what a given task explicitly names.
2. Preserve all currently-working behavior (Part 2's confirmed-working list) — if unsure whether a change affects something unrelated, stop and ask rather than guessing.
3. Match the existing theme exactly: dark glassmorphic panels (`bg-white/95 dark:bg-[rgba(15,15,25,0.92)]`, `backdrop-blur-[20px]`), zinc-scale grays for neutral UI, `#7C3AED`→`#2563EB` gradient reserved for primary/accent elements only. Copy patterns directly from `MainMenu.tsx` / `LayersPanel.tsx` / `PropertiesPanel.tsx` — never invent new colors, spacing, radii, or shadows.
4. TypeScript strict mode is on — no `any`, no `@ts-ignore`.
5. **This sandbox cannot run terminal commands.** State exactly which commands the human operator needs to run manually, and at what point — wait for confirmation before proceeding past a manual-command dependency.
6. **A fix is not done until `npx tsc --noEmit` has actually been run and shown clean, and runtime behavior has been manually verified in the browser.** See Part 3a — this project has been burned by "confirmed fixed" that wasn't, more than once. Static reasoning is not proof.
7. Any data that should correspond to real installed files/packages (icon slugs, module paths) must be generated programmatically from what's actually on disk, never hand-typed from memory or assumption.
8. When a decision is already locked in this document, follow it exactly — don't substitute a different approach because it seems better, unless explicitly told the decision is open for reconsideration.

---

## PART 8 — Open Questions (Nothing Else Outstanding Beyond These)

1. `/board`'s leftover menu items once the dashboard absorbs Sign up/Theme/Account/Preferences (Part 6)
2. Where Canvas background setting belongs — dashboard sidebar vs. Properties panel (Part 6)
3. Folders — separate nav page vs. dashboard home section (Part 6)

Once these three are resolved, the dashboard build prompt can be finalized and sent.

---

## PART 9 — Immediate Next Steps (in order)

1. Finish confirming the remaining Part 3 fixes (connector-delete-cascade, eraser cursor, circle/ellipse bbox, arrow/line binding, Pentagon/Ellipse, fonts, Bold/Italic/Line height, image-upload delay investigation, sticky note bug+redesign)
2. Complete QA checklist sections 11–23 (Part 2, untested list)
3. Resolve the three Part 8 open questions
4. Build the dashboard (Part 6)
5. Only then: stand up the backend (Part 4) and start on Tier B features

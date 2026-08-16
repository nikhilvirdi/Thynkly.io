# Thynkly.io

A hand-drawn-style whiteboard and diagramming tool for the browser — sketch, diagram, and take notes on any device, with full pen and stylus support (Apple Pencil, S-Pen, Wacom, Windows Ink) alongside mouse and touch.

## Features

- Shapes: rectangle, circle, ellipse, triangle, diamond, pentagon, hexagon, star, line, arrow
- Freehand drawing with pressure sensitivity, taper, and per-device stroke smoothing
- Text, including labels bound inside shapes
- Collapsible sticky notes
- Connectors with shape binding, anchor points, and straight/curved/orthogonal routing
- Icons (Lucide and Tabler libraries) and image embedding
- Selection: click, lasso, multi-select, grouping
- Alignment tools, smart guides, snap-to-grid and snap-to-object
- Layers panel and properties panel
- Undo/redo
- Eraser and laser pointer
- Export to PNG, SVG, PDF, native JSON, and standalone offline HTML
- Light and dark theme
- Full stylus/pen support with palm rejection across pen and touch modes

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + TypeScript |
| State management | Zustand |
| Canvas rendering | HTML Canvas + rough.js (hand-drawn style) |
| Freehand strokes | perfect-freehand |
| Spatial indexing | rbush |
| Styling | Tailwind CSS + shadcn/ui |
| PDF export | jsPDF |

# Thynkly.io

A hand-drawn whiteboard and diagramming tool for the browser. Sketch, diagram, and take notes on any device, with proper pen and stylus support for Apple Pencil, S-Pen, Wacom, and Windows Ink alongside mouse and touch.

## What you can do

Draw rectangles, circles, ellipses, triangles, diamonds, pentagons, hexagons, stars, lines, and arrows, or just sketch freehand with real pressure sensitivity and palm rejection. Arrows and lines snap to the shapes you connect them to, so your diagrams stay linked as you move things around, with straight, curved, or right-angle routing depending on what looks right.

Add text with bold, italic, adjustable line height, and a few different fonts to choose from. Drop in sticky notes that actually look like sticky notes, pin and all. Paste or upload images straight onto the board. Pick from a full library of Material Symbols icons, organized by category so you're not scrolling forever to find the right one.

Select things by clicking, lassoing, or dragging a box around them. Group elements, reorder layers, adjust every property from stroke color to roughness to opacity in a dedicated panel. Undo and redo freely. Erase whole elements or just the part you drag over. Draw with a laser pointer for walkthroughs and presentations that don't leave a permanent mark.

Everything snaps to a grid or to nearby objects when you want it to, with smart guides showing up as you align things by eye. Switch between light and dark themes whenever you like.

Save your work as PNG, SVG, HTML, or XML. Boards live in folders you organize yourself, with recent boards and starred favorites easy to get back to, and anything you delete sits safely in trash for two weeks before it's gone for good. Sign in with Google to keep your boards synced across devices.

Work with other people in real time on the same board, or share a link with read-only or edit access. Split your screen between the whiteboard and a markdown notes panel when you want to draw and write at the same time. Rough sketches get recognized and cleaned up into proper shapes automatically. Install it like a native app and keep working even without an internet connection.

Group related elements into labeled frames, drop in live embeds from links you paste, or bring in diagrams written in Mermaid syntax and get them rendered as real, editable shapes. Hit a focus mode when you want the canvas and nothing else, or bring in your own custom icon sets.

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
| Icons | Material Symbols |

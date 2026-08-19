'use client';

import { useEffect } from 'react';
import { useCanvasStore } from '@/store/canvas-store';
import { useUIStore } from '@/store/ui-store';
import { exportToJSON, pickAndParseScene } from '@/lib/export/json';
import { ShapeType } from '@/types';

export function useKeyboardShortcuts() {
  const setTool = useCanvasStore(state => state.setTool);
  const deleteElements = useCanvasStore(state => state.deleteElements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const elements = useCanvasStore(state => state.elements);
  const selectAll = useCanvasStore(state => state.selectAll);
  const clearSelection = useCanvasStore(state => state.clearSelection);
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const canUndo = useCanvasStore(state => state.canUndo);
  const canRedo = useCanvasStore(state => state.canRedo);
  const copy = useCanvasStore(state => state.copy);
  const duplicate = useCanvasStore(state => state.duplicate);
  const updateElement = useCanvasStore(state => state.updateElement);
  const bringToFront = useCanvasStore(state => state.bringToFront);
  const sendToBack = useCanvasStore(state => state.sendToBack);
  const viewport = useCanvasStore(state => state.viewport);
  const setZoom = useCanvasStore(state => state.setZoom);
  const zoomToFit = useCanvasStore(state => state.zoomToFit);
  const zoomToSelection = useCanvasStore(state => state.zoomToSelection);
  const groupSelected = useCanvasStore(state => state.groupSelected);
  const ungroupSelected = useCanvasStore(state => state.ungroupSelected);
  const toggleLockSelected = useCanvasStore(state => state.toggleLockSelected);
  const flipSelected = useCanvasStore(state => state.flipSelected);
  const copyStyle = useCanvasStore(state => state.copyStyle);
  const pasteStyle = useCanvasStore(state => state.pasteStyle);
  const updateGrid = useUIStore(state => state.updateGrid);
  const setDialog = useUIStore(state => state.setDialog);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in form elements or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const key = e.key.toLowerCase();

      // '?' opens the shortcut reference (Shift+/ on most layouts).
      if (e.key === '?' && !isCtrl) {
        e.preventDefault();
        setDialog('help');
        return;
      }

      // --- File shortcuts ---
      if (isCtrl && key === 's') {
        e.preventDefault();
        const s = useCanvasStore.getState();
        exportToJSON(s.elements, s.canvasBackground);
        return;
      }
      if (isCtrl && key === 'o') {
        e.preventDefault();
        pickAndParseScene().then((scene) => {
          if (scene) useCanvasStore.getState().loadScene(scene.elements, scene.background);
        });
        return;
      }
      if (isCtrl && isShift && key === 'e') {
        e.preventDefault();
        setDialog('export');
        return;
      }

      // --- Tool Shortcuts (no modifier) ---
      // Shift is excluded here: Shift+H and Shift+V are flip, and the tool
      // switch used to fire alongside them.
      if (!isCtrl && !isShift) {
        switch (key) {
          case 'v':
            e.preventDefault(); setTool('select');
            break;
          case 'h':
            e.preventDefault(); setTool('hand');
            break;
          case 'r':
            e.preventDefault(); setTool(ShapeType.RECTANGLE);
            break;
          case 'o':
            e.preventDefault(); setTool(ShapeType.CIRCLE);
            break;
          case 'l':
            e.preventDefault(); setTool(ShapeType.LINE);
            break;
          case 'a':
            if (!isCtrl) { e.preventDefault(); setTool(ShapeType.ARROW); }
            break;
          case 'p':
            e.preventDefault(); setTool(ShapeType.FREEHAND);
            break;
          case 't':
            e.preventDefault(); setTool(ShapeType.TEXT);
            break;
          case 'e':
            e.preventDefault(); setTool('eraser');
            break;
          case 'k':
            e.preventDefault(); setTool('laser');
            break;
          case 'q':
            e.preventDefault(); setTool('lasso');
            break;
          case 'n':
            e.preventDefault(); setTool('sticky');
            break;
          case 'escape':
            e.preventDefault();
            clearSelection();
            setTool('select');
            break;
        }
      }

      // --- Delete / Backspace ---
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isCtrl) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          deleteElements(Array.from(selectedIds));
        }
      }

      // --- Arrow key nudging ---
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && !isCtrl) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          const nudge = isShift ? 10 : 1;
          const dx = key === 'arrowright' ? nudge : key === 'arrowleft' ? -nudge : 0;
          const dy = key === 'arrowdown' ? nudge : key === 'arrowup' ? -nudge : 0;
          Array.from(selectedIds).forEach(id => {
            const el = elements[id];
            if (el) updateElement(id, { x: el.x + dx, y: el.y + dy });
          });
        }
      }

      // --- Shift shortcuts (no Ctrl) ---
      if (isShift && !isCtrl) {
        switch (key) {
          case 'h':
            e.preventDefault(); flipSelected('horizontal');
            return;
          case 'v':
            e.preventDefault(); flipSelected('vertical');
            return;
          case '1':
          case '!':
            e.preventDefault(); zoomToFit();
            return;
          case '2':
          case '@':
            e.preventDefault(); zoomToSelection();
            return;
        }
      }

      // --- Ctrl/Cmd shortcuts ---
      if (isCtrl) {
        // Style clipboard is Ctrl+Alt+C / Ctrl+Alt+V, checked before plain copy.
        if (e.altKey && key === 'c') { e.preventDefault(); copyStyle(); return; }
        if (e.altKey && key === 'v') { e.preventDefault(); pasteStyle(); return; }

        switch (key) {
          case 'g':
            e.preventDefault();
            if (isShift) ungroupSelected(); else groupSelected();
            break;
          case 'l':
            if (isShift) { e.preventDefault(); toggleLockSelected(); }
            break;
          case "'":
            e.preventDefault();
            updateGrid({ enabled: !useUIStore.getState().grid.enabled });
            break;
          case 'z':
            e.preventDefault();
            if (isShift) { if (canRedo()) redo(); }
            else { if (canUndo()) undo(); }
            break;
          case 'y':
            e.preventDefault();
            if (canRedo()) redo();
            break;
          case 'c':
            e.preventDefault();
            if (selectedIds.size > 0) copy();
            break;
          case 'x':
            e.preventDefault();
            if (selectedIds.size > 0) {
              copy();
              deleteElements(Array.from(selectedIds));
            }
            break;

          case 'd':
            e.preventDefault();
            if (selectedIds.size > 0) duplicate();
            break;
          case 'a':
            e.preventDefault();
            selectAll();
            break;
          case '=':
          case '+':
            e.preventDefault();
            setZoom(viewport.zoom * 1.2);
            break;
          case '-':
            e.preventDefault();
            setZoom(viewport.zoom / 1.2);
            break;
          case '0':
            e.preventDefault();
            setZoom(1);
            break;
          case '1':
            e.preventDefault();
            zoomToFit();
            break;
          case ']':
            e.preventDefault();
            Array.from(selectedIds).forEach(id => bringToFront(id));
            break;
          case '[':
            e.preventDefault();
            Array.from(selectedIds).forEach(id => sendToBack(id));
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, elements, viewport.zoom]);
}

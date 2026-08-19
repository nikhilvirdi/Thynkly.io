'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/store/ui-store';
import { useCanvasStore } from '@/store/canvas-store';
import {
  Menu, FolderOpen, Save, Image as ImageIcon, Users,
  Command, Search, HelpCircle, Trash2, LogIn, Settings,
  Sun, Moon, Monitor, ChevronRight
} from 'lucide-react';
import { exportToJSON, pickAndParseScene } from '@/lib/export/json';

export function MainMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const setDialog = useUIStore(state => state.setDialog);

  const theme = useUIStore(state => state.theme);
  const setTheme = useUIStore(state => state.setTheme);
  const deleteElements = useCanvasStore(state => state.deleteElements);
  const elements = useCanvasStore(state => state.elements);
  const canvasBackground = useCanvasStore(state => state.canvasBackground);
  const setCanvasBackground = useCanvasStore(state => state.setCanvasBackground);
  const setIsCanvasBackgroundCustomized = useCanvasStore(state => state.setIsCanvasBackgroundCustomized);

  const LIGHT_CANVAS_BACKGROUNDS = [
    { label: 'White',        value: '#ffffff' },
    { label: 'Light Gray',   value: '#f0f0f0' },
    { label: 'Mid Gray',     value: '#e8e8e8' },
    { label: 'Light Yellow', value: '#fafae0' },
    { label: 'Light Blue',   value: '#e8f4f8' },
    { label: 'Light Beige',  value: '#f5f0e8' },
  ];

  const DARK_CANVAS_BACKGROUNDS = [
    { label: 'Pure Black',   value: '#000000' },
    { label: 'Near Black',   value: '#1e1e1e' },
    { label: 'Dark Gray',    value: '#2b2b2b' },
    { label: 'Medium Dark',  value: '#3d3d3d' },
    { label: 'Dark Navy',    value: '#1a1a2e' },
    { label: 'Dark Green',   value: '#1a2e1a' },
  ];

  const resolvedTheme = theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const swatches = resolvedTheme === 'dark' ? DARK_CANVAS_BACKGROUNDS : LIGHT_CANVAS_BACKGROUNDS;

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // System theme listener
  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        setTheme('system');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme, setTheme]);

  const handleResetCanvas = () => {
    deleteElements(Object.keys(elements));
    setIsOpen(false);
  };

  const handleSave = () => {
    exportToJSON(elements, canvasBackground);
    setIsOpen(false);
  };

  const handleOpenFile = async () => {
    setIsOpen(false);
    const scene = await pickAndParseScene();
    if (scene) useCanvasStore.getState().loadScene(scene.elements, scene.background);
  };

  const menuSections = [
    {
      label: 'FILE',
      items: [
        { icon: FolderOpen, label: 'Open', shortcut: 'Ctrl+O', onClick: handleOpenFile },
        { icon: Save, label: 'Save to...', shortcut: 'Ctrl+S', onClick: handleSave },
        { icon: ImageIcon, label: 'Export image...', shortcut: 'Ctrl+Shift+E', onClick: () => {
          setDialog('export');
          setIsOpen(false);
        }},
      ]
    },
    {
      label: 'TOOLS',
      items: [
        { icon: Users, label: 'Live collaboration...' },
        { icon: Command, label: 'Command palette', shortcut: 'Ctrl+/' },
        { icon: Search, label: 'Find on canvas', shortcut: 'Ctrl+F' },
        { icon: HelpCircle, label: 'Help', shortcut: '?', onClick: () => { setDialog('help'); setIsOpen(false); } },
        { icon: Trash2, label: 'Reset the canvas', onClick: handleResetCanvas, destructive: true },
      ]
    }
  ];

  return (
    <div className="fixed top-4 left-4 z-[100]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`backdrop-blur-[20px] rounded-lg p-2.5 shadow-sm transition-colors ${
          resolvedTheme === 'light'
            ? 'bg-white border border-zinc-200 hover:bg-zinc-100'
            : 'bg-[#0f0f19]/90 border border-[rgba(255,255,255,0.08)] hover:bg-white/10'
        }`}
      >
        <Menu size={20} className={resolvedTheme === 'light' ? 'text-zinc-800' : 'text-zinc-200'} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            // Themed rather than permanently dark: this panel used to be a
            // black slab floating on a white canvas in light mode.
            className="absolute top-full left-0 mt-3 w-[280px] max-w-[calc(100vw-32px)] bg-white/95 dark:bg-[rgba(15,15,25,0.92)] backdrop-blur-[20px] border border-zinc-200 dark:border-[rgba(255,255,255,0.08)] rounded-2xl shadow-2xl overflow-hidden flex flex-col py-3 text-zinc-700 dark:text-zinc-200"
          >
            <div className="max-h-[70vh] overflow-y-auto no-scrollbar pb-2" style={{ maxHeight: 'calc(var(--app-height, 80vh) - 120px)' }}>
              {menuSections.map((section, idx) => (
                <div key={idx} className="mb-4">
                  <div className="px-5 mb-2 text-[10px] font-bold tracking-widest text-zinc-500">
                    {section.label}
                  </div>
                  <div className="flex flex-col">
                    {section.items.map((item, i) => (
                      <button
                        key={i}
                        onClick={(item as {onClick?: () => void}).onClick}
                        className={`group relative flex items-center justify-between w-full px-5 py-2 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all duration-200 ${(item as {destructive?: boolean}).destructive ? 'hover:text-red-400' : ''}`}
                      >
                        {/* Hover left accent border */}
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#7C3AED] to-[#2563EB] scale-y-0 group-hover:scale-y-100 origin-left transition-transform duration-200 rounded-r-full" />
                        
                        <div className="flex items-center gap-3 transform group-hover:translate-x-1 transition-transform duration-200">
                          <div className={`p-1.5 rounded-md transition-colors ${(item as {destructive?: boolean}).destructive ? 'group-hover:bg-red-500/10' : 'group-hover:bg-gradient-to-br group-hover:from-[#7C3AED]/20 group-hover:to-[#2563EB]/20'}`}>
                            <item.icon size={16} className={(item as {destructive?: boolean}).destructive ? 'group-hover:text-red-400' : 'text-zinc-500 dark:text-zinc-400 group-hover:text-[#9d5cff]'} />
                          </div>
                          <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                            {item.label}
                          </span>
                        </div>
                        {(item as {shortcut?: string}).shortcut && (
                          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/10 shadow-sm">
                            {(item as {shortcut?: string}).shortcut}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="px-5 mb-2 text-[10px] font-bold tracking-widest text-zinc-500 mt-2">
                ACCOUNT
              </div>
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

              <div className="px-5 mb-2 text-[10px] font-bold tracking-widest text-zinc-500 mt-4">
                SETTINGS
              </div>
              
              <div className="flex flex-col gap-1 px-3">
                <button className="group relative flex items-center justify-between w-full px-2 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3 transform group-hover:translate-x-1 transition-transform duration-200">
                    <div className="p-1.5 rounded-md group-hover:bg-gradient-to-br group-hover:from-[#7C3AED]/20 group-hover:to-[#2563EB]/20">
                      <Settings size={16} className="text-zinc-500 dark:text-zinc-400 group-hover:text-[#9d5cff] transition-colors" />
                    </div>
                    <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">Preferences</span>
                  </div>
                  <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
                </button>

                <div className="flex items-center justify-between px-4 py-2 mt-1">
                  <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300">Theme</span>
                  <div className="flex items-center bg-zinc-100 dark:bg-black/40 border border-zinc-200 dark:border-white/10 rounded-full p-1 shadow-inner">
                    <button
                      onClick={() => setTheme('light')}
                      className={`p-1.5 rounded-full transition-all duration-200 ${theme === 'light' ? 'bg-zinc-200 text-zinc-900 shadow-sm' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                    >
                      <Sun size={14} />
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={`p-1.5 rounded-full transition-all duration-200 ${theme === 'dark' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                    >
                      <Moon size={14} />
                    </button>
                    <button
                      onClick={() => setTheme('system')}
                      className={`p-1.5 rounded-full transition-all duration-200 ${theme === 'system' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                    >
                      <Monitor size={14} />
                    </button>
                  </div>
                </div>


                <div className="flex flex-col mt-4 px-3 gap-3">
                  <span className={`text-[14px] font-medium ${resolvedTheme === 'dark' ? 'text-zinc-300' : 'text-zinc-600'}`}>Canvas background</span>
                  <div className="flex gap-3">
                    {swatches.map((c) => (
                      <button 
                        key={c.value}
                        title={c.label}
                        onClick={() => {
                          setCanvasBackground(c.value);
                          setIsCanvasBackgroundCustomized(true);
                        }}
                        className={`relative w-7 h-7 rounded-full border-2 transition-all duration-200 ${
                          canvasBackground === c.value 
                            ? 'border-[#7C3AED] scale-[1.12] shadow-[0_0_0_2px_#7C3AED]' 
                            : resolvedTheme === 'dark' 
                              ? 'border-white/10 hover:scale-[1.08] hover:border-white/30' 
                              : 'border-zinc-300 hover:scale-[1.08] hover:border-zinc-400'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Scrollbar hide utility inline */}
            <style jsx>{`
              .no-scrollbar::-webkit-scrollbar {
                display: none;
              }
              .no-scrollbar {
                -ms-overflow-style: none;
                scrollbar-width: none;
              }
            `}</style>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



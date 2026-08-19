export enum ShapeType {
  RECTANGLE = 'rectangle',
  CIRCLE = 'circle',
  ELLIPSE = 'ellipse',
  TRIANGLE = 'triangle',
  DIAMOND = 'diamond',
  PENTAGON = 'pentagon',
  HEXAGON = 'hexagon',
  STAR = 'star',
  ARROW = 'arrow',
  LINE = 'line',
  FREEHAND = 'freehand',
  TEXT = 'text',
  IMAGE = 'image',
  CONNECTOR = 'connector',
  ICON = 'icon',
  STICKY = 'sticky',
}

export type Tool =
  | 'select'
  | 'lasso'
  | 'sticky'
  | 'hand'
  | 'eraser'
  | 'laser'
  | 'text'
  | ShapeType

export interface StyleProperties {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  roughness: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  penType?: 'pen' | 'pencil' | 'fountain' | 'marker' | 'highlighter';
  /** Default stroke variability for new freehand strokes. */
  strokeVariability?: 'variable' | 'constant';
}

export interface BaseElement {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  zIndex: number;
  style: StyleProperties;
  bbox?: BoundingBox;
  /**
   * Groups this element belongs to, outermost first — same shape as
   * Excalidraw's, so nesting works: grouping a selection appends one new id to
   * every member, ungrouping pops the outermost id they all share.
   */
  groupIds?: string[];
}

export interface ShapeElement extends BaseElement {
  type: Exclude<ShapeType, ShapeType.FREEHAND>;
  seed: number; // For roughjs consistent rendering
}

export interface FreehandElement extends BaseElement {
  type: ShapeType.FREEHAND;
  points: [number, number, number?][]; // [x, y, pressure]
  simulatePressure?: boolean;
  taperStart?: number | boolean;
  taperEnd?: number | boolean;
  /**
   * perfect-freehand streamline, captured per stroke because it depends on the
   * input device: Excalidraw uses 0.2 for pen and touch and 0.5 for a mouse,
   * so a stylus is not smoothed into feeling laggy.
   */
  streamline?: number;
  /**
   * 'variable' tapers with pressure (the classic Excalidraw look); 'constant'
   * keeps one width end to end, for handwriting and diagrams.
   */
  variability?: StrokeVariability;
}

export type StrokeVariability = 'variable' | 'constant';

export interface TextElement extends BaseElement {
  type: ShapeType.TEXT;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  textAlign?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  /** Line-height multiplier. Defaults to LINE_HEIGHT (1.4) when absent. */
  lineHeight?: number;
  /**
   * Set when this text is a label bound inside a shape. Bound text is drawn
   * centred in its container and is not independently selectable — you select
   * the shape, exactly as in Excalidraw.
   */
  containerId?: string | null;
}

export interface ImageElement extends BaseElement {
  type: ShapeType.IMAGE;
  src: string;
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  lockAspectRatio: boolean;
}

export interface ConnectorElement extends BaseElement {
  type: ShapeType.CONNECTOR;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startElementId?: string | null;
  endElementId?: string | null;
  startAnchorPoint?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  endAnchorPoint?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  controlPoints?: { x: number, y: number }[];
  routingMode?: 'straight' | 'curved' | 'orthogonal';
  isManuallyRouted?: boolean;
  curved?: boolean; // Deprecated, use routingMode
  label?: string;
  seed: number;
  /**
   * Head at each end. Both are settable, so a connector can be plain, one-way
   * or double-headed. Names match `ARROWHEADS` in lib/canvas/arrowheads.
   */
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  /** Font size for the label sitting on the line. */
  labelFontSize?: number;
  startBindingGap?: number;
  endBindingGap?: number;
  startOffsetFromCenter?: { x: number; y: number };
  endOffsetFromCenter?: { x: number; y: number };
}

export interface IconElement extends BaseElement {
  type: ShapeType.ICON;
  iconName: string;
  iconLibrary: 'material-symbols';
  color: string;
}

/**
 * A sticky note. Collapses to a small dot on the canvas so a board can carry
 * reminders without them covering the drawing; clicking the dot reopens it.
 */
export interface StickyElement extends BaseElement {
  type: ShapeType.STICKY;
  text: string;
  /** Note paper colour. Text colour is derived for contrast. */
  noteColor: string;
  collapsed: boolean;
  fontSize: number;
  fontFamily: string;
  /**
   * Size to restore on expand. While collapsed the element's own width/height
   * shrink to the dot, so it stops reserving the full note's space on the
   * board — selection, hit testing and export all read those fields.
   */
  expandedWidth?: number;
  expandedHeight?: number;
}

export type WhiteboardElement = ShapeElement | FreehandElement | TextElement | ImageElement | ConnectorElement | IconElement | StickyElement;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface GridSettings {
  enabled: boolean;
  size: number;
  type: 'square' | 'dots' | 'lines';
  color: string;
  opacity: number;
}

export interface SnapSettings {
  enabled: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;
  snapDistance: number;
  showGuides: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface HistoryEntry {
  type: 'create' | 'update' | 'delete' | 'batch';
  elements: WhiteboardElement[];
  timestamp: string;
}

import { Point, BoundingBox, WhiteboardElement, ShapeType, FreehandElement } from '@/types';

export const distance = (p1: Point, p2: Point) => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const angle = (p1: Point, p2: Point) => {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
};

export const rotatePoint = (point: Point, center: Point, angleInRadians: number): Point => {
  const cos = Math.cos(angleInRadians);
  const sin = Math.sin(angleInRadians);
  const nx = (cos * (point.x - center.x)) + (sin * (point.y - center.y)) + center.x;
  const ny = (cos * (point.y - center.y)) - (sin * (point.x - center.x)) + center.y;
  return { x: nx, y: ny };
};

export const doBoxesIntersect = (box1: BoundingBox, box2: BoundingBox) => {
  return !(box2.minX > box1.maxX || 
           box2.maxX < box1.minX || 
           box2.minY > box1.maxY ||
           box2.maxY < box1.minY);
};

export const isPointInBox = (p: Point, box: BoundingBox) => {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
};

// Calculate the minimum bounding box for a set of points
export const calculateBoundingBox = (points: Point[]): BoundingBox => {
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = points[0]!.x, maxX = points[0]!.x;
  let minY = points[0]!.y, maxY = points[0]!.y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
};

export const pointToSegmentDistanceSq = (p: Point, a: Point, b: Point): number => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * (b.x - a.x);
  const cy = a.y + t * (b.y - a.y);
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
};

export const isBoxIntersectingCapsule = (box: BoundingBox, capsuleA: Point, capsuleB: Point, radius: number): boolean => {
  // Simple check: does the capsule's bounding box intersect the box?
  const capBox: BoundingBox = {
    minX: Math.min(capsuleA.x, capsuleB.x) - radius,
    minY: Math.min(capsuleA.y, capsuleB.y) - radius,
    maxX: Math.max(capsuleA.x, capsuleB.x) + radius,
    maxY: Math.max(capsuleA.y, capsuleB.y) + radius,
  };
  if (!doBoxesIntersect(box, capBox)) return false;

  // If one of the capsule points is inside the box, it's intersecting
  if (isPointInBox(capsuleA, box) || isPointInBox(capsuleB, box)) return true;

  // Otherwise, we need to check if the segment intersects any of the box edges,
  // or if any box corner is within `radius` of the segment.
  const corners: Point[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY }
  ];

  for (const corner of corners) {
    if (pointToSegmentDistanceSq(corner, capsuleA, capsuleB) <= radius * radius) {
      return true;
    }
  }

  // Segment-segment intersection check (capsule core vs box edges)
  const intersectSegments = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
    const ccw = (A: Point, B: Point, C: Point) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  };

  for (let i = 0; i < corners.length; i++) {
    const p3 = corners[i]!;
    const p4 = corners[(i + 1) % corners.length]!;
    if (intersectSegments(capsuleA, capsuleB, p3, p4)) return true;
  }

  return false;
};

export const getElementBBox = (el: WhiteboardElement): BoundingBox => {
  if (el.type === ShapeType.FREEHAND) {
    const fh = el as FreehandElement;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of fh.points) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
    // If no points, fallback
    if (minX === Infinity) {
      minX = el.x; maxX = el.x; minY = el.y; maxY = el.y;
    }
    return { minX, minY, maxX, maxY };
  } else if (el.type === ShapeType.CONNECTOR) {
    const conn = el as import('@/types').ConnectorElement;
    const minX = Math.min(conn.startX, conn.endX);
    const maxX = Math.max(conn.startX, conn.endX);
    const minY = Math.min(conn.startY, conn.endY);
    const maxY = Math.max(conn.startY, conn.endY);
    return { minX, minY, maxX, maxY };
  } else if (el.type === ShapeType.CIRCLE || el.type === ShapeType.ELLIPSE) {
    // roughjs strokes bleed outside the element bounds by strokeWidth/2.
    // Expand the bbox to match the visual footprint so selection handles
    // sit at the visible edge of the stroke, not inside it.
    const pad = Math.max(1, ((el.style?.strokeWidth ?? 2) / 2));
    return {
      minX: el.x - pad,
      minY: el.y - pad,
      maxX: el.x + el.width + pad,
      maxY: el.y + el.height + pad,
    };
  } else {
    // For rotated shapes, calculate the envelope box
    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const corners = [
        rotatePoint({ x: el.x, y: el.y }, { x: cx, y: cy }, el.rotation),
        rotatePoint({ x: el.x + el.width, y: el.y }, { x: cx, y: cy }, el.rotation),
        rotatePoint({ x: el.x, y: el.y + el.height }, { x: cx, y: cy }, el.rotation),
        rotatePoint({ x: el.x + el.width, y: el.y + el.height }, { x: cx, y: cy }, el.rotation)
      ];
      return calculateBoundingBox(corners);
    }
    return {
      minX: el.x,
      minY: el.y,
      maxX: el.x + el.width,
      maxY: el.y + el.height
    };
  }
};

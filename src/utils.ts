import { Position } from '@xyflow/react';
import type { Node } from '@xyflow/react';


interface Point {
  x: number;
  y: number;
}

interface NodePosition {
  x: number;
  y: number;
}

interface NodeInternals {
  positionAbsolute: NodePosition;
}

interface NodeWithInternals extends Node {
  internals: NodeInternals;
}

// this helper function returns the intersection point
// of the line between the center of the intersectionNode and the target node
function getNodeIntersection(intersectionNode: Node, targetNode: Node): Point {
  const { width: intersectionNodeWidth = 0, height: intersectionNodeHeight = 0 } =
    intersectionNode.measured || {};
  const intersectionNodePosition = (intersectionNode as NodeWithInternals).internals.positionAbsolute;
  const targetPosition = (targetNode as NodeWithInternals).internals.positionAbsolute;

  const w = intersectionNodeWidth / 2;
  const h = intersectionNodeHeight / 2;

  const x2 = intersectionNodePosition.x + w;
  const y2 = intersectionNodePosition.y + h;
  const x1 = targetPosition.x + ((targetNode.measured?.width ?? 0) / 2);
  const y1 = targetPosition.y + ((targetNode.measured?.height ?? 0) / 2);

  if (intersectionNode.type === 'place') {
    // Adjust for elliptical nodes
    const dx = x1 - x2;
    const dy = y1 - y2;
    const angle = Math.atan2(dy, dx);
    const rx = w;
    const ry = h;
    const x = x2 + rx * Math.cos(angle);
    const y = y2 + ry * Math.sin(angle);
    return { x, y };
  }

  // Default for rectangular nodes
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  const x = w * (xx3 + yy3) + x2;
  const y = h * (-xx3 + yy3) + y2;

  return { x, y };
}

/**
 * Get the intersection point of the node boundary towards a specific point (e.g., a bendpoint)
 * This is used when we have bendpoints and need to calculate where the edge exits/enters the node
 */
export function getNodeIntersectionToPoint(node: Node, targetPoint: Point): Point {
  const { width: nodeWidth = 0, height: nodeHeight = 0 } = node.measured || {};
  const nodePosition = (node as NodeWithInternals).internals.positionAbsolute;

  const w = nodeWidth / 2;
  const h = nodeHeight / 2;

  // Node center
  const cx = nodePosition.x + w;
  const cy = nodePosition.y + h;
  
  // Target point
  const x1 = targetPoint.x;
  const y1 = targetPoint.y;

  if (node.type === 'place') {
    // Elliptical nodes - calculate intersection with ellipse
    const dx = x1 - cx;
    const dy = y1 - cy;
    const angle = Math.atan2(dy, dx);
    const rx = w;
    const ry = h;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    return { x, y };
  }

  // Rectangular nodes - find intersection with rectangle edge
  const dx = x1 - cx;
  const dy = y1 - cy;
  
  if (dx === 0 && dy === 0) {
    // Target is at center, return center
    return { x: cx, y: cy };
  }
  
  // Calculate intersection with rectangle
  // Using parametric line: P = center + t * direction
  // Find t where line intersects rectangle boundary
  let t = Infinity;
  
  if (dx !== 0) {
    // Intersection with left or right edge
    const tRight = w / Math.abs(dx);
    const tLeft = w / Math.abs(dx);
    t = Math.min(t, dx > 0 ? tRight : tLeft);
  }
  
  if (dy !== 0) {
    // Intersection with top or bottom edge
    const tBottom = h / Math.abs(dy);
    const tTop = h / Math.abs(dy);
    t = Math.min(t, dy > 0 ? tBottom : tTop);
  }
  
  const x = cx + t * dx;
  const y = cy + t * dy;

  return { x, y };
}

/** Fraction of a node's half-extent that a parallel arc may be shifted by. Below 1 so the
 *  shifted line still crosses a decent chord of the shape rather than grazing its rim. */
const PARALLEL_ARC_CLEARANCE = 0.75;

function getNodeCenter(node: Node): Point {
  const { width = 0, height = 0 } = node.measured || {};
  const position = (node as NodeWithInternals).internals.positionAbsolute;
  return { x: position.x + width / 2, y: position.y + height / 2 };
}

/**
 * How far the node's boundary reaches from its centre along `dir` — the shape's support
 * function, exact for both the ellipse of a place and the axis-aligned rectangle of a
 * transition. A line perpendicular to `dir` crosses the shape exactly while its signed
 * distance from the centre stays below this.
 */
function getNodeHalfExtent(node: Node, dir: Point): number {
  const { width = 0, height = 0 } = node.measured || {};
  const w = width / 2;
  const h = height / 2;

  return node.type === 'place'
    ? Math.hypot(w * dir.x, h * dir.y)
    : Math.abs(w * dir.x) + Math.abs(h * dir.y);
}

/**
 * Parameter interval over which the ray `origin + t * dir` (|dir| = 1) lies inside `node`,
 * or null when the ray misses the shape.
 */
function getRayNodeInterval(
  node: Node,
  origin: Point,
  dir: Point
): { tMin: number; tMax: number } | null {
  const { width = 0, height = 0 } = node.measured || {};
  const w = width / 2;
  const h = height / 2;
  const c = getNodeCenter(node);

  if (w <= 0 || h <= 0) return null;

  if (node.type === 'place') {
    // Ellipse: substitute the ray into (x/w)² + (y/h)² = 1 and solve the quadratic.
    const ex = (origin.x - c.x) / w;
    const ey = (origin.y - c.y) / h;
    const dx = dir.x / w;
    const dy = dir.y / h;

    const a = dx * dx + dy * dy;
    const b = 2 * (ex * dx + ey * dy);
    const cc = ex * ex + ey * ey - 1;
    const discriminant = b * b - 4 * a * cc;
    if (a === 0 || discriminant < 0) return null;

    const root = Math.sqrt(discriminant);
    return { tMin: (-b - root) / (2 * a), tMax: (-b + root) / (2 * a) };
  }

  // Rectangle: slab method, one parameter range per axis, intersected.
  const slab = (originComponent: number, dirComponent: number, centerComponent: number, half: number) => {
    if (dirComponent === 0) {
      // Parallel to this pair of edges: either always within the slab or never.
      return Math.abs(originComponent - centerComponent) <= half
        ? { lo: -Infinity, hi: Infinity }
        : null;
    }
    const t1 = (centerComponent - half - originComponent) / dirComponent;
    const t2 = (centerComponent + half - originComponent) / dirComponent;
    return { lo: Math.min(t1, t2), hi: Math.max(t1, t2) };
  };

  const xSlab = slab(origin.x, dir.x, c.x, w);
  const ySlab = slab(origin.y, dir.y, c.y, h);
  if (!xSlab || !ySlab) return null;

  const tMin = Math.max(xSlab.lo, ySlab.lo);
  const tMax = Math.min(xSlab.hi, ySlab.hi);

  return tMin <= tMax ? { tMin, tMax } : null;
}

/**
 * Endpoints for one of several arcs running between the same two nodes, laid out the way CPN
 * Tools does it: the whole centre-to-centre line is translated sideways by `offset` and the
 * endpoints are where *that* line meets the two shapes. Because every arc of the pair shares
 * one direction vector and differs only in its sideways shift, the arcs come out exactly
 * parallel whatever the nodes' relative position.
 *
 * The alternative — aiming each arc at a shifted point and intersecting from the node centre —
 * displaces each endpoint in proportion to its own node's size, so the two lines converge on
 * the smaller node. That is the artefact this replaces.
 *
 * `offset` is signed along the left-hand normal of the source → target direction, so callers
 * drawing the reverse arc of a pair must negate it to land on the same world-space side.
 * Returns null when no sensible straight arc exists (coincident centres, overlapping nodes),
 * leaving the caller to fall back to the unoffset geometry.
 */
export function getParallelEdgeEndpoints(
  sourceNode: Node,
  targetNode: Node,
  offset: number
): { sx: number; sy: number; tx: number; ty: number } | null {
  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);

  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const dir = { x: dx / length, y: dy / length };
  const normal = { x: -dir.y, y: dir.x };

  // Clamp so the shifted line still crosses both shapes. The limit depends only on the
  // unsigned normal, so both arcs of a pair clamp by the same amount and stay symmetric
  // about the centre line.
  const limit =
    PARALLEL_ARC_CLEARANCE *
    Math.min(getNodeHalfExtent(sourceNode, normal), getNodeHalfExtent(targetNode, normal));
  const shift = Math.max(-limit, Math.min(limit, offset));

  const origin = { x: sourceCenter.x + normal.x * shift, y: sourceCenter.y + normal.y * shift };

  const sourceInterval = getRayNodeInterval(sourceNode, origin, dir);
  const targetInterval = getRayNodeInterval(targetNode, origin, dir);
  if (!sourceInterval || !targetInterval) return null;

  // Leave the source at its far boundary, enter the target at its near one.
  const tSource = sourceInterval.tMax;
  const tTarget = targetInterval.tMin;
  if (tTarget <= tSource) return null; // shapes overlap along this line

  return {
    sx: origin.x + dir.x * tSource,
    sy: origin.y + dir.y * tSource,
    tx: origin.x + dir.x * tTarget,
    ty: origin.y + dir.y * tTarget,
  };
}

function getEdgePosition(
  node: NodeWithInternals,
  intersectionPoint: Point
): Position {
  const n = { ...node.internals.positionAbsolute, ...node };
  const nx = Math.round(n.x);
  const ny = Math.round(n.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);

  if (node.type === 'place') {
    // Adjust for elliptical nodes
    const dx = px - (nx + ((n.measured?.width ?? 0) / 2));
    const dy = py - (ny + ((n.measured?.height ?? 0) / 2));
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angle) < Math.PI / 4) return Position.Right;
    if (Math.abs(angle) > (3 * Math.PI) / 4) return Position.Left;
    return angle > 0 ? Position.Bottom : Position.Top;
  }

  // Default for rectangular nodes
  if (px <= nx + 1) {
    return Position.Left;
  }
  if (px >= nx + (n.measured?.width ?? 0) - 1) {
    return Position.Right;
  }
  if (py <= ny + 1) {
    return Position.Top;
  }
  if (py >= n.y + ((n.measured?.height ?? 0) - 1)) {
    return Position.Bottom;
  }

  return Position.Top;
}

// returns the parameters (sx, sy, tx, ty, sourcePos, targetPos) you need to create an edge
interface EdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

export function getEdgeParams(source: Node, target: Node): EdgeParams {
  const sourceIntersectionPoint = getNodeIntersection(source, target);
  const targetIntersectionPoint = getNodeIntersection(target, source);

  const sourcePos = getEdgePosition(source as NodeWithInternals, sourceIntersectionPoint);
  const targetPos = getEdgePosition(target as NodeWithInternals, targetIntersectionPoint);

  return {
    sx: sourceIntersectionPoint.x,
    sy: sourceIntersectionPoint.y,
    tx: targetIntersectionPoint.x,
    ty: targetIntersectionPoint.y,
    sourcePos,
    targetPos,
  };
}

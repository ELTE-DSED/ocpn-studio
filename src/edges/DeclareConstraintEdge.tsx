import React, { useCallback } from 'react';
import { useInternalNode } from '@xyflow/react';
import { getEdgeParams } from '../utils';
import useStore from '@/stores/store';
import { useSimulationContext } from '@/context/useSimulationContextHook';
import type { BinaryDeclareTemplate } from '@/types';

type SourceMarker = 'ball' | 'diamond-filled' | 'diamond-hollow' | 'none';
type TargetMarker = 'ball' | 'arrow' | 'ball-arrow' | 'none';

interface TemplateSpec {
  label: string;
  color: string;
  lines: 1 | 2 | 3;
  sourceMarker: SourceMarker;
  targetMarker: TargetMarker;
  hash: boolean;
}

// Visual grammar matches CPN Tools' own Declare notation (no text labels — every
// template has a distinct shape): line count encodes strength (1 = base, 2 =
// alternate, 3 = chain), a filled ball marks the "activation" side, an arrowhead
// marks a side carrying a forward-looking obligation, and a double cross-tick marks
// negated relations.
const TEMPLATE_META: Record<BinaryDeclareTemplate, TemplateSpec> = {
  response: { label: 'Response', color: '#15803d', lines: 1, sourceMarker: 'ball', targetMarker: 'arrow', hash: false },
  precedence: { label: 'Precedence', color: '#15803d', lines: 1, sourceMarker: 'none', targetMarker: 'ball-arrow', hash: false },
  succession: { label: 'Succession', color: '#15803d', lines: 1, sourceMarker: 'ball', targetMarker: 'ball-arrow', hash: false },
  'alternate-response': { label: 'Alternate Response', color: '#15803d', lines: 2, sourceMarker: 'ball', targetMarker: 'arrow', hash: false },
  'alternate-precedence': { label: 'Alternate Precedence', color: '#15803d', lines: 2, sourceMarker: 'none', targetMarker: 'ball-arrow', hash: false },
  'alternate-succession': { label: 'Alternate Succession', color: '#15803d', lines: 2, sourceMarker: 'ball', targetMarker: 'ball-arrow', hash: false },
  'chain-response': { label: 'Chain Response', color: '#15803d', lines: 3, sourceMarker: 'ball', targetMarker: 'arrow', hash: false },
  'chain-precedence': { label: 'Chain Precedence', color: '#15803d', lines: 3, sourceMarker: 'none', targetMarker: 'ball-arrow', hash: false },
  'chain-succession': { label: 'Chain Succession', color: '#15803d', lines: 3, sourceMarker: 'ball', targetMarker: 'ball-arrow', hash: false },
  'responded-existence': { label: 'Responded Existence', color: '#7e22ce', lines: 1, sourceMarker: 'ball', targetMarker: 'none', hash: false },
  'co-existence': { label: 'Co-Existence', color: '#7e22ce', lines: 1, sourceMarker: 'ball', targetMarker: 'ball', hash: false },
  choice: { label: 'Choice', color: '#7e22ce', lines: 1, sourceMarker: 'diamond-hollow', targetMarker: 'none', hash: false },
  'exclusive-choice': { label: 'Exclusive Choice', color: '#7e22ce', lines: 1, sourceMarker: 'diamond-filled', targetMarker: 'none', hash: false },
  'not-coexistence': { label: 'Not Coexistence', color: '#b91c1c', lines: 1, sourceMarker: 'ball', targetMarker: 'ball', hash: true },
  'not-succession': { label: 'Not Succession', color: '#b91c1c', lines: 1, sourceMarker: 'ball', targetMarker: 'ball-arrow', hash: true },
  'not-chain-succession': { label: 'Not Chain Succession', color: '#b91c1c', lines: 3, sourceMarker: 'ball', targetMarker: 'ball-arrow', hash: true },
};

const LINE_OFFSETS: Record<1 | 2 | 3, number[]> = {
  1: [0],
  2: [-0.9, 0.9],
  3: [-1.6, 0, 1.6],
};

// Ball/diamond markers sit tangent to the true node-boundary point — their
// center is pushed outward by their own radius, so they touch the node at a
// single point instead of being centered on the boundary (which would leave
// half the shape hidden behind the node's opaque fill).
const BALL_R = 4.5;
const DIAMOND_R = 5.5;
const ARROW_LEN = 9;
const ARROW_HALF_WIDTH = 3.2;
// A plain (arrow-less) line end is pulled back slightly less than the marker's
// full near-edge distance, so it visibly dips into the ball/diamond rather than
// just kissing its tangent edge.
const LINE_INTO_MARKER = 1.5;

interface DeclareConstraintEdgeProps {
  id: string;
  source: string;
  target: string;
  data?: {
    template: BinaryDeclareTemplate;
    enabled: boolean;
  };
}

function DeclareConstraintEdge({ id, source, target, data }: DeclareConstraintEdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const setSelectedElement = useStore((state) => state.setSelectedElement);
  const showDeclareLayer = useStore((state) => state.showDeclareLayer);
  const activeMode = useStore((state) => state.activeMode);
  const edges = useStore((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return petriNet?.edges ?? [];
  });
  const isSelected = useStore((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return petriNet?.selectedElement?.type === 'edge' && petriNet.selectedElement.element.id === id;
  });

  const { declareResults, blockedTransitions } = useSimulationContext();

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const edge = edges.find((edge) => edge.id === id);
    if (edge && activePetriNetId) {
      setSelectedElement(activePetriNetId, { type: 'edge', element: edge });
    }
  }, [id, edges, activePetriNetId, setSelectedElement]);

  if (!showDeclareLayer || !sourceNode || !targetNode) {
    return null;
  }

  const template = data?.template ?? 'response';
  const enabled = data?.enabled ?? true;
  const meta = TEMPLATE_META[template];

  const { sx, sy, tx, ty } = getEdgeParams(sourceNode, targetNode);

  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  // Live acceptance state, only meaningful once a simulation/analysis run has touched this constraint
  const liveResult = activeMode !== 'model'
    ? declareResults.find((r) => r.constraintId === id)
    : undefined;
  // Is THIS constraint, right now, the reason one of its two transitions can't fire?
  const blockedEndpoint = activeMode !== 'model'
    ? blockedTransitions.find(
        (bt) => (bt.transitionId === source || bt.transitionId === target) && bt.blockingConstraintIds.includes(id),
      )
    : undefined;
  const isBlockingNow = !!blockedEndpoint;
  const blockedNodeLabel = blockedEndpoint
    ? ((blockedEndpoint.transitionId === source ? sourceNode.data : targetNode.data) as { label?: string } | undefined)?.label
    : undefined;
  const strokeColor = isBlockingNow
    ? '#dc2626'
    : liveResult
      ? (liveResult.state === 'satisfied' ? '#16a34a' : '#d97706')
      : meta.color;
  const opacity = enabled ? 1 : 0.35;

  const offsets = LINE_OFFSETS[meta.lines];
  const strokeWidth = meta.lines === 1 ? 1.1 : meta.lines === 2 ? 0.95 : 0.85;
  const hasTargetArrow = meta.targetMarker === 'arrow' || meta.targetMarker === 'ball-arrow';
  const hasTargetBall = meta.targetMarker === 'ball' || meta.targetMarker === 'ball-arrow';

  // Source marker center: pushed out along the edge direction (away from the
  // source node's own body) by its radius, so it's tangent to the boundary
  // rather than centered on it. Lines start where they touch the marker's
  // outer surface, not at its center.
  const sourceR = meta.sourceMarker === 'ball' ? BALL_R : meta.sourceMarker === 'none' ? 0 : DIAMOND_R;
  const sourceMarkerCenter = { x: sx + ux * sourceR, y: sy + uy * sourceR };
  // Plain (arrow-less) line ends dip a bit past the marker's tangent edge, into
  // its body, rather than stopping exactly at the edge.
  const sourceLineStart = sourceR > 0
    ? { x: sx + ux * (2 * sourceR - LINE_INTO_MARKER), y: sy + uy * (2 * sourceR - LINE_INTO_MARKER) }
    : { x: sx, y: sy };

  // Target ball: same tangent treatment, pushed out away from the target node's
  // own body (i.e. back towards the source) by its radius.
  const targetBallCenter = { x: tx - ux * BALL_R, y: ty - uy * BALL_R };
  const targetBallNearEdge = hasTargetBall
    ? { x: tx - ux * 2 * BALL_R, y: ty - uy * 2 * BALL_R }
    : { x: tx, y: ty };

  // Arrowhead: its tip points at whatever comes next (the ball's near edge, or
  // the bare node boundary when there's no ball) and its base sits ARROW_LEN
  // further back — lines stop at that base, not at the tip, so the outer lines
  // of a multi-line bundle read as shorter than the arrow-tipped center line.
  const arrowTip = targetBallNearEdge;
  const arrowBase = { x: arrowTip.x - ux * ARROW_LEN, y: arrowTip.y - uy * ARROW_LEN };
  const arrowPolygon = [
    `${arrowTip.x},${arrowTip.y}`,
    `${arrowBase.x + px * ARROW_HALF_WIDTH},${arrowBase.y + py * ARROW_HALF_WIDTH}`,
    `${arrowBase.x - px * ARROW_HALF_WIDTH},${arrowBase.y - py * ARROW_HALF_WIDTH}`,
  ].join(' ');

  // A ball-only end (no arrow) also gets the "dip in" treatment; an arrow-tipped
  // end stops at the arrow's base and lets the arrowhead itself carry the line
  // the rest of the way to the ball/node.
  const targetLineEnd = hasTargetArrow
    ? arrowBase
    : hasTargetBall
      ? { x: tx - ux * (2 * BALL_R - LINE_INTO_MARKER), y: ty - uy * (2 * BALL_R - LINE_INTO_MARKER) }
      : targetBallNearEdge;

  // Plain straight parallel lines — no fan/kink, each simply offset perpendicular
  // to the source-target axis for its full length.
  const straightPath = `M ${sx},${sy} L ${tx},${ty}`;
  const buildLinePath = (off: number) =>
    `M ${sourceLineStart.x + px * off},${sourceLineStart.y + py * off} L ${targetLineEnd.x + px * off},${targetLineEnd.y + py * off}`;

  // Negation cross-ticks: two short perpendicular strokes at the midpoint, wide enough
  // to cross every parallel line in the bundle.
  const midX = (sourceLineStart.x + targetLineEnd.x) / 2;
  const midY = (sourceLineStart.y + targetLineEnd.y) / 2;
  const hashHalfWidth = Math.max(...offsets.map(Math.abs)) + 2;
  const hashTicks = [-2.5, 2.5].map((along) => {
    const cx = midX + ux * along;
    const cy = midY + uy * along;
    return {
      x1: cx + px * hashHalfWidth,
      y1: cy + py * hashHalfWidth,
      x2: cx - px * hashHalfWidth,
      y2: cy - py * hashHalfWidth,
    };
  });

  const tooltip = isBlockingNow
    ? `${meta.label} — blocking: "${blockedNodeLabel ?? '…'}" cannot fire right now`
    : liveResult ? `${meta.label} — ${liveResult.state}` : meta.label;

  return (
    <g style={{ opacity }} className={`cursor-pointer${isBlockingNow ? ' animate-pulse' : ''}`} onMouseDown={handleClick}>
      <title>{tooltip}</title>

      {/* Invisible wider hit-path for easier clicking */}
      <path
        d={straightPath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ pointerEvents: 'stroke' }}
      />
      {isSelected && (
        <path d={buildLinePath(0)} fill="none" stroke={strokeColor} strokeWidth="6" strokeOpacity="0.25" strokeLinecap="round" />
      )}

      {/* Parallel line(s) — count encodes response(1)/alternate(2)/chain(3) */}
      {offsets.map((off) => (
        <path
          key={off}
          d={buildLinePath(off)}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      ))}

      {/* Arrowhead, drawn as a plain polygon (not an SVG marker): its tip touches
          the target ball's near edge (or the bare node boundary when there's no
          ball), so the arrow visibly "feeds into" whatever comes next. */}
      {hasTargetArrow && <polygon points={arrowPolygon} fill={strokeColor} />}

      {/* Negation cross-ticks */}
      {meta.hash && hashTicks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={strokeColor} strokeWidth={1.1} />
      ))}

      {/* Source marker: ball (activation) or diamond (choice family) — tangent
          to the node, touching it at a single point. */}
      {meta.sourceMarker === 'ball' && (
        <circle cx={sourceMarkerCenter.x} cy={sourceMarkerCenter.y} r={BALL_R} fill={strokeColor} />
      )}
      {meta.sourceMarker === 'diamond-filled' && (
        <polygon
          points={`${sourceMarkerCenter.x},${sourceMarkerCenter.y - DIAMOND_R} ${sourceMarkerCenter.x + DIAMOND_R},${sourceMarkerCenter.y} ${sourceMarkerCenter.x},${sourceMarkerCenter.y + DIAMOND_R} ${sourceMarkerCenter.x - DIAMOND_R},${sourceMarkerCenter.y}`}
          fill={strokeColor}
        />
      )}
      {meta.sourceMarker === 'diamond-hollow' && (
        <polygon
          points={`${sourceMarkerCenter.x},${sourceMarkerCenter.y - DIAMOND_R} ${sourceMarkerCenter.x + DIAMOND_R},${sourceMarkerCenter.y} ${sourceMarkerCenter.x},${sourceMarkerCenter.y + DIAMOND_R} ${sourceMarkerCenter.x - DIAMOND_R},${sourceMarkerCenter.y}`}
          fill="white"
          stroke={strokeColor}
          strokeWidth={1.25}
        />
      )}

      {/* Target ball — tangent to the node, touching it at a single point. */}
      {hasTargetBall && (
        <circle cx={targetBallCenter.x} cy={targetBallCenter.y} r={BALL_R} fill={strokeColor} />
      )}
    </g>
  );
}

export default DeclareConstraintEdge;

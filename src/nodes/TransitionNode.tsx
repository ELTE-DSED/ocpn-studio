import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeResizer, useConnection, useReactFlow } from '@xyflow/react';
import useStore from '@/stores/store';
import type { Node } from '@xyflow/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { UnaryDeclareConstraint, DeclareResult } from '@/types';
import { useSimulationContext } from '@/context/useSimulationContextHook';

// Export the interface so it can be imported elsewhere
export interface TransitionNodeData {
  label: string;
  isArcMode: boolean;
  isDeclareMode?: boolean;
  type: string;
  guard: string;
  time: string;
  priority: string;
  codeSegment: string;
  // Hierarchy: substitution transition
  subPageId?: string; // ID of the subpage petri net (makes this a substitution transition)
  socketAssignments?: { portPlaceId: string; socketPlaceId: string }[];
  overrideColor?: string;
  // Offset positions for draggable inscriptions
  guardOffset?: { x: number; y: number };
  timeOffset?: { x: number; y: number };
  // Unary Declare constraints (Existence/Absence) dropped directly onto this transition
  declareUnary?: UnaryDeclareConstraint[];
}

export interface TransitionNodeProps {
  id: string;
  data: TransitionNodeData;
  selected: boolean;
}

// Draggable inscription component
// Positions are relative to the center of the node
// Always anchors from the center of the text (no alignment switching)
// Currently disabled - will be made configurable later
/* function DraggableInscription({
  children,
  offset,
  onDragEnd,
  className,
  style,
}: {
  children: React.ReactNode;
  offset: { x: number; y: number };
  onDragEnd: (offset: { x: number; y: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(offset);
  const currentOffsetRef = useRef(dragOffset);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const { getZoom } = useReactFlow();

  // Keep ref in sync
  currentOffsetRef.current = dragOffset;

  // Track previous offset to detect actual changes
  const prevOffsetRef = useRef(offset);

  React.useEffect(() => {
    // Only reset if offset actually changed (not just re-render)
    if (prevOffsetRef.current.x === offset.x && prevOffsetRef.current.y === offset.y) {
      return;
    }
    prevOffsetRef.current = offset;
    setDragOffset(offset);
  }, [offset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: currentOffsetRef.current.x,
      offsetY: currentOffsetRef.current.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const zoom = getZoom();
      const dx = (moveEvent.clientX - dragStartRef.current.x) / zoom;
      const dy = (moveEvent.clientY - dragStartRef.current.y) / zoom;
      const newX = dragStartRef.current.offsetX + dx;
      const newY = dragStartRef.current.offsetY + dy;

      const newOffset = { x: newX, y: newY };
      setDragOffset(newOffset);
      currentOffsetRef.current = newOffset;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (dragStartRef.current) {
        onDragEnd(currentOffsetRef.current);
      }
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [getZoom, onDragEnd]);

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
      className={`nodrag ${className || ''}`}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  );
}
*/

export const TransitionNode: React.FC<TransitionNodeProps> = ({ id, data, selected }) => {
  const connection = useConnection();
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const setActivePetriNet = useStore((state) => state.setActivePetriNet);
  // const updateNodeData = useStore((state) => state.updateNodeData);
  const { getNode, setNodes } = useReactFlow();

  // Get the subpage name for the hierarchy tag
  const subPageName = useStore((state) => {
    if (!data.subPageId) return null;
    return state.petriNetsById[data.subPageId]?.name || null;
  });

  // Check if simulation is active and this substitution transition's subpage marking changed
  const activeMode = useStore((state) => state.activeMode);
  const isFireMode = useStore((state) => state.isFireMode);

  // Check if any enabled monitor watches this transition
  const hasMonitor = useStore((state) =>
    state.monitors.some((m) => m.enabled && m.transitionIds.includes(id)),
  );

  // Unary Declare constraints (Existence/Absence/Exactly/Init/Last) dropped directly onto
  // this transition, rendered as CPN-Tools-style "roof" tags sitting on top of the node.
  const showDeclareLayer = useStore((state) => state.showDeclareLayer);
  const unaryConstraints = data.declareUnary ?? [];
  const { declareResults, blockedTransitions, enabledTransitions } = useSimulationContext();
  // Which constraints (of any kind) are, right now, the reason THIS transition can't fire.
  const blockingConstraintIdsForThisTransition = blockedTransitions.find((bt) => bt.transitionId === id)?.blockingConstraintIds ?? [];
  // Fire Transition Mode: highlight this transition as clickable when it's currently enabled
  // (or would become enabled by letting simulation time advance — see EnabledTransitionInfo).
  const fireableInfo = isFireMode && activeMode === 'simulation'
    ? enabledTransitions.find((t) => t.transitionId === id)
    : undefined;
  const isFireable = !!fireableInfo;
  const isFireableInFuture = !!fireableInfo?.isFuture;
  const roofTags = unaryConstraints.map((c) => {
    // Labels match CPN Tools' own Declare notation exactly (e.g. "1..*", "0..1", "3").
    const n = c.n ?? 1;
    const label =
      c.template === 'existence' ? `${n}..*`
      : c.template === 'absence' ? (n <= 1 ? '0' : `0..${n - 1}`)
      : c.template === 'exactly' ? `${n}`
      : c.template === 'init' ? 'init'
      : 'last';
    const result = declareResults.find((r: DeclareResult) => r.constraintId === c.id);
    const isLive = activeMode !== 'model' && !!result;
    const isBlockingNow = activeMode !== 'model' && blockingConstraintIdsForThisTransition.includes(c.id);
    const color = !c.enabled ? '#9ca3af'
      : isBlockingNow ? '#dc2626'
      : isLive ? (result!.state === 'satisfied' ? '#16a34a' : '#d97706')
      : '#4f46e5';
    const tooltip = isBlockingNow
      ? `${c.template} — blocking: "${data.label}" cannot fire right now`
      : `${c.template}${n !== 1 && (c.template === 'existence' || c.template === 'absence' || c.template === 'exactly') ? ` (${n})` : ''}${isLive ? ` — ${result!.state}` : ''}${c.enabled ? '' : ' (disabled)'}`;
    return { id: c.id, label, color, tooltip, isBlockingNow };
  });

  // Get validation errors for this transition
  const validationErrors = useStore((state) => state.validationErrors[id]);
  const hasValidationIssues = validationErrors && validationErrors.length > 0;
  const errorTooltip = validationErrors?.map(e => e.message).join('\n') || '';

  const hasSubpageActivity = useStore((state) => {
    if (!data.subPageId || activeMode !== 'simulation') return false;
    const subPage = state.petriNetsById[data.subPageId];
    if (!subPage) return false;
    // Compare each non-port place's current marking against its initial marking
    // Glow only when any internal place's marking differs from its initial state
    // Port places (In/Out/I/O) are excluded since they mirror socket places on the parent
    return subPage.nodes.some((n) => {
      if (n.type !== 'place') return false;
      // Skip port places — their markings are shown on the parent page
      if (n.data?.portType) return false;
      const currentMarking = Array.isArray(n.data?.marking) ? n.data.marking : [];
      const initialStr = typeof n.data?.initialMarking === 'string' ? n.data.initialMarking.trim() : '';
      // Parse initial marking to compare (simple JSON parse; empty string → empty array)
      let initialMarking: unknown[] = [];
      if (initialStr) {
        try {
          // Handle UNIT marking: [(), (), ...]
          const unitMatch = initialStr.match(/^\[\s*((?:\(\)\s*,?\s*)*)\s*\]$/);
          if (unitMatch) {
            const unitCount = (initialStr.match(/\(\)/g) || []).length;
            initialMarking = Array(unitCount).fill(null);
          } else {
            const parsed = JSON.parse(initialStr);
            initialMarking = Array.isArray(parsed) ? parsed : [parsed];
          }
        } catch {
          initialMarking = [];
        }
      }
      // Quick length check first
      if (currentMarking.length !== initialMarking.length) return true;
      if (currentMarking.length === 0) return false;
      // Strip timestamps from timed tokens so we compare only values.
      // Timed tokens have shape { timestamp: number, value: ... }; we keep only `value`.
      const stripTimestamp = (token: unknown): unknown => {
        if (token && typeof token === 'object' && 'timestamp' in token && 'value' in token) {
          return (token as { value: unknown }).value;
        }
        return token;
      };
      // Order-independent multiset comparison via sorted JSON serialization
      const sortedStringify = (arr: unknown[]) => {
        const strings = arr.map((t) => JSON.stringify(stripTimestamp(t)));
        strings.sort();
        return strings.join('\n');
      };
      return sortedStringify(currentMarking) !== sortedStringify(initialMarking);
    });
  });

  const handleBadgeClick = useCallback((fieldId: string) => {
    if (!activePetriNetId) return;
    const node = getNode(id) as Node | undefined;
    if (node) {
      useStore.getState().setSelectedElement(activePetriNetId, { type: 'node', element: node });
      // Also update React Flow's internal selection state
      setNodes((nodes) => nodes.map((n) => ({ ...n, selected: n.id === id })));
    }
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 50);
  }, [activePetriNetId, id, getNode, setNodes]);

  const isTarget = connection.inProgress && connection.fromNode.id !== id && connection.fromNode.type === 'place';
  // Declare constraints connect two transitions, so the target handle only opens
  // to another transition (and only while Declare-connect mode is active).
  const isDeclareTarget = data.isDeclareMode && connection.inProgress && connection.fromNode.id !== id && connection.fromNode.type === 'transition';

  // Default offsets for inscriptions (relative to node center)
  // Disabled for now - will be made configurable later
  // const timeOffset = data.timeOffset ?? { x: 45, y: -15 };
  // const handleTimeDragEnd = useCallback((newOffset: { x: number; y: number }) => {
  //   if (activePetriNetId) {
  //     updateNodeData(activePetriNetId, id, { ...data, timeOffset: newOffset });
  //   }
  // }, [activePetriNetId, id, data, updateNodeData]);

  return (
    <div
      className={`relative cpn-node transition-node${isFireable ? ' cursor-pointer' : ''}`}
      style={data.overrideColor ? { borderColor: data.overrideColor } : undefined}
    >

      <NodeResizer
        isVisible={selected}
        minWidth={15}
        minHeight={30}
      />
      
      {/* Static Label */}
      <div className="whitespace-pre-wrap leading-tight">
        {data.label}
      </div>

      {/* Guard inscription removed - shown only as badge icon */}

      {/* Time inscription - disabled for now, shown only as badge icon
      {data.time && (
        <DraggableInscription
          offset={timeOffset}
          onDragEnd={handleTimeDragEnd}
          className="text-[9px] font-mono whitespace-nowrap text-[#8B4513]"
        >
          @+{data.time}
        </DraggableInscription>
      )}
      */}

      {/* Guard badge - shield icon at top-left corner (moves out diagonally when selected) */}
      {data.guard && data.guard.trim() && (
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: -2,
            transform: selected ? 'translate(-100%, -100%)' : 'translate(-50%, -50%)',
            transition: 'transform 0.15s ease-out',
          }}
          className="cursor-pointer nodrag"
          title={`Guard: ${data.guard}`}
          onClick={(e) => { e.stopPropagation(); handleBadgeClick('guard'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11.5" fill="white" stroke="#006400" strokeWidth="1" />
            <path d="M12 4L6 7v4c0 3.5 2.5 6.7 6 8 3.5-1.3 6-4.5 6-8V7l-6-3z" fill="#006400" fillOpacity="0.15" stroke="#006400" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* Time delay badge - clock icon at top-right corner (moves out diagonally when selected) */}
      {data.time && data.time.trim() && (
        <div
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            transform: selected ? 'translate(100%, -100%)' : 'translate(50%, -50%)',
            transition: 'transform 0.15s ease-out',
          }}
          className="cursor-pointer nodrag"
          title={`Time: @+${data.time}`}
          onClick={(e) => { e.stopPropagation(); handleBadgeClick('time-expression'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11.5" fill="white" stroke="#8B4513" strokeWidth="1" />
            <circle cx="12" cy="12" r="8" fill="#8B4513" fillOpacity="0.12" stroke="#8B4513" strokeWidth="1.2" />
            <line x1="12" y1="7" x2="12" y2="12" stroke="#8B4513" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="12" x2="16" y2="12" stroke="#8B4513" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Code segment badge - small icon at bottom-right corner (moves out diagonally when selected) */}
      {data.codeSegment && data.codeSegment.trim() && (
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            transform: selected ? 'translate(100%, 100%)' : 'translate(50%, 50%)',
            transition: 'transform 0.15s ease-out',
          }}
          className="cursor-pointer nodrag"
          title="Has code segment"
          onClick={(e) => { e.stopPropagation(); handleBadgeClick('code-segment'); }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="6.5" fill="white" stroke="#6b7280" strokeWidth="1" />
            <text x="7" y="10" textAnchor="middle" fontSize="8" fontFamily="monospace" fontWeight="600" fill="#6b7280">{'{}'}</text>
          </svg>
        </div>
      )}

      {/* Priority badge - flag icon at bottom-left corner (moves out diagonally when selected) */}
      {data.priority && data.priority !== 'NONE' && (
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            left: -2,
            transform: selected ? 'translate(-100%, 100%)' : 'translate(-50%, 50%)',
            transition: 'transform 0.15s ease-out',
          }}
          className="cursor-pointer nodrag"
          title={`Priority: ${data.priority}`}
          onClick={(e) => { e.stopPropagation(); handleBadgeClick('priority'); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11.5" fill="white" stroke="#b45309" strokeWidth="1" />
            <path d="M8 5v14M8 5h8l-3 4 3 4H8" fill="#b45309" fillOpacity="0.15" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* Monitor indicator badge - top center (moves out upward when selected) */}
      {hasMonitor && (
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: '50%',
            transform: selected ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)',
            transition: 'transform 0.15s ease-out',
          }}
          className="nodrag pointer-events-none"
          title="Monitored"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11.5" fill="white" stroke="#2563eb" strokeWidth="1" />
            <circle cx="12" cy="8" r="2.5" fill="#2563eb" fillOpacity="0.2" stroke="#2563eb" strokeWidth="1.2" />
            <path d="M6 19 Q6 13 12 13 Q18 13 18 19" fill="#2563eb" fillOpacity="0.15" stroke="#2563eb" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Unary Declare constraint (Existence/Absence/Exactly/Init/Last) - a single CPN-Tools-
          style "roof" tag sitting on top of the node (CPN Tools only ever allows one — some
          templates are mutually exclusive). Kept low-profile and only lightly overlapping the
          node's top edge so it doesn't swallow arrowheads of arcs arriving from above. */}
      {showDeclareLayer && roofTags.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 2,
            marginBottom: -3,
            zIndex: 5,
          }}
          className="nodrag"
        >
          {roofTags.map((tag) => (
            <div
              key={tag.id}
              className={`cursor-pointer${tag.isBlockingNow ? ' animate-pulse' : ''}`}
              title={tag.tooltip}
              onClick={(e) => { e.stopPropagation(); handleBadgeClick('declare-unary'); }}
            >
              <svg width="28" height="15" viewBox="0 0 28 15" xmlns="http://www.w3.org/2000/svg">
                <path d="M1,14 L1,6.5 L14,1 L27,6.5 L27,14 Z" fill="white" stroke={tag.color} strokeWidth={tag.isBlockingNow ? 1.6 : 1} strokeLinejoin="round" />
                <text x="14" y="11.5" textAnchor="middle" fontSize="7.5" fontWeight="600" fontFamily="sans-serif" fill={tag.color}>{tag.label}</text>
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* Hierarchy tag - subpage name at bottom center */}
      {data.subPageId && subPageName && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: selected
              ? 'translate(-50%, calc(100% + 4px))'
              : 'translate(-50%, calc(100% - 1px))',
            transition: 'transform 0.15s ease-out',
          }}
          className="nodrag pointer-events-auto cursor-pointer"
        >
          <div
            className="flex items-center px-0.5 h-[16px] rounded-[2px] border border-blue-400/70 bg-blue-50 text-[8px] font-medium text-blue-700 whitespace-nowrap shadow-sm hover:bg-blue-100 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              if (data.subPageId) setActivePetriNet(data.subPageId);
            }}>
            {subPageName}
          </div>
        </div>
      )}

      {/* Green border for substitution transitions with active subpage */}
      {hasSubpageActivity && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 3,
            border: '2px solid #7ED321',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Fire Transition Mode: pulsing highlight on transitions the user can click to fire.
          Amber instead of green when it's only reachable by letting simulation time advance
          (firing it will jump the clock forward to fireableInfo.atTime). */}
      {isFireable && (
        <div
          className="animate-pulse"
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 3,
            border: `2px solid ${isFireableInFuture ? '#d97706' : '#16a34a'}`,
            boxShadow: isFireableInFuture
              ? '0 0 6px 1px rgba(217, 119, 6, 0.5)'
              : '0 0 6px 1px rgba(22, 163, 74, 0.5)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Validation error/warning border overlay */}
      {/* Validation caution badge - bottom center (below hierarchy tag if present) */}
      {hasValidationIssues && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: '50%',
                transform: selected
                  ? `translate(-50%, calc(100% + ${data.subPageId ? '20px' : '4px'}))`
                  : `translate(-50%, calc(100% + ${data.subPageId ? '15px' : '-1px'}))`,
                transition: 'transform 0.15s ease-out',
                zIndex: 10,
              }}
              className="nodrag pointer-events-auto cursor-help"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L1 21h22L12 2z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round" />
                <text x="12" y="19" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#000">!</text>
              </svg>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <div className="flex items-start gap-1.5">
              <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L1 21h22L12 2z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round" />
                <text x="12" y="19" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#000">!</text>
              </svg>
              <div>
                <p className="font-semibold">Warning</p>
                {errorTooltip.split('\n').map((line, i) => (
                  <p key={i} className="text-xs opacity-90">{line}</p>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      
      <Handle
        className="custom-handle"
        type="source"
        position={Position.Right}
        style={{ visibility: ((data.isArcMode || data.isDeclareMode) && !connection.inProgress) ? 'visible' : 'hidden' }}
      />
      <Handle
        className="custom-handle"
        type="target"
        position={Position.Left}
        style={{ visibility: ((data.isArcMode && isTarget) || isDeclareTarget) ? 'visible' : 'hidden' }}
        isConnectable={isTarget || isDeclareTarget}
      />
    </div>
  );
};

export default memo(TransitionNode);

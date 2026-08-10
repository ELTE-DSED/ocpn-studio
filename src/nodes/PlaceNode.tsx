import React, { useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeResizer, useConnection, useReactFlow } from '@xyflow/react';
import useStore from '@/stores/store'; // Import Zustand store
import { isTimedToken } from '@/types';
import { formatDateTimeFull } from '@/utils/timeFormat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Export the interface so it can be imported elsewhere
export interface PlaceNodeData {
  label: string;
  isArcMode: boolean;
  isDeclareMode?: boolean;
  type: string;
  colorSet: string;
  initialMarking: string;
  marking: unknown[]; // Array of tokens (can be plain values or TimedToken objects)
  // Hierarchy: port places and fusion places
  portType?: 'in' | 'out' | 'io'; // Port type for places on subpages
  fusionSetId?: string; // Links this place to a fusion set
  // Offset positions for draggable inscriptions
  overrideColor?: string;
  colorSetOffset?: { x: number; y: number };
  tokenCountOffset?: { x: number; y: number };
  markingOffset?: { x: number; y: number };
}

export interface PlaceNodeProps {
  id: string;
  data: PlaceNodeData;
  selected: boolean;
}

// Default inscription offsets, for places whose inscriptions have never been dragged.
// Frozen module constants rather than literals built during render: they are passed as
// props into DraggableInscription, where they key an effect that sets state — a fresh
// object each render makes that effect fire on every render of the place.
const DEFAULT_COLOR_SET_OFFSET = Object.freeze({ x: 0, y: 35 }); // Below the place
const DEFAULT_TOKEN_COUNT_OFFSET = Object.freeze({ x: 25, y: -5 }); // Top-right of place
const DEFAULT_MARKING_OFFSET = Object.freeze({ x: 40, y: 0 }); // Right of token count

// Draggable inscription component
function DraggableInscription({
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
  React.useEffect(() => {
    currentOffsetRef.current = dragOffset;
  });

  // Mirror the prop into state when it actually changes. Keyed on the coordinates rather
  // than the object, and a no-op when they already match: as a passive effect that sets
  // state, an identity-keyed version fires on every render of the place — and during a
  // simulation run, where markings change continuously, those updates cascade into
  // React's "Maximum update depth exceeded".
  React.useEffect(() => {
    setDragOffset((prev) =>
      prev.x === offset.x && prev.y === offset.y ? prev : { x: offset.x, y: offset.y }
    );
  }, [offset.x, offset.y]);

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
      const newOffset = {
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      };
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
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        ...style,
      }}
      className={`nodrag ${className || ''}`}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  );
}

// Format a single token value for display (handles objects/records, arrays, strings, numbers)
function formatTokenValue(token: unknown, isUnitType: boolean = false, isListType: boolean = false): string {
  if (token === null || token === undefined) {
    return isUnitType ? '•' : '()';
  } else if (token instanceof Map) {
    // Convert Map to object notation
    const entries: string[] = [];
    token.forEach((value, key) => {
      entries.push(`${key}=${formatTokenValue(value)}`);
    });
    return `{${entries.join(', ')}}`; 
  } else if (Array.isArray(token)) {
    if (isListType) {
      // List type — display with brackets
      return `[${token.map(t => formatTokenValue(t)).join(',')}]`;
    }
    // Product/tuple type
    return `(${token.map(t => formatTokenValue(t)).join(',')})`; 
  } else if (typeof token === 'object') {
    // Check if it's a timed token - don't format the wrapper, just the value
    if (isTimedToken(token)) {
      return formatTokenValue(token.value, isUnitType, isListType);
    }
    // Plain object (record type)
    const entries = Object.entries(token).map(([k, v]) => `${k}=${formatTokenValue(v)}`);
    return `{${entries.join(', ')}}`; 
  } else if (typeof token === 'string') {
    return `"${token}"`;
  } else {
    return String(token);
  }
}

// Format time for display - relative or absolute based on epoch
function formatTimeDisplay(timestampMs: number, epoch: Date | null): string {
  if (epoch) {
    // Absolute time display
    const date = new Date(epoch.getTime() + timestampMs);
    return formatDateTimeFull(date);
  }
  // No epoch - show plain integer model time
  return `@${timestampMs}`;
}

// Get grouped marking data for table display
export interface MarkingEntry {
  count: number;
  value: string;
  timestamp: number;
  timeDisplay: string;
}

function getMarkingTableData(marking: unknown[], isUnitType: boolean = false, isTimed: boolean = false, epoch: Date | null = null, isListType: boolean = false): MarkingEntry[] {
  if (isUnitType && !isTimed) {
    return [{ count: marking.length, value: '•', timestamp: 0, timeDisplay: '' }];
  }
  
  // Group tokens by value (and timestamp for timed tokens)
  const tokenCounts = new Map<string, MarkingEntry>();
  for (const token of marking) {
    const timestamp = isTimedToken(token) ? token.timestamp : 0;
    const value = isTimedToken(token) ? formatTokenValue(token.value, isUnitType, isListType) : formatTokenValue(token, isUnitType, isListType);
    const key = isTimed ? `${value}@${timestamp}` : value;
    const existing = tokenCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      tokenCounts.set(key, { 
        count: 1, 
        value, 
        timestamp,
        timeDisplay: isTimed ? formatTimeDisplay(timestamp, epoch) : ''
      });
    }
  }
  
  return Array.from(tokenCounts.values());
}

const MAX_VISIBLE_ROWS = 10;

export const PlaceNode: React.FC<PlaceNodeProps> = ({ id, data, selected }) => {
  const connection = useConnection();
  const colorSet = useStore((state) =>
    state.colorSets.find((cs) => cs.name === data.colorSet)
  );
  const colorSetColor = data.overrideColor || colorSet?.color || '#000000';
  // Check if this is a UNIT type colorset
  const isUnitType = colorSet?.type === 'basic' && colorSet?.definition?.includes('= unit;');
  // Check if this is a list type colorset
  const isListType = colorSet?.type === 'list' || (colorSet?.definition?.includes('= list ') ?? false);
  // Check if this is a timed colorset
  const isTimed = colorSet?.timed === true;
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const updateNodeData = useStore((state) => state.updateNodeData);
  const showMarkingDisplay = useStore((state) => state.showMarkingDisplay);
  const simulationEpoch = useStore((state) => state.simulationEpoch);
  const epoch = simulationEpoch ? new Date(simulationEpoch) : null;

  // Get fusion set name if this place belongs to one
  const fusionSetName = useStore((state) => {
    if (!data.fusionSetId) return null;
    return state.fusionSets.find((fs) => fs.id === data.fusionSetId)?.name || null;
  });

  // Check if any enabled monitor watches this place
  const hasMonitor = useStore((state) =>
    state.monitors.some((m) => m.enabled && m.placeIds.includes(id)),
  );

  // Get validation errors for this place
  const validationErrors = useStore((state) => state.validationErrors[id]);
  const hasValidationIssues = validationErrors && validationErrors.length > 0;
  const errorTooltip = validationErrors?.map(e => e.message).join('\n') || '';

  const isTarget = connection.inProgress && connection.fromNode.id !== id && connection.fromNode.type === 'transition';

  const hasMarking = data.marking && Array.isArray(data.marking) && data.marking.length > 0;
  const tokenCount = hasMarking ? data.marking.length : 0;
  const markingTableData = hasMarking ? getMarkingTableData(data.marking as unknown[], isUnitType, isTimed, epoch, isListType) : [];
  const visibleRows = markingTableData.slice(0, MAX_VISIBLE_ROWS);
  const hasMoreRows = markingTableData.length > MAX_VISIBLE_ROWS;

  // Default offsets for inscriptions
  const colorSetOffset = data.colorSetOffset ?? DEFAULT_COLOR_SET_OFFSET;
  const tokenCountOffset = data.tokenCountOffset ?? DEFAULT_TOKEN_COUNT_OFFSET;
  const markingOffset = data.markingOffset ?? DEFAULT_MARKING_OFFSET;

  const handleColorSetDragEnd = useCallback((newOffset: { x: number; y: number }) => {
    if (activePetriNetId) {
      updateNodeData(activePetriNetId, id, { ...data, colorSetOffset: newOffset });
    }
  }, [activePetriNetId, id, data, updateNodeData]);

  const handleTokenCountDragEnd = useCallback((newOffset: { x: number; y: number }) => {
    if (activePetriNetId) {
      updateNodeData(activePetriNetId, id, { ...data, tokenCountOffset: newOffset });
    }
  }, [activePetriNetId, id, data, updateNodeData]);

  const handleMarkingDragEnd = useCallback((newOffset: { x: number; y: number }) => {
    if (activePetriNetId) {
      updateNodeData(activePetriNetId, id, { ...data, markingOffset: newOffset });
    }
  }, [activePetriNetId, id, data, updateNodeData]);

  return (
    <div className="relative cpn-node place-node" style={{ borderColor: colorSetColor }}>
      <NodeResizer
        isVisible={selected}
        minWidth={30}
        minHeight={30}
      />

      {/* Static Label */}
      <div className="whitespace-pre-wrap leading-tight">
        {data.label}
      </div>

      {/* ColorSet inscription - draggable */}
      {data.colorSet && (
        <DraggableInscription
          offset={colorSetOffset}
          onDragEnd={handleColorSetDragEnd}
          className="text-[9px] font-mono whitespace-nowrap"
          style={{ top: '50%', left: '50%' }}
        >
          {data.colorSet}
        </DraggableInscription>
      )}

      {/* Token count circle - draggable */}
      {hasMarking && (
        <DraggableInscription
          offset={tokenCountOffset}
          onDragEnd={handleTokenCountDragEnd}
          style={{ top: '50%', left: '50%' }}
        >
          <div className="marking flex items-center justify-center text-[9px] text-black rounded-full min-w-[14px] h-[14px] px-0.5">
            {tokenCount}
          </div>
        </DraggableInscription>
      )}

      {/* Current marking table - draggable */}
      {hasMarking && showMarkingDisplay && (
        <DraggableInscription
          offset={markingOffset}
          onDragEnd={handleMarkingDragEnd}
          style={{ top: '50%', left: '50%' }}
        >
          <table className="marking text-[7px] font-mono text-black rounded-sm border-collapse">
            <tbody>
              {visibleRows.map((entry, idx) => (
                <tr key={idx}>
                  <td className="px-1 py-0.5 text-right">{entry.count}`</td>
                  <td className="px-1 py-0.5">{entry.value}</td>
                  {isTimed && <td className="px-1 py-0.5 text-muted-foreground whitespace-nowrap">{entry.timeDisplay}</td>}
                </tr>
              ))}
              {hasMoreRows && (
                <tr>
                  <td colSpan={isTimed ? 3 : 2} className="px-1 py-0.5 text-center text-muted-foreground">
                    ...{markingTableData.length - MAX_VISIBLE_ROWS} more
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DraggableInscription>
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

      {/* Port type hierarchy tag (In/Out/I/O) at bottom center */}
      {data.portType && (
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
          className="nodrag pointer-events-none"
        >
          <div className={`flex items-center justify-center px-0.5 h-[14px] rounded-[2px] border text-[8px] font-semibold whitespace-nowrap ${
            data.portType === 'in' ? 'border-green-400/70 bg-green-50 text-green-700' :
            data.portType === 'out' ? 'border-orange-400/70 bg-orange-50 text-orange-700' :
            'border-purple-400/70 bg-purple-50 text-purple-700'
          }`}>
            {data.portType === 'in' ? 'In' : data.portType === 'out' ? 'Out' : 'I/O'}
          </div>
        </div>
      )}

      {/* Fusion set tag at bottom center (below port tag if both exist) */}
      {fusionSetName && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: selected
              ? `translate(-50%, calc(100% + ${data.portType ? '20px' : '4px'}))`
              : `translate(-50%, calc(100% + ${data.portType ? '15px' : '-1px'}))`,
            transition: 'transform 0.15s ease-out',
          }}
          className="nodrag pointer-events-none"
        >
          <div className="flex items-center gap-0.5 px-1.5 h-[14px] rounded-[2px] border border-cyan-400/70 bg-cyan-50 text-[8px] font-medium text-cyan-700 whitespace-nowrap">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="5" cy="8" r="4" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <circle cx="11" cy="8" r="4" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            {fusionSetName}
          </div>
        </div>
      )}

      {/* Validation caution badge - bottom center (moves down when selected), below fusion/port tags */}
      {hasValidationIssues && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              style={{
                position: 'absolute',
                bottom: -2,
                left: '50%',
                transform: selected
                  ? `translate(-50%, calc(100% + ${data.portType && fusionSetName ? '36px' : data.portType || fusionSetName ? '20px' : '4px'}))`
                  : `translate(-50%, calc(100% + ${data.portType && fusionSetName ? '30px' : data.portType || fusionSetName ? '14px' : '-1px'}))`,
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
        style={{ visibility: data.isArcMode && !connection.inProgress ? 'visible' : 'hidden' }}
      />
      <Handle
        className="custom-handle"
        type="target"
        position={Position.Left}
        style={{ visibility: data.isArcMode && isTarget ? 'visible' : 'hidden' }}
        isConnectable={isTarget}
      />
    </div>
  );
};

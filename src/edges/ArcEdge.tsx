import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useInternalNode, EdgeLabelRenderer, useReactFlow } from '@xyflow/react';
import { getEdgeParams, getNodeIntersectionToPoint, getParallelEdgeEndpoints } from '../utils.js';
import useStore from '@/stores/store'; // Import Zustand store
import type { ArcType } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Label offset used by arcs whose label has never been dragged. Frozen and shared so
 *  every render of every such arc yields the same reference — see its use site. */
const DEFAULT_LABEL_OFFSET = Object.freeze({ x: 0, y: 0 });

/** Gap between straight parallel arcs. Node-relative in effect: getParallelEdgeEndpoints
 *  clamps it down when the nodes are too small to carry the full separation. */
const PARALLEL_ARC_SPACING = 8;

/** Gap between parallel arcs that carry bendpoints. Larger, because those are routed by
 *  hand and shift whole polylines rather than sliding two straight lines apart. */
const PARALLEL_BENDPOINT_SPACING = 60;

/**
 * Calculate the distance from a point to a line segment
 */
function distanceToSegment(
  point: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSq = dx * dx + dy * dy;
  
  if (lengthSq === 0) {
    // p1 and p2 are the same point
    return Math.sqrt((point.x - p1.x) ** 2 + (point.y - p1.y) ** 2);
  }
  
  // Project point onto the line segment
  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

interface FloatingEdgeProps {
  id: string;
  source: string;
  target: string;
  style?: React.CSSProperties;
  label?: React.ReactNode; // Optional label for the edge
  data?: {
    bendpoints?: { x: number; y: number }[];
    isBidirectional?: boolean;
    order?: number; // Order index for offsetting parallel arcs
    labelOffset?: { x: number; y: number }; // Custom offset for the label position
    arcType?: ArcType; // Type of arc: normal, reset, or inhibitor
    delay?: string; // Per-arc time delay expression
    overrideColor?: string; // User-specified color override
  };
}

/**
 * Build an SVG path string that goes through bendpoints
 * Returns the path and the midpoint for label positioning
 */
function buildPathWithBendpoints(
  sx: number, sy: number, 
  tx: number, ty: number, 
  bendpoints?: { x: number; y: number }[]
): { path: string; labelX: number; labelY: number } {
  if (!bendpoints || bendpoints.length === 0) {
    // No bendpoints - straight line
    const path = `M ${sx},${sy} L ${tx},${ty}`;
    return { 
      path, 
      labelX: (sx + tx) / 2, 
      labelY: (sy + ty) / 2 
    };
  }

  // Build path through all bendpoints
  let path = `M ${sx},${sy}`;
  
  // Add line segments to each bendpoint
  for (const bp of bendpoints) {
    path += ` L ${bp.x},${bp.y}`;
  }
  
  // Final segment to target
  path += ` L ${tx},${ty}`;

  // Calculate label position at the middle of the path by arc length
  // Build array of all points: source -> bendpoints -> target
  const allPoints = [{ x: sx, y: sy }, ...bendpoints, { x: tx, y: ty }];
  
  // Calculate cumulative lengths of each segment
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < allPoints.length; i++) {
    const dx = allPoints[i].x - allPoints[i - 1].x;
    const dy = allPoints[i].y - allPoints[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    totalLength += len;
  }
  
  // Find the point at half the total length
  const targetLength = totalLength / 2;
  let accumulatedLength = 0;
  let labelX = (sx + tx) / 2;
  let labelY = (sy + ty) / 2;
  
  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (accumulatedLength + segLen >= targetLength) {
      // The midpoint is on this segment
      const remainingLength = targetLength - accumulatedLength;
      const t = segLen > 0 ? remainingLength / segLen : 0;
      labelX = allPoints[i].x + t * (allPoints[i + 1].x - allPoints[i].x);
      labelY = allPoints[i].y + t * (allPoints[i + 1].y - allPoints[i].y);
      break;
    }
    accumulatedLength += segLen;
  }

  return { path, labelX, labelY };
}

function ArcEdge({ id, source, target, style, label, data }: FloatingEdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { getZoom } = useReactFlow();

  // State for bendpoint interactions
  const [hoveredBendpointIndex, setHoveredBendpointIndex] = useState<number | null>(null);
  const [draggingBendpointIndex, setDraggingBendpointIndex] = useState<number | null>(null);
  const bendpointDragRef = useRef<{ 
    startX: number; 
    startY: number; 
    lastClientX: number;
    lastClientY: number;
    originalBendpoints: { x: number; y: number }[]; 
    hasDragged: boolean;
    index: number;
  } | null>(null);
  // Ref to track new bendpoint creation state (to distinguish click from drag on arc path)
  const arcPathDragRef = useRef<{ startX: number; startY: number; insertIndex: number; newBendpoint: { x: number; y: number }; hasDragged: boolean } | null>(null);

  // Get store actions and state
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const updateEdgeData = useStore((state) => state.updateEdgeData);
  const setSelectedElement = useStore((state) => state.setSelectedElement);

  // Get edges from store to detect parallel arcs
  const edges = useStore((state) => {
    const activePetriNetId = state.activePetriNetId;
    const petriNet = activePetriNetId ? state.petriNetsById[activePetriNetId] : null;
    return petriNet?.edges ?? [];
  });

  // Compute parallel arc info using useMemo to avoid recalculating on every render
  const { parallelArcIndex, totalParallelArcs } = useMemo(() => {
    // Find all parallel arcs (same source-target pair, in either direction)
    const parallelArcs = edges.filter(edge => 
      (edge.source === source && edge.target === target) ||
      (edge.source === target && edge.target === source)
    );
    
    const totalArcs = parallelArcs.length;
    let arcIndex = parallelArcs.findIndex(edge => edge.id === id);
    if (arcIndex === -1) arcIndex = 0;
    
    return { parallelArcIndex: arcIndex, totalParallelArcs: totalArcs };
  }, [edges, id, source, target]);

  // Determine arc color based on the connected place's colorset (or override)
  // For arcs, one end is always a place and the other is a transition
  const colorSetColor = useStore((state) => {
    // Check edge-level override color first
    if (data?.overrideColor) return data.overrideColor as string;

    const activePetriNetId = state.activePetriNetId;
    const petriNet = activePetriNetId ? state.petriNetsById[activePetriNetId] : null;
    
    if (!petriNet || !petriNet.nodes) return '#000';
    
    // Find the place node (source or target - one of them should be a place)
    const sourceNodeData = petriNet.nodes.find(n => n.id === source);
    const targetNodeData = petriNet.nodes.find(n => n.id === target);
    
    // Determine which node is the place (places have colorSet in their data)
    const placeNode = sourceNodeData?.type === 'place' ? sourceNodeData : 
                      targetNodeData?.type === 'place' ? targetNodeData : null;
    
    // Check place-level override color
    if (placeNode?.data?.overrideColor) {
      return placeNode.data.overrideColor as string;
    }

    if (placeNode && placeNode.data?.colorSet) {
      const placeColorSet = state.colorSets.find(cs => cs.name === placeNode.data.colorSet);
      if (placeColorSet?.color) {
        return placeColorSet.color;
      }
    }
    
    // Fallback: try to match a single variable in the inscription
    if (typeof label === 'string') {
      const variable = state.variables.find((v) => v.name === label.trim());
      if (variable) {
        const varColorSet = state.colorSets.find((cs) => cs.name === variable.colorSet);
        if (varColorSet?.color) {
          return varColorSet.color;
        }
      }
    }
    
    return '#000';
  });

  // Get validation errors for this arc
  const validationErrors = useStore((state) => state.validationErrors[id]);
  const hasArcErrors = validationErrors && validationErrors.length > 0;
  const arcErrorTooltip = validationErrors?.map(e => e.message).join('\n') || '';

  // Check if this edge is currently selected
  const isSelected = useStore((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return petriNet?.selectedElement?.type === 'edge' && petriNet.selectedElement.element.id === id;
  });
  
  // Handler for when label is dragged - must be before early return
  const handleLabelDragEnd = useCallback((newOffset: { x: number; y: number }) => {
    if (activePetriNetId) {
      updateEdgeData(activePetriNetId, id, { labelOffset: newOffset });
    }
  }, [activePetriNetId, id, updateEdgeData]);

  // Handler for starting a bendpoint drag
  const handleBendpointDragStart = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingBendpointIndex(index);
    bendpointDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      originalBendpoints: [...(data?.bendpoints ?? [])],
      hasDragged: false,
      index,
    };

    // Get adjacent points for snapping (source/target nodes or adjacent bendpoints)
    const getAdjacentPoints = () => {
      const bendpoints = bendpointDragRef.current?.originalBendpoints ?? [];
      const sourcePos = sourceNode ? {
        x: sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? 0) / 2,
        y: sourceNode.internals.positionAbsolute.y + (sourceNode.measured?.height ?? 0) / 2,
      } : null;
      const targetPos = targetNode ? {
        x: targetNode.internals.positionAbsolute.x + (targetNode.measured?.width ?? 0) / 2,
        y: targetNode.internals.positionAbsolute.y + (targetNode.measured?.height ?? 0) / 2,
      } : null;
      
      const idx = bendpointDragRef.current?.index ?? 0;
      const prevPoint = idx === 0 ? sourcePos : bendpoints[idx - 1];
      const nextPoint = idx === bendpoints.length - 1 ? targetPos : bendpoints[idx + 1];
      
      return { prevPoint, nextPoint };
    };

    // Calculate snapped position for horizontal/vertical alignment
    const calculateSnappedPosition = (rawX: number, rawY: number) => {
      const { prevPoint, nextPoint } = getAdjacentPoints();
      if (!prevPoint && !nextPoint) return { x: rawX, y: rawY };
      
      let snappedX = rawX;
      let snappedY = rawY;
      
      // Check for horizontal/vertical alignment with previous point
      if (prevPoint) {
        const dxPrev = Math.abs(rawX - prevPoint.x);
        const dyPrev = Math.abs(rawY - prevPoint.y);
        
        // If close to vertical alignment with prev point
        if (dxPrev < 20) {
          snappedX = prevPoint.x;
        }
        // If close to horizontal alignment with prev point
        if (dyPrev < 20) {
          snappedY = prevPoint.y;
        }
      }
      
      // Check for horizontal/vertical alignment with next point
      if (nextPoint) {
        const dxNext = Math.abs(rawX - nextPoint.x);
        const dyNext = Math.abs(rawY - nextPoint.y);
        
        // If close to vertical alignment with next point
        if (dxNext < 20) {
          snappedX = nextPoint.x;
        }
        // If close to horizontal alignment with next point
        if (dyNext < 20) {
          snappedY = nextPoint.y;
        }
      }
      
      return { x: snappedX, y: snappedY };
    };

    // Function to update bendpoint position based on current state
    const updateBendpointPosition = (clientX: number, clientY: number, shiftKey: boolean) => {
      if (!bendpointDragRef.current || !activePetriNetId) return;
      const zoom = getZoom();
      const dx = (clientX - bendpointDragRef.current.startX) / zoom;
      const dy = (clientY - bendpointDragRef.current.startY) / zoom;
      
      // Mark as dragged if moved more than 3 pixels
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        bendpointDragRef.current.hasDragged = true;
      }
      
      const idx = bendpointDragRef.current.index;
      const originalBp = bendpointDragRef.current.originalBendpoints[idx];
      let newX = originalBp.x + dx;
      let newY = originalBp.y + dy;
      
      // Apply snapping if Shift is held
      if (shiftKey) {
        const snapped = calculateSnappedPosition(newX, newY);
        newX = snapped.x;
        newY = snapped.y;
      }
      
      const newBendpoints = bendpointDragRef.current.originalBendpoints.map((bp, i) => 
        i === idx ? { x: newX, y: newY } : bp
      );
      
      updateEdgeData(activePetriNetId, id, { bendpoints: newBendpoints });
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!bendpointDragRef.current) return;
      // Store last mouse position for key event handling
      bendpointDragRef.current.lastClientX = moveEvent.clientX;
      bendpointDragRef.current.lastClientY = moveEvent.clientY;
      
      updateBendpointPosition(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey);
    };

    // Handle keydown/keyup for Shift to update position immediately
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Shift' && bendpointDragRef.current) {
        updateBendpointPosition(
          bendpointDragRef.current.lastClientX,
          bendpointDragRef.current.lastClientY,
          true
        );
      }
    };
    
    const handleKeyUp = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Shift' && bendpointDragRef.current) {
        updateBendpointPosition(
          bendpointDragRef.current.lastClientX,
          bendpointDragRef.current.lastClientY,
          false
        );
      }
    };

    const handleMouseUp = () => {
      const didDrag = bendpointDragRef.current?.hasDragged ?? false;
      setDraggingBendpointIndex(null);
      
      // If no actual drag happened, treat as a click → delete the bendpoint
      if (!didDrag && activePetriNetId && data?.bendpoints) {
        const newBendpoints = data.bendpoints.filter((_, i) => i !== index);
        updateEdgeData(activePetriNetId, id, {
          bendpoints: newBendpoints.length > 0 ? newBendpoints : undefined,
        });
      }
      
      bendpointDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }, [activePetriNetId, id, data?.bendpoints, sourceNode, targetNode, updateEdgeData, getZoom]);

  // Handler for creating a new bendpoint on the arc path (or selecting arc on click)
  const handleArcPathMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    e.preventDefault();

    if (!activePetriNetId) return;

    // Convert screen coordinates to canvas coordinates using SVG transform
    const svgElement = (e.target as SVGElement).closest('svg');
    if (!svgElement) return;

    // Transform point using the SVG's viewBox/transform
    const svgPoint = svgElement.createSVGPoint();
    svgPoint.x = e.clientX;
    svgPoint.y = e.clientY;
    const ctm = svgElement.getScreenCTM();
    
    let transformedPoint: { x: number; y: number };
    if (ctm) {
      const pt = svgPoint.matrixTransform(ctm.inverse());
      transformedPoint = { x: pt.x, y: pt.y };
    } else {
      // Fallback: use getBoundingClientRect and zoom level
      const rect = svgElement.getBoundingClientRect();
      const zoom = getZoom();
      // Get the viewBox to understand the coordinate system
      const viewBox = svgElement.viewBox.baseVal;
      if (viewBox && viewBox.width > 0) {
        const scaleX = viewBox.width / rect.width;
        const scaleY = viewBox.height / rect.height;
        transformedPoint = {
          x: viewBox.x + (e.clientX - rect.left) * scaleX,
          y: viewBox.y + (e.clientY - rect.top) * scaleY,
        };
      } else {
        // Last resort fallback using zoom
        transformedPoint = {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom,
        };
      }
    }

    const newBendpoint = { x: transformedPoint.x, y: transformedPoint.y };
    
    // Calculate where to insert the bendpoint (for when drag is confirmed)
    const currentBendpoints = data?.bendpoints ?? [];
    let insertIndex = 0;
    
    if (currentBendpoints.length > 0) {
      // Find the segment closest to the click point
      const sourcePos = sourceNode ? { x: sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? 0) / 2, y: sourceNode.internals.positionAbsolute.y + (sourceNode.measured?.height ?? 0) / 2 } : { x: 0, y: 0 };
      const targetPos = targetNode ? { x: targetNode.internals.positionAbsolute.x + (targetNode.measured?.width ?? 0) / 2, y: targetNode.internals.positionAbsolute.y + (targetNode.measured?.height ?? 0) / 2 } : { x: 0, y: 0 };
      
      const allPoints = [sourcePos, ...currentBendpoints, targetPos];
      let minDist = Infinity;
      
      for (let i = 0; i < allPoints.length - 1; i++) {
        const p1 = allPoints[i];
        const p2 = allPoints[i + 1];
        const dist = distanceToSegment(newBendpoint, p1, p2);
        if (dist < minDist) {
          minDist = dist;
          insertIndex = i;
        }
      }
    }

    // Store drag info but DON'T create bendpoint yet
    arcPathDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      insertIndex,
      newBendpoint,
      hasDragged: false,
    };

    // Get source and target positions for snapping
    const sourcePos = sourceNode ? {
      x: sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? 0) / 2,
      y: sourceNode.internals.positionAbsolute.y + (sourceNode.measured?.height ?? 0) / 2,
    } : { x: 0, y: 0 };
    const targetPos = targetNode ? {
      x: targetNode.internals.positionAbsolute.x + (targetNode.measured?.width ?? 0) / 2,
      y: targetNode.internals.positionAbsolute.y + (targetNode.measured?.height ?? 0) / 2,
    } : { x: 0, y: 0 };

    // Calculate snapped position for a new bendpoint at insertIndex
    const calculateNewBendpointSnappedPosition = (rawX: number, rawY: number, bendpoints: { x: number; y: number }[], idx: number) => {
      // Previous point is either source or the previous bendpoint
      const prevPoint = idx === 0 ? sourcePos : bendpoints[idx - 1];
      // Next point is either target or the next bendpoint (idx+1 since bendpoints array includes the current one)
      const nextPoint = idx === bendpoints.length - 1 ? targetPos : bendpoints[idx + 1];
      
      let snappedX = rawX;
      let snappedY = rawY;
      
      if (prevPoint) {
        if (Math.abs(rawX - prevPoint.x) < 20) snappedX = prevPoint.x;
        if (Math.abs(rawY - prevPoint.y) < 20) snappedY = prevPoint.y;
      }
      if (nextPoint) {
        if (Math.abs(rawX - nextPoint.x) < 20) snappedX = nextPoint.x;
        if (Math.abs(rawY - nextPoint.y) < 20) snappedY = nextPoint.y;
      }
      
      return { x: snappedX, y: snappedY };
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!arcPathDragRef.current || !activePetriNetId) return;
      const z = getZoom();
      const dx = (moveEvent.clientX - arcPathDragRef.current.startX) / z;
      const dy = (moveEvent.clientY - arcPathDragRef.current.startY) / z;
      
      // Check if we've moved enough to consider it a drag
      if (!arcPathDragRef.current.hasDragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        arcPathDragRef.current.hasDragged = true;
        
        // NOW create the bendpoint since user started dragging
        const newBendpoints = [
          ...currentBendpoints.slice(0, insertIndex),
          arcPathDragRef.current.newBendpoint,
          ...currentBendpoints.slice(insertIndex),
        ];
        updateEdgeData(activePetriNetId, id, { bendpoints: newBendpoints });
        
        // Switch to bendpoint drag ref for continued dragging
        setDraggingBendpointIndex(insertIndex);
        bendpointDragRef.current = {
          startX: arcPathDragRef.current.startX,
          startY: arcPathDragRef.current.startY,
          lastClientX: moveEvent.clientX,
          lastClientY: moveEvent.clientY,
          originalBendpoints: newBendpoints,
          hasDragged: true,
          index: insertIndex,
        };
      }
      
      // If we're dragging, update the bendpoint position
      if (bendpointDragRef.current) {
        // Store last mouse position
        bendpointDragRef.current.lastClientX = moveEvent.clientX;
        bendpointDragRef.current.lastClientY = moveEvent.clientY;
        
        const idx = bendpointDragRef.current.index;
        const originalBp = bendpointDragRef.current.originalBendpoints[idx];
        let newX = originalBp.x + dx;
        let newY = originalBp.y + dy;
        
        // Apply snapping if Shift is held
        if (moveEvent.shiftKey) {
          const snapped = calculateNewBendpointSnappedPosition(
            newX, newY, 
            bendpointDragRef.current.originalBendpoints, 
            idx
          );
          newX = snapped.x;
          newY = snapped.y;
        }
        
        const updatedBendpoints = bendpointDragRef.current.originalBendpoints.map((bp, i) => 
          i === idx ? { x: newX, y: newY } : bp
        );
        updateEdgeData(activePetriNetId, id, { bendpoints: updatedBendpoints });
      }
    };

    // Handle keydown/keyup for Shift to update position immediately
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Shift' && bendpointDragRef.current && activePetriNetId) {
        const z = getZoom();
        const dx = (bendpointDragRef.current.lastClientX - bendpointDragRef.current.startX) / z;
        const dy = (bendpointDragRef.current.lastClientY - bendpointDragRef.current.startY) / z;
        
        const idx = bendpointDragRef.current.index;
        const originalBp = bendpointDragRef.current.originalBendpoints[idx];
        const snapped = calculateNewBendpointSnappedPosition(
          originalBp.x + dx, originalBp.y + dy,
          bendpointDragRef.current.originalBendpoints,
          idx
        );
        
        const updatedBendpoints = bendpointDragRef.current.originalBendpoints.map((bp, i) => 
          i === idx ? snapped : bp
        );
        updateEdgeData(activePetriNetId, id, { bendpoints: updatedBendpoints });
      }
    };
    
    const handleKeyUp = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Shift' && bendpointDragRef.current && activePetriNetId) {
        const z = getZoom();
        const dx = (bendpointDragRef.current.lastClientX - bendpointDragRef.current.startX) / z;
        const dy = (bendpointDragRef.current.lastClientY - bendpointDragRef.current.startY) / z;
        
        const idx = bendpointDragRef.current.index;
        const originalBp = bendpointDragRef.current.originalBendpoints[idx];
        
        const updatedBendpoints = bendpointDragRef.current.originalBendpoints.map((bp, i) => 
          i === idx ? { x: originalBp.x + dx, y: originalBp.y + dy } : bp
        );
        updateEdgeData(activePetriNetId, id, { bendpoints: updatedBendpoints });
      }
    };

    const handleMouseUp = () => {
      // If no drag happened, treat as a click → select the arc
      if (arcPathDragRef.current && !arcPathDragRef.current.hasDragged) {
        const edge = edges.find(e => e.id === id);
        if (edge && activePetriNetId) {
          setSelectedElement(activePetriNetId, { type: 'edge', element: edge });
        }
      }
      
      setDraggingBendpointIndex(null);
      arcPathDragRef.current = null;
      bendpointDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }, [activePetriNetId, id, data?.bendpoints, sourceNode, targetNode, edges, updateEdgeData, setSelectedElement, getZoom]);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const bendpoints = data?.bendpoints;
  // Shared constant, not a fresh literal: this value is an effect dependency down in
  // DraggableArcLabel, and a new object on every render made that effect re-run (and
  // re-set state) on every render of this edge.
  const labelOffset = data?.labelOffset ?? DEFAULT_LABEL_OFFSET;
  const isBidirectional = data?.isBidirectional ?? false;
  const arcType: ArcType = data?.arcType ?? 'normal';
  
  // Calculate offset for parallel arcs
  // Center the group of arcs: offset from -(n-1)/2 to +(n-1)/2
  const hasBendpoints = !!bendpoints && bendpoints.length > 0;
  const offsetSpacing = hasBendpoints ? PARALLEL_BENDPOINT_SPACING : PARALLEL_ARC_SPACING;
  let offsetAmount = 0;

  if (totalParallelArcs > 1) {
    // For 2 arcs: indices 0,1 → offsets -half, +half
    // For 3 arcs: indices 0,1,2 → offsets -spacing, 0, +spacing
    const centerOffset = (totalParallelArcs - 1) / 2;
    offsetAmount = (parallelArcIndex - centerOffset) * offsetSpacing;
  }

  // First, get the base edge params (center-to-center direction)
  const edgeParams = getEdgeParams(sourceNode, targetNode);
  
  // Calculate perpendicular direction for offsetting
  // IMPORTANT: Use a canonical ordering (smaller ID to larger ID) so that
  // parallel arcs in opposite directions use the SAME perpendicular vector
  const canonicalSource = source < target ? source : target;
  const isCanonicalDirection = source === canonicalSource;
  
  const baseDx = edgeParams.tx - edgeParams.sx;
  const baseDy = edgeParams.ty - edgeParams.sy;
  const baseLen = Math.sqrt(baseDx * baseDx + baseDy * baseDy);
  
  // Perpendicular unit vector (always computed in canonical direction)
  let perpX = baseLen > 0 ? -baseDy / baseLen : 0;
  let perpY = baseLen > 0 ? baseDx / baseLen : 1;
  
  // If this arc goes against canonical direction, flip the perpendicular
  // so all parallel arcs use the same world-space perpendicular
  if (!isCanonicalDirection) {
    perpX = -perpX;
    perpY = -perpY;
  }
  
  let sx: number, sy: number, tx: number, ty: number;
  let edgePath: string;
  let labelX: number, labelY: number;
  
  if (hasBendpoints && bendpoints) {
    // Apply offset to bendpoints first
    const offsetBendpoints = offsetAmount !== 0 
      ? bendpoints.map(bp => ({
          x: bp.x + perpX * offsetAmount,
          y: bp.y + perpY * offsetAmount,
        }))
      : bendpoints;
    
    const firstBendpoint = offsetBendpoints[0];
    const lastBendpoint = offsetBendpoints[offsetBendpoints.length - 1];
    
    // Source intersection towards first (offset) bendpoint
    const sourceIntersection = getNodeIntersectionToPoint(sourceNode, firstBendpoint);
    sx = sourceIntersection.x;
    sy = sourceIntersection.y;
    
    // Target intersection from last (offset) bendpoint
    const targetIntersection = getNodeIntersectionToPoint(targetNode, lastBendpoint);
    tx = targetIntersection.x;
    ty = targetIntersection.y;
    
    // Build path with offset bendpoints
    const pathResult = buildPathWithBendpoints(sx, sy, tx, ty, offsetBendpoints);
    edgePath = pathResult.path;
    labelX = pathResult.labelX;
    labelY = pathResult.labelY;
  } else {
    // No bendpoints. Parallel arcs slide the whole centre-to-centre line sideways and take
    // their endpoints from where that line meets the two shapes, so every arc of a group
    // shares one direction and the arcs stay parallel at any relative node position.
    // getParallelEdgeEndpoints measures its offset along the left-hand normal of the
    // source → target direction, which flips with the arc, hence the canonical negation.
    const parallelEndpoints =
      offsetAmount !== 0
        ? getParallelEdgeEndpoints(
            sourceNode,
            targetNode,
            isCanonicalDirection ? offsetAmount : -offsetAmount
          )
        : null;

    if (parallelEndpoints) {
      sx = parallelEndpoints.sx;
      sy = parallelEndpoints.sy;
      tx = parallelEndpoints.tx;
      ty = parallelEndpoints.ty;
    } else {
      sx = edgeParams.sx;
      sy = edgeParams.sy;
      tx = edgeParams.tx;
      ty = edgeParams.ty;
    }

    const pathResult = buildPathWithBendpoints(sx, sy, tx, ty, undefined);
    edgePath = pathResult.path;
    labelX = pathResult.labelX;
    labelY = pathResult.labelY;
  }
  
  // Calculate perpendicular offset for default label positioning (above the arc)
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const labelOffsetDistance = 12;
  
  let labelPerpX = len > 0 ? -dy / len : 0;
  let labelPerpY = len > 0 ? dx / len : -1;
  
  if (labelPerpY > 0) {
    labelPerpX = -labelPerpX;
    labelPerpY = -labelPerpY;
  }
  
  const baseLabelX = labelX + labelPerpX * labelOffsetDistance;
  const baseLabelY = labelY + labelPerpY * labelOffsetDistance;
  
  // Hide default unit token inscription "1`()" - CPN Tools doesn't display this by default
  const isDefaultUnitInscription = typeof label === 'string' && 
    (label.trim() === '1`()' || label.trim() === '()');
  
  // Append @+delay suffix to label when arc has a delay expression
  const arcDelay = (data as Record<string, unknown>)?.delay as string | undefined;
  const hasDelay = arcDelay && arcDelay.trim() !== '';
  let formattedLabel: React.ReactNode;
  if (isDefaultUnitInscription && !hasDelay) {
    formattedLabel = null;
  } else if (hasDelay) {
    const baseLabel = isDefaultUnitInscription ? '' : (label || '');
    // Show a timer icon instead of the full delay text
    const timerIcon = (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 2, marginTop: -2 }}
        aria-hidden="true"
      >
        <title>{`@+${arcDelay}`}</title>
        <circle cx="12" cy="12" r="11.5" fill="white" stroke="#8B4513" strokeWidth="1" />
        <circle cx="12" cy="12" r="8" fill="#8B4513" fillOpacity="0.12" stroke="#8B4513" strokeWidth="1.2" />
        <line x1="12" y1="7" x2="12" y2="12" stroke="#8B4513" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="12" x2="16" y2="12" stroke="#8B4513" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
    formattedLabel = baseLabel ? <>{baseLabel}{timerIcon}</> : timerIcon;
  } else {
    formattedLabel = label;
  }

  // Compute the actual bendpoints positions for rendering (with offset)
  const displayBendpoints = bendpoints && offsetAmount !== 0
    ? bendpoints.map(bp => ({
        x: bp.x + perpX * offsetAmount,
        y: bp.y + perpY * offsetAmount,
      }))
    : bendpoints;
  
  return (
    <>
      {renderArcPath(
        id, 
        edgePath, 
        colorSetColor, 
        isBidirectional, 
        arcType,
        isSelected,
        style,
        // eslint-disable-next-line react-hooks/refs -- ref is only accessed inside event handler callbacks, not during render
        handleArcPathMouseDown,
      )}
      {/* Render interactive bendpoint handles - always visible on hover */}
      {displayBendpoints && displayBendpoints.length > 0 && (
        <g className="bendpoint-handles">
          {displayBendpoints.map((bp, index) => (
            <g key={index}>
              {/* Larger invisible hit area */}
              <circle
                cx={bp.x}
                cy={bp.y}
                r={12}
                fill="transparent"
                style={{ cursor: 'grab', pointerEvents: 'all' }}
                onMouseEnter={() => setHoveredBendpointIndex(index)}
                onMouseLeave={() => {
                  if (draggingBendpointIndex !== index) {
                    setHoveredBendpointIndex(null);
                  }
                }}
                onMouseDown={(e) => handleBendpointDragStart(e, index)}
              />
              {/* Visible circle on hover or drag */}
              {(hoveredBendpointIndex === index || draggingBendpointIndex === index) && (
                <circle
                  cx={bp.x}
                  cy={bp.y}
                  r={5}
                  fill={colorSetColor}
                  stroke="white"
                  strokeWidth={1.5}
                  style={{ 
                    pointerEvents: 'none',
                    cursor: draggingBendpointIndex === index ? 'grabbing' : 'grab',
                  }}
                />
              )}
            </g>
          ))}
        </g>
      )}
      {formattedLabel && (
        <DraggableArcLabel
          id={id}
          label={formattedLabel}
          baseLabelX={baseLabelX}
          baseLabelY={baseLabelY}
          labelOffset={labelOffset}
          onLabelDragEnd={handleLabelDragEnd}
          isSelected={isSelected}
          colorSetColor={colorSetColor}
          hasError={!!hasArcErrors}
          errorTooltip={arcErrorTooltip}
        />
      )}
    </>
  );
}

// Helper function to render the arc SVG (markers and path only, label handled in main component)
function renderArcPath(
  id: string,
  edgePath: string,
  colorSetColor: string,
  isBidirectional: boolean,
  arcType: ArcType,
  isSelected: boolean,
  style?: React.CSSProperties,
  onPathMouseDown?: (e: React.MouseEvent) => void,
) {
  const isInhibitor = arcType === 'inhibitor';
  const isReset = arcType === 'reset';

  return (
    <g>
      {/* Define custom arrow markers */}
      <defs>
        {/* Arrow pointing forward (at end of arc) — normal arcs */}
        <marker
          id={`arrow-end-${id}`}
          markerWidth="10"
          markerHeight="10"
          refX="10"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points="0,0 10,5 0,10"
            fill={colorSetColor}
          />
        </marker>
        {/* Arrow pointing backward (at start of arc, for bidirectional) */}
        <marker
          id={`arrow-start-${id}`}
          markerWidth="10"
          markerHeight="10"
          refX="0"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points="10,0 0,5 10,10"
            fill={colorSetColor}
          />
        </marker>
        {/* Inhibitor arc marker: small circle at end */}
        <marker
          id={`inhibitor-end-${id}`}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <circle
            cx="5"
            cy="5"
            r="4"
            fill="white"
            stroke={colorSetColor}
            strokeWidth="1.5"
          />
        </marker>
        {/* Reset arc marker: double arrowhead at end */}
        <marker
          id={`reset-end-${id}`}
          markerWidth="16"
          markerHeight="10"
          refX="16"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points="0,0 10,5 0,10"
            fill={colorSetColor}
          />
          <polygon
            points="6,0 16,5 6,10"
            fill={colorSetColor}
          />
        </marker>
      </defs>
      {/* Invisible wider path for easier clicking/dragging to add bendpoints or select arc */}
      {onPathMouseDown && (
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
          onMouseDown={onPathMouseDown}
        />
      )}
      {/* Selection highlight - thicker translucent stroke behind the main path */}
      {isSelected && (
        <path
          d={edgePath}
          fill="none"
          stroke={colorSetColor}
          strokeWidth="5"
          strokeOpacity="0.3"
          strokeLinecap="round"
        />
      )}
      {/* Edge Path */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="stroke-[currentColor]"
        style={{ stroke: colorSetColor, ...style }}
        markerEnd={
          isInhibitor ? `url(#inhibitor-end-${id})`
          : isReset ? `url(#reset-end-${id})`
          : `url(#arrow-end-${id})`
        }
        markerStart={isBidirectional && !isInhibitor && !isReset ? `url(#arrow-start-${id})` : undefined}
      />
    </g>
  );
}

// Draggable label component for arc inscriptions
function DraggableArcLabel({
  id,
  label,
  baseLabelX,
  baseLabelY,
  labelOffset,
  onLabelDragEnd,
  isSelected,
  colorSetColor,
  hasError,
  errorTooltip,
}: {
  id: string;
  label: React.ReactNode;
  baseLabelX: number;
  baseLabelY: number;
  labelOffset: { x: number; y: number };
  onLabelDragEnd: (offset: { x: number; y: number }) => void;
  isSelected?: boolean;
  colorSetColor?: string;
  hasError?: boolean;
  errorTooltip?: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(labelOffset);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const currentOffsetRef = useRef(dragOffset);
  
  // Keep ref in sync with state
  React.useEffect(() => {
    currentOffsetRef.current = dragOffset;
  });
  
  // Get viewport zoom for proper drag scaling
  const { getZoom } = useReactFlow();
  
  // Access the store to select this edge when clicked
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const setSelectedElement = useStore((state) => state.setSelectedElement);
  const edges = useStore((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return petriNet?.edges || [];
  });
  
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
      // Divide by zoom to convert screen pixels to canvas pixels
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
        onLabelDragEnd(currentOffsetRef.current);
      }
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onLabelDragEnd, getZoom]);
  
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Select the parent edge
    const edge = edges.find(edge => edge.id === id);
    if (edge && activePetriNetId) {
      setSelectedElement(activePetriNetId, { type: 'edge', element: edge });
    }
  }, [id, edges, activePetriNetId, setSelectedElement]);

  // Update dragOffset when labelOffset prop changes (e.g., after save).
  // Keyed on the coordinates rather than the object, and a no-op when they match what
  // state already holds: as a passive effect that sets state, an identity-keyed version
  // fires on every parent render, and during a simulation run — where the canvas
  // re-renders continuously — those queued updates cascade into React's "Maximum update
  // depth exceeded".
  React.useEffect(() => {
    setDragOffset((prev) =>
      prev.x === labelOffset.x && prev.y === labelOffset.y ? prev : { x: labelOffset.x, y: labelOffset.y }
    );
  }, [labelOffset.x, labelOffset.y]);

  const finalX = baseLabelX + dragOffset.x;
  const finalY = baseLabelY + dragOffset.y;

  const inscriptionContent = (
    <div
      style={{
        transform: `translate(-50%, -100%) translate(${finalX}px,${finalY}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
        pointerEvents: 'auto',
        ...(hasError
          ? { backgroundColor: '#fef3c7', outline: '1.5px solid #f59e0b', borderRadius: '3px' }
          : isSelected && colorSetColor
            ? { backgroundColor: `${colorSetColor}1A`, outline: `1.5px solid ${colorSetColor}4D`, borderRadius: '3px' }
            : {}),
      }}
      className={`nodrag nopan edge-label-renderer__custom-edge text-[10px] font-mono whitespace-pre-wrap ${isDragging ? '' : 'hover:bg-accent/50'} px-1 rounded`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {hasError && (
        <span className="inline-flex align-middle mr-0.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L1 21h22L12 2z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round" />
            <text x="12" y="19" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#000">!</text>
          </svg>
        </span>
      )}
      {label}
    </div>
  );

  return (
    <EdgeLabelRenderer>
      {hasError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {inscriptionContent}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <div className="flex items-start gap-1.5">
              <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L1 21h22L12 2z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" strokeLinejoin="round" />
                <text x="12" y="19" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#000">!</text>
              </svg>
              <div>
                <p className="font-semibold">Warning</p>
                {(errorTooltip ?? '').split('\n').map((line, i) => (
                  <p key={i} className="text-xs opacity-90">{line}</p>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        inscriptionContent
      )}
    </EdgeLabelRenderer>
  );
}

export default ArcEdge;

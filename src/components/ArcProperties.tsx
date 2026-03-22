import { useState, useEffect } from 'react';
import useStore from '@/stores/store';
import type { ArcType } from '@/types';

import { Label } from "@/components/ui/label";
import { UndoableInput as Input, UndoableTextarea as Textarea } from "@/components/ui/undoable-input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ArcDirection = 'source-to-target' | 'target-to-source' | 'bidirectional';

// Parse relative time from milliseconds
function msToRelativeTime(totalMs: number): { ms: number; s: number; m: number; h: number; d: number } {
  let remaining = Math.abs(totalMs);
  const d = Math.floor(remaining / (24 * 60 * 60 * 1000));
  remaining %= 24 * 60 * 60 * 1000;
  const h = Math.floor(remaining / (60 * 60 * 1000));
  remaining %= 60 * 60 * 1000;
  const m = Math.floor(remaining / (60 * 1000));
  remaining %= 60 * 1000;
  const s = Math.floor(remaining / 1000);
  const ms = remaining % 1000;
  return { ms, s, m, h, d };
}

// Convert relative time to Rhai delay expression
function relativeTimeToExpression(rel: { ms: number; s: number; m: number; h: number; d: number }): string {
  const parts: string[] = [];
  if (rel.d > 0) parts.push(`delay_days(${rel.d})`);
  if (rel.h > 0) parts.push(`delay_hours(${rel.h})`);
  if (rel.m > 0) parts.push(`delay_min(${rel.m})`);
  if (rel.s > 0) parts.push(`delay_sec(${rel.s})`);
  if (rel.ms > 0) parts.push(`delay_ms(${rel.ms})`);
  return parts.length > 0 ? parts.join(' + ') : '';
}

// Try to parse a time expression back to relative time
function parseTimeExpression(expr: string): { ms: number; s: number; m: number; h: number; d: number } | null {
  if (!expr || expr.trim() === '') {
    return { ms: 0, s: 0, m: 0, h: 0, d: 0 };
  }
  const delayPattern = /delay_(days|hours|min|sec|ms)\s*\(\s*(\d+)\s*\)/g;
  let totalMs = 0;
  let hasMatch = false;
  let match;
  const cleaned = expr.replace(delayPattern, '').replace(/\+/g, '').trim();
  if (cleaned !== '') return null;
  delayPattern.lastIndex = 0;
  while ((match = delayPattern.exec(expr)) !== null) {
    hasMatch = true;
    const unit = match[1];
    const value = parseInt(match[2], 10);
    switch (unit) {
      case 'days': totalMs += value * 24 * 60 * 60 * 1000; break;
      case 'hours': totalMs += value * 60 * 60 * 1000; break;
      case 'min': totalMs += value * 60 * 1000; break;
      case 'sec': totalMs += value * 1000; break;
      case 'ms': totalMs += value; break;
    }
  }
  if (!hasMatch && expr.trim() !== '') return null;
  return msToRelativeTime(totalMs);
}

const ArcProperties = () => {
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const petriNetsById = useStore((state) => state.petriNetsById);
  const selectedElement = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return activePetriNet?.selectedElement;
  });
  const updateEdgeLabel = useStore((state) => state.updateEdgeLabel);
  const updateEdgeData = useStore((state) => state.updateEdgeData);
  const swapEdgeDirection = useStore((state) => state.swapEdgeDirection);

  // State for arc delay input mode
  const [delayMode, setDelayMode] = useState<'relative' | 'expression'>('relative');
  const [relativeDelay, setRelativeDelay] = useState({ ms: 0, s: 0, m: 0, h: 0, d: 0 });
  const [delayExpression, setDelayExpression] = useState('');
  const [lastEdgeId, setLastEdgeId] = useState<string | null>(null);

  // Extract edge data safely (before early returns, for useEffect)
  const isValidEdge = selectedElement?.type === 'edge' && selectedElement.element;
  const edgeId = isValidEdge ? selectedElement.element.id : null;
  const edgeData = isValidEdge ? selectedElement.element.data as Record<string, unknown> : null;

  // Initialize delay state when edge changes
  /* eslint-disable react-hooks/set-state-in-effect -- Form init on selection change */
  useEffect(() => {
    if (edgeId && edgeId !== lastEdgeId && edgeData) {
      setLastEdgeId(edgeId);
      const delayValue = (edgeData.delay as string) || '';
      const parsed = parseTimeExpression(delayValue);
      if (parsed !== null) {
        setDelayMode('relative');
        setRelativeDelay(parsed);
        setDelayExpression(delayValue);
      } else {
        setDelayMode('expression');
        setDelayExpression(delayValue);
        setRelativeDelay({ ms: 0, s: 0, m: 0, h: 0, d: 0 });
      }
    }
  }, [edgeId, lastEdgeId, edgeData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-focus the field requested via focusRequest (e.g. from "Resolve Non-determinism" panel)
  const focusField = useStore((state) => state.focusRequest?.field);
  useEffect(() => {
    if (!focusField || !edgeId) return;
    const fieldIdMap: Record<string, string> = {
      label: 'inscription',
      delay: 'delay-expression',
    };
    const domId = fieldIdMap[focusField];
    if (!domId) return;

    // If focusing the delay field, switch to expression mode so the textarea is visible
    if (focusField === 'delay') {
      setDelayMode('expression'); // eslint-disable-line react-hooks/set-state-in-effect -- Intentional: need expression tab visible to focus
    }

    // Wait for render, then focus
    const timer = setTimeout(() => {
      const el = document.getElementById(domId);
      if (el) {
        el.focus();
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.select();
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [focusField, edgeId]);

  if (!selectedElement) {
    return null;
  }

  // check if selectedElement is an edge
  if (selectedElement.type !== "edge") {
    return null;
  }

  const { id, label, source, target, data } = selectedElement.element;
  const isBidirectional = (data as { isBidirectional?: boolean })?.isBidirectional ?? false;
  const arcType: ArcType = (data as { arcType?: ArcType })?.arcType ?? 'normal';

  // Get node names for display
  const getNodeName = (nodeId: string): string => {
    if (!activePetriNetId) return nodeId;
    const petriNet = petriNetsById[activePetriNetId];
    if (!petriNet) return nodeId;
    const node = petriNet.nodes.find(n => n.id === nodeId);
    return (node?.data?.label as string) || nodeId;
  };

  // Get node type (place or transition)
  const getNodeType = (nodeId: string): string => {
    if (!activePetriNetId) return 'unknown';
    const petriNet = petriNetsById[activePetriNetId];
    if (!petriNet) return 'unknown';
    const node = petriNet.nodes.find(n => n.id === nodeId);
    return node?.type || 'unknown';
  };

  const sourceName = getNodeName(source);
  const targetName = getNodeName(target);
  const sourceType = getNodeType(source);

  // Determine current direction value for dropdown
  const getCurrentDirection = (): ArcDirection => {
    if (isBidirectional) return 'bidirectional';
    // Source to target is the default direction
    return 'source-to-target';
  };

  const handleDirectionChange = (newDirection: ArcDirection) => {
    if (!activePetriNetId) return;

    const currentDirection = getCurrentDirection();
    
    if (newDirection === currentDirection) return;

    if (newDirection === 'bidirectional') {
      // Make it bidirectional
      updateEdgeData(activePetriNetId, id, { isBidirectional: true });
    } else if (currentDirection === 'bidirectional') {
      // Was bidirectional, now making it unidirectional
      updateEdgeData(activePetriNetId, id, { isBidirectional: false });
      if (newDirection === 'target-to-source') {
        // Swap direction
        swapEdgeDirection(activePetriNetId, id);
      }
    } else {
      // Swapping between source-to-target and target-to-source
      swapEdgeDirection(activePetriNetId, id);
    }
  };

  const handleArcTypeChange = (newType: ArcType) => {
    if (!activePetriNetId) return;
    const newData: Record<string, unknown> = { arcType: newType };
    // Reset bidirectional when switching to inhibitor/reset (they only go P→T)
    if (newType !== 'normal' && isBidirectional) {
      newData.isBidirectional = false;
    }
    updateEdgeData(activePetriNetId, id, newData);
    // Clear inscription for inhibitor/reset arcs
    if (newType !== 'normal') {
      updateEdgeLabel(activePetriNetId, id, '');
    }
  };

  const updateDelay = (expr: string) => {
    if (activePetriNetId) {
      updateEdgeData(activePetriNetId, id, { delay: expr });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="arcType">Arc Type</Label>
        <Select value={arcType} onValueChange={(value) => handleArcTypeChange(value as ArcType)}>
          <SelectTrigger id="arcType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="inhibitor">Inhibitor</SelectItem>
            <SelectItem value="reset">Reset</SelectItem>
          </SelectContent>
        </Select>
        {arcType === 'inhibitor' && (
          <p className="text-xs text-muted-foreground">
            Transition enabled only when place is empty
          </p>
        )}
        {arcType === 'reset' && (
          <p className="text-xs text-muted-foreground">
            Removes all tokens from place when transition fires
          </p>
        )}
      </div>

      {arcType === 'normal' && (
        <div className="grid w-full items-center gap-1.5">
          <Label htmlFor="direction">Direction</Label>
          <Select value={getCurrentDirection()} onValueChange={(value) => handleDirectionChange(value as ArcDirection)}>
            <SelectTrigger id="direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="source-to-target">
                {sourceName} → {targetName}
              </SelectItem>
              <SelectItem value="target-to-source">
                {targetName} → {sourceName}
              </SelectItem>
              <SelectItem value="bidirectional">
                Bidirectional
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {sourceType === 'place' ? 'Place → Transition' : 'Transition → Place'}
          </p>
        </div>
      )}

      {arcType === 'normal' && (
        <div className="grid w-full items-center gap-1.5">
          <Label htmlFor="inscription">Inscription</Label>
          <Textarea
            id="inscription"
            value={label as string ?? ""}
            rows={3}
            className="font-mono text-sm"
            onChange={(e) => {
              if (activePetriNetId) {
                updateEdgeLabel(activePetriNetId, id, e.target.value)
              }
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="overrideColor"
          checked={!!data?.overrideColor}
          onCheckedChange={(checked) => {
            if (activePetriNetId) {
              updateEdgeData(activePetriNetId, id, {
                overrideColor: checked ? '#000000' : undefined,
              });
            }
          }}
        />
        <Label htmlFor="overrideColor" className="text-sm">Override color</Label>
        {!!data?.overrideColor && (
          <input
            type="color"
            value={data.overrideColor as string}
            onChange={(e) => {
              if (activePetriNetId) {
                updateEdgeData(activePetriNetId, id, {
                  overrideColor: e.target.value,
                });
              }
            }}
            className="w-6 h-6 rounded border cursor-pointer"
          />
        )}
      </div>

      {arcType === 'normal' && (
        <div className="grid w-full items-center gap-1.5">
          <Label>Arc Delay</Label>
          <Tabs value={delayMode} onValueChange={(v) => setDelayMode(v as 'relative' | 'expression')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="relative">Relative</TabsTrigger>
              <TabsTrigger value="expression">Expression</TabsTrigger>
            </TabsList>
            <TabsContent value="relative" className="mt-2">
              <div className="flex flex-wrap gap-2">
                {(['d', 'h', 'm', 's', 'ms'] as const).map((unit) => {
                  const max = unit === 'd' ? undefined : unit === 'h' ? 23 : unit === 'ms' ? 999 : 59;
                  const width = unit === 'ms' ? 'w-16' : 'w-14';
                  return (
                    <div key={unit} className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="0"
                        max={max}
                        value={relativeDelay[unit]}
                        onChange={(e) => {
                          const newRel = { ...relativeDelay, [unit]: parseInt(e.target.value, 10) || 0 };
                          setRelativeDelay(newRel);
                          const expr = relativeTimeToExpression(newRel);
                          setDelayExpression(expr);
                          updateDelay(expr);
                        }}
                        className={`${width} h-8 text-sm`}
                      />
                      <span className="text-xs text-muted-foreground">{unit}</span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
            <TabsContent value="expression" className="mt-2">
              <Textarea
                id="delay-expression"
                placeholder="e.g.: delay_hours(2) + delay_min(30)"
                value={delayExpression}
                onChange={(e) => {
                  const newExpr = e.target.value;
                  setDelayExpression(newExpr);
                  updateDelay(newExpr);
                }}
                className="min-h-[80px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Available: delay_ms(), delay_sec(), delay_min(), delay_hours(), delay_days()
              </p>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            Per-token delay added when tokens are produced on this arc
          </p>
        </div>
      )}
    </div>
  );
}

export default ArcProperties;

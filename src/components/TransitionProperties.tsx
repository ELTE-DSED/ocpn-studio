import { useState, useEffect, useMemo } from 'react';
import useStore from '@/stores/store';

import { Label } from "@/components/ui/label";
import { UndoableInput as Input, UndoableTextarea as Textarea, UndoableAutoExpandingInput } from "@/components/ui/undoable-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CodeSegmentEditor } from "@/components/CodeSegmentEditor";

import type { Priority } from "@/declarations";
import type { TransitionNodeData } from '@/nodes/TransitionNode';
import type { UnaryDeclareConstraint, UnaryDeclareTemplate } from '@/types';
import { Trash2, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// Short labels for the Declare-constraint select trigger — the dropdown items themselves
// keep the full descriptive text, but showing that same long text in the trigger is what
// was blowing out the properties panel's width.
const UNARY_TEMPLATE_SHORT_LABELS: Record<UnaryDeclareTemplate, string> = {
  existence: 'Existence',
  absence: 'Absence',
  exactly: 'Exactly',
  init: 'Init',
  last: 'Last',
};

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

// Field order/labels/bounds for the relative time delay grid below
const RELATIVE_TIME_FIELDS: { key: 'd' | 'h' | 'm' | 's' | 'ms'; label: string; max?: number }[] = [
  { key: 'd', label: 'Days' },
  { key: 'h', label: 'Hours', max: 23 },
  { key: 'm', label: 'Minutes', max: 59 },
  { key: 's', label: 'Seconds', max: 59 },
  { key: 'ms', label: 'Milliseconds', max: 999 },
];

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

// Try to parse a time expression back to relative time (for display purposes)
// Returns null if it can't be parsed as a simple relative time
function parseTimeExpression(expr: string): { ms: number; s: number; m: number; h: number; d: number } | null {
  if (!expr || expr.trim() === '') {
    return { ms: 0, s: 0, m: 0, h: 0, d: 0 };
  }
  
  // Try to match delay function calls and sum them up
  const delayPattern = /delay_(days|hours|min|sec|ms)\s*\(\s*(\d+)\s*\)/g;
  let totalMs = 0;
  let hasMatch = false;
  let match;
  
  // Check if the expression only contains delay calls and + operators
  const cleaned = expr.replace(delayPattern, '').replace(/\+/g, '').trim();
  if (cleaned !== '') {
    // Has other content, not a simple relative expression
    return null;
  }
  
  // Reset regex and extract values
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
  
  if (!hasMatch && expr.trim() !== '') {
    return null;
  }
  
  return msToRelativeTime(totalMs);
}

const TransitionProperties = ({ priorities }: { priorities: Priority[] }) => {
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const selectedElement = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return activePetriNet?.selectedElement;
  });
  const updateNodeData = useStore((state) => state.updateNodeData);
  const petriNetsById = useStore((state) => state.petriNetsById);
  const petriNetOrder = useStore((state) => state.petriNetOrder);
  const assignSubpageToTransition = useStore((state) => state.assignSubpageToTransition);
  const removeSubpageFromTransition = useStore((state) => state.removeSubpageFromTransition);

  // State for time input mode
  const [timeMode, setTimeMode] = useState<'relative' | 'expression'>('relative');
  const [relativeTime, setRelativeTime] = useState({ ms: 0, s: 0, m: 0, h: 0, d: 0 });
  const [expressionValue, setExpressionValue] = useState('');
  const [lastNodeId, setLastNodeId] = useState<string | null>(null);

  // Extract node data safely (for use in useEffect before early returns)
  const isValidNode = selectedElement && selectedElement.type === 'node' && selectedElement.element;
  const nodeId = isValidNode ? selectedElement.element.id : null;
  const nodeData = isValidNode ? selectedElement.element.data as { label?: string; colorSet?: string; isArcMode?: boolean; type?: string; initialMarking?: string; guard?: string; time?: string; priority?: string; codeSegment?: string; subPageId?: string; socketAssignments?: { portPlaceId: string; socketPlaceId: string }[]; overrideColor?: string; declareUnary?: UnaryDeclareConstraint[] } : null;

  // Initialize time state when node changes - must be called before any early returns
  /* eslint-disable react-hooks/set-state-in-effect -- Form init on selection change */
  useEffect(() => {
    if (nodeId && nodeId !== lastNodeId && nodeData) {
      setLastNodeId(nodeId);
      const timeValue = nodeData.time || '';
      const parsed = parseTimeExpression(timeValue);
      if (parsed !== null) {
        setTimeMode('relative');
        setRelativeTime(parsed);
        setExpressionValue(timeValue);
      } else {
        setTimeMode('expression');
        setExpressionValue(timeValue);
        setRelativeTime({ ms: 0, s: 0, m: 0, h: 0, d: 0 });
      }
    }
  }, [nodeId, lastNodeId, nodeData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-focus the field requested via focusRequest (e.g. from "Resolve Non-determinism" panel)
  const focusField = useStore((state) => state.focusRequest?.field);
  useEffect(() => {
    if (!focusField || !nodeId) return;
    // Map field names to DOM element IDs
    const fieldIdMap: Record<string, string> = {
      guard: 'guard',
      time: 'time-expression',
      codeSegment: 'code-segment',
      declareUnary: 'declare-unary',
    };
    const domId = fieldIdMap[focusField];
    if (!domId) return;

    // If focusing the time field, switch to expression mode so the textarea is visible
    if (focusField === 'time') {
      setTimeMode('expression'); // eslint-disable-line react-hooks/set-state-in-effect -- Intentional: need expression tab visible to focus
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
  }, [focusField, nodeId]);

  // Ensure selectedElement is a node and has the correct data type
  if (!isValidNode || !nodeData) {
    return <div>No node selected</div>;
  }

  const id = nodeId!;
  const data = nodeData;

  // Ensure data has transition-specific fields (guard may be absent on loaded nodes)
  if (data.type === 'place' || data.type === 'auxText') {
    return <div>Invalid node type</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="label">Label</Label>
        <UndoableAutoExpandingInput
          id="label"
          value={data.label ?? ""}
          onChange={(e) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, { ...data, label: e.target.value, isArcMode: data.isArcMode || false, type: data.type || 'defaultType', colorSet: data.colorSet || 'defaultColorSet', initialMarking: data.initialMarking || 'defaultMarking' })
            }
          }
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="overrideColor" className="text-sm">Color</Label>
        <input
          type="color"
          id="overrideColor"
          value={data.overrideColor || '#000000'}
          onChange={(e) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                overrideColor: e.target.value === '#000000' ? undefined : e.target.value,
              } as TransitionNodeData);
            }
          }}
          className="w-6 h-6 rounded border cursor-pointer"
        />
        {data.overrideColor && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              if (activePetriNetId) {
                updateNodeData(activePetriNetId, id, {
                  ...data,
                  overrideColor: undefined,
                } as TransitionNodeData);
              }
            }}
          >
            Reset
          </Button>
        )}
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="guard">Guard</Label>
        <Textarea
          id="guard"
          value={data.guard || ""}
          placeholder="Boolean expression, e.g.: x > 0 && y != z"
          className="min-h-[60px] font-mono text-sm"
          onChange={(e) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: data.label || "",
                guard: e.target.value,
                isArcMode: data.isArcMode || false,
                type: data.type || "defaultType",
                colorSet: data.colorSet || "defaultColorSet",
                initialMarking: data.initialMarking || "defaultMarking",
              })}
            }
          }
        />
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label>Time Delay</Label>
        <Tabs value={timeMode} onValueChange={(v) => setTimeMode(v as 'relative' | 'expression')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="relative">Relative</TabsTrigger>
            <TabsTrigger value="expression">Expression</TabsTrigger>
          </TabsList>
          <TabsContent value="relative" className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              {RELATIVE_TIME_FIELDS.map((field) => (
                <div key={field.key} className="rounded-lg border bg-muted/20 p-3">
                  <label htmlFor={`time-${field.key}`} className="text-xs text-muted-foreground">
                    {field.label}
                  </label>
                  <Input
                    id={`time-${field.key}`}
                    type="number"
                    min="0"
                    max={field.max}
                    value={relativeTime[field.key]}
                    onChange={(e) => {
                      const newRel = { ...relativeTime, [field.key]: parseInt(e.target.value, 10) || 0 };
                      setRelativeTime(newRel);
                      const expr = relativeTimeToExpression(newRel);
                      setExpressionValue(expr);
                      if (activePetriNetId) {
                        updateNodeData(activePetriNetId, id, {
                          ...data,
                          label: data.label || "",
                          time: expr,
                          isArcMode: data.isArcMode || false,
                          type: data.type || "defaultType",
                          colorSet: data.colorSet,
                          initialMarking: data.initialMarking,
                          priority: data.priority,
                          codeSegment: data.codeSegment || "",
                          guard: data.guard || "",
                        });
                      }
                    }}
                    className="w-full border-0 bg-transparent p-0 h-auto text-2xl font-bold shadow-none focus-visible:ring-0"
                  />
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="expression" className="mt-2">
            <Textarea
              id="time-expression"
              placeholder="Rhai expression, e.g.: delay_hours(2) + delay_min(30)"
              value={expressionValue}
              onChange={(e) => {
                const newExpr = e.target.value;
                setExpressionValue(newExpr);
                if (activePetriNetId) {
                  updateNodeData(activePetriNetId, id, {
                    ...data,
                    label: data.label || "",
                    time: newExpr,
                    isArcMode: data.isArcMode || false,
                    type: data.type || "defaultType",
                    colorSet: data.colorSet,
                    initialMarking: data.initialMarking,
                    priority: data.priority,
                    codeSegment: data.codeSegment || "",
                    guard: data.guard || "",
                  });
                }
              }}
              className="min-h-[80px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Available: delay_ms(), delay_sec(), delay_min(), delay_hours(), delay_days()
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="priority">Priority</Label>
        <Select
          value={data.priority !== undefined && !priorities.some(p => p.name === data.priority) ? "CUSTOM" : (data.priority ?? "NONE")}
          onValueChange={(value) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: data.label || "",
                priority: value === "NONE" ? undefined : value === "CUSTOM" ? (data.priority && /^\d+$/.test(data.priority) ? data.priority : "") : value,
                isArcMode: data.isArcMode || false,
                type: data.type || "defaultType",
                colorSet: data.colorSet,
                initialMarking: data.initialMarking,
                guard: data.guard || "",
                time: data.time || "",
                codeSegment: data.codeSegment || "",
              })}
            }
          }
        >
          <SelectTrigger id="priority">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">None</SelectItem>
            {priorities.map((p) => (
              <SelectItem key={p.id} value={p.name}>
                {p.name} ({p.level})
              </SelectItem>
            ))}
            <SelectItem value="CUSTOM">Custom value...</SelectItem>
          </SelectContent>
        </Select>
        {data.priority !== undefined && !priorities.some(p => p.name === data.priority) && (
          <>
          <Input
            type="number"
            placeholder="e.g. 100"
            value={data.priority}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (activePetriNetId) {
                const val = e.target.value.trim();
                updateNodeData(activePetriNetId, id, {
                  ...data,
                  label: data.label || "",
                  priority: val === '' ? undefined : val,
                  isArcMode: data.isArcMode || false,
                  type: data.type || "defaultType",
                  colorSet: data.colorSet,
                  initialMarking: data.initialMarking,
                  guard: data.guard || "",
                  time: data.time || "",
                  codeSegment: data.codeSegment || "",
                });
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Lower value = higher priority.
          </p>
          </>
        )}
      </div>

      <Separator />

      <div className="grid w-full items-center gap-1.5">
        <CodeSegmentEditor
          value={data.codeSegment || ""}
          onChange={(value) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: data.label || "",
                codeSegment: value,
                isArcMode: data.isArcMode || false,
                type: data.type || "defaultType",
                colorSet: data.colorSet,
                initialMarking: data.initialMarking,
                guard: data.guard || "",
                time: data.time || "",
                priority: data.priority,
              })}
            }
          }
        />
      </div>

      <Separator />

      <DeclareUnarySection
        activePetriNetId={activePetriNetId}
        transitionId={id}
        constraints={data.declareUnary || []}
        updateNodeData={updateNodeData}
        data={data}
      />

      <SubpageSection
        activePetriNetId={activePetriNetId}
        transitionId={id}
        data={data}
        petriNetsById={petriNetsById}
        petriNetOrder={petriNetOrder}
        assignSubpageToTransition={assignSubpageToTransition}
        removeSubpageFromTransition={removeSubpageFromTransition}
      />
    </div>
  )
}

/** Subpage assignment section for transitions */
function SubpageSection({
  activePetriNetId,
  transitionId,
  data,
  petriNetsById,
  petriNetOrder,
  assignSubpageToTransition,
  removeSubpageFromTransition,
}: {
  activePetriNetId: string | null;
  transitionId: string;
  data: { subPageId?: string; socketAssignments?: { portPlaceId: string; socketPlaceId: string }[] };
  petriNetsById: Record<string, { id: string; name: string; nodes: { id: string; type?: string; data?: Record<string, unknown> }[]; edges: { id: string; source: string; target: string }[] }>;
  petriNetOrder: string[];
  assignSubpageToTransition: (petriNetId: string, transitionId: string, subPageId: string, socketAssignments: { portPlaceId: string; socketPlaceId: string }[]) => void;
  removeSubpageFromTransition: (petriNetId: string, transitionId: string) => void;
}) {
  // Read live transition data from the store (not from stale selectedElement)
  const liveNode = useMemo(() => {
    if (!activePetriNetId || !petriNetsById[activePetriNetId]) return null;
    return petriNetsById[activePetriNetId].nodes.find((n) => n.id === transitionId);
  }, [activePetriNetId, petriNetsById, transitionId]);

  const currentSubPageId = (liveNode?.data?.subPageId as string) || data.subPageId || null;
  const currentSocketAssignments = (liveNode?.data?.socketAssignments as { portPlaceId: string; socketPlaceId: string }[]) || data.socketAssignments || [];

  // Available subpages: exclude the current net and the main page
  const availableSubpages = useMemo(() => {
    return petriNetOrder
      .filter((id) => id !== activePetriNetId)
      .map((id) => ({ id, name: petriNetsById[id]?.name || id }));
  }, [petriNetOrder, activePetriNetId, petriNetsById]);

  // Port places on the selected subpage (places with portType set)
  const portPlaces = useMemo(() => {
    if (!currentSubPageId || !petriNetsById[currentSubPageId]) return [];
    return petriNetsById[currentSubPageId].nodes.filter(
      (n) => n.type === 'place' && n.data?.portType
    );
  }, [currentSubPageId, petriNetsById]);

  // Places on the parent net that can be sockets (places connected to this transition)
  const parentPlaces = useMemo(() => {
    if (!activePetriNetId || !petriNetsById[activePetriNetId]) return [];
    const parentNet = petriNetsById[activePetriNetId];
    // Get all places connected to this transition via arcs
    const connectedPlaceIds = new Set<string>();
    parentNet.edges.forEach((e) => {
      if (e.source === transitionId) connectedPlaceIds.add(e.target);
      if (e.target === transitionId) connectedPlaceIds.add(e.source);
    });
    return parentNet.nodes.filter(
      (n) => n.type === 'place' && connectedPlaceIds.has(n.id)
    );
  }, [activePetriNetId, petriNetsById, transitionId]);

  // All places on the parent net (for socket selection)
  const allParentPlaces = useMemo(() => {
    if (!activePetriNetId || !petriNetsById[activePetriNetId]) return [];
    return petriNetsById[activePetriNetId].nodes.filter((n) => n.type === 'place');
  }, [activePetriNetId, petriNetsById]);

  const handleSubpageChange = (subPageId: string) => {
    if (!activePetriNetId) return;
    if (subPageId === '__none__') {
      removeSubpageFromTransition(activePetriNetId, transitionId);
      return;
    }
    // Auto-generate socket assignments by matching port places to connected parent places
    const subPage = petriNetsById[subPageId];
    if (!subPage) return;
    const ports = subPage.nodes.filter((n) => n.type === 'place' && n.data?.portType);
    const autoAssignments: { portPlaceId: string; socketPlaceId: string }[] = [];

    for (const port of ports) {
      // Try to find a matching parent place by name/label
      const portLabel = (port.data?.label as string) || '';
      const matchByName = parentPlaces.find(
        (p) => (p.data?.label as string) === portLabel
      );
      if (matchByName) {
        autoAssignments.push({ portPlaceId: port.id, socketPlaceId: matchByName.id });
      }
    }
    assignSubpageToTransition(activePetriNetId, transitionId, subPageId, autoAssignments);
  };

  const handleSocketChange = (portPlaceId: string, socketPlaceId: string) => {
    if (!activePetriNetId || !currentSubPageId) return;
    const updated = currentSocketAssignments.filter((sa) => sa.portPlaceId !== portPlaceId);
    if (socketPlaceId !== '__none__') {
      updated.push({ portPlaceId, socketPlaceId });
    }
    assignSubpageToTransition(activePetriNetId, transitionId, currentSubPageId, updated);
  };

  return (
    <>
      <Separator />
      <div className="grid w-full items-center gap-1.5">
        <Label>Subpage</Label>
        <Select
          value={currentSubPageId || '__none__'}
          onValueChange={handleSubpageChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {availableSubpages.map((sp) => (
              <SelectItem key={sp.id} value={sp.id}>
                {sp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Socket assignments - shown when a subpage is selected and has port places */}
      {currentSubPageId && portPlaces.length > 0 && (
        <div className="grid w-full items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Socket Assignments</Label>
          <div className="space-y-2">
            {portPlaces.map((port) => {
              const currentSocket = currentSocketAssignments.find(
                (sa) => sa.portPlaceId === port.id
              );
              const portLabel = (port.data?.label as string) || port.id;
              const portType = port.data?.portType as string;
              const portTypeLabel = portType === 'in' ? 'In' : portType === 'out' ? 'Out' : 'I/O';
              const portTypeColor = portType === 'in' ? 'text-green-600' : portType === 'out' ? 'text-orange-600' : 'text-purple-600';
              return (
                <div key={port.id} className="flex items-center gap-2">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className={`text-[10px] font-semibold ${portTypeColor}`}>{portTypeLabel}</span>
                    <span className="text-xs truncate" title={portLabel}>{portLabel}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">→</span>
                  <div className="flex-1">
                    <Select
                      value={currentSocket?.socketPlaceId || '__none__'}
                      onValueChange={(val) => handleSocketChange(port.id, val)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="Not assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not assigned</SelectItem>
                        {allParentPlaces.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {(p.data?.label as string) || p.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
          {portPlaces.length === 0 && currentSubPageId && (
            <p className="text-xs text-muted-foreground">
              No port places defined on the subpage. Set port types (In/Out/I/O) on subpage places first.
            </p>
          )}
        </div>
      )}

      {currentSubPageId && portPlaces.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No port places defined on the subpage. Set port types (In/Out/I/O) on subpage places first.
        </p>
      )}

      {currentSubPageId && (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (activePetriNetId) {
              removeSubpageFromTransition(activePetriNetId, transitionId);
            }
          }}
        >
          Remove Subpage
        </Button>
      )}
    </>
  );
}

/** Unary Declare constraints (Existence/Absence) attached directly to this transition */
function DeclareUnarySection({
  activePetriNetId,
  transitionId,
  constraints,
  updateNodeData,
  data,
}: {
  activePetriNetId: string | null;
  transitionId: string;
  constraints: UnaryDeclareConstraint[];
  updateNodeData: (petriNetId: string, id: string, newData: TransitionNodeData) => void;
  data: { label?: string; isArcMode?: boolean; type?: string; guard?: string; time?: string; priority?: string; codeSegment?: string };
}) {
  const commit = (newConstraints: UnaryDeclareConstraint[]) => {
    if (!activePetriNetId) return;
    updateNodeData(activePetriNetId, transitionId, {
      ...data,
      label: data.label || "",
      isArcMode: data.isArcMode || false,
      type: data.type || "defaultType",
      guard: data.guard || "",
      time: data.time || "",
      priority: data.priority,
      codeSegment: data.codeSegment || "",
      declareUnary: newConstraints,
    } as TransitionNodeData);
  };

  const handleAdd = () => {
    // CPN Tools allows only a single "roof" per transition — some unary templates are
    // mutually exclusive (e.g. Init and Last), so stacking several never made sense.
    if (constraints.length > 0) return;
    commit([{ id: uuidv4(), template: 'existence', enabled: true }]);
  };

  const handleUpdate = (constraintId: string, patch: Partial<UnaryDeclareConstraint>) => {
    commit(constraints.map((c) => (c.id === constraintId ? { ...c, ...patch } : c)));
  };

  const handleDelete = (constraintId: string) => {
    commit(constraints.filter((c) => c.id !== constraintId));
  };

  return (
    <div className="grid w-full items-center gap-1.5">
      <Label>Declare Constraint</Label>
      {constraints.length > 0 && (
        <div className="space-y-2">
          {constraints.map((c) => (
            <div key={c.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => handleUpdate(c.id, { enabled: e.target.checked })}
                  className="cursor-pointer shrink-0"
                  title="Enabled"
                />
                <Select
                  value={c.template}
                  onValueChange={(value) => handleUpdate(c.id, { template: value as UnaryDeclareTemplate })}
                >
                  <SelectTrigger className="h-8 text-sm flex-1 min-w-0">
                    <SelectValue>{UNARY_TEMPLATE_SHORT_LABELS[c.template]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="existence">Existence — must fire at least n times</SelectItem>
                    <SelectItem value="absence">Absence — must fire at most n−1 times</SelectItem>
                    <SelectItem value="exactly">Exactly — must fire exactly n times</SelectItem>
                    <SelectItem value="init">Init — must be the first to fire</SelectItem>
                    <SelectItem value="last">Last — must be the last to fire</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Delete constraint" onClick={() => handleDelete(c.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {(c.template === 'existence' || c.template === 'absence' || c.template === 'exactly') && (
                <div className="flex items-center gap-2 pl-6">
                  <Label className="text-xs text-muted-foreground font-normal">n =</Label>
                  <Input
                    type="number"
                    min="1"
                    value={c.n ?? 1}
                    onChange={(e) => handleUpdate(c.id, { n: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-16 h-7 text-sm"
                    title="n"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {constraints.length === 0 && (
        <Button id="declare-unary" size="sm" variant="outline" onClick={handleAdd} className="self-start">
          <Plus className="h-3 w-3 mr-1" /> Add Constraint
        </Button>
      )}
    </div>
  );
}

export default TransitionProperties;

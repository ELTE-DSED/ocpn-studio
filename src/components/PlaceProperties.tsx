import { useState, useEffect } from 'react';
import useStore from '@/stores/store';
import { pauseUndo, resumeUndo } from '@/stores/store';

import { Label } from "@/components/ui/label";
import { UndoableInput as Input, UndoableAutoExpandingInput } from "@/components/ui/undoable-input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { RecordMarkingDialog } from '@/components/dialogs/RecordMarkingDialog';
import { TimedMarkingDialog, TimedToken } from '@/components/dialogs/TimedMarkingDialog';
import { ColorSet } from '@/declarations';
import type { PlaceNodeData } from '@/nodes/PlaceNode';
import { Separator } from "@/components/ui/separator";
import { v4 as uuidv4 } from 'uuid';
import { useSimulationContext } from '@/context/useSimulationContextHook';

// Define the type for the values within a parsed record (matches RecordMarkingDialog)
type RecordValue = string | number | boolean | unknown[] | Record<string, unknown>;
// Define the type for a single parsed record
type ParsedRecord = Record<string, RecordValue>;
// For multiset mode, entries can be any JSON value
type MultisetEntry = string | number | boolean | unknown[] | Record<string, unknown>;

// Define the type for the data part of the selected place
interface SelectedPlaceData {
  label?: string;
  colorSet?: string;
  isArcMode?: boolean;
  type?: string;
  initialMarking?: string;
  marking?: unknown[];
  portType?: 'in' | 'out' | 'io';
  fusionSetId?: string;
  overrideColor?: string;
}

// Define the type for the selected place state
interface SelectedPlace {
  id: string;
  data: SelectedPlaceData;
  // Which marking the open dialog is editing — the model's fixed starting state, or the
  // live simulator state right now. Determines both what initialData the dialog is seeded
  // with and where onSave writes the result back to.
  target: 'initial' | 'current';
}

const PlaceProperties = ({ colorSets }: { colorSets: ColorSet[] }) => {
  const [isRecordMarkingDialogOpen, setIsRecordMarkingDialogOpen] = useState(false);
  const [isTimedMarkingDialogOpen, setIsTimedMarkingDialogOpen] = useState(false);
  // Use the specific type for the selectedPlace state
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [newFusionSetName, setNewFusionSetName] = useState('');
  const [currentMarkingInput, setCurrentMarkingInput] = useState('');
  const [isApplyingMarking, setIsApplyingMarking] = useState(false);
  const simulationContext = useSimulationContext();

  // Access selectedElement from the store
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const selectedElement = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return activePetriNet?.selectedElement;
  });
  const updateNodeData = useStore((state) => state.updateNodeData);
  const fusionSets = useStore((state) => state.fusionSets);
  const addFusionSet = useStore((state) => state.addFusionSet);
  const deleteFusionSet = useStore((state) => state.deleteFusionSet);
  const isSubpage = useStore((state) => state.petriNetOrder[0] !== state.activePetriNetId);

  // Pre-fill the quick-edit input with the place's live marking whenever the *selection*
  // changes (not on every marking tick — that would clobber whatever the user is mid-typing
  // every time a step fires). Lets you tweak a small part of the current value instead of
  // retyping the whole thing from scratch, matching the ask that started this.
  const selectedPlaceId = selectedElement?.type === 'node' ? selectedElement.element.id : null;
  useEffect(() => {
    const liveData = selectedElement?.type === 'node' ? (selectedElement.element.data as SelectedPlaceData) : undefined;
    setCurrentMarkingInput(JSON.stringify(liveData?.marking ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaceId]);

  // Ensure selectedElement is a node and has the correct data type
  if (!selectedElement || selectedElement.type !== 'node' || !selectedElement.element) {
    return <div>No node selected</div>;
  }

  // Use the specific type here as well, although it's inferred correctly
  const { id, data }: { id: string; data: SelectedPlaceData } = selectedElement.element;

  // Type guard to ensure data is of type PlaceNodeData
  if (!('colorSet' in data)) {
    return <div>Invalid node type</div>;
  }

  // Check if the selected colorSet is a UNIT type
  const selectedColorSet = colorSets.find((cs) => cs.name === data.colorSet);
  const isUnitType = selectedColorSet?.type === 'basic' && selectedColorSet?.definition?.includes('= unit;');
  // Check if the selected colorSet is timed
  const isTimed = selectedColorSet?.timed === true;

  // Determine the base type of the colorset for timed marking editor
  const getColorSetBaseType = (): 'int' | 'bool' | 'string' | 'unit' | 'other' => {
    if (!selectedColorSet) return 'other';
    const def = selectedColorSet.definition?.toLowerCase() || '';
    if (def.includes('= unit')) return 'unit';
    if (def.includes('= int')) return 'int';
    if (def.includes('= bool')) return 'bool';
    if (def.includes('= string')) return 'string';
    return 'other';
  };

  // Parse timed marking string to TimedToken array
  const parseTimedMarking = (marking: string): TimedToken[] => {
    if (!marking) return [];
    try {
      const parsed = JSON.parse(marking);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (typeof item === 'object' && item !== null && 'value' in item && 'timestamp' in item) {
            return { value: item.value, timestamp: Number(item.timestamp) || 0 };
          }
          // If it's a simple value, wrap it with timestamp 0
          return { value: item, timestamp: 0 };
        });
      }
    } catch {
      // Try to parse as simple array and add default timestamps
      try {
        const simpleArray = JSON.parse(marking);
        if (Array.isArray(simpleArray)) {
          return simpleArray.map((v) => ({ value: v, timestamp: 0 }));
        }
      } catch {
        // Fall through
      }
    }
    return [];
  };

  // Format TimedToken array to marking string
  const formatTimedMarking = (tokens: TimedToken[]): string => {
    if (tokens.length === 0) return '';
    return JSON.stringify(tokens.map((t) => ({ value: t.value, timestamp: t.timestamp })));
  };

  // Helper to parse UNIT marking to count (handles array format, number, and legacy formats)
  const parseUnitMarkingCount = (marking: string): number => {
    if (!marking) return 0;
    const trimmed = marking.trim();
    // If it's a number, return it directly
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    // If it's an array of unit values like "[(), (), ()]", count them
    if (trimmed.startsWith('[')) {
      try {
        // Count occurrences of "()" in the array
        const matches = trimmed.match(/\(\)/g);
        return matches ? matches.length : 0;
      } catch {
        return 0;
      }
    }
    // Handle legacy "()" format (single unit token)
    if (trimmed === '()') return 1;
    // Handle N`() or N'() format
    const multiMatch = trimmed.match(/^(\d+)[`']\(\)$/);
    if (multiMatch) return parseInt(multiMatch[1], 10);
    return 0;
  };

  // Helper to convert count to UNIT marking format
  const countToUnitMarking = (count: number): string => {
    if (count <= 0) return '';
    // Create an array of N unit values: [(), (), ...]
    const units = Array(count).fill('()').join(', ');
    return `[${units}]`;
  };

  // Helper function to get record attributes
  const getRecordAttributes = (colorSetName: string) => {
    const colorSet = colorSets.find((cs) => cs.name === colorSetName)
    if (!colorSet || colorSet.type !== "record") return []

    // In a real implementation, parse the record definition
    // For now, we'll use a simplified approach for the demo
    if (colorSetName === "Product") {
      return [
        { name: "id", type: "INT" },
        { name: "name", type: "STRING" },
        { name: "price", type: "REAL" },
      ]
    } else if (colorSetName === "Order") {
      return [
        { name: "orderId", type: "STRING" },
        { name: "status", type: "STRING" },
        { name: "amount", type: "INT" },
      ]
    }

    // Try to parse from the definition
    try {
      const recordRegex = /colset\s+(\w+)\s*=\s*record\s+([^;]+);/i
      const fieldsRegex = /(\w+)\s*:\s*(\w+)/g

      const match = colorSet.definition.match(recordRegex)
      if (!match) return []

      const fields = match[2]
      const attributes = []
      let fieldMatch

      while ((fieldMatch = fieldsRegex.exec(fields)) !== null) {
        attributes.push({
          name: fieldMatch[1],
          type: fieldMatch[2].toUpperCase(),
        })
      }

      return attributes
    } catch (error) {
      console.error("Failed to parse record definition:", error)
      return []
    }
  }

  // Helper function to parse initial marking
  const parseInitialMarking = (initialMarking: string): ParsedRecord[] => {
    if (!initialMarking) return []

    try {
      // Try to parse as JSON first
      if (initialMarking.trim().startsWith("[")) {
        // Assuming JSON structure matches ParsedRecord[]
        return JSON.parse(initialMarking) as ParsedRecord[];
      }

      // If not JSON, try to parse as CPN Tools format
      const regex = /(\d+)`\{([^}]+)\}/g
      const records: ParsedRecord[] = []
      let match

      while ((match = regex.exec(initialMarking)) !== null) {
        const count = Number.parseInt(match[1], 10)
        const recordStr = match[2]

        // Parse record attributes
        const attrRegex = /(\w+)=([^,]+)(?:,|$)/g
        const record: ParsedRecord = {}
        let attrMatch

        while ((attrMatch = attrRegex.exec(recordStr)) !== null) {
          let value: string | number | boolean = attrMatch[2].trim()
          const key = attrMatch[1];

          // Try to convert to appropriate type
          if (!isNaN(Number(value))) {
            if (value.includes(".")) {
              record[key] = Number.parseFloat(value)
            } else {
              record[key] = Number.parseInt(value, 10)
            }
          } else if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
            record[key] = value.toLowerCase() === "true"
          } else {
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.substring(1, value.length - 1)
            }
            record[key] = value
          }
        }

        // Add the record multiple times based on count
        for (let i = 0; i < count; i++) {
          records.push({ ...record })
        }
      }

      return records
    } catch (error) {
      console.error("Failed to parse initial marking:", error)
      return []
    }
  }

  // Helper function to format record marking
  const formatRecordMarking = (records: ParsedRecord[] | MultisetEntry[]) => {
    if (!records || records.length === 0) return ""

    try {
      // For simplicity, we'll return as JSON string
      // In a real implementation, you might format it according to CPN Tools syntax
      return JSON.stringify(records)
    } catch (error) {
      console.error("Failed to format record marking:", error)
      return ""
    }
  }

  // Overwrite this place's *live* marking mid-simulation — distinct from Initial Marking
  // above, which only takes effect on the next reset/run. Only meaningful once a
  // simulation is actually initialized (there's no "current" marking before that).
  const handleApplyCurrentMarking = async () => {
    setIsApplyingMarking(true);
    try {
      await simulationContext.setPlaceMarking(id, currentMarkingInput);
      // Leave the field showing what was just applied (on success) rather than clearing it —
      // it should keep reflecting the live value, matching the pre-fill-on-select behavior.
    } finally {
      setIsApplyingMarking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="label">Label</Label>
        <UndoableAutoExpandingInput
          id="label"
          value={data.label || ""}
          onChange={(e) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: e.target.value,
                isArcMode: data.isArcMode || false,
                type: data.type || "node",
                colorSet: data.colorSet || "INT",
                initialMarking: data.initialMarking || "",
              });
            }
          }
          }
        />
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="colorSet">Color Set</Label>
        <Select
          value={data.colorSet || "INT"}
          onValueChange={(value) => {
            // const colorSetObj = colorSets.find((cs) => cs.name === value);
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: data.label || "",
                colorSet: value,
                isArcMode: data.isArcMode || false,
                type: data.type || "node",
                initialMarking: data.initialMarking || "",
              });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select color set" />
          </SelectTrigger>
          <SelectContent>
            {colorSets.map((cs) => (
              <SelectItem key={cs.id} value={cs.name}>
                <div className="flex items-center">
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: cs.color || "#3b82f6" }}
                  ></div>
                  {cs.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="overrideColor"
          checked={!!data.overrideColor}
          onCheckedChange={(checked) => {
            if (activePetriNetId) {
              const colorSetObj = colorSets.find((cs) => cs.name === data.colorSet);
              updateNodeData(activePetriNetId, id, {
                ...data,
                overrideColor: checked ? (colorSetObj?.color || '#000000') : undefined,
              } as PlaceNodeData);
            }
          }}
        />
        <Label htmlFor="overrideColor" className="text-sm">Override color</Label>
        {data.overrideColor && (
          <input
            type="color"
            value={data.overrideColor}
            onChange={(e) => {
              if (activePetriNetId) {
                updateNodeData(activePetriNetId, id, {
                  ...data,
                  overrideColor: e.target.value,
                } as PlaceNodeData);
              }
            }}
            className="w-6 h-6 rounded border cursor-pointer"
          />
        )}
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="initialMarking">Initial Marking</Label>
        {isUnitType && !isTimed ? (
          /* UNIT type (non-timed): show simple number input */
          <Input
            id="initialMarking"
            type="number"
            min="0"
            value={parseUnitMarkingCount(data.initialMarking || "")}
            onChange={(e) => {
              if (activePetriNetId) {
                const count = parseInt(e.target.value, 10) || 0;
                updateNodeData(activePetriNetId, id, {
                  ...data,
                  label: data.label || "",
                  initialMarking: countToUnitMarking(count),
                  isArcMode: data.isArcMode || false,
                  type: data.type || "defaultType",
                  colorSet: data.colorSet || "defaultColorSet",
                });
              }
            }}
          />
        ) : isTimed ? (() => {
          // Expression-based markings (e.g. imported `[timed((), (5.0*day))]` or a
          // function call) are not JSON — show them as editable text instead of the
          // structured dialog, which can only represent literal tokens and would
          // silently replace the expression on save.
          const marking = data.initialMarking || "";
          let isExpression = false;
          if (marking.trim() !== "") {
            try {
              JSON.parse(marking);
            } catch {
              isExpression = true;
            }
          }
          return isExpression ? (
            <Textarea
              id="initialMarking"
              value={marking}
              placeholder='e.g., [timed((), delay_days(5))]'
              rows={2}
              onChange={(e) => {
                if (activePetriNetId) {
                  updateNodeData(activePetriNetId, id, {
                    ...data,
                    label: data.label || "",
                    initialMarking: e.target.value,
                    isArcMode: data.isArcMode || false,
                    type: data.type || "defaultType",
                    colorSet: data.colorSet || "defaultColorSet",
                  });
                }
              }}
            />
          ) : (
            /* Timed colorset: show token count summary with Edit button */
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <div className="flex-1 text-sm text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
                  {parseTimedMarking(marking).length} timed token(s)
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedPlace({ id, data: { ...data }, target: 'initial' });
                    setIsTimedMarkingDialogOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </div>
          );
        })() : (() => {
          // Detect whether initialMarking is a valid JSON value or an expression
          let isExpression = false;
          if (data.initialMarking && typeof data.initialMarking === 'string' && data.initialMarking.trim() !== '') {
            try {
              JSON.parse(data.initialMarking);
            } catch {
              isExpression = true;
            }
          }
          return isExpression ? (
            /* Expression-based marking (e.g., all_orders()): show textarea only */
            <Textarea
              id="initialMarking"
              value={data.initialMarking || ""}
              placeholder="e.g., all_orders()"
              rows={2}
              onChange={(e) => {
                if (activePetriNetId) {
                  updateNodeData(activePetriNetId, id, {
                    ...data,
                    label: data.label || "",
                    initialMarking: e.target.value,
                    isArcMode: data.isArcMode || false,
                    type: data.type || "defaultType",
                    colorSet: data.colorSet || "defaultColorSet",
                  });
                }
              }}
            />
          ) : (
            /* JSON marking: show text input with Edit button */
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  id="initialMarking"
                  value={data.initialMarking || ""}
                  placeholder="e.g., [1, 2, 3]"
                  onChange={(e) => {
                    if (activePetriNetId) {
                      updateNodeData(activePetriNetId, id, {
                        ...data,
                        label: data.label || "",
                        initialMarking: e.target.value,
                        isArcMode: data.isArcMode || false,
                        type: data.type || "defaultType",
                        colorSet: data.colorSet || "defaultColorSet",
                      });
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedPlace({ id, data: { ...data }, target: 'initial' });
                    setIsRecordMarkingDialogOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Current Marking — live token multiset, only meaningful once a simulation is
          actually running. Separate from Initial Marking above: editing this changes what's
          in the place *right now*, for testing/debugging, without touching the model's
          fixed starting state or requiring a reset. */}
      {simulationContext.isInitialized && (
        <>
          <Separator />
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="currentMarking">Current Marking (live)</Label>
            {isUnitType && !isTimed ? (
              /* UNIT type (non-timed): same simple count input as Initial Marking, applied
                 straight to the live simulator (no dialog needed — there are no attributes
                 to edit on a unit token). */
              <Input
                id="currentMarking"
                type="number"
                min="0"
                value={(data.marking ?? []).length}
                onChange={(e) => {
                  const count = parseInt(e.target.value, 10) || 0;
                  simulationContext.setPlaceMarking(id, countToUnitMarking(count));
                }}
              />
            ) : isTimed ? (
              /* Timed colorset: same token-count-summary + Edit button as Initial Marking,
                 opening the same structured dialog against the live marking. */
              <div className="flex gap-2 items-center">
                <div className="flex-1 text-sm text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
                  {(data.marking ?? []).length} timed token(s)
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedPlace({ id, data: { ...data }, target: 'current' });
                    setIsTimedMarkingDialogOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            ) : (
              /* JSON/record marking: quick raw-text edit (pre-filled with the live value —
                 tweak a small part instead of retyping it) plus an Edit button opening the
                 same table-based dialog Initial Marking uses, so individual attributes can
                 be changed without hand-editing JSON. */
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    id="currentMarking"
                    value={currentMarkingInput}
                    placeholder="e.g., [1, 2, 3]"
                    onChange={(e) => setCurrentMarkingInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyCurrentMarking();
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={handleApplyCurrentMarking}
                    disabled={isApplyingMarking || currentMarkingInput.trim() === ''}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedPlace({ id, data: { ...data }, target: 'current' });
                      setIsRecordMarkingDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Overwrites this place&apos;s tokens right now (for testing/debugging) — doesn&apos;t change the initial marking above.
            </p>
          </div>
        </>
      )}

      {/* Port Type (available on subpage places) */}
      {isSubpage && (
        <>
          <Separator />
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="portType">Port Type</Label>
            <Select
              value={data.portType || '__none__'}
              onValueChange={(value) => {
                if (activePetriNetId) {
                  updateNodeData(activePetriNetId, id, {
                    ...data,
                    label: data.label || "",
                    isArcMode: data.isArcMode || false,
                    type: data.type || "place",
                    colorSet: data.colorSet || "",
                    initialMarking: data.initialMarking || "",
                    portType: value === '__none__' ? undefined : value as 'in' | 'out' | 'io',
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="in">In</SelectItem>
                <SelectItem value="out">Out</SelectItem>
                <SelectItem value="io">I/O</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Fusion Set */}
      <Separator />
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="fusionSet">Fusion Set</Label>
        <Select
          value={data.fusionSetId || '__none__'}
          onValueChange={(value) => {
            if (activePetriNetId) {
              updateNodeData(activePetriNetId, id, {
                ...data,
                label: data.label || "",
                isArcMode: data.isArcMode || false,
                type: data.type || "place",
                colorSet: data.colorSet || "",
                initialMarking: data.initialMarking || "",
                fusionSetId: value === '__none__' ? undefined : value,
              });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {fusionSets.map((fs) => (
              <SelectItem key={fs.id} value={fs.id}>
                <div className="flex items-center justify-between w-full">
                  <span>{fs.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1 mt-1">
          <Input
            id="newFusionSetName"
            value={newFusionSetName}
            onChange={(e) => setNewFusionSetName(e.target.value)}
            placeholder="New fusion set name"
            className="flex-1 h-7 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            disabled={!newFusionSetName.trim()}
            onClick={() => {
              const name = newFusionSetName.trim();
              if (!name) return;
              const newId = uuidv4();
              addFusionSet({ id: newId, name });
              setNewFusionSetName('');
              // Auto-assign this place to the new fusion set
              if (activePetriNetId) {
                updateNodeData(activePetriNetId, id, {
                  ...data,
                  label: data.label || "",
                  isArcMode: data.isArcMode || false,
                  type: data.type || "place",
                  colorSet: data.colorSet || "",
                  initialMarking: data.initialMarking || "",
                  fusionSetId: newId,
                });
              }
            }}
          >
            Create
          </Button>
        </div>
        {data.fusionSetId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-destructive hover:text-destructive mt-1"
            onClick={() => {
              if (data.fusionSetId) {
                deleteFusionSet(data.fusionSetId);
              }
            }}
          >
            Delete Fusion Set
          </Button>
        )}
      </div>

      {selectedPlace && (
        <>
          <RecordMarkingDialog
            open={isRecordMarkingDialogOpen}
            onOpenChange={(open) => {
              if (open) pauseUndo();
              else resumeUndo();
              setIsRecordMarkingDialogOpen(open);
            }}
            colorSetName={selectedPlace.data?.colorSet || ""}
            titleLabel={selectedPlace.target === 'current' ? 'Edit Current Marking' : undefined}
            attributes={getRecordAttributes(selectedPlace.data?.colorSet || "")}
            initialData={
              selectedPlace.target === 'current'
                ? (selectedPlace.data?.marking ?? []) as ParsedRecord[] | MultisetEntry[]
                : parseInitialMarking(selectedPlace.data?.initialMarking || "")
            }
            onSave={(records) => {
              const formattedMarking = formatRecordMarking(records);
              if (!selectedPlace) return;
              if (selectedPlace.target === 'current') {
                setCurrentMarkingInput(formattedMarking);
                simulationContext.setPlaceMarking(selectedPlace.id, formattedMarking);
              } else if (activePetriNetId) {
                updateNodeData(activePetriNetId, selectedPlace.id, {
                  label: selectedPlace.data.label || "",
                  isArcMode: selectedPlace.data.isArcMode || false,
                  type: selectedPlace.data.type || "place",
                  colorSet: selectedPlace.data.colorSet || "INT",
                  initialMarking: formattedMarking,
                  marking: records as unknown[]
                });
              }
            }}
          />
          <TimedMarkingDialog
            open={isTimedMarkingDialogOpen}
            onOpenChange={(open) => {
              if (open) pauseUndo();
              else resumeUndo();
              setIsTimedMarkingDialogOpen(open);
            }}
            colorSetName={selectedPlace.data?.colorSet || ""}
            titleLabel={selectedPlace.target === 'current' ? 'Edit Current Marking' : undefined}
            colorSetType={getColorSetBaseType()}
            recordAttributes={getRecordAttributes(selectedPlace.data?.colorSet || "")}
            initialData={
              selectedPlace.target === 'current'
                ? parseTimedMarking(JSON.stringify(selectedPlace.data?.marking ?? []))
                : parseTimedMarking(selectedPlace.data?.initialMarking || "")
            }
            onSave={(tokens) => {
              const formattedMarking = formatTimedMarking(tokens);
              if (!selectedPlace) return;
              if (selectedPlace.target === 'current') {
                setCurrentMarkingInput(formattedMarking);
                simulationContext.setPlaceMarking(selectedPlace.id, formattedMarking);
              } else if (activePetriNetId) {
                updateNodeData(activePetriNetId, selectedPlace.id, {
                  label: selectedPlace.data.label || "",
                  isArcMode: selectedPlace.data.isArcMode || false,
                  type: selectedPlace.data.type || "place",
                  colorSet: selectedPlace.data.colorSet || "INT",
                  initialMarking: formattedMarking,
                  marking: tokens as unknown[]
                });
              }
            }}
          />
        </>
      )}

    </div>
  );
};

export default PlaceProperties;

import type React from "react";
import useStore from '@/stores/store';
import { useState } from "react";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, GripVertical, Edit, ChevronDown, ChevronUp, Clock, TriangleAlert, Palette, Box, Tag, Layers, FunctionSquare, BookOpen, Shield, Plus } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AdvancedColorSetEditor } from "@/components/AdvancedColorSetEditor";
import { VariableEditor } from '@/components/VariableEditor';
import { PriorityEditor } from "@/components/PriorityEditor";
import { FunctionEditor } from "@/components/FunctionEditor";
import { UseEditor } from "@/components/UseEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

import { ColorSet, Variable, Priority, Function, Use, Value } from "@/declarations"
import type { UnaryDeclareConstraint, BinaryDeclareTemplate } from "@/types";
import type { TransitionNodeData } from "@/nodes/TransitionNode";

// A flat, cross-page view of every Declare constraint in the model (binary edges + unary badges)
interface DeclareConstraintOverviewItem {
  id: string;
  netId: string;
  name: string;
  enabled: boolean;
  elementType: 'node' | 'edge';
  /** For unary constraints only: the transition node the constraint is attached to */
  parentNodeId?: string;
}

function gatherDeclareOverview(petriNetsById: Record<string, { id: string; name: string; nodes: { id: string; type?: string; data?: Record<string, unknown> }[]; edges: { id: string; type?: string; source: string; target: string; data?: Record<string, unknown> }[] }>): DeclareConstraintOverviewItem[] {
  const items: DeclareConstraintOverviewItem[] = [];
  const labelOf = (netId: string, nodeId: string) =>
    (petriNetsById[netId]?.nodes.find((n) => n.id === nodeId)?.data?.label as string) || nodeId;

  for (const net of Object.values(petriNetsById)) {
    for (const edge of net.edges) {
      if (edge.type !== 'declare-constraint') continue;
      const template = (edge.data as { template?: BinaryDeclareTemplate })?.template ?? 'response';
      const enabled = (edge.data as { enabled?: boolean })?.enabled ?? true;
      items.push({
        id: edge.id,
        netId: net.id,
        name: `${template} — ${labelOf(net.id, edge.source)} → ${labelOf(net.id, edge.target)}`,
        enabled,
        elementType: 'edge',
      });
    }
    for (const node of net.nodes) {
      if (node.type !== 'transition') continue;
      const unary = (node.data as { declareUnary?: UnaryDeclareConstraint[] })?.declareUnary;
      if (!unary) continue;
      for (const c of unary) {
        items.push({
          id: c.id,
          netId: net.id,
          name: `${c.template} — ${labelOf(net.id, node.id)}`,
          enabled: c.enabled,
          elementType: 'node',
          parentNodeId: node.id,
        });
      }
    }
  }
  return items;
}

export function DeclarationManager() {
  const [isPrioritiesOpen, setIsPrioritiesOpen] = useState(false);
  const [isColorSetsOpen, setIsColorSetsOpen] = useState(false);
  const [isVariablesOpen, setIsVariablesOpen] = useState(false);
  const [isFunctionsOpen, setIsFunctionsOpen] = useState(false);
  const [isUsesOpen, setIsUsesOpen] = useState(false);
  const [isValuesOpen, setIsValuesOpen] = useState(false);
  const [isConstraintsOpen, setIsConstraintsOpen] = useState(false);

  const petriNetsById = useStore((state) => state.petriNetsById);
  const requestFocus = useStore((state) => state.requestFocus);
  const setEdgesAction = useStore((state) => state.setEdges);
  const updateNodeDataAction = useStore((state) => state.updateNodeData);
  const declareItems = gatherDeclareOverview(petriNetsById);

  const handleDeleteDeclareItem = (item: DeclareConstraintOverviewItem) => {
    const net = petriNetsById[item.netId];
    if (!net) return;
    if (item.elementType === 'edge') {
      setEdgesAction(item.netId, net.edges.filter((e) => e.id !== item.id));
    } else if (item.parentNodeId) {
      const node = net.nodes.find((n) => n.id === item.parentNodeId);
      if (!node) return;
      const declareUnary = ((node.data as { declareUnary?: UnaryDeclareConstraint[] }).declareUnary || [])
        .filter((c) => c.id !== item.id);
      updateNodeDataAction(item.netId, item.parentNodeId, { ...node.data, declareUnary } as TransitionNodeData);
    }
  };

  const colorSets = useStore((state) => state.colorSets);
  const setColorSets = useStore((state) => state.setColorSets);
  const onAddColorSet = useStore((state) => state.addColorSet);
  const onDeleteColorSet = useStore((state) => state.deleteColorSet);
  const renameColorSet = useStore((state) => state.renameColorSet);
  const variables = useStore((state) => state.variables);
  const setVariables = useStore((state) => state.setVariables);
  const onAddVariable = useStore((state) => state.addVariable);
  const onDeleteVariable = useStore((state) => state.deleteVariable);
  const priorities = useStore((state) => state.priorities);
  const setPriorities = useStore((state) => state.setPriorities);
  const onAddPriority = useStore((state) => state.addPriority);
  const onDeletePriority = useStore((state) => state.deletePriority);
  const functions = useStore((state) => state.functions);
  const setFunctions = useStore((state) => state.setFunctions);
  const onAddFunction = useStore((state) => state.addFunction);
  const onDeleteFunction = useStore((state) => state.deleteFunction);
  const uses = useStore((state) => state.uses);
  const setUses = useStore((state) => state.setUses);
  const onAddUse = useStore((state) => state.addUse);
  const onDeleteUse = useStore((state) => state.deleteUse);
  const values = useStore((state) => state.values);
  const onAddValue = useStore((state) => state.addValue);
  const onUpdateValue = useStore((state) => state.updateValue);
  const onDeleteValue = useStore((state) => state.deleteValue);

  const [newVariable, setNewVariable] = useState({ name: "", colorSet: "INT" })
  const [newPriority, setNewPriority] = useState({ name: "", level: 250 })
  const [selectedColorSet, setSelectedColorSet] = useState<ColorSet | undefined>(undefined);
  const [advancedEditorOpen, setAdvancedEditorOpen] = useState(false);

  const [selectedVariable, setSelectedVariable] = useState<Variable | undefined>(undefined);
  const [variableEditorOpen, setVariableEditorOpen] = useState(false);

  const [selectedPriority, setSelectedPriority] = useState<Priority | undefined>(undefined);
  const [priorityEditorOpen, setPriorityEditorOpen] = useState(false);

  const [selectedFunction, setSelectedFunction] = useState<Function | undefined>(undefined);
  const [functionEditorOpen, setFunctionEditorOpen] = useState(false);

  const [selectedUse, setSelectedUse] = useState<Use | undefined>(undefined);
  const [useEditorOpen, setUseEditorOpen] = useState(false);

  const [newValue, setNewValue] = useState({ name: "", expression: "" });
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingValueName, setEditingValueName] = useState("");
  const [editingValueExpression, setEditingValueExpression] = useState("");

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<ColorSet | Variable | Priority | Function | Use | null>(null)
  const [draggedType, setDraggedType] = useState<"colorSet" | "variable" | "priority" | "function" | "use" | null>(null)

  const handleAddVariable = () => {
    if (newVariable.name && newVariable.colorSet) {
      onAddVariable({
        name: newVariable.name,
        colorSet: newVariable.colorSet,
      })
      setNewVariable({ name: "", colorSet: "INT" })
    }
  }

  const handleAddPriority = () => {
    if (newPriority.name && newPriority.level) {
      onAddPriority({
        name: newPriority.name,
        level: Number(newPriority.level),
      })
      setNewPriority({ name: "", level: 100 })
    }
  }

  const handleAddValue = () => {
    if (newValue.name && newValue.expression) {
      onAddValue({
        name: newValue.name,
        expression: newValue.expression,
      });
      setNewValue({ name: "", expression: "" });
    }
  };

  const handleStartEditValue = (v: Value) => {
    setEditingValueId(v.id || null);
    setEditingValueName(v.name);
    setEditingValueExpression(v.expression);
  };

  const handleSaveEditValue = () => {
    if (editingValueId && editingValueName) {
      onUpdateValue(editingValueId, { name: editingValueName, expression: editingValueExpression });
      setEditingValueId(null);
    }
  };

  const handleCancelEditValue = () => {
    setEditingValueId(null);
  };

  const handleEditColorSet = (colorSet: ColorSet) => {
    setSelectedColorSet(colorSet)
    setAdvancedEditorOpen(true)
  }

  const handleEditVariable = (variable: Variable) => {
    setSelectedVariable(variable);
    setVariableEditorOpen(true);
  }

  const handleEditPriority = (priority: Priority) => {
    setSelectedPriority(priority);
    setPriorityEditorOpen(true);
  }

  const handleEditFunction = (func: Function) => {
    setSelectedFunction(func);
    setFunctionEditorOpen(true);
  }

  const handleSaveFunction = (func: Omit<Function, "id">) => {
    if (selectedFunction) {
      // Update existing function
      const updatedFunctions = functions.map((f) => (f.id === selectedFunction.id ? { ...f, ...func } : f));
      //onReorderFunctions(updatedFunctions)
      setFunctions(updatedFunctions);
    } else {
      // Add new function
      onAddFunction(func);
    }
    setFunctionEditorOpen(false);
    setSelectedFunction(undefined);
  };

  const handleEditUse = (use: Omit<Use, 'id'>) => {
    setSelectedUse(use);
    setUseEditorOpen(true);
  }

  const handleSaveUse = (use: Omit<Use, 'id'>) => {
    if (selectedUse) {
      // Update existing use
      const updatedUses = uses.map((u) => (u.id === selectedUse.id ? { ...u, ...use } : u));
      //onReorderUses(updatedUses)
      setUses(updatedUses);
    } else {
      // Add new use
      onAddUse(use);
    }
    setUseEditorOpen(false);
    setSelectedUse(undefined);
  }

  const handleSaveAdvancedColorSet = (colorSet: Omit<ColorSet, "id">) => {
    if (selectedColorSet) {
      // Check if name changed - if so, use renameColorSet to update all references
      if (selectedColorSet.name !== colorSet.name && selectedColorSet.id) {
        renameColorSet(selectedColorSet.id, colorSet.name);
      }
      // Update the color set with all other changes
      const updatedColorSets = colorSets.map((cs) => (cs.id === selectedColorSet.id ? { ...cs, ...colorSet } : cs))
      setColorSets(updatedColorSets);
    } else {
      // Add new color set
      onAddColorSet(colorSet)
    }
    setAdvancedEditorOpen(false)
    setSelectedColorSet(undefined)
  };

  const handleSaveVariable = (variable: Omit<Variable, "id">) => {
    if (selectedVariable) {
      // Update existing variable
      const updatedVariables = variables.map((v) => (v.id === selectedVariable.id ? { ...v, ...variable } : v));
      //onReorderVariables(updatedVariables)
      setVariables(updatedVariables);
    } else {
      // Add new variable
      onAddVariable(variable)
    }
    setVariableEditorOpen(false)
    setSelectedVariable(undefined)
  };

  const handleSavePriority = (priority: Omit<Priority, "id">) => {
    if (selectedPriority) {
      // Update existing priority
      const updatedPriorities = priorities.map((p) => (p.id === selectedPriority.id ? { ...p, ...priority } : p));
      //onReorderPriorities(updatedPriorities)
      setPriorities(updatedPriorities);
    } else {
      // Add new priority
      onAddPriority(priority)
    }
    setPriorityEditorOpen(false)
    setSelectedPriority(undefined)
  };

  // Drag handlers
  const handleDragStart = (
    e: React.DragEvent,
    item: ColorSet | Variable | Priority | Function | Use,
    type: "colorSet" | "variable" | "priority" | "function" | "use"
  ) => {
    setDraggedItem(item)
    setDraggedType(type)
    e.dataTransfer.effectAllowed = "move"
    // Required for Firefox
    e.dataTransfer.setData("text/plain", item.id ?? '');
  }

  const handleDragOver = (e: React.DragEvent, targetItem: ColorSet | Variable | Function | Use) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"

    if (draggedItem && draggedItem.id !== targetItem.id) {
      // Add visual feedback for the drop target
      const target = e.currentTarget as HTMLElement
      target.classList.add("bg-muted")
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement
    target.classList.remove("bg-muted")
  }

  const handleDrop = (e: React.DragEvent, targetItem: ColorSet | Variable | Function | Use) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("bg-muted");

    if (!draggedItem || !draggedType) return;

    if (draggedItem.id === targetItem.id) return;

    // Reorder the items
    if (draggedType === "colorSet") {
      const newOrder = [...colorSets];
      const draggedIndex = newOrder.findIndex((item) => item.id === draggedItem.id);
      const targetIndex = newOrder.findIndex((item) => item.id === targetItem.id);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedItem as ColorSet);
        setColorSets(newOrder);
      }
    } else if (draggedType === "variable") {
      const newOrder = [...variables];
      const draggedIndex = newOrder.findIndex((item) => item.id === draggedItem.id);
      const targetIndex = newOrder.findIndex((item) => item.id === targetItem.id);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedItem as Variable);
        setVariables(newOrder);
      }
    } else if (draggedType === "priority") {
      const newOrder = [...priorities];
      const draggedIndex = newOrder.findIndex((item) => item.id === draggedItem.id);
      const targetIndex = newOrder.findIndex((item) => item.id === targetItem.id);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedItem as Priority);
        setPriorities(newOrder);
      }
    } else if (draggedType === "function") {
      const newOrder = [...functions];
      const draggedIndex = newOrder.findIndex((item) => item.id === draggedItem.id);
      const targetIndex = newOrder.findIndex((item) => item.id === targetItem.id);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedItem as Function);
        setFunctions(newOrder);
      }
    }

    setDraggedItem(null);
    setDraggedType(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null)
    setDraggedType(null)
  }

  return (
    <div className="space-y-2">

      {/* Color Sets Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isColorSetsOpen} onOpenChange={setIsColorSetsOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Palette className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Color Sets{colorSets.length > 0 ? ` (${colorSets.length})` : ''}</span>
            {isColorSetsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              The token types a place can hold, e.g. numbers, strings, or structured records.
            </p>
            <div className="space-y-2">
              {colorSets.map((cs) => (
                <div
                  key={cs.id}
                  className="border rounded-md bg-muted/20 transition-colors overflow-hidden"
                  draggable
                  onDragStart={(e) => handleDragStart(e, cs, "colorSet")}
                  onDragOver={(e) => handleDragOver(e, cs)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, cs)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 self-stretch flex-shrink-0"
                        style={{ backgroundColor: cs.color || "#3b82f6" }}
                      />
                      <div className="cursor-grab active:cursor-grabbing py-3">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="font-mono text-sm py-3">
                        {cs.definition.replace(/^colset\s+/i, '').replace(/;$/, '')}
                      </div>
                    </div>
                    <div className="flex items-center pr-1">
                      {cs.timed && (
                        <span title="Timed color set" className="mr-1">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                      )}
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditColorSet(cs)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => cs.id && onDeleteColorSet(cs.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={advancedEditorOpen} onOpenChange={setAdvancedEditorOpen}>
              <DialogTrigger asChild>
                <Button
                  className="w-full border-dashed text-primary hover:text-primary"
                  variant="outline"
                  onClick={() => {
                    setSelectedColorSet(undefined)
                    setAdvancedEditorOpen(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create New Color Set
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>
                    {selectedColorSet ? `Edit Color Set: ${selectedColorSet.name}` : "Create New Color Set"}
                  </DialogTitle>
                </DialogHeader>
                <AdvancedColorSetEditor
                  colorSet={selectedColorSet}
                  existingColorSets={colorSets}
                  onSave={handleSaveAdvancedColorSet}
                />
              </DialogContent>
            </Dialog>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Variables Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isVariablesOpen} onOpenChange={setIsVariablesOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Box className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Variables{variables.length > 0 ? ` (${variables.length})` : ''}</span>
            {isVariablesOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Typed placeholders usable in guards, arc inscriptions, and code segments.
            </p>
            <div className="space-y-2">
              {variables.map((v) => {
                const varColorSet = colorSets.find((cs) => cs.name === v.colorSet);
                return (
                <div
                  key={v.id}
                  className="border rounded-md bg-muted/20 transition-colors overflow-hidden"
                  draggable
                  onDragStart={(e) => handleDragStart(e, v, "variable")}
                  onDragOver={(e) => handleDragOver(e, v)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, v)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 self-stretch flex-shrink-0"
                        style={{ backgroundColor: varColorSet?.color || "#3b82f6" }}
                      />
                      <div className="cursor-grab active:cursor-grabbing py-3">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="font-mono text-sm py-3">
                        var {v.name}: {v.colorSet};
                      </div>
                    </div>
                    <div className="flex items-center pr-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditVariable(v)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => v.id && onDeleteVariable(v.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Name (e.g., n)"
                className="flex-1"
                value={newVariable.name}
                onChange={(e) => setNewVariable({ ...newVariable, name: e.target.value })}
              /> :
              <Select
                value={newVariable.colorSet}
                onValueChange={(value) => setNewVariable({ ...newVariable, colorSet: value })}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Color Set" />
                </SelectTrigger>
                <SelectContent>
                  {colorSets.map((cs) => (
                    <SelectItem key={cs.id} value={cs.name}>
                      {cs.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button size="sm" variant="outline" onClick={handleAddVariable}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Variable
            </Button>

            <Dialog open={variableEditorOpen} onOpenChange={setVariableEditorOpen}>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>
                    {selectedVariable ? `Edit Variable: ${selectedVariable.name}` : "Create New Variable"}
                  </DialogTitle>
                </DialogHeader>
                <VariableEditor
                  variable={selectedVariable}
                  existingColorSets={colorSets}
                  onSave={handleSaveVariable}
                />
              </DialogContent>
            </Dialog>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Values Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isValuesOpen} onOpenChange={setIsValuesOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Tag className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Values{values.length > 0 ? ` (${values.length})` : ''}</span>
            {isValuesOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Named constants usable in expressions throughout the model.
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {values.map((v) => (
                <div
                  key={v.id}
                  className="border rounded-md p-3 bg-muted/20 transition-colors"
                >
                  {editingValueId === v.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          className="flex-1 font-mono text-sm"
                          value={editingValueName}
                          onChange={(e) => setEditingValueName(e.target.value)}
                          placeholder="Name"
                        />
                        <span className="text-muted-foreground">=</span>
                        <Input
                          className="flex-1 font-mono text-sm"
                          value={editingValueExpression}
                          onChange={(e) => setEditingValueExpression(e.target.value)}
                          placeholder="Expression"
                        />
                      </div>
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" onClick={handleCancelEditValue}>Cancel</Button>
                        <Button size="sm" onClick={handleSaveEditValue}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <div className="font-mono text-sm">
                        val {v.name} = {v.expression}
                      </div>
                      <div className="flex items-center">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleStartEditValue(v)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => v.id && onDeleteValue(v.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Name (e.g., ds)"
                className="flex-1"
                value={newValue.name}
                onChange={(e) => setNewValue({ ...newValue, name: e.target.value })}
              />
              <span className="text-muted-foreground">=</span>
              <Input
                placeholder="Expression (e.g., 10)"
                className="flex-1"
                value={newValue.expression}
                onChange={(e) => setNewValue({ ...newValue, expression: e.target.value })}
              />
            </div>

            <Button size="sm" variant="outline" onClick={handleAddValue}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Value
            </Button>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Priorities Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isPrioritiesOpen} onOpenChange={setIsPrioritiesOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Layers className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Priorities{priorities.length > 0 ? ` (${priorities.length})` : ''}</span>
            {isPrioritiesOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3 mb-8">
            <p className="text-xs text-muted-foreground">
              Named levels controlling which enabled transition fires first (lower = higher priority).
            </p>
            <div className="space-y-2">
              {priorities
                .slice()
                .sort((a, b) => a.level - b.level) // Sort by level ascending
                .map((p) => (
                  <div
                    key={p.id}
                    className="border rounded-md p-3 bg-muted/20 transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-sm">
                          {p.name} = {p.level}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditPriority(p)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => p.id && onDeletePriority(p.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Name (e.g., P_MEDIUM)"
                className="flex-1"
                value={newPriority.name}
                onChange={(e) => setNewPriority({ ...newPriority, name: e.target.value })}
              />
              <Input
                type="number"
                placeholder="Level (e.g., 250)"
                className="w-[120px]"
                value={newPriority.level || ""}
                onChange={(e) => setNewPriority({ ...newPriority, level: Number.parseInt(e.target.value) || 0 })}
              />
            </div>

            <Button size="sm" variant="outline" onClick={handleAddPriority}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Priority
            </Button>

            <Dialog open={priorityEditorOpen} onOpenChange={setPriorityEditorOpen}>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>
                    {selectedPriority ? `Edit Priority: ${selectedPriority.name}` : "Create New Priority"}
                  </DialogTitle>
                </DialogHeader>
                <PriorityEditor
                  priority={selectedPriority}
                  onSave={handleSavePriority}
                />
              </DialogContent>
            </Dialog>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Functions Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isFunctionsOpen} onOpenChange={setIsFunctionsOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <FunctionSquare className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Functions{functions.length > 0 ? ` (${functions.length})` : ''}</span>
            {functions.some((f) => f.code.startsWith('// SML (needs manual translation):')) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <TriangleAlert className="h-4 w-4 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Some functions could not be auto-translated from SML and need manual translation to Rhai.</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isFunctionsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Reusable Rhai functions callable from guards, arc inscriptions, and code segments.
            </p>
            <div className="space-y-2">
              {functions.map((f) => (
                <div
                  key={f.id}
                  className="border rounded-md p-3 bg-muted/20 transition-colors"
                  draggable
                  onDragStart={(e) => handleDragStart(e, f, "function")}
                  onDragOver={(e) => handleDragOver(e, f)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, f)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="cursor-grab active:cursor-grabbing">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="font-mono text-sm">
                        fn {f.name}
                      </div>
                      {f.code.startsWith('// SML (needs manual translation):') && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>This function could not be auto-translated from SML to Rhai. Manual translation is needed.</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="flex items-center">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditFunction(f)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => f.id && onDeleteFunction(f.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={functionEditorOpen} onOpenChange={setFunctionEditorOpen}>
              <DialogTrigger asChild>
                <Button
                  className="w-full border-dashed text-primary hover:text-primary"
                  variant="outline"
                  onClick={() => setSelectedFunction(undefined)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create New Function
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>
                    {selectedFunction ? `Edit Function: ${selectedFunction.name}` : "Create New Function"}
                  </DialogTitle>
                </DialogHeader>
                <FunctionEditor
                  existingFunction={selectedFunction}
                  onSave={handleSaveFunction}
                />
              </DialogContent>
            </Dialog>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Use Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isUsesOpen} onOpenChange={setIsUsesOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Libraries{uses.length > 0 ? ` (${uses.length})` : ''}</span>
            {isUsesOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              External Rhai script files imported into this model.
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {uses.map((use) => (
                <div
                  key={use.id}
                  className="border rounded-md p-3 bg-muted/20 transition-colors"
                  draggable
                  onDragStart={(e) => handleDragStart(e, use, "use")}
                  onDragOver={(e) => handleDragOver(e, use)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, use)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="cursor-grab active:cursor-grabbing">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="font-mono text-sm">use "{use.name}";</div>
                    </div>
                    <div className="flex items-center">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditUse(use)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => use.id && onDeleteUse(use.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={useEditorOpen} onOpenChange={setUseEditorOpen}>
              <DialogTrigger asChild>
                <Button className="w-full border-dashed text-primary hover:text-primary" variant="outline" onClick={() => setSelectedUse(undefined)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add External Library
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>{selectedUse ? "Edit External Library" : "Add External Library"}</DialogTitle>
                </DialogHeader>
                <UseEditor
                  existingUse={selectedUse}
                  onSave={handleSaveUse} />
              </DialogContent>
            </Dialog>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Constraints Section (Declare) */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isConstraintsOpen} onOpenChange={setIsConstraintsOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Shield className="h-4 w-4" />
            </span>
            <span className="font-bold flex-1">Constraints{declareItems.length > 0 ? ` (${declareItems.length})` : ''}</span>
            {isConstraintsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Behavioral rules — e.g. &quot;B must eventually follow A&quot; — enforced during simulation.
            </p>
            {declareItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No Declare constraints yet. Draw one from the constraint tool in the canvas toolbar.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {declareItems.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-md p-2 bg-muted/20 transition-colors flex items-center justify-between gap-2"
                  >
                    <button
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      onClick={() => requestFocus({
                        netId: item.netId,
                        elementId: item.elementType === 'edge' ? item.id : (item.parentNodeId || item.id),
                        elementType: item.elementType,
                        field: item.elementType === 'node' ? 'declareUnary' : undefined,
                      })}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.enabled ? '#15803d' : '#9ca3af' }}
                        title={item.enabled ? 'Enabled' : 'Disabled'}
                      />
                      <span className="font-mono text-xs truncate" title={item.name}>{item.name}</span>
                    </button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => handleDeleteDeclareItem(item)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

    </div>
  )
}


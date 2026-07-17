import useStore from '@/stores/store';
import { pauseUndo, resumeUndo } from '@/stores/store';
import { useShallow } from 'zustand/react/shallow';

import { Label } from "@/components/ui/label";
import { UndoableInput as Input } from "@/components/ui/undoable-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { Priority } from "@/declarations";
import type { TransitionNodeData } from '@/nodes/TransitionNode';

/** Returns the shared value across all nodes for a field, or undefined if they differ. */
function commonValue<T>(dataList: Record<string, unknown>[], key: string): T | undefined {
  if (dataList.length === 0) return undefined;
  const first = dataList[0][key];
  return dataList.every((d) => d[key] === first) ? (first as T) : undefined;
}

const TransitionBatchProperties = ({ nodeIds, priorities }: { nodeIds: string[]; priorities: Priority[] }) => {
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const updateNodeData = useStore((state) => state.updateNodeData);
  // useShallow avoids an infinite render loop: `.filter()` returns a new array wrapper on
  // every store read, but the node object references inside stay stable unless that node's
  // own data changed, so shallow (element-wise) comparison settles correctly.
  const nodes = useStore(useShallow((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return (petriNet?.nodes ?? []).filter((n) => n.type === 'transition' && nodeIds.includes(n.id));
  }));

  if (nodes.length < 2 || !activePetriNetId) return null;

  const dataList = nodes.map((n) => n.data as unknown as Record<string, unknown>);
  const applyToAll = (patch: Partial<TransitionNodeData>) => {
    pauseUndo();
    for (const n of nodes) {
      updateNodeData(activePetriNetId, n.id, { ...(n.data as unknown as TransitionNodeData), ...patch });
    }
    resumeUndo();
  };

  const commonOverrideColor = commonValue<string | undefined>(dataList, 'overrideColor');
  // `commonValue` returns undefined both when values genuinely differ AND when they're all
  // undefined (the normal "no override set" state) — distinguish those explicitly so we
  // don't flag a shared "unset" state as mixed.
  const overrideColorMixed = commonOverrideColor === undefined && !dataList.every((d) => !d.overrideColor);
  const commonPriority = commonValue<string | undefined>(dataList, 'priority');
  const priorityIsCustom = commonPriority !== undefined && commonPriority !== '' && !priorities.some((p) => p.name === commonPriority);
  const priorityMixed = commonPriority === undefined && !dataList.every((d) => !d.priority);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Editing a field here applies it to all {nodes.length} selected transitions.
      </p>

      <div className="flex items-center gap-2">
        <Label htmlFor="batch-overrideColor" className="text-sm">Color</Label>
        <input
          type="color"
          id="batch-overrideColor"
          value={commonOverrideColor || '#000000'}
          onChange={(e) => applyToAll({ overrideColor: e.target.value === '#000000' ? undefined : e.target.value })}
          className="w-6 h-6 rounded border cursor-pointer"
        />
        {overrideColorMixed && (
          <span className="text-xs text-muted-foreground">(mixed)</span>
        )}
      </div>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="batch-priority">Priority</Label>
        <Select
          value={priorityMixed ? '' : priorityIsCustom ? 'CUSTOM' : (commonPriority || 'NONE')}
          onValueChange={(value) => {
            applyToAll({
              priority: value === 'NONE' ? undefined : value === 'CUSTOM' ? '' : value,
            });
          }}
        >
          <SelectTrigger id="batch-priority">
            <SelectValue placeholder="Mixed values" />
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
        {priorityIsCustom && (
          <Input
            type="number"
            placeholder="Priority level (lower = higher priority)"
            value={commonPriority}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const val = e.target.value.trim();
              applyToAll({ priority: val === '' ? undefined : val });
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TransitionBatchProperties;

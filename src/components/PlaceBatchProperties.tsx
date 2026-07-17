import useStore from '@/stores/store';
import { pauseUndo, resumeUndo } from '@/stores/store';
import { useShallow } from 'zustand/react/shallow';

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

import { ColorSet } from '@/declarations';
import type { PlaceNodeData } from '@/nodes/PlaceNode';

/** Returns the shared value across all nodes for a field, or undefined if they differ. */
function commonValue<T>(dataList: Record<string, unknown>[], key: string): T | undefined {
  if (dataList.length === 0) return undefined;
  const first = dataList[0][key];
  return dataList.every((d) => d[key] === first) ? (first as T) : undefined;
}

const PlaceBatchProperties = ({ nodeIds, colorSets }: { nodeIds: string[]; colorSets: ColorSet[] }) => {
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const updateNodeData = useStore((state) => state.updateNodeData);
  const fusionSets = useStore((state) => state.fusionSets);
  const isSubpage = useStore((state) => state.petriNetOrder[0] !== state.activePetriNetId);
  // useShallow is essential here: `.filter()` returns a new array wrapper on every store
  // read, and without shallow comparison that would be treated as "always changed",
  // causing an infinite render loop (each render re-subscribes to an "always different"
  // value). The individual node object references inside are stable unless that node's
  // own data actually changed, so shallow (element-wise) comparison settles correctly.
  const nodes = useStore(useShallow((state) => {
    const petriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return (petriNet?.nodes ?? []).filter((n) => n.type === 'place' && nodeIds.includes(n.id));
  }));

  if (nodes.length < 2 || !activePetriNetId) return null;

  const dataList = nodes.map((n) => n.data as unknown as Record<string, unknown>);
  const applyToAll = (patch: Partial<PlaceNodeData>) => {
    pauseUndo();
    for (const n of nodes) {
      updateNodeData(activePetriNetId, n.id, { ...(n.data as unknown as PlaceNodeData), ...patch });
    }
    resumeUndo();
  };

  const commonColorSet = commonValue<string>(dataList, 'colorSet');
  const commonOverrideColor = commonValue<string | undefined>(dataList, 'overrideColor');
  const overrideColorMixed = commonOverrideColor === undefined && !dataList.every((d) => !d.overrideColor);
  const commonPortType = commonValue<string | undefined>(dataList, 'portType');
  const commonFusionSetId = commonValue<string | undefined>(dataList, 'fusionSetId');

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Editing a field here applies it to all {nodes.length} selected places.
      </p>

      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="batch-colorSet">Color Set</Label>
        <Select
          value={commonColorSet ?? ''}
          onValueChange={(value) => applyToAll({ colorSet: value })}
        >
          <SelectTrigger id="batch-colorSet">
            <SelectValue placeholder="Mixed values" />
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
          id="batch-overrideColor"
          checked={overrideColorMixed ? 'indeterminate' : !!commonOverrideColor}
          onCheckedChange={(checked) => {
            if (checked) {
              // Use the first selected place's own colorset color as the shared starting point.
              const colorSetObj = colorSets.find((cs) => cs.name === (nodes[0].data as unknown as PlaceNodeData).colorSet);
              applyToAll({ overrideColor: colorSetObj?.color || '#000000' });
            } else {
              applyToAll({ overrideColor: undefined });
            }
          }}
        />
        <Label htmlFor="batch-overrideColor" className="text-sm">
          Override color{overrideColorMixed ? ' (mixed)' : ''}
        </Label>
        {commonOverrideColor && (
          <input
            type="color"
            value={commonOverrideColor}
            onChange={(e) => applyToAll({ overrideColor: e.target.value })}
            className="w-6 h-6 rounded border cursor-pointer"
          />
        )}
      </div>

      {isSubpage && (
        <>
          <Separator />
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="batch-portType">Port Type</Label>
            <Select
              value={commonPortType ?? '__none__'}
              onValueChange={(value) => applyToAll({ portType: value === '__none__' ? undefined : value as 'in' | 'out' | 'io' })}
            >
              <SelectTrigger id="batch-portType">
                <SelectValue placeholder="Mixed values" />
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

      <Separator />
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="batch-fusionSet">Fusion Set</Label>
        <Select
          value={commonFusionSetId ?? '__none__'}
          onValueChange={(value) => applyToAll({ fusionSetId: value === '__none__' ? undefined : value })}
        >
          <SelectTrigger id="batch-fusionSet">
            <SelectValue placeholder="Mixed values" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {fusionSets.map((fs) => (
              <SelectItem key={fs.id} value={fs.id}>
                {fs.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default PlaceBatchProperties;

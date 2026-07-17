import type { ReactNode } from 'react';
import useStore from '@/stores/store';
import { useSimulationContext } from '@/context/useSimulationContextHook';
import type { BinaryDeclareTemplate } from '@/types';

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A transition name, rendered bold inline within a constraint's explanatory sentence. */
const T = ({ children }: { children: string }) => <strong className="font-semibold text-foreground">{children}</strong>;

// Each description names its source/target transitions directly (rather than listing them
// separately below), phrased as "the transition X" so it reads as a sentence, not a diagram.
const TEMPLATE_DESCRIPTIONS: Record<BinaryDeclareTemplate, (source: string, target: string) => ReactNode> = {
  response: (s, t) => <>If the transition <T>{s}</T> fires, the transition <T>{t}</T> must eventually fire afterward.</>,
  precedence: (s, t) => <>The transition <T>{t}</T> may only fire if the transition <T>{s}</T> has fired at least once before.</>,
  succession: (s, t) => <>If the transition <T>{s}</T> fires, the transition <T>{t}</T> must eventually fire afterward — and the transition <T>{t}</T> may only fire once the transition <T>{s}</T> has already fired.</>,
  'alternate-response': (s, t) => <>If the transition <T>{s}</T> fires, the transition <T>{t}</T> must eventually fire afterward, and the transition <T>{s}</T> cannot fire again until the transition <T>{t}</T> does.</>,
  'alternate-precedence': (s, t) => <>The transition <T>{t}</T> may only fire if the transition <T>{s}</T> has fired since the last firing of the transition <T>{t}</T> — a single firing of <T>{s}</T> cannot satisfy more than one firing of <T>{t}</T>.</>,
  'alternate-succession': (s, t) => <>The transition <T>{s}</T> and the transition <T>{t}</T> must alternate: after the transition <T>{s}</T> fires, the transition <T>{t}</T> must fire before the transition <T>{s}</T> fires again, and each firing of the transition <T>{t}</T> needs a fresh firing of the transition <T>{s}</T> since the last one.</>,
  'chain-response': (s, t) => <>The transition <T>{t}</T> must be the very next transition to fire after the transition <T>{s}</T>, system-wide.</>,
  'chain-precedence': (s, t) => <>The transition <T>{s}</T> must be the transition that fired immediately before the transition <T>{t}</T>, system-wide.</>,
  'chain-succession': (s, t) => <>Whenever the transition <T>{s}</T> fires, the transition <T>{t}</T> must be the very next transition to fire system-wide — and whenever the transition <T>{t}</T> fires, the transition <T>{s}</T> must have fired immediately before it.</>,
  'responded-existence': (s, t) => <>If the transition <T>{s}</T> fires, the transition <T>{t}</T> must fire too — in either order.</>,
  'co-existence': (s, t) => <>The transition <T>{s}</T> fires if and only if the transition <T>{t}</T> fires.</>,
  choice: (s, t) => <>At least one of the transition <T>{s}</T> or the transition <T>{t}</T> must fire.</>,
  'exclusive-choice': (s, t) => <>Exactly one of the transition <T>{s}</T> or the transition <T>{t}</T> must fire, never both.</>,
  'not-succession': (s, t) => <>Once the transition <T>{s}</T> fires, the transition <T>{t}</T> may never fire afterward.</>,
  'not-coexistence': (s, t) => <>The transition <T>{s}</T> and the transition <T>{t}</T> must never both fire in the same run.</>,
  'not-chain-succession': (s, t) => <>The transition <T>{t}</T> may never fire as the immediate next event after the transition <T>{s}</T> (but may fire later).</>,
};

const TEMPLATE_LABELS: Record<BinaryDeclareTemplate, string> = {
  response: 'Response',
  precedence: 'Precedence',
  succession: 'Succession',
  'alternate-response': 'Alternate Response',
  'alternate-precedence': 'Alternate Precedence',
  'alternate-succession': 'Alternate Succession',
  'chain-response': 'Chain Response',
  'chain-precedence': 'Chain Precedence',
  'chain-succession': 'Chain Succession',
  'responded-existence': 'Responded Existence',
  'co-existence': 'Co-Existence',
  choice: 'Choice',
  'exclusive-choice': 'Exclusive Choice',
  'not-succession': 'Not Succession',
  'not-coexistence': 'Not Coexistence',
  'not-chain-succession': 'Not Chain Succession',
};

const TEMPLATE_GROUPS: { label: string; templates: BinaryDeclareTemplate[] }[] = [
  { label: 'Ordering', templates: ['response', 'precedence', 'succession', 'alternate-response', 'alternate-precedence', 'alternate-succession', 'chain-response', 'chain-precedence', 'chain-succession'] },
  { label: 'Existence', templates: ['responded-existence', 'co-existence', 'choice', 'exclusive-choice'] },
  { label: 'Negation', templates: ['not-succession', 'not-coexistence', 'not-chain-succession'] },
];

const DeclareConstraintProperties = () => {
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const petriNetsById = useStore((state) => state.petriNetsById);
  const selectedElement = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return activePetriNet?.selectedElement;
  });
  const updateEdgeData = useStore((state) => state.updateEdgeData);
  const { declareResults } = useSimulationContext();

  if (!selectedElement || selectedElement.type !== 'edge' || selectedElement.element.type !== 'declare-constraint') {
    return null;
  }

  const { id, source, target, data } = selectedElement.element;
  const template: BinaryDeclareTemplate = (data as { template?: BinaryDeclareTemplate })?.template ?? 'response';
  const enabled = (data as { enabled?: boolean })?.enabled ?? true;

  const getNodeName = (nodeId: string): string => {
    if (!activePetriNetId) return nodeId;
    const node = petriNetsById[activePetriNetId]?.nodes.find((n) => n.id === nodeId);
    return (node?.data?.label as string) || nodeId;
  };

  const liveResult = declareResults.find((r) => r.constraintId === id);

  return (
    <div className="space-y-4">
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="declareTemplate">Template</Label>
        <Select
          value={template}
          onValueChange={(value) => {
            if (activePetriNetId) {
              updateEdgeData(activePetriNetId, id, { template: value as BinaryDeclareTemplate });
            }
          }}
        >
          <SelectTrigger id="declareTemplate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.templates.map((t) => (
                  <SelectItem key={t} value={t}>{TEMPLATE_LABELS[t]}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{TEMPLATE_DESCRIPTIONS[template](getNodeName(source), getNodeName(target))}</p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="declareEnabled"
          checked={enabled}
          onCheckedChange={(checked) => {
            if (activePetriNetId) {
              updateEdgeData(activePetriNetId, id, { enabled: checked === true });
            }
          }}
        />
        <Label htmlFor="declareEnabled" className="text-sm">Enabled</Label>
      </div>

      {liveResult && (
        <div className="grid w-full items-center gap-1.5">
          <Label>Live State</Label>
          <p className={`text-sm font-medium ${liveResult.state === 'satisfied' ? 'text-green-600' : 'text-amber-600'}`}>
            {liveResult.state === 'satisfied' ? 'Satisfied' : 'Pending'}
            {liveResult.activationCount > 0 && ` · activated ${liveResult.activationCount}×`}
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        While simulating, the target transition is blocked from firing whenever it would break this constraint —
        violations are prevented rather than flagged, matching CPN Tools&apos; Declare plugin.
      </p>
    </div>
  );
};

export default DeclareConstraintProperties;

import { useState, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import useStore from '@/stores/store';
import type { Monitor, MonitorType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AddMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editMonitor?: Monitor; // If provided, edit instead of create
}

const MONITOR_TYPES: { value: MonitorType; label: string; description: string }[] = [
  { value: 'marking-size', label: 'Marking Size', description: 'Track token count on selected places' },
  { value: 'transition-count', label: 'Transition Count', description: 'Count firings of selected transitions' },
  { value: 'breakpoint-place', label: 'Place Breakpoint', description: 'Stop when place meets condition' },
  { value: 'breakpoint-transition', label: 'Transition Breakpoint', description: 'Stop when transition fires' },
  { value: 'data-collector', label: 'Data Collector', description: 'Custom Rhai script to observe data' },
  { value: 'interval-duration', label: 'Duration', description: 'Measure time between start/end transitions' },
];

export function AddMonitorDialog({ open, onOpenChange, editMonitor }: AddMonitorDialogProps) {
  const petriNetsById = useStore((state) => state.petriNetsById);
  const petriNetOrder = useStore((state) => state.petriNetOrder);
  const addMonitor = useStore((state) => state.addMonitor);
  const updateMonitor = useStore((state) => state.updateMonitor);

  const [name, setName] = useState(editMonitor?.name ?? '');
  const [type, setType] = useState<MonitorType>(editMonitor?.type ?? 'marking-size');
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(
    new Set(editMonitor?.placeIds ?? []),
  );
  const [selectedTransitionIds, setSelectedTransitionIds] = useState<Set<string>>(
    new Set(editMonitor?.transitionIds ?? []),
  );
  const [stopCondition, setStopCondition] = useState<string>(
    editMonitor?.config.stopCondition ?? 'empty',
  );
  const [observationScript, setObservationScript] = useState<string>(
    editMonitor?.observationScript ?? '',
  );
  const [predicateScript, setPredicateScript] = useState<string>(
    editMonitor?.predicateScript ?? '',
  );
  const [startTransitionId, setStartTransitionId] = useState<string>(
    editMonitor?.config.startTransitionId ?? '',
  );
  const [endTransitionId, setEndTransitionId] = useState<string>(
    editMonitor?.config.endTransitionId ?? '',
  );
  const [correlationKey, setCorrelationKey] = useState<string>(
    editMonitor?.config.correlationKey ?? 'ac.id',
  );

  // Collect all places and transitions across all nets
  const { places, transitions } = useMemo(() => {
    const places: { id: string; label: string; netName: string }[] = [];
    const transitions: { id: string; label: string; netName: string }[] = [];

    for (const netId of petriNetOrder) {
      const net = petriNetsById[netId];
      if (!net) continue;
      for (const node of net.nodes) {
        if (node.type === 'place') {
          places.push({
            id: node.id,
            label: (node.data?.label as string) || node.id,
            netName: net.name,
          });
        } else if (node.type === 'transition') {
          transitions.push({
            id: node.id,
            label: (node.data?.label as string) || node.id,
            netName: net.name,
          });
        }
      }
    }

    return { places, transitions };
  }, [petriNetsById, petriNetOrder]);

  const needsPlaces = type === 'marking-size' || type === 'breakpoint-place';
  const needsTransitions = type === 'transition-count' || type === 'breakpoint-transition';
  const needsStopCondition = type === 'breakpoint-place' || type === 'breakpoint-transition';
  const needsScripts = type === 'data-collector';
  const needsDurationConfig = type === 'interval-duration';

  const togglePlace = (id: string) => {
    setSelectedPlaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTransition = (id: string) => {
    setSelectedTransitionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    const monitor: Monitor = {
      id: editMonitor?.id ?? uuidv4(),
      name: name.trim() || `Monitor ${Date.now()}`,
      type,
      enabled: editMonitor?.enabled ?? true,
      placeIds: Array.from(selectedPlaceIds),
      transitionIds: Array.from(selectedTransitionIds),
      config: {
        stopCondition: needsStopCondition
          ? (stopCondition as Monitor['config']['stopCondition'])
          : undefined,
        startTransitionId: needsDurationConfig ? startTransitionId : undefined,
        endTransitionId: needsDurationConfig ? endTransitionId : undefined,
        correlationKey: needsDurationConfig ? correlationKey.trim() : undefined,
      },
      observationScript: needsScripts ? observationScript : undefined,
      predicateScript: needsScripts && predicateScript.trim() ? predicateScript : undefined,
    };

    if (editMonitor) {
      updateMonitor(editMonitor.id, monitor);
    } else {
      addMonitor(monitor);
    }

    onOpenChange(false);
    // Reset
    setName('');
    setType('marking-size');
    setSelectedPlaceIds(new Set());
    setSelectedTransitionIds(new Set());
    setStopCondition('empty');
    setObservationScript('');
    setPredicateScript('');
    setStartTransitionId('');
    setEndTransitionId('');
    setCorrelationKey('ac.id');
  };

  const isValid =
    name.trim().length > 0 &&
    ((needsPlaces && selectedPlaceIds.size > 0) ||
      (needsTransitions && selectedTransitionIds.size > 0) ||
      (needsScripts && observationScript.trim().length > 0) ||
      (needsDurationConfig && startTransitionId && endTransitionId && correlationKey.trim().length > 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editMonitor ? 'Edit Monitor' : 'Add Monitor'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="monitor-name">Name</Label>
            <Input
              id="monitor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Queue Size"
            />
          </div>

          {/* Type */}
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as MonitorType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONITOR_TYPES.map((mt) => (
                  <SelectItem key={mt.value} value={mt.value}>
                    <span className="font-medium">{mt.label}</span>
                    <span className="text-muted-foreground text-xs ml-2">{mt.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Place selection */}
          {needsPlaces && (
            <div className="space-y-1">
              <Label>Watched Places</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-auto space-y-1">
                {places.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No places in model</p>
                ) : (
                  places.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 py-0.5"
                    >
                      <Checkbox
                        checked={selectedPlaceIds.has(p.id)}
                        onCheckedChange={() => togglePlace(p.id)}
                      />
                      <span>{p.label}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{p.netName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Transition selection */}
          {needsTransitions && (
            <div className="space-y-1">
              <Label>Watched Transitions</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-auto space-y-1">
                {transitions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No transitions in model</p>
                ) : (
                  transitions.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 py-0.5"
                    >
                      <Checkbox
                        checked={selectedTransitionIds.has(t.id)}
                        onCheckedChange={() => toggleTransition(t.id)}
                      />
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{t.netName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Stop condition for breakpoints */}
          {needsStopCondition && (
            <div className="space-y-1">
              <Label>Stop Condition</Label>
              <Select value={stopCondition} onValueChange={setStopCondition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {type === 'breakpoint-place' ? (
                    <>
                      <SelectItem value="empty">Place becomes empty</SelectItem>
                      <SelectItem value="not-empty">Place becomes non-empty</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="enabled">Transition fires</SelectItem>
                      <SelectItem value="not-enabled">Transition becomes disabled</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {needsDurationConfig && (
            <>
              <div className="space-y-1">
                <Label>Start Transition</Label>
                <Select value={startTransitionId} onValueChange={setStartTransitionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select start transition" />
                  </SelectTrigger>
                  <SelectContent>
                    {transitions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-medium">{t.label}</span>
                        <span className="text-muted-foreground text-xs ml-2">{t.netName}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>End Transition</Label>
                <Select value={endTransitionId} onValueChange={setEndTransitionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select end transition" />
                  </SelectTrigger>
                  <SelectContent>
                    {transitions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-medium">{t.label}</span>
                        <span className="text-muted-foreground text-xs ml-2">{t.netName}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="correlation-key">Correlation Key (Rhai)</Label>
                <p className="text-xs text-muted-foreground">
                  Expression evaluated on both firings to pair start and end events, e.g. <code>ac.id</code>.
                </p>
                <Input
                  id="correlation-key"
                  value={correlationKey}
                  onChange={(e) => setCorrelationKey(e.target.value)}
                  placeholder="ac.id"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          {/* Rhai script editors for DataCollector monitors */}
          {needsScripts && (
            <>
              <div className="space-y-1">
                <Label htmlFor="observation-script">Observation Script (Rhai)</Label>
                <p className="text-xs text-muted-foreground">
                  Must return a numeric value. Available variables: <code>step</code>, <code>time</code>,{' '}
                  <code>transition_id</code>, <code>transition_name</code>, <code>markings</code> (map: place_id → count),
                  plus all binding variables.
                </p>
                <textarea
                  id="observation-script"
                  className="w-full h-20 rounded-md border bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  value={observationScript}
                  onChange={(e) => setObservationScript(e.target.value)}
                  placeholder='e.g. markings["place_1"]'
                  spellCheck={false}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="predicate-script">Predicate Script (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Must return a boolean. When provided, the observation is only recorded when this returns <code>true</code>.
                  Leave empty to record on every step.
                </p>
                <textarea
                  id="predicate-script"
                  className="w-full h-16 rounded-md border bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  value={predicateScript}
                  onChange={(e) => setPredicateScript(e.target.value)}
                  placeholder='e.g. transition_name == "Send"'
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid}>
            {editMonitor ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

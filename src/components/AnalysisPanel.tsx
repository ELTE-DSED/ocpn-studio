import { useState, useContext, useCallback, useMemo } from 'react';
import useStore from '@/stores/store';
import { useShallow } from 'zustand/react/shallow';
import { SimulationContext } from '@/context/useSimulationContextHook';
import type { Monitor } from '@/types';
import { NON_BLOCKING_DECLARE_TEMPLATES } from '@/types';
import type { BlockedTransitionInfo } from '@/types';
import type { TransitionNodeData } from '@/nodes/TransitionNode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Plus,
  Trash2,
  Edit,
  ChevronDown,
  ChevronUp,
  Activity,
  BarChart3,
  Network,
  ToggleLeft,
  ToggleRight,
  Play,
  Loader2,
  GitGraph,
  Dice5,
  Search,
  ShieldAlert,
  ShieldCheck,
  Ban,
} from 'lucide-react';
import { AddMonitorDialog } from '@/components/dialogs/AddMonitorDialog';
import { PerformanceReport } from '@/components/PerformanceReport';
import { StateSpaceReportView } from '@/components/StateSpaceReportView';

/** Maximum number of states for which the graph visualization is enabled */
const GRAPH_NODE_LIMIT = 500;

/** Distribution function names recognized by cpnsim */
const DIST_FUNCTIONS = [
  'bernoulli', 'beta', 'binomial', 'chisq', 'discrete', 'erlang',
  'exponential', 'gamma', 'normal', 'poisson', 'rayleigh', 'student',
  'uniform', 'weibull',
] as const;

/** Regex to find distribution function calls with their arguments */
const DIST_REGEX = new RegExp(
  `\\b(${DIST_FUNCTIONS.join('|')})\\s*\\(([^)]*?)\\)`,
  'gi'
);

/** Regex to detect IntRange colorset definitions: "int with X..Y" */
const INT_RANGE_REGEX = /int\s+with\s+(-?\d+)\s*\.\.\s*(-?\d+)/i;

/** A source of non-determinism found in the model */
interface NonDeterminismSource {
  id: string;
  type: 'distribution' | 'intRange';
  /** Distribution function name or variable name */
  name: string;
  /** Short description of where it occurs */
  location: string;
  /** Raw parameters string from the function call */
  params?: string;
  /** Range bounds for IntRange sources */
  range?: [number, number];
  /** Smart default override value */
  defaultValue: number;
  /** Context-qualified key for the WASM override map (e.g. "discrete@t:Landing:time") */
  overrideKey?: string;
  /** ID of the petri net containing this source */
  netId?: string;
  /** ID of the node or edge where this source occurs */
  elementId?: string;
  /** Whether the source is on a node or edge */
  elementType?: 'node' | 'edge';
  /** Which property field contains this source (e.g. 'guard', 'time', 'codeSegment', 'label', 'delay') */
  field?: string;
}

/** Compute a smart default value for a distribution function */
function getDistDefault(fnName: string, paramsStr: string): number {
  const nums = paramsStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  switch (fnName.toLowerCase()) {
    case 'bernoulli': return nums[0] !== undefined ? (nums[0] >= 0.5 ? 1 : 0) : 1;
    case 'beta': return nums.length >= 2 ? nums[0] / (nums[0] + nums[1]) : 0.5;
    case 'binomial': return nums.length >= 2 ? Math.round(nums[0] * nums[1]) : 1;
    case 'chisq': return nums[0] !== undefined ? Math.max(nums[0] - 2, 0) : 1;
    case 'discrete': return nums.length >= 2 ? Math.round((nums[0] + nums[1]) / 2) : 1;
    case 'erlang': return nums.length >= 2 && nums[1] > 0 ? Math.round((nums[0] - 1) / nums[1]) : 1;
    case 'exponential': return nums[0] !== undefined && nums[0] > 0 ? Math.round(1 / nums[0]) : 1;
    case 'gamma': return nums.length >= 2 ? Math.round(nums[0] * nums[1]) : 1;
    case 'normal': return nums[0] !== undefined ? Math.round(nums[0]) : 0;
    case 'poisson': return nums[0] !== undefined ? Math.round(nums[0]) : 1;
    case 'rayleigh': return nums[0] !== undefined ? Math.round(nums[0]) : 1;
    case 'student': return 0;
    case 'uniform': return nums.length >= 2 ? Math.round((nums[0] + nums[1]) / 2) : 1;
    case 'weibull': return nums.length >= 2 && nums[1] > 1
      ? Math.round(nums[0] * Math.pow((nums[1] - 1) / nums[1], 1 / nums[1])) : 1;
    default: return 1;
  }
}

const TYPE_LABELS: Record<string, string> = {
  'marking-size': 'Marking',
  'transition-count': 'Count',
  'breakpoint-place': 'BP Place',
  'breakpoint-transition': 'BP Trans',
  'data-collector': 'Data',
  'interval-duration': 'Duration',
};

const TYPE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  'marking-size': 'default',
  'transition-count': 'secondary',
  'breakpoint-place': 'destructive',
  'breakpoint-transition': 'destructive',
  'data-collector': 'outline',
  'interval-duration': 'default',
};

// Stable empty-array fallback so `blockedTransitions ?? []` doesn't hand the memo below a
// fresh array identity (and therefore a spurious "changed" dependency) on every render.
const EMPTY_BLOCKED_TRANSITIONS: BlockedTransitionInfo[] = [];

export function AnalysisPanel() {
  const { monitors, updateMonitor, deleteMonitor, stateSpaceResult, setStateSpaceResult, setActiveSpecialTab,
    petriNetsById, petriNetOrder, colorSets, variables, functions: modelFunctions } = useStore(
    useShallow((state) => ({
      monitors: state.monitors,
      updateMonitor: state.updateMonitor,
      deleteMonitor: state.deleteMonitor,
      stateSpaceResult: state.stateSpaceResult,
      setStateSpaceResult: state.setStateSpaceResult,
      setActiveSpecialTab: state.setActiveSpecialTab,
      petriNetsById: state.petriNetsById,
      petriNetOrder: state.petriNetOrder,
      colorSets: state.colorSets,
      variables: state.variables,
      functions: state.functions,
    })),
  );

  const simulationContext = useContext(SimulationContext);
  const monitorResults = simulationContext?.monitorResults ?? [];
  const declareResults = simulationContext?.declareResults ?? [];
  const blockedTransitions = simulationContext?.blockedTransitions ?? EMPTY_BLOCKED_TRANSITIONS;

  // Constraints currently the reason some transition can't fire (proactive-blocking
  // templates only — see DeclareConstraintEdge/TransitionNode for the live pulse).
  const blockingConstraintIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bt of blockedTransitions) for (const cid of bt.blockingConstraintIds) ids.add(cid);
    return ids;
  }, [blockedTransitions]);
  const currentlyBlocking = declareResults.filter((r) => blockingConstraintIds.has(r.constraintId));

  // Templates that can never be enforced by blocking (Existence, Response, Responded
  // Existence, Co-Existence, Choice) only ever show "pending" — if the run has reached a
  // deadlock while one is still pending, it will never resolve. See the deadlock toast in
  // useSimulationController for the same check at the moment it happens.
  const nonBlockingTemplates: readonly string[] = NON_BLOCKING_DECLARE_TEMPLATES;
  const unresolvedConstraints = declareResults.filter(
    (r) => r.state === 'pending' && nonBlockingTemplates.includes(r.template),
  );

  const [isMonitorsOpen, setIsMonitorsOpen] = useState(true);
  const [isDeclareOpen, setIsDeclareOpen] = useState(true);
  const [isResultsOpen, setIsResultsOpen] = useState(true);
  const [isStateSpaceOpen, setIsStateSpaceOpen] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | undefined>();

  const [isCalculating, setIsCalculating] = useState(false);
  const [maxStates, setMaxStates] = useState(10000);
  const [maxArcs, setMaxArcs] = useState(50000);

  // Non-determinism override state
  const [overrideValues, setOverrideValues] = useState<Record<string, number>>({});
  const [showOverrides, setShowOverrides] = useState(false);

  /** Scan the model for all sources of non-determinism */
  const nonDetSources = useMemo(() => {
    const sources: NonDeterminismSource[] = [];

    // Helper: scan an expression string for distribution function calls
    // `evalContext` matches the Rust EVAL_CONTEXT format: "t:<name>:<field>" or "a:<id>:<field>"
    const scanExpr = (expr: string, location: string, ref?: { netId: string; elementId: string; elementType: 'node' | 'edge'; field?: string }, evalContext?: string) => {
      if (!expr) return;
      let match: RegExpExecArray | null;
      DIST_REGEX.lastIndex = 0;
      while ((match = DIST_REGEX.exec(expr)) !== null) {
        const fnName = match[1].toLowerCase();
        // Each call site gets its own entry with a context-qualified override key
        const overrideKey = evalContext ? `${fnName}@${evalContext}` : fnName;
        sources.push({
          id: `dist:${overrideKey}`,
          type: 'distribution',
          name: fnName,
          location,
          params: match[2],
          defaultValue: getDistDefault(fnName, match[2]),
          overrideKey,
          netId: ref?.netId,
          elementId: ref?.elementId,
          elementType: ref?.elementType,
          field: ref?.field,
        });
      }
    };

    // Scan all petri nets
    for (const netId of petriNetOrder) {
      const net = petriNetsById[netId];
      if (!net) continue;

      for (const node of net.nodes) {
        if (node.type === 'transition') {
          const data = node.data as unknown as TransitionNodeData;
          const tName = data.label || node.id;
          if (data.guard) scanExpr(data.guard, `Guard: ${tName}`, { netId, elementId: node.id, elementType: 'node', field: 'guard' }, `t:${tName}:guard`);
          if (data.time) scanExpr(data.time, `Time: ${tName}`, { netId, elementId: node.id, elementType: 'node', field: 'time' }, `t:${tName}:time`);
          if (data.codeSegment) scanExpr(data.codeSegment, `Code: ${tName}`, { netId, elementId: node.id, elementType: 'node', field: 'codeSegment' }, `t:${tName}:codeSegment`);
        }
      }

      for (const edge of net.edges) {
        const label = typeof edge.data?.label === 'string' ? edge.data.label : edge.id;
        if (edge.data?.label) {
          scanExpr(String(edge.data.label), `Arc: ${label}`, { netId, elementId: edge.id, elementType: 'edge', field: 'label' }, `a:${edge.id}:inscription`);
        }
        if (edge.data?.delay) {
          scanExpr(String(edge.data.delay), `Delay: ${label}`, { netId, elementId: edge.id, elementType: 'edge', field: 'delay' }, `a:${edge.id}:delay`);
        }
      }
    }

    // Scan function definitions
    for (const fn of modelFunctions) {
      if (fn.code) scanExpr(fn.code, `Function: ${fn.name}`);
    }

    // Scan IntRange colorsets → find variables using them
    const intRangeColorSets = new Map<string, [number, number]>();
    for (const cs of colorSets) {
      const rangeMatch = INT_RANGE_REGEX.exec(cs.definition);
      if (rangeMatch) {
        intRangeColorSets.set(cs.name, [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])]);
      }
    }

    if (intRangeColorSets.size > 0) {
      for (const v of variables) {
        const range = intRangeColorSets.get(v.colorSet);
        if (range) {
          sources.push({
            id: `range:${v.name}`,
            type: 'intRange',
            name: v.name,
            location: `Var ${v.name} : ${v.colorSet}`,
            range,
            defaultValue: Math.round((range[0] + range[1]) / 2),
          });
        }
      }
    }

    return sources;
  }, [petriNetsById, petriNetOrder, colorSets, variables, modelFunctions]);

  /** Initialize override values with smart defaults when sources change */
  const handleAnalyze = useCallback(() => {
    const defaults: Record<string, number> = {};
    for (const src of nonDetSources) {
      defaults[src.id] = src.defaultValue;
    }
    setOverrideValues(defaults);
    setShowOverrides(true);
  }, [nonDetSources]);

  /** Build override maps for the WASM call */
  const buildOverrideMaps = useCallback((): {
    distOverrides?: Record<string, number>;
    intRangeOverrides?: Record<string, number>;
  } => {
    if (!showOverrides || nonDetSources.length === 0) return {};
    const distOverrides: Record<string, number> = {};
    const intRangeOverrides: Record<string, number> = {};
    for (const src of nonDetSources) {
      const val = overrideValues[src.id] ?? src.defaultValue;
      if (src.type === 'distribution') {
        distOverrides[src.overrideKey ?? src.name] = val;
      } else {
        intRangeOverrides[src.name] = val;
      }
    }
    return {
      distOverrides: Object.keys(distOverrides).length > 0 ? distOverrides : undefined,
      intRangeOverrides: Object.keys(intRangeOverrides).length > 0 ? intRangeOverrides : undefined,
    };
  }, [showOverrides, nonDetSources, overrideValues]);

  const toggleEnabled = (monitor: Monitor) => {
    updateMonitor(monitor.id, { ...monitor, enabled: !monitor.enabled });
  };

  const handleEdit = (monitor: Monitor) => {
    setEditingMonitor(monitor);
    setAddDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteMonitor(id);
  };

  const handleDialogClose = (open: boolean) => {
    setAddDialogOpen(open);
    if (!open) setEditingMonitor(undefined);
  };

  const handleCalculateStateSpace = useCallback(async () => {
    if (!simulationContext) return;
    setIsCalculating(true);
    setStateSpaceResult(null);
    try {
      const { distOverrides, intRangeOverrides } = buildOverrideMaps();
      const result = await simulationContext.calculateStateSpace(
        maxStates, maxArcs, undefined, distOverrides, intRangeOverrides,
      );
      if (result) {
        setStateSpaceResult(result);
      }
    } finally {
      setIsCalculating(false);
    }
  }, [simulationContext, maxStates, maxArcs, setStateSpaceResult, buildOverrideMaps]);

  return (
    <div className="space-y-2 text-sm">
      {/* Monitors Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isMonitorsOpen} onOpenChange={setIsMonitorsOpen}>
          <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
              <Activity className="h-4 w-4" />
            </span>
            <span className="font-semibold text-sm flex-1">
              Monitors{monitors.length > 0 ? ` (${monitors.length})` : ''}
            </span>
            {isMonitorsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CollapsibleTrigger>

          <CollapsibleContent className="px-3 pb-3 space-y-1">
          {monitors.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 pt-1">
              No monitors defined yet.
            </p>
          ) : (
            monitors.map((monitor) => (
              <div
                key={monitor.id}
                className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-accent group"
              >
                {/* Enable/disable toggle */}
                <button
                  onClick={() => toggleEnabled(monitor)}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  title={monitor.enabled ? 'Disable monitor' : 'Enable monitor'}
                >
                  {monitor.enabled ? (
                    <ToggleRight className="h-4 w-4 text-primary" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                </button>

                {/* Name */}
                <span
                  className={`text-xs truncate flex-1 ${
                    !monitor.enabled ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {monitor.name}
                </span>

                {/* Type badge */}
                <Badge variant={TYPE_VARIANTS[monitor.type] ?? 'outline'} className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                  {TYPE_LABELS[monitor.type] ?? monitor.type}
                </Badge>

                {/* Edit button */}
                <button
                  onClick={() => handleEdit(monitor)}
                  className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Edit monitor"
                >
                  <Edit className="h-3.5 w-3.5" />
                </button>

                {/* Delete button */}
                <button
                  onClick={() => handleDelete(monitor.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Delete monitor"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-primary hover:text-primary"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Monitor
          </Button>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Declare Constraints Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isDeclareOpen} onOpenChange={setIsDeclareOpen}>
        <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <span className="font-semibold text-sm flex-1">
            Declare Constraints
            {(currentlyBlocking.length > 0 || unresolvedConstraints.length > 0) && (
              <span className="text-destructive font-normal ml-1">
                ({currentlyBlocking.length + unresolvedConstraints.length})
              </span>
            )}
          </span>
          {isDeclareOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 space-y-2">
          {declareResults.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">
              No simulation run yet — run or step the simulation to see live constraint state here.
            </p>
          ) : (
            <>
              {currentlyBlocking.length > 0 && (
                <div className="px-1 space-y-1">
                  <div className="text-xs font-medium flex items-center gap-1 text-destructive">
                    <Ban className="h-3.5 w-3.5" />
                    Blocking right now
                  </div>
                  <div className="rounded border border-destructive/30 bg-destructive/5 divide-y divide-destructive/10">
                    {currentlyBlocking.map((r) => {
                      const blockedHere = blockedTransitions.filter((bt) => bt.blockingConstraintIds.includes(r.constraintId));
                      return (
                        <div key={r.constraintId} className="px-2 py-1.5">
                          <div className="text-xs font-medium truncate">{r.constraintName}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            Withholding {blockedHere.length} transition{blockedHere.length === 1 ? '' : 's'} from firing
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {unresolvedConstraints.length > 0 && (
                <div className="px-1 space-y-1">
                  <div className="text-xs font-medium flex items-center gap-1 text-amber-600">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Still open
                  </div>
                  <div className="rounded border border-amber-500/30 bg-amber-500/5 divide-y divide-amber-500/10">
                    {unresolvedConstraints.map((r) => (
                      <div key={r.constraintId} className="px-2 py-1.5">
                        <div className="text-xs font-medium truncate">{r.constraintName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Not yet satisfied. This template can&apos;t be enforced by blocking a
                          firing, so it stays &quot;pending&quot; until it resolves — or the
                          simulation deadlocks with it still open.
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentlyBlocking.length === 0 && unresolvedConstraints.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                  Nothing blocking, nothing left open.
                </p>
              )}
            </>
          )}
        </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Performance Report Section */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isResultsOpen} onOpenChange={setIsResultsOpen}>
        <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <BarChart3 className="h-4 w-4" />
          </span>
          <span className="font-semibold text-sm flex-1">Performance Report</span>
          {isResultsOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3">
          <PerformanceReport results={monitorResults} />
        </CollapsibleContent>
        </Collapsible>
      </div>

      {/* State Space Analysis */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Collapsible open={isStateSpaceOpen} onOpenChange={setIsStateSpaceOpen}>
        <CollapsibleTrigger className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Network className="h-4 w-4" />
          </span>
          <span className="font-semibold text-sm flex-1">State Space</span>
          {isStateSpaceOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 space-y-3">
          {/* Settings */}
          <div className="grid grid-cols-2 gap-2 px-1">
            <div>
              <label className="text-xs text-muted-foreground">Max States</label>
              <input
                type="number"
                value={maxStates}
                onChange={(e) => setMaxStates(Number(e.target.value))}
                className="w-full rounded border bg-background px-2 py-1 text-xs"
                min={100}
                max={1000000}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max Arcs</label>
              <input
                type="number"
                value={maxArcs}
                onChange={(e) => setMaxArcs(Number(e.target.value))}
                className="w-full rounded border bg-background px-2 py-1 text-xs"
                min={100}
                max={1000000}
              />
            </div>
          </div>

          {/* Non-determinism analysis */}
          {nonDetSources.length > 0 && (
            <div className="px-1 space-y-2">
              {!showOverrides ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs w-full"
                  onClick={handleAnalyze}
                >
                  <Search className="h-3.5 w-3.5 mr-1" />
                  Resolve Non-determinism ({nonDetSources.length})
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center gap-1">
                      <Dice5 className="h-3.5 w-3.5 text-amber-500" />
                      Deterministic Overrides
                    </span>
                    <button
                      onClick={() => setShowOverrides(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      title="Disable overrides"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="rounded border bg-muted/30 divide-y divide-border">
                    {nonDetSources.map((src) => (
                      <div key={src.id} className="flex items-center gap-2 px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Badge
                              variant={src.type === 'distribution' ? 'secondary' : 'outline'}
                              className="text-[9px] px-1 py-0 h-3.5 flex-shrink-0"
                            >
                              {src.type === 'distribution' ? 'dist' : 'range'}
                            </Badge>
                            <span className="text-xs font-mono font-medium truncate">
                              {src.type === 'distribution'
                                ? `${src.name}(${src.params ?? ''})`
                                : `${src.name} [${src.range?.[0]}..${src.range?.[1]}]`
                              }
                            </span>
                          </div>
                          <div
                            className={`text-[10px] text-muted-foreground truncate ${src.elementId ? 'cursor-pointer hover:text-foreground hover:underline' : ''}`}
                            onClick={() => {
                              if (src.netId && src.elementId && src.elementType) {
                                useStore.getState().requestFocus({
                                  netId: src.netId,
                                  elementId: src.elementId,
                                  elementType: src.elementType,
                                  field: src.field,
                                });
                              }
                            }}
                          >
                            {src.location}
                          </div>
                        </div>
                        <input
                          type="number"
                          value={overrideValues[src.id] ?? src.defaultValue}
                          onChange={(e) => setOverrideValues(prev => ({
                            ...prev,
                            [src.id]: Number(e.target.value),
                          }))}
                          className="w-16 rounded border bg-background px-1.5 py-0.5 text-xs text-right font-mono"
                          step={src.type === 'intRange' ? 1 : 'any'}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 px-1">
            <Button
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={handleCalculateStateSpace}
              disabled={isCalculating || !simulationContext}
            >
              {isCalculating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              {isCalculating ? 'Calculating…' : 'Calculate'}
            </Button>

            {stateSpaceResult && (stateSpaceResult.report.numStates <= GRAPH_NODE_LIMIT) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setActiveSpecialTab('stateSpaceGraph')}
              >
                <GitGraph className="h-3.5 w-3.5 mr-1" />
                Graph
              </Button>
            )}
          </div>

          {/* Large state space warning */}
          {stateSpaceResult && stateSpaceResult.report.numStates > GRAPH_NODE_LIMIT && (
            <p className="text-xs text-muted-foreground px-1">
              Graph visualization disabled for state spaces with more than {GRAPH_NODE_LIMIT} states.
            </p>
          )}

          {/* Report */}
          {stateSpaceResult && (
            <StateSpaceReportView report={stateSpaceResult.report} />
          )}
        </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Add/Edit Monitor Dialog */}
      <AddMonitorDialog
        open={addDialogOpen}
        onOpenChange={handleDialogClose}
        editMonitor={editingMonitor}
      />
    </div>
  );
}

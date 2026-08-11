import {
  type Edge,
  type Node,
} from '@xyflow/react';
// import { PlaceNodeProps } from '@/nodes/PlaceNode'; // Import PlaceNodeData
// import { TransitionNodeProps } from '@/nodes/TransitionNode'; // Import TransitionNodeData

import type { ColorSet, Variable, Priority, Function, Use, Value } from '@/declarations';
import type { ValidationErrors } from '@/utils/validation';
import { PlaceNodeData } from './nodes/PlaceNode';
import { TransitionNodeData } from './nodes/TransitionNode';
import { AuxTextNodeData } from './nodes/AuxTextNode';

// A timed token has a value and a timestamp (in milliseconds)
export interface TimedToken {
  value: unknown;
  timestamp: number; // Timestamp in milliseconds (0 = immediately available)
}

// Helper to check if a token is a timed token object
export function isTimedToken(token: unknown): token is TimedToken {
  return (
    token !== null &&
    typeof token === 'object' &&
    'value' in token &&
    'timestamp' in token &&
    typeof (token as TimedToken).timestamp === 'number'
  );
}

export type ArcType = 'normal' | 'reset' | 'inhibitor';

// Declare constraints (LTL-style behavioral rules over transition occurrences, see cpntools.org)
export type BinaryDeclareTemplate =
  | 'response'
  | 'precedence'
  | 'succession'
  | 'alternate-response'
  | 'alternate-precedence'
  | 'alternate-succession'
  | 'chain-response'
  | 'chain-precedence'
  | 'chain-succession'
  | 'responded-existence'
  | 'co-existence'
  | 'choice'
  | 'exclusive-choice'
  | 'not-coexistence'
  | 'not-succession'
  | 'not-chain-succession';

export type UnaryDeclareTemplate = 'existence' | 'absence' | 'exactly' | 'init' | 'last';

export type DeclareTemplate = BinaryDeclareTemplate | UnaryDeclareTemplate;

// A unary constraint lives directly on the transition it constrains (dropped onto it, like a "roof" tag)
export interface UnaryDeclareConstraint {
  id: string;
  template: UnaryDeclareTemplate;
  enabled: boolean;
  /** Occurrence count parameter, used by Existence/Absence/Exactly (defaults to 1 if omitted) */
  n?: number;
}

// A binary constraint is drawn as an edge between two transitions; this is the edge's `data`
export interface DeclareConstraintEdgeData {
  template: BinaryDeclareTemplate;
  enabled: boolean;
}

// Live acceptance state of one constraint, reported by the simulator after each step.
// There is no "violated" state: the simulator proactively blocks transitions that would
// break a constraint, so violations are prevented rather than flagged after the fact.
export interface DeclareResult {
  constraintId: string;
  constraintName: string;
  template: DeclareTemplate;
  state: 'pending' | 'satisfied';
  activationCount: number;
}

// A transition that currently has a binding the guard/tokens would allow, but that is
// being proactively withheld by one or more Declare constraints — reported live so the
// canvas can show *why* the transition isn't firing.
export interface BlockedTransitionInfo {
  transitionId: string;
  blockingConstraintIds: string[];
}

// A transition that would be enabled if the user pressed "step" right now — including ones
// only reachable after the clock eagerly advances to a future token timestamp. `atTime` is
// when it would actually fire; `isFuture` is whether that's later than the simulator's
// current displayed time (firing it will advance the clock to `atTime`).
export interface EnabledTransitionInfo {
  transitionId: string;
  transitionName: string;
  atTime: number;
  isFuture: boolean;
}

// Templates whose obligation cannot be enforced by blocking a future firing — they can
// only ever be judged "resolved" or "still open" while the run continues, and are never
// definitively violated until the run itself ends without the obligation being met.
export const NON_BLOCKING_DECLARE_TEMPLATES: readonly DeclareTemplate[] = [
  'existence',
  'response',
  'responded-existence',
  'co-existence',
  'choice',
];

export type PortType = 'in' | 'out' | 'io';

export type SocketAssignment = {
  portPlaceId: string; // Place ID on the subpage
  socketPlaceId: string; // Place ID on the parent page
};

export type FusionSet = {
  id: string;
  name: string;
};

export type PetriNet = {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  selectedElement?: SelectedElement | null;
};

//export type AppNode = Node;

// Define the type for selectedElement
export type SelectedElement =
  | { type: 'node'; element: Node }
  | { type: 'edge'; element: Edge }
  | null;

export type ActiveMode = 'model' | 'simulation' | 'analysis';

// Monitor types
export type MonitorType =
  | 'marking-size'
  | 'transition-count'
  | 'breakpoint-place'
  | 'breakpoint-transition'
  | 'data-collector'
  | 'interval-duration';

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  enabled: boolean;
  // Target subnet
  placeIds: string[];       // watched places
  transitionIds: string[];  // watched transitions
  // Type-specific config
  config: {
    stopCondition?: 'empty' | 'not-empty' | 'enabled' | 'not-enabled';
    startTransitionId?: string;
    endTransitionId?: string;
    correlationKey?: string;
  };
  // Rhai scripts for DataCollector monitors
  observationScript?: string;  // Rhai expression returning a numeric value
  predicateScript?: string;    // Rhai expression returning bool (when to record)
}

export interface MonitorObservation {
  step: number;
  time: number;
  value: number;
}

export interface MonitorStatistics {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface MonitorResult {
  monitorId: string;
  monitorName?: string;
  monitorType?: MonitorType;
  observations: MonitorObservation[];
  statistics: MonitorStatistics;
  breakpointHit?: boolean;
}

// State Space types
export interface StateNode {
  id: number;
  marking: Record<string, string[]>; // place_id -> token strings
  time: number;
}

export interface StateArc {
  from: number;
  to: number;
  transitionId: string;
  transitionName: string;
  binding: string;
}

export interface PlaceBounds {
  placeId: string;
  placeName: string;
  upperBound: number;
  lowerBound: number;
  upperMultiSetBound: number;
  lowerMultiSetBound: number;
}

export interface SccComponent {
  id: number;
  states: number[];
}

export interface TransitionFireCount {
  transitionId: string;
  transitionName: string;
  fireCount: number;
}

export interface StateSpaceReport {
  numStates: number;
  numArcs: number;
  numScc: number;
  isFull: boolean;
  limitReached: boolean;
  calcTimeMs: number;
  placeBounds: PlaceBounds[];
  homeMarkings: number[];
  deadMarkings: number[];
  deadTransitions: string[];
  liveTransitions: string[];
  transitionFireCounts: TransitionFireCount[];
  sccGraph: SccComponent[];
  terminalScc: number[];
}

export interface StateSpaceGraph {
  nodes: StateNode[];
  arcs: StateArc[];
}

export interface StateSpaceResult {
  report: StateSpaceReport;
  graph: StateSpaceGraph;
}

/** Request to focus on a specific element in the canvas (zoom + select + highlight field) */
export type FocusRequest = {
  netId: string;
  elementId: string;
  elementType: 'node' | 'edge';
  /** Which property field to auto-focus (e.g. 'guard', 'time', 'codeSegment', 'label', 'delay') */
  field?: string;
  /** Skip the usual switch to Model mode — e.g. the Simulation pane's enabled-transitions
   * list wants to highlight a transition without leaving Simulation mode. */
  keepMode?: boolean;
} | null;

/**
 * Descriptive metadata about the model as a document — who made it, what it is for, where it
 * lives. Every field is optional: a model is perfectly valid with none of them.
 *
 * The model's *name* is not here. It lives in `ocpnName`, which predates this type and drives
 * the header, the export filenames and the PNML `<name>`; a second copy would only drift.
 * The serialiser writes it into `metadata.name` on the way out so the block is self-contained
 * for anything reading the file, and the parser accepts it back as a fallback.
 *
 * `generator` and `modified` are likewise absent: both describe the *file*, not the model, and
 * are stamped by the serialiser at save time. Keeping them out of the store is what stops a
 * save from dirtying the document it has just written.
 */
export type OcpnMetadata = {
  /** What the model is about. Free text, expected to be a paragraph or two. */
  description?: string;
  /** Model authors, in whatever order they should be credited. */
  authors?: string[];
  /** Where the model lives — a repository, a paper, a project page. */
  url?: string;
  /** The *model's* own version, chosen by its authors. Unrelated to the app version. */
  version?: string;
  /** Licence the model is published under, as an SPDX identifier or free text. */
  license?: string;
  /** ISO 8601 timestamp, stamped once when the model is first created. */
  created?: string;
};

export type AppState = {
  ocpnName: string; // Top-level name for the OCPN project
  metadata: OcpnMetadata; // Descriptive metadata about the model as a document
  /**
   * The file this model is currently bound to, or null when it has never been saved and has
   * no origin on disk. `handle` is present only where the File System Access API is available
   * *and* the file is a native .ocpn — an imported .cpn or .pnml keeps its `name` for display
   * but no handle, so Save prompts for an .ocpn location instead of writing back lossily.
   *
   * Deliberately outside both the dirty snapshot and the undo history: which file the model
   * came from is not part of the model.
   */
  currentFile: { name: string; handle: FileSystemFileHandle | null } | null;
  petriNetsById: Record<string, PetriNet>;
  petriNetOrder: string[]; // IDs in tab order
  activePetriNetId: string | null;
  activeMode: ActiveMode; // Whether the UI is in model editing or simulation mode
  colorSets: ColorSet[];
  variables: Variable[];
  priorities: Priority[];
  functions: Function[];
  uses: Use[];
  values: Value[];
  simulationEpoch?: string | null; // ISO 8601 date string for simulation epoch
  showMarkingDisplay: boolean; // Toggle for showing/hiding marking rectangles
  isArcMode: boolean; // Whether arc connection mode is active
  activeArcType: ArcType; // The type of arc to create when connecting nodes
  isDeclareMode: boolean; // Whether Declare-constraint drawing mode is active
  activeDeclareTemplate: BinaryDeclareTemplate; // The template to use when connecting two transitions
  showDeclareLayer: boolean; // Toggle for showing/hiding Declare constraint edges and badges
  isChainMode: boolean; // Whether Chain mode (click-to-place alternating place/transition) is active
  isFireMode: boolean; // Whether "click a transition to fire it" mode is active during simulation
  fusionSets: FusionSet[]; // Named fusion sets for fusion places
  monitors: Monitor[]; // Defined monitors for analysis
  stateSpaceResult: StateSpaceResult | null; // Cached state space analysis result
  activeSpecialTab: 'stateSpaceGraph' | null; // Non-Petri-net tab currently displayed
  focusRequest: FocusRequest; // Request to zoom to and focus on a specific element
  validationErrors: ValidationErrors; // Computed validation errors keyed by element ID
};

export type AppActions = {
  setNodes: (petriNetId: string, nodes: Node[]) => void;
  setEdges: (petriNetId: string, edges: Edge[]) => void;
  
  createPetriNet: (name: string) => void;
  addPetriNet: (newPetriNet: PetriNet) => void;
  setActivePetriNet: (id: string) => void;
  renamePetriNet: (id: string, newName: string) => void;
  deletePetriNet: (id: string) => void;
  duplicatePetriNet: (id: string) => void;
  reorderPetriNets: (newOrder: string[]) => void;
  addNode: (petriNetId: string, newNode: Node) => void;
  addEdge: (petriNetId: string, edge: Edge) => void;
  updateNode: (petriNetId: string, node: Node) => void;
  updateNodeMarking: (id: string, newMarking: unknown[]) => void;
  /**
   * Apply many places' markings in a single store write. A chunked simulation run stages
   * its marking changes and flushes them through here once per chunk: written one at a
   * time, each place would rebuild its net's node array and re-render every subscribed
   * node, several times per fired transition.
   */
  updateNodeMarkings: (markings: Map<string, unknown[]>) => void;
  updateNodeData: (petriNetId: string, id: string, newData: PlaceNodeData | TransitionNodeData | AuxTextNodeData) => void;
  updateEdgeData: (petriNetId: string, id: string, newData: Record<string, unknown>) => void;
  updateEdgeLabel: (petriNetId: string, id: string, newLabel: string) => void;
  swapEdgeDirection: (petriNetId: string, id: string) => void;
  applyInitialMarkings: () => void;
  setSelectedElement: (petriNetId: string, element: SelectedElement) => void;
  
  setColorSets: (colorSets: ColorSet[]) => void;
  setVariables: (variables: Variable[]) => void;
  setPriorities: (priorities: Priority[]) => void;
  setFunctions: (functions: Function[]) => void;
  setUses: (uses: Use[]) => void;
  setValues: (values: Value[]) => void;

  addColorSet: (newColorSet: ColorSet) => void;
  addVariable: (newVariable: Variable) => void;
  addPriority: (newPriority: Priority) => void;
  addFunction: (newFunction: Function) => void;
  addUse: (newUse: Use) => void;
  addValue: (newValue: Value) => void;
  renameColorSet: (id: string, newName: string) => void;
  deleteColorSet: (id: string) => void;
  deleteVariable: (id: string) => void;
  deletePriority: (id: string) => void;
  deleteFunction: (id: string) => void;
  updateUse: (id: string, newUse: Use) => void;
  deleteUse: (id: string) => void;
  updateValue: (id: string, newValue: Value) => void;
  deleteValue: (id: string) => void;

  toggleArcMode: (state: boolean, arcType?: ArcType) => void;
  setActiveArcType: (arcType: ArcType) => void;
  toggleDeclareMode: (state: boolean, template?: BinaryDeclareTemplate) => void;
  setShowDeclareLayer: (show: boolean) => void;
  toggleChainMode: (state: boolean) => void;
  toggleFireMode: (state: boolean) => void;
  setActiveMode: (mode: ActiveMode) => void;
  setOcpnName: (name: string) => void;
  setMetadata: (metadata: OcpnMetadata) => void;
  setCurrentFile: (file: { name: string; handle: FileSystemFileHandle | null } | null) => void;
  setSimulationEpoch: (epoch: string | null) => void;
  setShowMarkingDisplay: (show: boolean) => void;

  // Fusion sets
  setFusionSets: (fusionSets: FusionSet[]) => void;
  addFusionSet: (fusionSet: FusionSet) => void;
  deleteFusionSet: (id: string) => void;

  // Monitors
  setMonitors: (monitors: Monitor[]) => void;
  addMonitor: (monitor: Monitor) => void;
  updateMonitor: (id: string, monitor: Monitor) => void;
  deleteMonitor: (id: string) => void;

  // State space
  setStateSpaceResult: (result: StateSpaceResult | null) => void;
  setActiveSpecialTab: (tab: 'stateSpaceGraph' | null) => void;

  // Focus navigation
  requestFocus: (request: FocusRequest) => void;

  // Hierarchy
  moveTransitionToSubpage: (petriNetId: string, transitionId: string) => void;
  moveNodesToSubpage: (petriNetId: string, nodeIds: string[], subpageName?: string) => void;
  flattenSubstitutionTransition: (petriNetId: string, transitionId: string) => void;
  assignSubpageToTransition: (petriNetId: string, transitionId: string, subPageId: string, socketAssignments: SocketAssignment[]) => void;
  removeSubpageFromTransition: (petriNetId: string, transitionId: string) => void;

  reset: () => void;
};



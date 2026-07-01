import { useState, useCallback, useRef, useEffect } from 'react';
import useStore, { pauseUndo, resumeUndo } from '@/stores/store';
import init, { WasmSimulator, type InitOutput } from '@rwth-pads/cpnsim';
import { PetriNetData, convertToJSON } from '@/utils/FileOperations';
import type { SimulationEvent } from '@/components/EventLog'; // Import SimulationEvent
import { v4 as uuidv4 } from 'uuid'; // For generating unique event IDs
import { type SimulationConfig, DEFAULT_SIMULATION_CONFIG } from '@/context/useSimulationContextHook';
import type { PetriNet, FusionSet, MonitorResult, Monitor, StateSpaceResult } from '@/types';
import type { Node } from '@xyflow/react';
import { toast } from 'sonner';

// Define TokenMovement locally as it's not exported from EventLog
export interface TokenMovement {
    placeId: string;
    placeName: string;
    tokens: string; // Keep as string for display consistency
}

/**
 * Normalizes a token value, converting JavaScript Map objects to plain objects.
 * This is needed because Rhai object maps are serialized as JS Maps via serde-wasm-bindgen.
 * Keys are sorted alphabetically to ensure consistent comparison regardless of original order.
 * Unit tokens (Rhai's `()`) are serialized as `null`/`undefined` and normalized to `null`.
 */
function normalizeToken(token: unknown): unknown {
  // Handle unit tokens: Rhai's () serializes as null/undefined
  if (token === null || token === undefined) {
    return null; // Use null as canonical representation of unit
  }
  if (token instanceof Map) {
    // Convert Map to plain object with sorted keys
    const obj: Record<string, unknown> = {};
    const sortedKeys = Array.from(token.keys()).map(String).sort();
    for (const key of sortedKeys) {
      obj[key] = normalizeToken(token.get(key));
    }
    return obj;
  } else if (Array.isArray(token)) {
    // Recursively normalize array elements
    return token.map(normalizeToken);
  } else if (typeof token === 'object') {
    // Recursively normalize object properties with sorted keys
    const obj: Record<string, unknown> = {};
    const sortedKeys = Object.keys(token).sort();
    for (const key of sortedKeys) {
      obj[key] = normalizeToken((token as Record<string, unknown>)[key]);
    }
    return obj;
  }
  // Return primitives as-is
  return token;
}

/**
 * Converts a token to a stable string representation for comparison.
 * Handles Map objects, plain objects, arrays, and primitives.
 * Keys are sorted to ensure consistent comparison regardless of original key order.
 */
function tokenToString(token: unknown): string {
  const normalized = normalizeToken(token);
  return JSON.stringify(normalized);
}

/**
 * Formats an array of tokens for display.
 * If all tokens are UNIT (null), displays as bullet count (e.g., "••" or "3•").
 * Otherwise displays as JSON array.
 */
function formatTokensForDisplay(tokens: unknown[], isUnitType: boolean): string {
  if (isUnitType || tokens.every(t => t === null || t === undefined)) {
    // All unit tokens - display as bullets
    const count = tokens.length;
    if (count <= 3) {
      return '•'.repeat(count);
    } else {
      return `${count}•`;
    }
  }
  // Mixed or non-unit tokens - display as JSON
  return JSON.stringify(tokens);
}

/**
 * Desugars CPN Tools multiset arc expression notation into Rhai array syntax.
 * 
 * CPN Tools uses the notation:
 *   N`expr          — N copies of expr in a multiset
 *   expr1 ++ expr2  — multiset union
 * 
 * This function converts to Rhai arrays:
 *   "var1"              → "[var1]"         (bare variable = 1 copy)
 *   "2`var1"            → "[var1, var1]"   (2 copies)
 *   "1`var1++1`var2"    → "[var1, var2]"   (union of two singletons)
 *   "1`x++2`y"          → "[x, y, y]"     (union: 1 of x, 2 of y)
 *   "3`(a, b)"          → "[(a, b), (a, b), (a, b)]" (3 product tokens)
 */
function desugarMultisetExpression(inscription: string): string {
    const trimmed = inscription.trim();

    // Split on "++" (multiset union operator)
    // We need to be careful with "++" inside parentheses/brackets (e.g., function calls)
    const parts = splitOnMultisetUnion(trimmed);

    const allElements: string[] = [];

    for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;

        // Match coefficient`expression pattern: "N`expr"
        // The backtick separates the count from the expression
        // The expression can be a variable, a parenthesized tuple, etc.
        const coeffMatch = trimmedPart.match(/^(\d+)`(.+)$/s);

        if (coeffMatch) {
            const count = parseInt(coeffMatch[1], 10);
            const expr = coeffMatch[2].trim();
            for (let i = 0; i < count; i++) {
                allElements.push(expr);
            }
        } else {
            // No coefficient — treat as a single element
            // This handles bare variables like "x" or expressions like "(a, b)"
            allElements.push(trimmedPart);
        }
    }

    return `[${allElements.join(', ')}]`;
}

/**
 * Splits an inscription string on "++" operators, respecting nesting.
 * Does not split on "++" inside parentheses, brackets, or braces.
 */
function splitOnMultisetUnion(s: string): string[] {
    const parts: string[] = [];
    let depth = 0; // Track () [] {} nesting
    let current = '';

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            current += ch;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            current += ch;
        } else if (depth === 0 && ch === '+' && i + 1 < s.length && s[i + 1] === '+') {
            // Found "++" at top level
            parts.push(current);
            current = '';
            i++; // Skip the second '+'
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

/**
 * Flattens a hierarchical Petri net into a single flat net for simulation.
 * 
 * 1. Substitution transitions are replaced by the content of their subpages:
 *    - Port places on the subpage are merged with their socket places on the parent
 *    - All non-port nodes and remapped arcs from the subpage are added to the parent
 *    - The substitution transition and its arcs are removed
 * 
 * 2. Fusion places: All places in the same fusion set are merged into one canonical place.
 *    All arcs to/from non-canonical fusion places are redirected to the canonical one.
 */
function flattenHierarchicalNet(
  petriNetsById: Record<string, PetriNet>,
  petriNetOrder: string[],
  fusionSets: FusionSet[],
): { flattenedNets: Record<string, PetriNet>; flattenedOrder: string[] } {
  // Deep clone to avoid mutating originals
  const nets: Record<string, PetriNet> = JSON.parse(JSON.stringify(petriNetsById));

  // Phase 1: Inline substitution transitions (recursively)
  // Process each net starting from the "root" pages (those not referenced as subpages)
  const subPageIds = new Set<string>();
  for (const net of Object.values(nets)) {
    for (const node of net.nodes) {
      if (node.type === 'transition' && node.data?.subPageId) {
        subPageIds.add(node.data.subPageId as string);
      }
    }
  }

  // Inline subpages into their parent nets
  const inlineSubpage = (netId: string, visited: Set<string>) => {
    if (visited.has(netId)) return; // Prevent infinite recursion
    visited.add(netId);

    const net = nets[netId];
    if (!net) return;

    // First, recursively inline any subpages within our subpages
    for (const node of net.nodes) {
      if (node.type === 'transition' && node.data?.subPageId) {
        inlineSubpage(node.data.subPageId as string, visited);
      }
    }

    // Now inline all substitution transitions in this net
    let changed = true;
    while (changed) {
      changed = false;
      const subTransitions = net.nodes.filter(
        (n) => n.type === 'transition' && n.data?.subPageId
      );

      for (const subTrans of subTransitions) {
        const subPageId = subTrans.data.subPageId as string;
        const socketAssignments = (subTrans.data.socketAssignments as { portPlaceId: string; socketPlaceId: string }[]) || [];
        const subPage = nets[subPageId];
        if (!subPage) continue;

        // Build port-to-socket mapping
        const portToSocket = new Map<string, string>();
        socketAssignments.forEach((sa) => portToSocket.set(sa.portPlaceId, sa.socketPlaceId));

        // Get non-port nodes from subpage
        const subpageNonPortNodes = subPage.nodes.filter(
          (n) => !(n.type === 'place' && n.data?.portType)
        );

        // Add non-port nodes to this net (with position offset from socket assignment)
        let offsetX = 0, offsetY = 0;
        if (socketAssignments.length > 0) {
          const firstAssignment = socketAssignments[0];
          const portPlace = subPage.nodes.find((n) => n.id === firstAssignment.portPlaceId);
          const socketPlace = net.nodes.find((n) => n.id === firstAssignment.socketPlaceId);
          if (portPlace && socketPlace) {
            offsetX = (socketPlace.position?.x || 0) - (portPlace.position?.x || 0);
            offsetY = (socketPlace.position?.y || 0) - (portPlace.position?.y || 0);
          }
        }
        for (const node of subpageNonPortNodes) {
          net.nodes.push({
            ...node,
            position: {
              x: (node.position?.x || 0) + offsetX,
              y: (node.position?.y || 0) + offsetY,
            },
          });
        }

        // Remap arcs: replace port place references with socket places
        for (const edge of subPage.edges) {
          net.edges.push({
            ...edge,
            id: `flat_${edge.id}`,
            source: portToSocket.get(edge.source) || edge.source,
            target: portToSocket.get(edge.target) || edge.target,
          });
        }

        // Remove the substitution transition and its arcs from this net
        net.nodes = net.nodes.filter((n) => n.id !== subTrans.id);
        net.edges = net.edges.filter(
          (e) => e.source !== subTrans.id && e.target !== subTrans.id
        );

        changed = true;
        break; // Restart the loop since we modified the arrays
      }
    }
  };

  // Process root nets (those not referenced as subpages)
  const rootNets = petriNetOrder.filter((id) => !subPageIds.has(id));
  const visited = new Set<string>();
  for (const rootId of rootNets) {
    inlineSubpage(rootId, visited);
  }

  // Phase 2: Merge fusion places
  if (fusionSets.length > 0) {
    for (const fusionSet of fusionSets) {
      // Find all place nodes across all nets that belong to this fusion set
      const fusionPlaces: { netId: string; node: Node }[] = [];
      for (const [netId, net] of Object.entries(nets)) {
        for (const node of net.nodes) {
          if (node.type === 'place' && node.data?.fusionSetId === fusionSet.id) {
            fusionPlaces.push({ netId, node });
          }
        }
      }

      if (fusionPlaces.length <= 1) continue;

      // Pick the first as canonical
      const canonical = fusionPlaces[0];
      const canonicalId = canonical.node.id;

      // For all other fusion places, redirect their arcs to the canonical place
      for (let i = 1; i < fusionPlaces.length; i++) {
        const fp = fusionPlaces[i];
        const fpId = fp.node.id;
        const net = nets[fp.netId];

        // Redirect arcs
        net.edges = net.edges.map((e) => ({
          ...e,
          source: e.source === fpId ? canonicalId : e.source,
          target: e.target === fpId ? canonicalId : e.target,
        }));

        // Remove the non-canonical fusion place
        net.nodes = net.nodes.filter((n) => n.id !== fpId);
      }

      // Merge initial markings: combine all markings into canonical place
      const canonicalNet = nets[canonical.netId];
      const canonicalNode = canonicalNet.nodes.find((n) => n.id === canonicalId);
      if (canonicalNode) {
        // Use the canonical place's marking/initial marking as-is
        // The other places' tokens would be on the canonical place already
        // since they share the same fusion set
      }
    }
  }

  // Build the flattened result: only include root nets (subpages have been inlined)
  const flattenedNets: Record<string, PetriNet> = {};
  const flattenedOrder: string[] = [];
  for (const id of rootNets) {
    if (nets[id]) {
      flattenedNets[id] = nets[id];
      flattenedOrder.push(id);
    }
  }

  return { flattenedNets, flattenedOrder };
}

/**
 * Convert a frontend Monitor to the WASM MonitorConfig format.
 * The WASM side expects: { id, name, type, enabled, placeIds, transitionIds,
 *   observationScript, predicateScript, stopCondition }
 */
function monitorToWasmConfig(monitor: Monitor): Record<string, unknown> {
  return {
    id: monitor.id,
    name: monitor.name,
    type: monitor.type,
    enabled: monitor.enabled,
    placeIds: monitor.placeIds,
    transitionIds: monitor.transitionIds,
    observationScript: monitor.observationScript ?? '',
    predicateScript: monitor.predicateScript ?? '',
    stopCondition: monitor.config.stopCondition ?? null,
    startTransitionId: monitor.config.startTransitionId ?? null,
    endTransitionId: monitor.config.endTransitionId ?? null,
    correlationKey: monitor.config.correlationKey ?? '',
  };
}

export function useSimulationController() {
  const wasmRef = useRef<InitOutput | null>(null); // Initialize as null
  const wasmSimulatorRef = useRef<WasmSimulator | null>(null);
  const [isInitialized, setIsInitialized] = useState(false); // Track initialization
  const [isRunning, setIsRunning] = useState(false); // Track if simulation is running
  const stopRequestedRef = useRef(false); // Flag to request stop
  const [events, setEvents] = useState<SimulationEvent[]>([]); // State for simulation events
  const [stepCounter, setStepCounter] = useState(0); // State for step counter
  const stepCounterRef = useRef(0); // Synchronous source of truth for step counter
  const [simulationTime, setSimulationTime] = useState(0.0); // State for simulation time
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig>(DEFAULT_SIMULATION_CONFIG); // Simulation config

  // Socket-to-port mapping for synchronizing markings between parent and subpage places
  const socketToPortMapRef = useRef<Map<string, string[]>>(new Map());

  // Monitor results from WASM simulator
  const [monitorResults, setMonitorResults] = useState<MonitorResult[]>([]);

  // Refs for auto-invalidation: track whether simulation updates (not user edits) are causing store changes
  const isInitializedRef = useRef(false);
  const isSimulationUpdatingRef = useRef(false);

  // Get necessary actions/state selectors from Zustand store
  const updateNodeMarking = useStore((state) => state.updateNodeMarking);
  const applyInitialMarkings = useStore((state) => state.applyInitialMarkings);

  // Helper function to find a node by ID across all Petri nets in the store
  const findNodeById = useCallback((nodeId: string) => {
    const currentPetriNetsById = useStore.getState().petriNetsById;
    for (const netId in currentPetriNetsById) {
      const node = currentPetriNetsById[netId].nodes.find(n => n.id === nodeId);
      if (node) {
        return node;
      }
    }
    return undefined; // Return undefined if not found
  }, []); // No dependencies, relies on getState

  // Callback for the WASM event listener
  // Stable callback: Dependencies are stable functions/setters
  const handleWasmEvent = useCallback((eventData: {
    transitionId: string;
    transitionName?: string;
    simulationTime?: bigint | number; // New field from WASM (i64 = bigint)
    time?: number; // Legacy field - may be removed
    consumed?: Map<string, number[]>; // Use any[] for tokens from WASM
    produced?: Map<string, number[]> // Use any[] for tokens from WASM
  }) => {

    // Helper: after updating a node's marking, sync port places if this is a socket place
    const syncPortPlaces = (nodeId: string) => {
      const portIds = socketToPortMapRef.current.get(nodeId);
      if (portIds && portIds.length > 0) {
        // Get the latest marking from the socket place
        const socketNode = findNodeById(nodeId);
        const marking = socketNode?.data?.marking;
        if (Array.isArray(marking)) {
          for (const portId of portIds) {
            updateNodeMarking(portId, [...marking]);
          }
        }
      }
    };

    // --- Update Markings in Zustand Store ---
    if (eventData.consumed instanceof Map) {
      eventData.consumed.forEach((tokens: number[], nodeId: string) => {
        const node = findNodeById(nodeId); // Use helper
        if (node && node.type === 'place') {
          let currentMarking: number[] = [];
          try {
            // Get the latest marking directly from the store state for accuracy
            const latestNodeState = findNodeById(nodeId); // Use helper
            const markingSource = latestNodeState?.data?.marking;
            // Marking in store should ideally be an array already
            if (Array.isArray(markingSource)) {
              currentMarking = markingSource;
            } else if (typeof markingSource === 'number') {
              // Handle single number marking
              currentMarking = [markingSource];
            } else if (typeof markingSource === 'string' && markingSource.trim() !== '') {
              // Fallback: try parsing if it's a string
              const parsedMarking = JSON.parse(markingSource);
              currentMarking = Array.isArray(parsedMarking) ? parsedMarking : [parsedMarking];
            }
          } catch (error) {
            console.error(`Error reading/parsing marking for node ${nodeId}:`, node.data.marking, error);
            currentMarking = [];
          }

          const updatedMarking = [...currentMarking]; // Clone to modify
          tokens.forEach((token: number) => {
            const tokenString = tokenToString(token); // Compare by normalized string representation
            const index = updatedMarking.findIndex(mToken => tokenToString(mToken) === tokenString);
            if (index !== -1) {
              updatedMarking.splice(index, 1); // Remove one instance
            } else {
              // This might happen with complex tokens or if WASM state diverges; log it.
              console.warn(`Token not found for removal in node ${nodeId}:`, token, updatedMarking);
            }
          });
          // Update the store with the new marking (which should be an array)
          updateNodeMarking(nodeId, updatedMarking);
          syncPortPlaces(nodeId);
        } else {
          // Log if the node wasn't found or wasn't a place
          console.warn(`Place node not found or invalid for consumed event: ${nodeId}`);
        }
      });
    } else if (eventData.consumed) {
      // Log if consumed exists but isn't a Map (unexpected format)
      console.warn('eventData.consumed is not a Map:', eventData.consumed);
    }

    if (eventData.produced instanceof Map) {
      eventData.produced.forEach((tokens: number[], nodeId: string) => {
        const node = findNodeById(nodeId); // Use helper
        if (node && node.type === 'place') {
          let currentMarking: number[] = [];
           try {
             // Get the latest marking directly from the store state
            const latestNodeState = findNodeById(nodeId); // Use helper
            const markingSource = latestNodeState?.data?.marking;
             if (Array.isArray(markingSource)) {
              currentMarking = markingSource;
            } else if (typeof markingSource === 'number') {
              // Handle single number marking
              currentMarking = [markingSource];
            } else if (typeof markingSource === 'string' && markingSource.trim() !== '') {
              const parsedMarking = JSON.parse(markingSource);
              currentMarking = Array.isArray(parsedMarking) ? parsedMarking : [parsedMarking];
            }
          } catch (error) {
            console.error(`Error reading/parsing marking for node ${nodeId}:`, node.data.marking, error);
            currentMarking = [];
          }

          // Add produced tokens to the cloned marking (normalize Map objects to plain objects)
          const normalizedTokens = tokens.map(t => normalizeToken(t));
          const updatedMarking = [...currentMarking, ...normalizedTokens];
          // Update the store
          updateNodeMarking(nodeId, updatedMarking);
          syncPortPlaces(nodeId);
        } else {
           console.warn(`Place node not found or invalid for produced event: ${nodeId}`);
        }
      });
    } else if (eventData.produced) {
       console.warn('eventData.produced is not a Map:', eventData.produced);
    }

    // --- Create and Add SimulationEvent to Local State ---
    const transitionNode = findNodeById(eventData.transitionId); // Use helper
    // Ensure transitionName is a string (using label), fallback to transitionId
    const transitionName = (transitionNode?.data?.label && typeof transitionNode.data.label === 'string') ? transitionNode.data.label : eventData.transitionId;

    // Get colorSets from store to check for UNIT types
    const colorSets = useStore.getState().colorSets;

    // Helper to convert WASM token map to TokenMovement array for the event log
    const mapTokenMovements = (tokenMap: Map<string, number[]> | undefined): TokenMovement[] => {
        if (!tokenMap) return [];
        const movements: TokenMovement[] = [];
        tokenMap.forEach((tokens, placeId) => {
            const placeNode = findNodeById(placeId); // Use helper
            // Ensure placeName is a string (using label), fallback to placeId
            const placeName = (placeNode?.data?.label && typeof placeNode.data.label === 'string') ? placeNode.data.label : placeId;
            // Check if this place uses a UNIT colorset
            const placeColorSet = typeof placeNode?.data?.colorSet === 'string' ? placeNode.data.colorSet : '';
            const isUnitType = placeColorSet.toUpperCase() === 'UNIT' || 
                colorSets.some(cs => cs.name === placeColorSet && cs.name.toUpperCase() === 'UNIT');
            // Normalize tokens (convert Maps to plain objects)
            const normalizedTokens = tokens.map(t => normalizeToken(t));
            movements.push({
                placeId: placeId,
                placeName: placeName, // Use validated name
                tokens: formatTokensForDisplay(normalizedTokens, isUnitType), // Format with bullet for UNIT
            });
        });
        return movements;
    };

    // Increment step counter synchronously via ref, then sync to state
    stepCounterRef.current += 1;
    const eventStepNumber = stepCounterRef.current;
    setStepCounter(eventStepNumber);

    // Extract simulation time - handle both bigint (new) and number (legacy) formats
    const simTime = eventData.simulationTime !== undefined 
      ? Number(eventData.simulationTime) 
      : (eventData.time ?? 0);

    // Construct the new event object
    const newEvent: SimulationEvent = {
      id: uuidv4(), // Generate unique ID
      step: eventStepNumber, // Use the *incremented* step number for this event
      time: simTime, // Time from WASM event (converted from bigint ms)
      transitionId: eventData.transitionId,
      transitionName: transitionName, // Use validated name (label)
      tokens: {
        consumed: mapTokenMovements(eventData.consumed),
        produced: mapTokenMovements(eventData.produced),
      },
      timestamp: new Date(), // Record when the event was processed by the UI
    };

    // Update the local events state for the EventLog component
    setEvents(prevEvents => [...prevEvents, newEvent]);
    // Update the simulation time state
    setSimulationTime(simTime);

    // NOTE: Monitor results are fetched AFTER run_step() returns (in _executeWasmStep
    // and other callers) to avoid a RefCell double-borrow panic. The handleWasmEvent
    // callback is invoked while run_step() still holds &mut self on the WASM simulator,
    // so calling getMonitorResults() here would cause "recursive use of an object".

  // Keep dependencies stable: only include functions/setters
  }, [updateNodeMarking, findNodeById, setStepCounter, setEvents, setSimulationTime]);

  // Function to initialize or re-initialize the WASM simulator
  async function _initializeWasm() {
    //console.log("Attempting to initialize WASM Simulator...");
    // Reset state before initialization
    setEvents([]);
    setStepCounter(0);
    stepCounterRef.current = 0;
    setSimulationTime(0.0);
    isInitializedRef.current = false; // Prevent auto-invalidation subscriber from triggering
    setIsInitialized(false); // Mark as not initialized until successful
    wasmRef.current = null; // Clear refs
    wasmSimulatorRef.current = null;

    try {
        wasmRef.current = await init(); // Initialize the WASM module
        //console.log("WASM module loaded.");

        // Apply initial markings based on the current store state
        // This action should update the markings within the Zustand store
        applyInitialMarkings();
        //console.log("Initial markings applied to store.");

        // Get the *latest* state from the store *after* applying initial markings
        const currentPetriNetsById = useStore.getState().petriNetsById;
        const currentPetriNetOrder = useStore.getState().petriNetOrder;
        const currentColorSets = useStore.getState().colorSets;
        const currentVariables = useStore.getState().variables;
        const currentPriorities = useStore.getState().priorities;
        const currentFunctions = useStore.getState().functions;
        const currentUses = useStore.getState().uses;
        const currentValues = useStore.getState().values;
        const currentSimulationEpoch = useStore.getState().simulationEpoch;
        const currentFusionSets = useStore.getState().fusionSets;

        // Flatten hierarchical nets (substitute transitions + merge fusion places)
        const { flattenedNets, flattenedOrder } = flattenHierarchicalNet(
          currentPetriNetsById,
          currentPetriNetOrder,
          currentFusionSets,
        );

        // Build socket-to-port mapping for marking synchronization
        // When WASM updates a socket place, we also update the corresponding port place(s)
        const socketToPort = new Map<string, string[]>();
        for (const net of Object.values(currentPetriNetsById)) {
          for (const node of net.nodes) {
            if (node.type === 'transition' && node.data?.socketAssignments) {
              const assignments = node.data.socketAssignments as { portPlaceId: string; socketPlaceId: string }[];
              for (const sa of assignments) {
                const existing = socketToPort.get(sa.socketPlaceId) || [];
                existing.push(sa.portPlaceId);
                socketToPort.set(sa.socketPlaceId, existing);
              }
            }
          }
        }
        socketToPortMapRef.current = socketToPort;

        // Sync initial markings from socket places to their port places
        // Port places typically have no initialMarking; they should mirror their socket place
        if (socketToPort.size > 0) {
          const state = useStore.getState();
          for (const [socketId, portIds] of socketToPort.entries()) {
            // Find the socket place's current marking
            let socketMarking: (string | number)[] | undefined;
            for (const net of Object.values(state.petriNetsById)) {
              const socketNode = net.nodes.find(n => n.id === socketId && n.type === 'place');
              if (socketNode) {
                socketMarking = Array.isArray(socketNode.data.marking) ? socketNode.data.marking : [];
                break;
              }
            }
            if (socketMarking && socketMarking.length > 0) {
              for (const portId of portIds) {
                updateNodeMarking(portId, socketMarking);
              }
            }
          }
        }

        // Prepare the data structure for the WASM simulator
        // Merge values into uses as "val name = expression;" since the Rust simulator
        // processes them from the uses array via scope.push_constant()
        const valuesAsUses = currentValues.map((v) => ({
          id: v.id,
          name: v.name,
          content: `val ${v.name} = ${v.expression};`,
        }));
        const petriNetData: PetriNetData = {
          petriNetsById: structuredClone(flattenedNets), // Use flattened nets
          petriNetOrder: flattenedOrder,
          colorSets: currentColorSets,
          variables: currentVariables,
          priorities: currentPriorities,
          functions: currentFunctions,
          uses: [...currentUses, ...valuesAsUses],
          values: currentValues,
          simulationSettings: {
            simulationEpoch: currentSimulationEpoch,
          },
        }

        // --- Preprocessing Petri Net Data for WASM ---
        // Ensure markings and inscriptions are in the format WASM expects (e.g., stringified JSON arrays)
        Object.values(petriNetData.petriNetsById).forEach((petriNet) => {
            petriNet.nodes.forEach((node) => {
                if (node.type === 'place') {
                    // Ensure node.data.marking is a stringified array for WASM
                    let markingArray: number[] = [];
                    if (Array.isArray(node.data.marking)) {
                        markingArray = node.data.marking; // Should be array after applyInitialMarkings/updateNodeMarking
                    } else if (typeof node.data.marking === 'string') { // Fallback if it's still string
                          try {
                            const parsed = JSON.parse(node.data.marking);
                            if (Array.isArray(parsed)) markingArray = parsed;
                         } catch { console.warn(`Could not parse marking string for node ${node.id}: ${node.data.marking}`); }
                    }
                    node.data.marking = JSON.stringify(markingArray); // Stringify for WASM

                    // Keep initialMarking as-is for WASM to evaluate as Rhai expression
                    // Only convert to array format if it's already a JSON array or a simple value
                    if (node.data.initialMarking) {
                        const im = node.data.initialMarking;
                        if (typeof im === 'string') {
                            // Check if it looks like a JSON array already
                            if (im.startsWith('[') && im.endsWith(']')) {
                                // Keep as-is - it's already an array expression
                            } else if (im.endsWith('.all()')) {
                                // Resolve .all() on the TypeScript side — Rhai doesn't support this syntax.
                                // Look up the color set and expand the int range into a JSON array.
                                const csName = im.substring(0, im.length - '.all()'.length).trim();
                                const cs = currentColorSets.find(c => c.name === csName);
                                if (cs && cs.definition.includes('int')) {
                                    const rangeMatch = cs.definition.match(/with\s+(\d+)\.\.(\d+)/);
                                    if (rangeMatch) {
                                        const start = parseInt(rangeMatch[1], 10);
                                        const end = parseInt(rangeMatch[2], 10);
                                        if (!isNaN(start) && !isNaN(end)) {
                                            const allValues = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                                            node.data.initialMarking = JSON.stringify(allValues);
                                        }
                                    }
                                }
                            } else if (im.trim() === '') {
                                node.data.initialMarking = '[]';
                            }
                            // Otherwise keep the original expression (e.g., "1", "8", "all_orders()")
                            // which Rhai can evaluate directly
                        } else if (Array.isArray(im)) {
                            node.data.initialMarking = JSON.stringify(im);
                        }
                    } else {
                        node.data.initialMarking = '[]';
                    }
                }
            });

            // Preprocess arc inscriptions: desugar CPN Tools multiset notation to Rhai arrays
            // Examples:
            //   "var1"              → "[var1]"
            //   "2`var1"            → "[var1, var1]"
            //   "1`var1++1`var2"    → "[var1, var2]"
            //   "1`x++2`y"         → "[x, y, y]"
            //   "(a, b)"           → "[(a, b)]"  (product token — single element array)
            //   "[x, y]"           → "[x, y]"    (already an array — keep as-is)
            petriNet.edges.forEach((arc) => {
                if (arc.label && typeof arc.label === 'string') {
                    let inscription = arc.label.trim();

                    // Handle @+ arc delay syntax: split "expr @+ delay" into inscription + delay
                    // This handles the case where users type the inscription with delay inline
                    const atPlusIndex = inscription.indexOf('@+');
                    if (atPlusIndex !== -1) {
                        const delayPart = inscription.substring(atPlusIndex + 2).trim();
                        inscription = inscription.substring(0, atPlusIndex).trim();
                        arc.label = inscription;
                        // Store the delay in arc data (will be serialized as separate field)
                        if (delayPart) {
                            const arcData = arc.data as Record<string, unknown> || {};
                            arcData.delay = delayPart;
                            arc.data = arcData;
                        }
                    }

                    // Skip empty inscriptions or those already in array form
                    if (!inscription || (inscription.startsWith('[') && inscription.endsWith(']'))) {
                        return;
                    }
                    // Check if it uses CPN Tools multiset notation (contains ` backtick or ++)
                    if (inscription.includes('`') || inscription.includes('++')) {
                        const newInscription = desugarMultisetExpression(inscription);
                        if (newInscription !== inscription) {
                            console.log(`Desugared arc inscription "${inscription}" → "${newInscription}"`);
                            arc.label = newInscription;
                        }
                    }
                }
            });
        });
        // --- End Preprocessing ---

        // Convert the processed data to the final JSON format for WASM
        const petriNetJSON = convertToJSON(petriNetData);
        // console.log("Initializing WASM with JSON:", petriNetJSON); // Debug log (can be large)

        // Create the WASM simulator instance
        console.log("Creating WASM Simulator with JSON:", petriNetJSON);
        wasmSimulatorRef.current = new WasmSimulator(petriNetJSON);
        console.log("WASM Simulator created successfully");
        // Set the event listener callback
        wasmSimulatorRef.current.setEventListener(handleWasmEvent);

        // Sync WASM-computed markings back to the frontend store.
        // This is essential for expression-based initial markings (e.g., all_orders())
        // which WASM/Rhai evaluates but applyInitialMarkings cannot parse as JSON.
        try {
          const wasmMarking = wasmSimulatorRef.current.getMarking();
          if (wasmMarking && typeof wasmMarking === 'object') {
            // wasmMarking is a Map or plain object: placeId → token[]
            const entries: [string, unknown[]][] = wasmMarking instanceof Map
              ? Array.from(wasmMarking.entries())
              : Object.entries(wasmMarking);
            for (const [placeId, tokens] of entries) {
              if (Array.isArray(tokens)) {
                // Normalize tokens (convert Maps to plain objects for consistent comparison)
                const normalized = tokens.map(normalizeToken);
                updateNodeMarking(placeId, normalized);
              }
            }
          }
        } catch (e) {
          console.warn("Failed to sync WASM marking to frontend:", e);
        }

        // Register monitors from the store in the WASM simulator
        const currentMonitors = useStore.getState().monitors;
        for (const monitor of currentMonitors) {
          if (monitor.enabled) {
            try {
              wasmSimulatorRef.current.addMonitor(monitorToWasmConfig(monitor));
            } catch (e) {
              console.warn(`Failed to register monitor '${monitor.name}':`, e);
            }
          }
        }

        // Mark initialization as complete
        isInitializedRef.current = true;
        setIsInitialized(true);
        console.log("WASM Simulator initialized successfully.");

    } catch (error) {
        // Log errors during initialization
        console.error("Error initializing WASM Simulator:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error('Simulation initialization failed', {
          description: errorMsg,
          duration: 10000,
        });
        setIsInitialized(false); // Ensure state reflects failure
        wasmRef.current = null;
        wasmSimulatorRef.current = null;
    }
  }

  // Ensure the WASM module is initialized before running steps
  // Exposed for external use (e.g., before running multiple steps)
  const ensureInitialized = useCallback(async () => {
    // Initialize only if refs are null or initialization flag is false
    if (!isInitializedRef.current || !wasmRef.current || !wasmSimulatorRef.current) {
        //console.log("Ensuring initialization...");
        await _initializeWasm();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: fetch monitor results from WASM after a step completes.
  // Must be called OUTSIDE the run_step callback to avoid RefCell double-borrow.
  const _fetchMonitorResults = () => {
    if (wasmSimulatorRef.current) {
      try {
        const results = wasmSimulatorRef.current.getMonitorResults() as MonitorResult[];
        setMonitorResults(results ?? []);
      } catch (e) {
        console.warn('Failed to get monitor results:', e);
      }
    }
  };

  // Core logic to execute a single WASM step
  // Assumes WASM is already initialized
  const _executeWasmStep = (): unknown => {
    if (wasmSimulatorRef.current) { // Check the ref directly
        try {
            // Step counter is now incremented reactively in handleWasmEvent
            console.log(`Requesting simulation step...`);
            // Guard: mark as simulation update so the auto-invalidation subscriber ignores marking changes
            isSimulationUpdatingRef.current = true;
            // Execute the step in WASM
            const result = wasmSimulatorRef.current.run_step();
            console.log(`Simulation step result:`, result);
            // Event handling (including state updates and step increment) happens in handleWasmEvent callback
            // Fetch monitor results now that run_step() has released its borrow
            _fetchMonitorResults();
            // Update simulation time to post-step model time (may differ from event's
            // firing time if the simulator eagerly advanced to the next enabled time)
            if (result !== null && result !== undefined) {
              const postStepTime = wasmSimulatorRef.current.getCurrentTime();
              setSimulationTime(Number(postStepTime));
            }
            return result;
        } catch (error) {
            console.error("Error running simulation step:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            toast.error('Simulation step failed', {
              description: errorMsg,
              duration: 8000,
            });
            return null;
        } finally {
            isSimulationUpdatingRef.current = false;
        }
    } else {
        // This should ideally not happen if ensureInitialized succeeded without errors,
        // but keep the warning as a safeguard.
        console.warn("WASM Simulator ref is null after initialization attempt, cannot run step.");
        return null;
    }
  };

  // Function to run a single simulation step (ensures init first)
  const runStep = async () => {
    await ensureInitialized(); // Make sure WASM is ready
    pauseUndo();
    try {
      _executeWasmStep(); // Execute the core step logic
    } finally {
      resumeUndo();
    }
  };

  // Function to run multiple steps with intermediate markings (animated)
  const runMultipleStepsAnimated = async (steps: number, delayMs: number = 50) => {
    if (isRunning) return; // Prevent concurrent runs
    
    setIsRunning(true);
    stopRequestedRef.current = false;
    pauseUndo();
    
    try {
      await ensureInitialized();
      for (let i = 0; i < steps; i++) {
        if (stopRequestedRef.current) {
          console.log("Simulation stopped by user");
          break;
        }
        const result = _executeWasmStep();
        if (result == null) {
          console.log("No transitions enabled, stopping animation.");
          break;
        }
        // Check for breakpoint hits from WASM monitors
        if (wasmSimulatorRef.current?.hasBreakpointHit()) {
          console.log("Breakpoint hit — stopping simulation.");
          break;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } finally {
      setIsRunning(false);
      resumeUndo();
    }
  };

  // Function to run multiple steps without intermediate markings (fast)
  const runMultipleStepsFast = async (steps: number) => {
    if (isRunning) return; // Prevent concurrent runs
    
    setIsRunning(true);
    stopRequestedRef.current = false;
    pauseUndo();
    
    // Yield to the browser so React can repaint (show busy cursor / disabled buttons)
    // before the synchronous WASM call blocks the JS thread
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    
    try {
      await ensureInitialized();
      if (wasmSimulatorRef.current) {
        // Check if the WASM simulator has the runMultipleSteps method
        const simulator = wasmSimulatorRef.current as unknown as {
          runMultipleSteps?: (steps: number) => unknown[];
        };
        
        if (typeof simulator.runMultipleSteps === 'function') {
          // Use batch execution - events are returned as an array
          // Guard: mark as simulation update so the auto-invalidation subscriber ignores marking changes
          isSimulationUpdatingRef.current = true;
          try {
            const results = simulator.runMultipleSteps(steps);
            
            // Process all results to update the UI state
            if (Array.isArray(results)) {
              for (const eventData of results) {
                if (eventData && typeof eventData === 'object') {
                  // Process each event through the event handler
                  handleWasmEvent(eventData as {
                    transitionId: string;
                    time: number;
                    consumed?: Map<string, number[]>;
                    produced?: Map<string, number[]>;
                  });
                }
                // Check for breakpoint hits after each event
                if (wasmSimulatorRef.current?.hasBreakpointHit()) {
                  console.log("Breakpoint hit during batch — stopping.");
                  break;
                }
              }
            }
          } catch (error) {
            console.error("Error running batch simulation steps:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            toast.error('Simulation failed', {
              description: errorMsg,
              duration: 8000,
            });
          } finally {
            isSimulationUpdatingRef.current = false;
          }
          // Fetch monitor results after batch execution
          _fetchMonitorResults();
          // Update simulation time to post-batch model time
          if (wasmSimulatorRef.current) {
            const postBatchTime = wasmSimulatorRef.current.getCurrentTime();
            setSimulationTime(Number(postBatchTime));
          }
        } else {
          // Fallback: run steps one by one without delay
          for (let i = 0; i < steps; i++) {
            if (stopRequestedRef.current) break;
            const result = _executeWasmStep();
            if (result == null) {
              console.log("No transitions enabled, stopping fast run.");
              break;
            }
            // Check for breakpoint hits
            if (wasmSimulatorRef.current?.hasBreakpointHit()) {
              console.log("Breakpoint hit — stopping simulation.");
              break;
            }
          }
        }
      }
    } finally {
      setIsRunning(false);
      resumeUndo();
    }
  };

  // Function to stop an ongoing simulation
  const stop = () => {
    console.log("Stop requested");
    stopRequestedRef.current = true;
  };

  // Function to fire a specific transition by ID
  const fireTransition = async (transitionId: string) => {
    await ensureInitialized();
    if (wasmSimulatorRef.current) {
      const simulator = wasmSimulatorRef.current as unknown as {
        fireTransition?: (transitionId: string) => unknown;
      };
      
      if (typeof simulator.fireTransition === 'function') {
        pauseUndo();
        try {
          // Guard: mark as simulation update so the auto-invalidation subscriber ignores marking changes
          isSimulationUpdatingRef.current = true;
          const result = simulator.fireTransition(transitionId);
          console.log(`Fire transition ${transitionId} result:`, result);
          // Event handling happens via the event listener callback
          // Fetch monitor results after the transition fires
          _fetchMonitorResults();
        } catch (error) {
          console.error(`Error firing transition ${transitionId}:`, error);
        } finally {
          isSimulationUpdatingRef.current = false;
          resumeUndo();
        }
      } else {
        console.warn("fireTransition method not available in WASM simulator");
      }
    }
  };

  // Function to get enabled transitions
  const getEnabledTransitions = async (): Promise<Array<{ transitionId: string; transitionName: string }>> => {
    await ensureInitialized();
    if (wasmSimulatorRef.current) {
      const simulator = wasmSimulatorRef.current as unknown as {
        getEnabledTransitions?: () => Array<{ transitionId: string; transitionName: string }>;
      };
      
      if (typeof simulator.getEnabledTransitions === 'function') {
        try {
          return simulator.getEnabledTransitions();
        } catch (error) {
          console.error("Error getting enabled transitions:", error);
        }
      }
    }
    return [];
  };

  // Function to reset the simulation
  const reset = async () => {
    //console.log("Resetting simulation...");
    stopRequestedRef.current = true; // Stop any ongoing simulation
    setIsRunning(false);
    setStepCounter(0); // Reset step counter state
    stepCounterRef.current = 0; // Reset ref
    setSimulationTime(0.0); // Reset simulation time state
    setEvents([]); // Reset events state
    setMonitorResults([]); // Clear monitor results state
    // Re-initializing effectively resets the simulation state in WASM
    await _initializeWasm();
  };

  // Function to clear the event log in the UI
  const clearEvents = () => {
      //console.log("Clearing event log.");
      setEvents([]); // Reset the local events state
  }

  // Auto-invalidate simulation when the model changes structurally.
  // This prevents stale WASM state from producing incorrect results after model edits.
  useEffect(() => {
    const unsub = useStore.subscribe((state, prevState) => {
      // Skip if simulation is not initialized or we're inside a simulation update
      if (!isInitializedRef.current || isSimulationUpdatingRef.current) return;

      // Check if declarations changed (reference equality — cheap)
      const declarationsChanged =
        state.petriNetOrder !== prevState.petriNetOrder ||
        state.colorSets !== prevState.colorSets ||
        state.variables !== prevState.variables ||
        state.priorities !== prevState.priorities ||
        state.functions !== prevState.functions ||
        state.uses !== prevState.uses ||
        state.fusionSets !== prevState.fusionSets;

      // For petriNetsById, we need to check if nodes or edges actually changed
      // (ignoring selectedElement changes which happen on tab switch/selection,
      //  and position-only changes which happen when moving nodes)
      let netsStructurallyChanged = false;
      if (state.petriNetsById !== prevState.petriNetsById) {
        const curIds = Object.keys(state.petriNetsById);
        const prevIds = Object.keys(prevState.petriNetsById);
        if (curIds.length !== prevIds.length) {
          netsStructurallyChanged = true;
        } else {
          for (const id of curIds) {
            const cur = state.petriNetsById[id];
            const prev = prevState.petriNetsById[id];
            if (!prev || cur.name !== prev.name) {
              netsStructurallyChanged = true;
              break;
            }
            // For edges, distinguish layout-only changes (label offset, bendpoints)
            // from structural changes that affect simulation semantics.
            if (cur.edges !== prev.edges) {
              if (cur.edges.length !== prev.edges.length) {
                netsStructurallyChanged = true;
                break;
              }
              const edgeLayoutKeys = new Set(['labelOffset', 'bendpoints']);
              for (let i = 0; i < cur.edges.length; i++) {
                const ce = cur.edges[i];
                const pe = prev.edges[i];
                if (ce.id !== pe.id || ce.source !== pe.source || ce.target !== pe.target || ce.label !== pe.label) {
                  netsStructurallyChanged = true;
                  break;
                }
                if (ce.data !== pe.data) {
                  const cData = (ce.data ?? {}) as Record<string, unknown>;
                  const pData = (pe.data ?? {}) as Record<string, unknown>;
                  const allKeys = new Set([...Object.keys(cData), ...Object.keys(pData)]);
                  for (const key of allKeys) {
                    if (edgeLayoutKeys.has(key)) continue;
                    if (cData[key] !== pData[key]) {
                      netsStructurallyChanged = true;
                      break;
                    }
                  }
                  if (netsStructurallyChanged) break;
                }
              }
              if (netsStructurallyChanged) break;
            }
            // For nodes, distinguish layout-only changes (position moves, inscription
            // offset drags) from structural changes that affect simulation semantics.
            if (cur.nodes !== prev.nodes) {
              if (cur.nodes.length !== prev.nodes.length) {
                netsStructurallyChanged = true;
                break;
              }
              for (let i = 0; i < cur.nodes.length; i++) {
                const cn = cur.nodes[i];
                const pn = prev.nodes[i];
                if (cn.id !== pn.id || cn.type !== pn.type) {
                  netsStructurallyChanged = true;
                  break;
                }
                // If data ref changed, check whether only layout offsets differ.
                // Inscription offset properties (e.g. markingOffset, guardOffset) are
                // purely visual and should not invalidate the simulation.
                if (cn.data !== pn.data) {
                  const layoutKeys = new Set([
                    'colorSetOffset', 'tokenCountOffset', 'markingOffset',
                    'guardOffset', 'timeOffset',
                  ]);
                  const cData = cn.data as Record<string, unknown>;
                  const pData = pn.data as Record<string, unknown>;
                  const allKeys = new Set([...Object.keys(cData), ...Object.keys(pData)]);
                  for (const key of allKeys) {
                    if (layoutKeys.has(key)) continue;
                    if (cData[key] !== pData[key]) {
                      netsStructurallyChanged = true;
                      break;
                    }
                  }
                  if (netsStructurallyChanged) break;
                }
              }
              if (netsStructurallyChanged) break;
            }
          }
        }
      }

      if (declarationsChanged || netsStructurallyChanged) {
        console.log('Model changed while simulation was active — resetting simulation.');
        // Tear down the simulation
        stopRequestedRef.current = true;
        setIsRunning(false);
        isInitializedRef.current = false;
        setIsInitialized(false);
        wasmSimulatorRef.current = null;
        socketToPortMapRef.current = new Map();
        setEvents([]);
        setStepCounter(0);
        stepCounterRef.current = 0;
        setSimulationTime(0.0);
        // Restore initial markings so the UI doesn't show stale simulation state
        useStore.getState().applyInitialMarkings();
      }
    });

    return unsub;
  }, []);

  const calculateStateSpace = useCallback(
    async (
      maxStates?: number,
      maxArcs?: number,
      isTimed?: boolean,
      distOverrides?: Record<string, number>,
      intRangeOverrides?: Record<string, number>,
    ): Promise<StateSpaceResult | null> => {
      // Always re-initialize so state space starts from initial markings,
      // not the current simulation state.
      await _initializeWasm();
      if (!wasmSimulatorRef.current) return null;
      try {
        const result = wasmSimulatorRef.current.calculateStateSpace(
          maxStates ?? undefined,
          maxArcs ?? undefined,
          isTimed ?? undefined,
          distOverrides ?? undefined,
          intRangeOverrides ?? undefined,
        );
        return result as StateSpaceResult;
      } catch (err) {
        console.error('State space calculation failed:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        toast.error('State space calculation failed', {
          description: errorMsg,
          duration: 8000,
        });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Return the state and functions needed by UI components
  return { 
    runStep, 
    runMultipleStepsAnimated,
    runMultipleStepsFast,
    stop,
    fireTransition,
    getEnabledTransitions,
    reset, 
    events, 
    clearEvents, 
    isInitialized, 
    isRunning,
    simulationTime, 
    stepCounter,
    simulationConfig,
    setSimulationConfig,
    ensureInitialized, 
    _executeWasmStep,
    monitorResults,
    calculateStateSpace,
  };
}

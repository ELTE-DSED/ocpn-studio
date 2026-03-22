import { create } from 'zustand';
import { temporal } from 'zundo';
import { Node, Edge } from '@xyflow/react';
import { AppState, AppActions, PetriNet, SelectedElement } from '@/types';
import type { FusionSet, Monitor } from '@/types';

import { v4 as uuidv4 } from 'uuid';

import { initialNodes } from '@/nodes';
import { initialEdges } from '@/edges';

import { initialColorSets } from '@/declarations';
import { initialVariables } from '@/declarations';
import { initialPriorities } from '@/declarations';
import { initialFunctions } from '@/declarations';

import type { PlaceNodeData } from '@/nodes/PlaceNode';
import { TransitionNodeData } from '@/nodes/TransitionNode';
import { AuxTextNodeData } from '@/nodes/AuxTextNode';
import type { ArcType } from '@/types';
import { validateModel, type ValidationErrors } from '@/utils/validation';

// define the initial state
const emptyState: AppState = {
  ocpnName: 'Demo OCPN',
  petriNetsById: {},
  petriNetOrder: [],
  activePetriNetId: null,
  activeMode: 'model',
  colorSets: [],
  variables: [],
  priorities: [],
  functions: [],
  uses: [],
  values: [],
  simulationEpoch: null,
  showMarkingDisplay: true,
  isArcMode: false,
  activeArcType: 'normal' as ArcType,
  fusionSets: [],
  monitors: [],
  stateSpaceResult: null,
  activeSpecialTab: null,
  focusRequest: null,
  validationErrors: {} as ValidationErrors,
}

export type StoreState = AppState & AppActions;

const initialPetriNetId = "ID6";

const initialPetriNet: PetriNet = {
  id: initialPetriNetId,
  name: "Main",
  nodes: initialNodes,
  edges: initialEdges,
  selectedElement: null,
};

// --- Undo batching state (module-level, used by handleSet) ---
let _undoBatchDepth = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _undoBatchFirstState: any = undefined;
let _undoBatchReplace: boolean | undefined;
// Reference to the real handleSet so endBatch can flush
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _realHandleSet: ((state: any, replace: any) => void) | undefined;

// Helper to strip transient fields from petri nets for undo tracking
const stripTransientPetriNetFields = (petriNetsById: Record<string, PetriNet>) => {
  const result: Record<string, { id: string; name: string; nodes: { id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown> }[]; edges: { id: string; source: string; target: string; label?: unknown; data?: Record<string, unknown> }[] }> = {};
  for (const [id, pn] of Object.entries(petriNetsById)) {
    if (!pn || !pn.nodes || !pn.edges) continue;
    result[id] = {
      id: pn.id,
      name: pn.name,
      nodes: pn.nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: pn.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        data: e.data as Record<string, unknown> | undefined,
      })),
    };
  }
  return result;
};

// this is our useStore hook that we can use in our components to get parts of the store and call actions
const useStore = create<StoreState>()(temporal((set) => ({
  ocpnName: 'Demo OCPN',
  petriNetsById: {
    [initialPetriNetId]: initialPetriNet,
  },
  petriNetOrder: [initialPetriNetId],
  activePetriNetId: initialPetriNetId,
  colorSets: initialColorSets,
  variables: initialVariables,
  priorities: initialPriorities,
  functions: initialFunctions,
  uses: [],
  values: [],
  simulationEpoch: null,
  showMarkingDisplay: true,
  isArcMode: false,
  activeArcType: 'normal' as ArcType,
  activeMode: 'model',
  fusionSets: [],
  monitors: [],
  stateSpaceResult: null,
  activeSpecialTab: null,
  focusRequest: null,
  validationErrors: {} as ValidationErrors,

  // Actions
  setNodes: (petriNetId: string, nodes: Node[]) => {
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [petriNetId]: {
          ...state.petriNetsById[petriNetId],
          nodes,
        },
      },
    }));
  },
  setEdges: (petriNetId: string, edges: Edge[]) => {
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [petriNetId]: {
          ...state.petriNetsById[petriNetId],
          edges,
        },
      },
    }));
  },

  // Create a new Petri net
  createPetriNet: (name: string) => {
    const newPetriNetId = uuidv4();
    const newPetriNet: PetriNet = {
      id: newPetriNetId,
      name,
      nodes: [],
      edges: [],
      selectedElement: null,
    };
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [newPetriNetId]: newPetriNet,
      },
      petriNetOrder: [...state.petriNetOrder, newPetriNetId],
      activePetriNetId: newPetriNetId,
    }));
  },
  // Add a new Petri net
  addPetriNet: (newPetriNet: PetriNet) => {
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [newPetriNet.id]: {
          ...newPetriNet,
          selectedElement: null,
        },
      },
      petriNetOrder: [...state.petriNetOrder, newPetriNet.id],
      activePetriNetId: newPetriNet.id,
    }));
  },
  setActivePetriNet: (id) => {
    set((state) => {
      // Guard: don't switch to a non-existent petri net
      if (!state.petriNetsById[id]) return state;
      return {
        activePetriNetId: id,
        petriNetsById: {
          ...state.petriNetsById,
          [id]: {
            ...state.petriNetsById[id],
            selectedElement: null,
          },
        },
      };
    });
  },
  duplicatePetriNet: (id) => {
    const state = useStore.getState();
    const source = state.petriNetsById[id];
    if (!source) return;

    // Build ID remap table
    const idMap = new Map<string, string>();
    source.nodes.forEach((n) => idMap.set(n.id, uuidv4()));
    source.edges.forEach((e) => idMap.set(e.id, uuidv4()));

    const newId = uuidv4();
    const remappedNodes = source.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      data: {
        ...n.data,
        // Clear hierarchy links — duplicated subpage is disconnected
        subPageId: undefined,
        socketAssignments: undefined,
        portType: undefined,
        fusionSetId: undefined,
      },
    }));
    const remappedEdges = source.edges.map((e) => ({
      ...e,
      id: idMap.get(e.id)!,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    }));

    const newNet: PetriNet = {
      id: newId,
      name: `${source.name} (copy)`,
      nodes: remappedNodes,
      edges: remappedEdges,
      selectedElement: null,
    };

    set((s) => ({
      petriNetsById: { ...s.petriNetsById, [newId]: newNet },
      petriNetOrder: [...s.petriNetOrder, newId],
      activePetriNetId: newId,
    }));
  },
  renamePetriNet: (id: string, newName: string) => {
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [id]: {
          ...state.petriNetsById[id],
          name: newName,
        },
      },
    }));
  },
  deletePetriNet: (id: string) =>
    set((state) => {
      // Cannot delete the main (first) net
      if (state.petriNetOrder[0] === id) return state;
      // Clean up substitution transitions in other nets that reference this subpage
      const updatedNetsById = { ...state.petriNetsById };
      for (const [netId, net] of Object.entries(updatedNetsById)) {
        if (netId === id) continue;
        const hasReference = net.nodes.some(
          (n) => n.type === 'transition' && n.data?.subPageId === id
        );
        if (hasReference) {
          updatedNetsById[netId] = {
            ...net,
            nodes: net.nodes.map((n) => {
              if (n.type === 'transition' && n.data?.subPageId === id) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { subPageId, socketAssignments, ...restData } = n.data as Record<string, unknown>;
                return { ...n, data: restData };
              }
              return n;
            }),
          };
        }
      }
      delete updatedNetsById[id];
      const newOrder = state.petriNetOrder.filter((pid) => pid !== id);
      return {
        petriNetsById: updatedNetsById,
        petriNetOrder: newOrder,
        activePetriNetId: state.activePetriNetId === id ? newOrder[0] : state.activePetriNetId,
      };
    }),
  reorderPetriNets: (newOrder: string[]) =>
    set(() => ({
      petriNetOrder: newOrder,
    })),

  // Add a new node to a petri net
  addNode: (petriNetId: string, newNode: Node) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedNodes = [...petriNet.nodes, { ...newNode, id: newNode.id ?? uuidv4() }];
      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            nodes: updatedNodes,
          },
        },
      };
    });
  },
  // Add a new edge to a petri net
  addEdge: (petriNetId: string, edge: Edge) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedEdges = [...petriNet.edges, { ...edge, id: edge.id ?? uuidv4() }];
      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            edges: updatedEdges,
          },
        },
      };
    });
  },
  // Update node
  updateNode: (petriNetId: string, node: Node) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedNodes = petriNet.nodes.map((n) => (n.id === node.id ? { ...node } : n));
      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            nodes: updatedNodes,
          },
        },
      };
    });
  },
  updateNodeMarking: (id: string, newMarking: unknown[]) => {
    set((state) => {
      // Search across all petri nets for the node (supports subpage places during simulation)
      const updatedNetsById = { ...state.petriNetsById };
      let found = false;
      for (const [netId, net] of Object.entries(updatedNetsById)) {
        const nodeIndex = net.nodes.findIndex((n) => n.id === id);
        if (nodeIndex !== -1) {
          updatedNetsById[netId] = {
            ...net,
            nodes: net.nodes.map((node) =>
              node.id === id ? { ...node, data: { ...node.data, marking: newMarking } } : node
            ),
          };
          found = true;
          break;
        }
      }
      if (!found) return state;
      return { petriNetsById: updatedNetsById };
    });
  },
  // Update node data
  updateNodeData: (petriNetId, id: string, newData: PlaceNodeData | TransitionNodeData | AuxTextNodeData) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      
      // Mapping from parent node properties to inscription types
      const propertyToInscriptionType: Record<string, string> = {
        initialMarking: 'initialMarking',
        colorSet: 'colorSet',
        guard: 'guard',
        time: 'time',
        priority: 'priority',
        codeSegment: 'codeSegment',
      };
      
      // First pass: update the target node
      let updatedNodes = petriNet.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...newData } } : node
      );
      
      // Second pass: update any child inscription nodes whose labels should reflect parent data
      updatedNodes = updatedNodes.map((node) => {
        // Check if this is an inscription node that is a child of the updated node
        if (node.type === 'inscription' && node.parentId === id) {
          const inscriptionType = node.data?.inscriptionType as string;
          // Find which parent property this inscription type maps to
          const parentProperty = Object.entries(propertyToInscriptionType).find(
            ([, insType]) => insType === inscriptionType
          )?.[0];
          
          if (parentProperty && parentProperty in newData) {
            // Update the inscription label to match the new parent property value
            // Cast through unknown to satisfy TypeScript
            const newLabel = (newData as unknown as Record<string, string>)[parentProperty];
            return {
              ...node,
              data: {
                ...node.data,
                label: newLabel || '',
              },
            };
          }
        }
        return node;
      });

      // Update selectedElement if it matches the updated node
      const updatedSelectedElement =
        petriNet.selectedElement?.type === 'node' && petriNet.selectedElement.element.id === id
          ? { ...petriNet.selectedElement, element: { ...petriNet.selectedElement.element, data: { ...newData } } }
          : petriNet.selectedElement;

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            nodes: updatedNodes,
            selectedElement: updatedSelectedElement,
          },
        },
      };
    });
  },
  // Update edge data
  updateEdgeData: (petriNetId: string, id: string, newData: Record<string, unknown>) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedEdges = petriNet.edges.map((edge) =>
        edge.id === id ? { ...edge, data: { ...edge.data, ...newData } } : edge
      );

      // Update selectedElement if it matches the updated edge
      const updatedSelectedElement =
        petriNet.selectedElement?.type === 'edge' && petriNet.selectedElement.element.id === id
          ? { ...petriNet.selectedElement, element: { ...petriNet.selectedElement.element, data: { ...petriNet.selectedElement.element.data, ...newData } } }
          : petriNet.selectedElement;

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            edges: updatedEdges,
            selectedElement: updatedSelectedElement,
          },
        },
      };
    });
  },
  // Update edge label
  updateEdgeLabel: (petriNetId: string, id: string, newLabel: string) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedEdges = petriNet.edges.map((edge) =>
        edge.id === id ? { ...edge, label: newLabel } : edge
      );

      // Update selectedElement if it matches the updated edge
      const updatedSelectedElement =
        petriNet.selectedElement?.type === 'edge' && petriNet.selectedElement.element.id === id
          ? { ...petriNet.selectedElement, element: { ...petriNet.selectedElement.element, label: newLabel } }
          : petriNet.selectedElement;

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            edges: updatedEdges,
            selectedElement: updatedSelectedElement,
          },
        },
      };
    });
  },

  // Swap edge source and target (reverse direction)
  swapEdgeDirection: (petriNetId: string, id: string) => {
    set((state) => {
      const petriNet = state.petriNetsById[petriNetId];
      const updatedEdges = petriNet.edges.map((edge) =>
        edge.id === id 
          ? { ...edge, source: edge.target, target: edge.source } 
          : edge
      );

      // Update selectedElement if it matches the updated edge
      const currentEdge = petriNet.edges.find(e => e.id === id);
      const updatedSelectedElement =
        petriNet.selectedElement?.type === 'edge' && petriNet.selectedElement.element.id === id && currentEdge
          ? { 
              ...petriNet.selectedElement, 
              element: { 
                ...petriNet.selectedElement.element, 
                source: currentEdge.target, 
                target: currentEdge.source 
              } 
            }
          : petriNet.selectedElement;

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...petriNet,
            edges: updatedEdges,
            selectedElement: updatedSelectedElement,
          },
        },
      };
    });
  },

  // Set marking = initialMarking for all places across all nets
  applyInitialMarkings: () => {
    set((state) => {
      const updatedNetsById = { ...state.petriNetsById };
      for (const [netId, petriNet] of Object.entries(updatedNetsById)) {
        const updatedNodes = petriNet.nodes.map((node) => {
          if (node.type === 'place') {
            let marking: (string | number | null)[] = []; // Include null for unit tokens
            if (node.data.initialMarking) {
              try {
                if (typeof node.data.initialMarking === 'string' && node.data.initialMarking.trim() !== '') {
                  let parsedMarking: (string | number | null)[] = []; // Include null for unit tokens
                  
                  // Check for UNIT type marking: [(), (), ...]
                  const unitMatch = node.data.initialMarking.match(/^\s*\[\s*((?:\(\)\s*,?\s*)*)\s*\]\s*$/);
                  if (unitMatch) {
                    // Count the number of () in the array
                    const unitCount = (node.data.initialMarking.match(/\(\)/g) || []).length;
                    // Create array of null values to represent unit tokens
                    parsedMarking = Array(unitCount).fill(null);
                  } else if (node.data.initialMarking.endsWith('.all()')) {
                    const colorSetName = node.data.initialMarking.substring(0, node.data.initialMarking.length - '.all()'.length).trim();
                    const colorSet = state.colorSets.find(cs => cs.name === colorSetName);

                    if (colorSet && colorSet.definition.includes('int')) {
                      const rangeMatch = colorSet.definition.match(/with\s+(\d+)\.\.(\d+)(?:\s+timed)?;/);
                      if (rangeMatch) {
                        const start = parseInt(rangeMatch[1], 10);
                        const end = parseInt(rangeMatch[2], 10);
                        if (!isNaN(start) && !isNaN(end)) {
                          // Generate array from start to end (inclusive)
                          parsedMarking = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                        } else {
                          console.warn(`Invalid range values in color set definition: "${colorSet.definition}"`);
                        }
                      } else {
                        console.warn(`No valid range found in color set definition: "${colorSet.definition}"`);
                      }
                    } else {
                      console.warn(`Cannot apply '.all()' to color set "${colorSetName}". It's either not found, not a 'basic' type, or doesn't contain 'int' in its definition.`);
                      parsedMarking = []; // Default to empty if conditions aren't met
                    }
                  } else {
                    // Try to parse as JSON; if it fails, treat as a Rhai expression
                    // that WASM will evaluate (e.g., all_orders())
                    try {
                      const parsed = JSON.parse(node.data.initialMarking);
                      // Ensure result is an array
                      if (Array.isArray(parsed)) {
                        parsedMarking = parsed;
                      } else {
                        // Single value - wrap in array
                        parsedMarking = [parsed];
                      }
                    } catch {
                      // Not valid JSON — it's a Rhai expression (e.g., function call).
                      // Leave marking empty; WASM will evaluate initialMarking directly.
                      parsedMarking = [];
                    }
                  }
                  marking = parsedMarking;
                }
              } catch (error) {
                console.error(`Error parsing initial marking for node ${node.id}:`, node.data.initialMarking, error);
                marking = []; // Default to empty on error
              }
            }
            // Ensure data retains other properties and update marking
            return {
              ...node,
              data: { ...node.data, marking },
            };
          }
          return node;
        });
        updatedNetsById[netId] = {
          ...petriNet,
          nodes: updatedNodes,
        };
      }
      return { petriNetsById: updatedNetsById };
    });
  },

  setSelectedElement: (petriNetId: string, element: SelectedElement | null) =>
    set((state) => ({
      petriNetsById: {
        ...state.petriNetsById,
        [petriNetId]: {
          ...state.petriNetsById[petriNetId],
          selectedElement: element,
        },
      },
    })),

  setColorSets: (colorSets) => {
    set({ colorSets });
  },
  setVariables: (variables) => {
    set({ variables });
  },
  setPriorities: (priorities) => {
    set({ priorities });
  },
  setFunctions: (functions) => {
    set({ functions });
  },
  setUses: (uses) => {
    set({ uses });
  },
  setValues: (values) => {
    set({ values });
  },

  // Add a new color set
  addColorSet: (newColorSet) =>
  set((state) => ({
    colorSets: [
      ...state.colorSets,
      { ...newColorSet, id: newColorSet.id ?? uuidv4() },
    ],
  })),
  // Add a new variable
  addVariable: (newVariable) =>
  set((state) => ({
    variables: [
      ...state.variables,
      { ...newVariable, id: newVariable.id ?? uuidv4() },
    ],
  })),
  // Add a new priority
  addPriority: (newPriority) =>
  set((state) => ({
    priorities: [
      ...state.priorities,
      { ...newPriority, id: newPriority.id ?? uuidv4() },
    ],
  })),
  // Add a new function
  addFunction: (newFunction) =>
  set((state) => ({
    functions: [
      ...state.functions,
      { ...newFunction, id: newFunction.id ?? uuidv4() },
    ],
  })),
  // Rename a color set and update all references (places, variables)
  renameColorSet: (id: string, newName: string) =>
  set((state) => {
    // Find the old name
    const colorSet = state.colorSets.find((cs) => cs.id === id);
    if (!colorSet) return state;
    
    const oldName = colorSet.name;
    if (oldName === newName) return state; // No change needed
    
    // Update the color set name
    const updatedColorSets = state.colorSets.map((cs) =>
      cs.id === id ? { ...cs, name: newName } : cs
    );
    
    // Update all variables that reference this color set
    const updatedVariables = state.variables.map((v) =>
      v.colorSet === oldName ? { ...v, colorSet: newName } : v
    );
    
    // Update all places in all Petri nets that reference this color set
    const updatedPetriNetsById: typeof state.petriNetsById = {};
    for (const [netId, petriNet] of Object.entries(state.petriNetsById)) {
      const updatedNodes = petriNet.nodes.map((node) => {
        if (node.type === 'place' && node.data?.colorSet === oldName) {
          return {
            ...node,
            data: { ...node.data, colorSet: newName },
          };
        }
        return node;
      });
      updatedPetriNetsById[netId] = {
        ...petriNet,
        nodes: updatedNodes,
      };
    }
    
    return {
      colorSets: updatedColorSets,
      variables: updatedVariables,
      petriNetsById: updatedPetriNetsById,
    };
  }),
  // Remove a color set
  deleteColorSet: (id) =>
  set((state) => ({
    colorSets: state.colorSets.filter((colorSet) => colorSet.id !== id),
  })),
  // Remove a variable
  deleteVariable: (id) =>
  set((state) => ({
    variables: state.variables.filter((variable) => variable.id !== id),
  })),
  // Remove a priority
  deletePriority: (id) =>
  set((state) => ({
    priorities: state.priorities.filter((priority) => priority.id !== id),
  })),
  // Remove a function
  deleteFunction: (id) =>
  set((state) => ({
    functions: state.functions.filter((func) => func.id !== id),
  })),

  // Add a new use
  addUse: (newUse) =>
  set((state) => ({
    uses: [
      ...state.uses,
      { ...newUse, id: newUse.id ?? uuidv4() },
    ],
  })),
  // Update a use
  updateUse: (id, newUse) =>
  set((state) => ({
    uses: state.uses.map((use) =>
      use.id === id ? { name: newUse.name, content: newUse.content } : use
    ),
  })),
  // Remove a use
  deleteUse: (id) =>
  set((state) => ({
    uses: state.uses.filter((use) => use.id !== id),
  })),

  // Add a new value
  addValue: (newValue) =>
  set((state) => ({
    values: [
      ...state.values,
      { ...newValue, id: newValue.id ?? uuidv4() },
    ],
  })),
  // Update a value
  updateValue: (id, newValue) =>
  set((state) => ({
    values: state.values.map((v) =>
      v.id === id ? { ...v, name: newValue.name, expression: newValue.expression } : v
    ),
  })),
  // Remove a value
  deleteValue: (id) =>
  set((state) => ({
    values: state.values.filter((v) => v.id !== id),
  })),

  toggleArcMode: (state: boolean, arcType?: ArcType) =>
  set((store) => ({
    isArcMode: state,
    activeArcType: arcType || store.activeArcType,
    petriNetsById: Object.fromEntries(
      Object.entries(store.petriNetsById).map(([petriNetId, petriNet]) => [
        petriNetId,
        {
          ...petriNet,
          nodes: petriNet.nodes.map((node) => ({
            ...node,
            data: { ...node.data, isArcMode: state },
          })),
        },
      ])
    ),
  })),

  setActiveArcType: (arcType: ArcType) =>
  set(() => ({
    activeArcType: arcType,
  })),

  setActiveMode: (mode) =>
    set(() => ({
      activeMode: mode,
    })),

  setOcpnName: (name: string) =>
    set(() => ({
      ocpnName: name,
    })),

  setSimulationEpoch: (epoch: string | null) =>
    set(() => ({
      simulationEpoch: epoch,
    })),

  setShowMarkingDisplay: (show: boolean) =>
    set(() => ({
      showMarkingDisplay: show,
    })),

  // Fusion sets
  setFusionSets: (fusionSets: FusionSet[]) =>
    set(() => ({ fusionSets })),

  addFusionSet: (fusionSet: FusionSet) =>
    set((state) => ({
      fusionSets: [...state.fusionSets, { ...fusionSet, id: fusionSet.id ?? uuidv4() }],
    })),

  deleteFusionSet: (id: string) =>
    set((state) => {
      // Remove the fusion set and clear references from all places
      const updatedPetriNetsById: Record<string, PetriNet> = {};
      for (const [netId, petriNet] of Object.entries(state.petriNetsById)) {
        updatedPetriNetsById[netId] = {
          ...petriNet,
          nodes: petriNet.nodes.map((node) => {
            if (node.type === 'place' && node.data?.fusionSetId === id) {
              return { ...node, data: { ...node.data, fusionSetId: undefined } };
            }
            return node;
          }),
        };
      }
      return {
        fusionSets: state.fusionSets.filter((fs) => fs.id !== id),
        petriNetsById: updatedPetriNetsById,
      };
    }),

  // Monitors
  setMonitors: (monitors: Monitor[]) =>
    set(() => ({ monitors })),

  addMonitor: (monitor: Monitor) =>
    set((state) => ({
      monitors: [...state.monitors, { ...monitor, id: monitor.id || uuidv4() }],
    })),

  updateMonitor: (id: string, monitor: Monitor) =>
    set((state) => ({
      monitors: state.monitors.map((m) => (m.id === id ? monitor : m)),
    })),

  deleteMonitor: (id: string) =>
    set((state) => ({
      monitors: state.monitors.filter((m) => m.id !== id),
    })),

  setStateSpaceResult: (result) =>
    set(() => ({
      stateSpaceResult: result,
    })),

  setActiveSpecialTab: (tab) =>
    set(() => ({
      activeSpecialTab: tab,
    })),

  requestFocus: (request) =>
    set(() => ({
      focusRequest: request,
    })),

  // Hierarchy: Move transition to subpage
  moveTransitionToSubpage: (petriNetId: string, transitionId: string) =>
    set((state) => {
      const parentNet = state.petriNetsById[petriNetId];
      if (!parentNet) return state;

      const transition = parentNet.nodes.find((n) => n.id === transitionId && n.type === 'transition');
      if (!transition) return state;

      // Already a substitution transition
      if (transition.data?.subPageId) return state;

      const subPageId = uuidv4();
      const baseName = (transition.data?.label as string) || 'Subpage';
      // Ensure unique subpage name
      const existingNames = new Set(Object.values(state.petriNetsById).map((n) => n.name));
      let subPageName = baseName;
      if (existingNames.has(subPageName)) {
        let counter = 2;
        while (existingNames.has(`${baseName} (${counter})`)) counter++;
        subPageName = `${baseName} (${counter})`;
      }

      // Find all arcs connected to this transition
      const connectedArcs = parentNet.edges.filter(
        (e) => e.source === transitionId || e.target === transitionId
      );

      // Find unique connected places
      const connectedPlaceIds = new Set<string>();
      connectedArcs.forEach((arc) => {
        if (arc.source === transitionId) connectedPlaceIds.add(arc.target);
        else connectedPlaceIds.add(arc.source);
      });

      const socketAssignments: { portPlaceId: string; socketPlaceId: string }[] = [];
      const portPlaces: Node[] = [];
      const subpageArcs: Edge[] = [];

      // Compute bounding box of transition + connected places to preserve relative positions
      const allInvolvedNodes = [transition, ...[...connectedPlaceIds].map((id) => parentNet.nodes.find((n) => n.id === id)).filter(Boolean)] as Node[];
      let minX = Infinity, minY = Infinity;
      for (const n of allInvolvedNodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
      }
      const offsetX = 300, offsetY = 200;

      // Create a copy of the transition for the subpage
      const copiedTransitionId = uuidv4();
      const copiedTransition: Node = {
        ...transition,
        id: copiedTransitionId,
        position: {
          x: transition.position.x - minX + offsetX,
          y: transition.position.y - minY + offsetY,
        },
        data: {
          ...transition.data,
          subPageId: undefined,
          socketAssignments: undefined,
        },
      };

      connectedPlaceIds.forEach((placeId) => {
        const place = parentNet.nodes.find((n) => n.id === placeId);
        if (!place) return;

        // Determine port type
        const inArcs = connectedArcs.filter((e) => e.source === placeId && e.target === transitionId);
        const outArcs = connectedArcs.filter((e) => e.source === transitionId && e.target === placeId);
        const portType = inArcs.length > 0 && outArcs.length > 0 ? 'io' : inArcs.length > 0 ? 'in' : 'out';

        const portPlaceId = uuidv4();
        portPlaces.push({
          id: portPlaceId,
          type: 'place',
          position: {
            x: place.position.x - minX + offsetX,
            y: place.position.y - minY + offsetY,
          },
          ...(place.width ? { width: place.width } : {}),
          ...(place.height ? { height: place.height } : {}),
          data: {
            label: place.data?.label || 'Port',
            colorSet: place.data?.colorSet || '',
            initialMarking: '',
            marking: [],
            portType,
            isArcMode: false,
            type: 'place',
          },
        });

        socketAssignments.push({ portPlaceId, socketPlaceId: placeId });

        // Create arcs on subpage mirroring parent arcs
        for (const arc of inArcs) {
          subpageArcs.push({
            id: uuidv4(),
            source: portPlaceId,
            target: copiedTransitionId,
            label: arc.label,
            data: { ...arc.data },
          });
        }
        for (const arc of outArcs) {
          subpageArcs.push({
            id: uuidv4(),
            source: copiedTransitionId,
            target: portPlaceId,
            label: arc.label,
            data: { ...arc.data },
          });
        }
      });

      // Mark the copied transition as selected on the subpage
      const selectedCopiedTransition: Node = {
        ...copiedTransition,
        selected: true,
      };

      // Create the subpage
      const subPage: PetriNet = {
        id: subPageId,
        name: subPageName,
        nodes: [selectedCopiedTransition, ...portPlaces],
        edges: subpageArcs,
        selectedElement: { type: 'node', element: selectedCopiedTransition },
      };

      // Update the original transition to be a substitution transition
      const updatedParentNodes = parentNet.nodes.map((n) =>
        n.id === transitionId
          ? {
              ...n,
              data: {
                ...n.data,
                subPageId,
                socketAssignments,
              },
            }
          : n
      );

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...parentNet,
            nodes: updatedParentNodes,
          },
          [subPageId]: subPage,
        },
        petriNetOrder: [...state.petriNetOrder, subPageId],
        activePetriNetId: subPageId, // Switch to the new subpage
      };
    }),

  // Hierarchy: Move multiple selected nodes to a subpage
  moveNodesToSubpage: (petriNetId: string, nodeIds: string[], subpageName?: string) =>
    set((state) => {
      const parentNet = state.petriNetsById[petriNetId];
      if (!parentNet) return state;

      const selectedIds = new Set(nodeIds);
      const selectedNodes = parentNet.nodes.filter((n) => selectedIds.has(n.id));
      if (selectedNodes.length === 0) return state;

      // Must contain at least one transition
      const selectedTransitions = selectedNodes.filter((n) => n.type === 'transition');
      if (selectedTransitions.length === 0) return state;

      // Don't allow if any selected transition is already a substitution transition
      if (selectedTransitions.some((t) => t.data?.subPageId)) return state;

      const subPageId = uuidv4();
      const baseName = subpageName ||
        (selectedTransitions.length === 1 ? (selectedTransitions[0].data?.label as string) || 'Subpage' : 'Subpage');
      // Ensure unique subpage name
      const existingNames = new Set(Object.values(state.petriNetsById).map((n) => n.name));
      let name = baseName;
      if (existingNames.has(name)) {
        let counter = 2;
        while (existingNames.has(`${baseName} (${counter})`)) counter++;
        name = `${baseName} (${counter})`;
      }

      // For multi-node moves, name the substitution transition "Substitution" (distinct from subpage name)
      const substTransitionLabel = selectedTransitions.length > 1 ? 'Substitution' : name;

      // Classify nodes:
      // - Internal nodes: selected transitions and selected places that are ONLY connected to selected nodes
      // - Boundary places: selected places connected to both selected and non-selected nodes
      //   OR non-selected places connected to selected transitions
      const allArcs = parentNet.edges;

      // Find boundary places: non-selected places connected to selected nodes
      const boundaryPlaceIds = new Set<string>();
      // Also find selected places that have connections outside the selection (they become boundary too)
      const internalSelectedPlaceIds = new Set<string>();

      const selectedPlaces = selectedNodes.filter((n) => n.type === 'place');
      const selectedTransitionIds = new Set(selectedTransitions.map((t) => t.id));

      // Check each arc to classify places
      for (const arc of allArcs) {
        const sourceSelected = selectedIds.has(arc.source);
        const targetSelected = selectedIds.has(arc.target);

        if (sourceSelected && !targetSelected) {
          // Arc from selected to non-selected: source's connected non-selected target is boundary
          const sourceNode = parentNet.nodes.find((n) => n.id === arc.source);
          if (sourceNode?.type === 'place') {
            // Selected place connects to outside — it's a boundary place
            boundaryPlaceIds.add(arc.source);
          }
          // Non-selected target that's a place connected to a selected transition
          const targetNode = parentNet.nodes.find((n) => n.id === arc.target);
          if (targetNode?.type === 'place') {
            boundaryPlaceIds.add(arc.target);
          }
        } else if (!sourceSelected && targetSelected) {
          // Arc from non-selected to selected: similar logic
          const targetNode = parentNet.nodes.find((n) => n.id === arc.target);
          if (targetNode?.type === 'place') {
            boundaryPlaceIds.add(arc.target);
          }
          const sourceNode = parentNet.nodes.find((n) => n.id === arc.source);
          if (sourceNode?.type === 'place') {
            boundaryPlaceIds.add(arc.source);
          }
        }
      }

      // Selected places not in boundary are internal
      for (const p of selectedPlaces) {
        if (!boundaryPlaceIds.has(p.id)) {
          internalSelectedPlaceIds.add(p.id);
        }
      }

      // Internal nodes = selected transitions + internal selected places
      const internalNodeIds = new Set([...selectedTransitionIds, ...internalSelectedPlaceIds]);

      // Internal arcs: arcs where both ends are internal nodes
      const internalArcs = allArcs.filter(
        (e) => internalNodeIds.has(e.source) && internalNodeIds.has(e.target)
      );

      // Boundary arcs: arcs connecting boundary places to internal nodes
      const boundaryArcs = allArcs.filter(
        (e) =>
          (boundaryPlaceIds.has(e.source) && internalNodeIds.has(e.target)) ||
          (internalNodeIds.has(e.source) && boundaryPlaceIds.has(e.target))
      );

      // Compute bounding box of all involved nodes (internal + boundary) to preserve relative positions
      const internalNodes = parentNet.nodes.filter((n) => internalNodeIds.has(n.id));
      const allInvolvedNodes = [...internalNodes, ...[...boundaryPlaceIds].map((id) => parentNet.nodes.find((n) => n.id === id)).filter(Boolean)] as Node[];
      let minX = Infinity, minY = Infinity;
      for (const n of allInvolvedNodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
      }

      // Create port places for boundary places and build socket assignments
      const socketAssignments: { portPlaceId: string; socketPlaceId: string }[] = [];
      const portPlaces: Node[] = [];
      const portArcs: Edge[] = [];
      const portIdMap = new Map<string, string>(); // boundaryPlaceId → portPlaceId

      for (const bpId of boundaryPlaceIds) {
        const bp = parentNet.nodes.find((n) => n.id === bpId);
        if (!bp) continue;

        // Determine port type from arcs connecting this boundary place to internal nodes
        const arcsIn = boundaryArcs.filter((e) => e.source === bpId && internalNodeIds.has(e.target));
        const arcsOut = boundaryArcs.filter((e) => e.target === bpId && internalNodeIds.has(e.source));
        const portType = arcsIn.length > 0 && arcsOut.length > 0 ? 'io' : arcsIn.length > 0 ? 'in' : 'out';

        const portPlaceId = uuidv4();
        portIdMap.set(bpId, portPlaceId);

        // Position port places preserving original boundary place position relative to internal nodes
        portPlaces.push({
          id: portPlaceId,
          type: 'place',
          position: {
            x: bp.position.x - minX + 300,
            y: bp.position.y - minY + 200,
          },
          ...(bp.width ? { width: bp.width } : {}),
          ...(bp.height ? { height: bp.height } : {}),
          data: {
            label: bp.data?.label || 'Port',
            colorSet: bp.data?.colorSet || '',
            initialMarking: '',
            marking: [],
            portType,
            isArcMode: false,
            type: 'place',
          },
        });

        socketAssignments.push({ portPlaceId, socketPlaceId: bpId });

        // Create arcs from port to internal nodes (mirroring the boundary arcs)
        for (const arc of arcsIn) {
          portArcs.push({
            id: uuidv4(),
            source: portPlaceId,
            target: arc.target,
            label: arc.label,
            data: { ...arc.data },
          });
        }
        for (const arc of arcsOut) {
          portArcs.push({
            id: uuidv4(),
            source: arc.source,
            target: portPlaceId,
            label: arc.label,
            data: { ...arc.data },
          });
        }
      }

      // Reposition internal nodes relative to subpage origin
      const subpageNodes: Node[] = internalNodes.map((n) => ({
        ...n,
        position: {
          x: n.position.x - minX + 300,
          y: n.position.y - minY + 200,
        },
        selected: false,
      }));

      // Create the subpage
      const subPage: PetriNet = {
        id: subPageId,
        name,
        nodes: [...subpageNodes, ...portPlaces],
        edges: [...internalArcs, ...portArcs],
        selectedElement: null,
      };

      // Create the substitution transition in the parent
      // Position it at the centroid of the removed nodes
      const centroidX = internalNodes.reduce((sum, n) => sum + n.position.x, 0) / internalNodes.length;
      const centroidY = internalNodes.reduce((sum, n) => sum + n.position.y, 0) / internalNodes.length;

      const substTransitionId = uuidv4();
      const substTransition: Node = {
        id: substTransitionId,
        type: 'transition',
        position: { x: centroidX, y: centroidY },
        data: {
          label: substTransitionLabel,
          guard: '',
          time: '',
          priority: '',
          codeSegment: '',
          isArcMode: false,
          type: 'transition',
          subPageId,
          socketAssignments,
        },
      };

      // Rewire arcs: arcs from non-selected nodes to boundary places stay.
      // Arcs from boundary places to internal nodes are removed (replaced by port arcs).
      // We need new arcs from boundary places to the substitution transition? No —
      // the boundary places are the sockets; the substitution transition concept means
      // arcs from boundary sockets to the subst. transition represent the interface.
      // Actually in CPN tools, the substitution transition doesn't have explicit arcs
      // to sockets — the socket assignments define the mapping. But for our React Flow
      // rendering, we should add arcs to make the graph connected.
      const newParentArcs: Edge[] = [];
      for (const bpId of boundaryPlaceIds) {
        const arcsIn = boundaryArcs.filter((e) => e.source === bpId && internalNodeIds.has(e.target));
        const arcsOut = boundaryArcs.filter((e) => e.target === bpId && internalNodeIds.has(e.source));

        if (arcsIn.length > 0) {
          // Boundary place feeds into internal: create arc from boundary to subst. transition
          // Use the inscription from the first arc as representative
          newParentArcs.push({
            id: uuidv4(),
            source: bpId,
            target: substTransitionId,
            label: arcsIn[0].label,
            data: { ...arcsIn[0].data },
          });
        }
        if (arcsOut.length > 0) {
          // Internal feeds out to boundary: create arc from subst. transition to boundary
          newParentArcs.push({
            id: uuidv4(),
            source: substTransitionId,
            target: bpId,
            label: arcsOut[0].label,
            data: { ...arcsOut[0].data },
          });
        }
      }

      // Remove internal nodes and their arcs from parent, and boundary arcs
      const boundaryArcIds = new Set(boundaryArcs.map((e) => e.id));
      const internalArcIds = new Set(internalArcs.map((e) => e.id));
      const remainingNodes = parentNet.nodes.filter((n) => !internalNodeIds.has(n.id));
      const remainingEdges = parentNet.edges.filter(
        (e) => !boundaryArcIds.has(e.id) && !internalArcIds.has(e.id)
      );

      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...parentNet,
            nodes: [...remainingNodes, substTransition],
            edges: [...remainingEdges, ...newParentArcs],
          },
          [subPageId]: subPage,
        },
        petriNetOrder: [...state.petriNetOrder, subPageId],
        activePetriNetId: subPageId,
      };
    }),

  // Hierarchy: Flatten (replace substitution transition with subpage content)
  flattenSubstitutionTransition: (petriNetId: string, transitionId: string) =>
    set((state) => {
      const parentNet = state.petriNetsById[petriNetId];
      if (!parentNet) return state;

      const transition = parentNet.nodes.find((n) => n.id === transitionId && n.type === 'transition');
      if (!transition || !transition.data?.subPageId) return state;

      const subPageId = transition.data.subPageId as string;
      const socketAssignments = (transition.data.socketAssignments as { portPlaceId: string; socketPlaceId: string }[]) || [];
      const subPage = state.petriNetsById[subPageId];
      if (!subPage) return state;

      // Build port-to-socket mapping
      const portToSocket = new Map<string, string>();
      socketAssignments.forEach((sa) => portToSocket.set(sa.portPlaceId, sa.socketPlaceId));

      // Get non-port nodes from subpage (skip port places)
      const subpageNonPortNodes = subPage.nodes.filter(
        (n) => !(n.type === 'place' && n.data?.portType)
      );

      // Compute position offset from socket assignments: the delta between
      // a socket place on the parent and its corresponding port place on the subpage
      let offsetX = 0, offsetY = 0;
      if (socketAssignments.length > 0) {
        const firstAssignment = socketAssignments[0];
        const portPlace = subPage.nodes.find((n) => n.id === firstAssignment.portPlaceId);
        const socketPlace = parentNet.nodes.find((n) => n.id === firstAssignment.socketPlaceId);
        if (portPlace && socketPlace) {
          offsetX = socketPlace.position.x - portPlace.position.x;
          offsetY = socketPlace.position.y - portPlace.position.y;
        }
      }
      const repositionedNodes = subpageNonPortNodes.map((n) => ({
        ...n,
        id: n.id, // Keep original IDs
        position: {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY,
        },
      }));

      // Remap arcs: replace port place references with socket places
      const remappedArcs = subPage.edges.map((e) => ({
        ...e,
        id: uuidv4(), // New IDs to avoid conflicts
        source: portToSocket.get(e.source) || e.source,
        target: portToSocket.get(e.target) || e.target,
      }));

      // Remove the substitution transition and its arcs from parent
      const filteredParentNodes = parentNet.nodes.filter((n) => n.id !== transitionId);
      const filteredParentEdges = parentNet.edges.filter(
        (e) => e.source !== transitionId && e.target !== transitionId
      );

      // Remove the subpage from petri nets
      const remainingNets = Object.fromEntries(
        Object.entries(state.petriNetsById).filter(([key]) => key !== subPageId)
      );

      return {
        petriNetsById: {
          ...remainingNets,
          [petriNetId]: {
            ...parentNet,
            nodes: [...filteredParentNodes, ...repositionedNodes],
            edges: [...filteredParentEdges, ...remappedArcs],
          },
        },
        petriNetOrder: state.petriNetOrder.filter((id) => id !== subPageId),
        activePetriNetId: state.activePetriNetId === subPageId ? petriNetId : state.activePetriNetId,
      };
    }),

  // Hierarchy: Manually assign a subpage to a transition (making it a substitution transition)
  assignSubpageToTransition: (petriNetId: string, transitionId: string, subPageId: string, socketAssignments: { portPlaceId: string; socketPlaceId: string }[]) =>
    set((state) => {
      const parentNet = state.petriNetsById[petriNetId];
      if (!parentNet) return state;
      const transition = parentNet.nodes.find((n) => n.id === transitionId && n.type === 'transition');
      if (!transition) return state;
      if (!state.petriNetsById[subPageId]) return state;
      const updatedNode = { ...transition, data: { ...transition.data, subPageId, socketAssignments } };
      const updatedNet = {
        ...parentNet,
        nodes: parentNet.nodes.map((n) => n.id === transitionId ? updatedNode : n),
        // Update selectedElement if this transition is currently selected
        selectedElement: parentNet.selectedElement?.type === 'node' && parentNet.selectedElement.element?.id === transitionId
          ? { type: 'node' as const, element: updatedNode }
          : parentNet.selectedElement,
      };
      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: updatedNet,
        },
      };
    }),

  // Hierarchy: Remove subpage assignment from a transition (revert to regular transition)
  removeSubpageFromTransition: (petriNetId: string, transitionId: string) =>
    set((state) => {
      const parentNet = state.petriNetsById[petriNetId];
      if (!parentNet) return state;
      const updatedNodes = parentNet.nodes.map((n) => {
        if (n.id === transitionId && n.type === 'transition') {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { subPageId, socketAssignments, ...restData } = n.data as Record<string, unknown>;
          return { ...n, data: restData };
        }
        return n;
      });
      const updatedNode = updatedNodes.find((n) => n.id === transitionId);
      return {
        petriNetsById: {
          ...state.petriNetsById,
          [petriNetId]: {
            ...parentNet,
            nodes: updatedNodes,
            // Update selectedElement if this transition is currently selected
            selectedElement: parentNet.selectedElement?.type === 'node' && parentNet.selectedElement.element?.id === transitionId && updatedNode
              ? { type: 'node' as const, element: updatedNode }
              : parentNet.selectedElement,
          },
        },
      };
    }),

  reset: () => {
    set(emptyState);
  },

}),
  {
    handleSet: (handleSet) => {
      // Capture the real handleSet so endBatch can flush
      _realHandleSet = handleSet;
      // Flag-based batching: when _undoBatchDepth > 0, we hold the
      // first pastState and only push it when the batch ends.
      return (pastState, replace) => {
        if (_undoBatchDepth > 0) {
          // Inside a batch — capture the first "before" state only
          if (!_undoBatchFirstState) {
            _undoBatchFirstState = pastState;
            _undoBatchReplace = replace;
          }
          // Discard intermediate states
          return;
        }
        // Not in a batch — record normally
        handleSet(pastState, replace);
      };
    },
    partialize: (state) => ({
      petriNetsById: state.petriNetsById,
      petriNetOrder: state.petriNetOrder,
      activePetriNetId: state.activePetriNetId,
      colorSets: state.colorSets,
      variables: state.variables,
      priorities: state.priorities,
      functions: state.functions,
      uses: state.uses,
      values: state.values,
      fusionSets: state.fusionSets,
      monitors: state.monitors,
    }),
    equality: (pastState, currentState) => {
      // Compare serialized snapshots to avoid recording no-op changes
      // (e.g. selection changes, node measured events)
      return JSON.stringify({
        petriNetsById: stripTransientPetriNetFields(pastState.petriNetsById as Record<string, PetriNet>),
        petriNetOrder: pastState.petriNetOrder,
        activePetriNetId: pastState.activePetriNetId,
        colorSets: pastState.colorSets,
        variables: pastState.variables,
        priorities: pastState.priorities,
        functions: pastState.functions,
        uses: pastState.uses,
        values: pastState.values,
        fusionSets: pastState.fusionSets,
        monitors: pastState.monitors,
      }) === JSON.stringify({
        petriNetsById: stripTransientPetriNetFields(currentState.petriNetsById as Record<string, PetriNet>),
        petriNetOrder: currentState.petriNetOrder,
        activePetriNetId: currentState.activePetriNetId,
        colorSets: currentState.colorSets,
        variables: currentState.variables,
        priorities: currentState.priorities,
        functions: currentState.functions,
        uses: currentState.uses,
        values: currentState.values,
        fusionSets: currentState.fusionSets,
        monitors: currentState.monitors,
      });
    },
    limit: 100,
  },
));

export default useStore;

// --- Auto-revalidation subscriber ---
// Re-runs validation whenever model-relevant state changes.
{
  let prevFingerprint = '';
  useStore.subscribe((state) => {
    // Build a lightweight fingerprint of validation-relevant fields only
    const fp = `${Object.keys(state.petriNetsById).length}:` +
      Object.values(state.petriNetsById).map(pn =>
        `${pn.nodes.length}:${pn.edges.length}:` +
        pn.nodes.map(n => {
          const d = n.data as Record<string, unknown>;
          // Only include fields relevant to validation
          return `${n.id}:${n.type}:${d.colorSet || ''}:${d.guard || ''}:${d.priority || ''}:${d.portType || ''}:${d.subPageId || ''}`;
        }).join(',') + '|' +
        pn.edges.map(e => `${e.id}:${e.label}`).join(',')
      ).join(';') +
      `:cs${state.colorSets.length}:${state.colorSets.map(cs => `${cs.name}:${cs.definition}`).join(',')}` +
      `:v${state.variables.length}:${state.variables.map(v => `${v.name}:${v.colorSet}`).join(',')}` +
      `:p${state.priorities.length}:${state.priorities.map(p => p.name).join(',')}`;

    if (fp !== prevFingerprint) {
      prevFingerprint = fp;
      const errors = validateModel(
        state.petriNetsById,
        state.colorSets,
        state.variables,
        state.priorities,
      );
      // Only update store if errors actually changed
      const currentErrors = useStore.getState().validationErrors;
      const errorsJson = JSON.stringify(errors);
      if (JSON.stringify(currentErrors) !== errorsJson) {
        useStore.setState({ validationErrors: errors });
      }
    }
  });
  // Run initial validation
  const initState = useStore.getState();
  useStore.setState({
    validationErrors: validateModel(
      initState.petriNetsById,
      initState.colorSets,
      initState.variables,
      initState.priorities,
    ),
  });
}

// --- Dirty tracking (has-unsaved-changes detection) ---

/** Compute a serialised snapshot of the model-relevant store fields. */
function getSnapshotString(): string {
  const s = useStore.getState();
  return JSON.stringify({
    ocpnName: s.ocpnName,
    petriNetsById: stripTransientPetriNetFields(s.petriNetsById),
    petriNetOrder: s.petriNetOrder,
    colorSets: s.colorSets,
    variables: s.variables,
    priorities: s.priorities,
    functions: s.functions,
    uses: s.uses,
    fusionSets: s.fusionSets,
    monitors: s.monitors,
  });
}

let _lastCleanSnapshot: string = getSnapshotString();

/** Mark the current state as "clean" (just saved / just loaded / just created). */
export const markClean = () => {
  _lastCleanSnapshot = getSnapshotString();
};

/** Return true if the store has unsaved changes since the last markClean(). */
export const isStoreDirty = (): boolean => {
  return getSnapshotString() !== _lastCleanSnapshot;
};

/**
 * Begin an undo batch. All state changes until the matching `resumeUndo()`
 * are collapsed into a single undo entry. Nestable (e.g., dialog inside drag).
 */
export const pauseUndo = () => {
  _undoBatchDepth++;
};

/**
 * End an undo batch. When the outermost batch closes, the state from
 * before the first `pauseUndo()` is pushed as a single undo entry.
 */
export const resumeUndo = () => {
  if (_undoBatchDepth <= 0) return;
  _undoBatchDepth--;
  if (_undoBatchDepth === 0 && _undoBatchFirstState !== undefined && _realHandleSet) {
    // Flush: push the pre-batch state onto the undo stack
    _realHandleSet(_undoBatchFirstState, _undoBatchReplace as Parameters<typeof _realHandleSet>[1]);
    _undoBatchFirstState = undefined;
    _undoBatchReplace = undefined;
  }
};

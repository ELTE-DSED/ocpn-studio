import React, { useCallback, useState, useContext, useRef, useEffect, useSyncExternalStore } from 'react';
import useStore, { pauseUndo, resumeUndo, markClean, isStoreDirty } from '@/stores/store';
import { usePetriNetHandlers } from '@/hooks/usePetriNetHandlers';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  useReactFlow,
  useNodesInitialized,
  Node,
  Edge,
  type Viewport,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';

//import Dagre from '@dagrejs/dagre';

import { Toolbar } from "@/components/Toolbar";
import { Button } from "@/components/ui/button";

import { BoomerDial, type Slice } from "@/components/BoomerDial";

import { Save, FolderOpen, Undo2, Redo2, FilePlus2 } from "lucide-react";

import CustomConnectionLine from '../edges/CustomConnectionLine';
import { useDnD } from '../utils/DnDContext';

import { OpenDialog } from '@/components/dialogs/OpenDialog';
import { SaveDialog } from '@/components/dialogs/SaveDialog';

import { SimulationToolbar } from '@/components/SimulationToolbar';
import { AssistanceToolbar } from '@/components/AssistanceToolbar';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initialColorSets, initialPriorities } from '@/declarations';
import { MoreVertical, Plus, GripVertical, Upload, Copy, Download } from 'lucide-react';
import { GitGraph } from 'lucide-react';
import { ReachabilityGraphTab } from '@/components/ReachabilityGraphTab';

import {
  convertToCPNToolsXML,
  convertToCPNPyJSON,
  convertToJSON,
  saveFile,
  parseFileContent,
  PetriNetData,
  convertToPNML,
} from '@/utils/FileOperations';

import { nodeTypes } from '../nodes';
import { edgeTypes } from '../edges';
import { toast } from 'sonner';
import { applySugiyamaLayout } from '@/utils/sugiyamaAdapter';

import { v4 as uuidv4 } from 'uuid';
import { type StoreState } from '@/stores/store'; // Ensure these types are defined in your store

import { LayoutOptions } from '@/components/LayoutPopover';

// Correct the import path for SimulationContext
import { SimulationContext } from '@/context/useSimulationContextHook';

const selector = (state: StoreState) => ({
  ocpnName: state.ocpnName,
  setOcpnName: state.setOcpnName,
  petriNetOrder: state.petriNetOrder,
  petriNetsById: state.petriNetsById,
  activePetriNetId: state.activePetriNetId,
  activeMode: state.activeMode,
  colorSets: state.colorSets,
  variables: state.variables,
  priorities: state.priorities,
  functions: state.functions,
  uses: state.uses,
  values: state.values,
  simulationEpoch: state.simulationEpoch,
  setSimulationEpoch: state.setSimulationEpoch,
  createPetriNet: state.createPetriNet,
  setActivePetriNet: state.setActivePetriNet,
  setNodes: state.setNodes,
  setEdges: state.setEdges,
  setColorSets: state.setColorSets,
  setVariables: state.setVariables,
  setPriorities: state.setPriorities,
  setFunctions: state.setFunctions,
  setUses: state.setUses,
  setValues: state.setValues,
  setFusionSets: state.setFusionSets,
  setMonitors: state.setMonitors,
  toggleArcMode: state.toggleArcMode,
  deletePetriNet: state.deletePetriNet,
  duplicatePetriNet: state.duplicatePetriNet,
  reorderPetriNets: state.reorderPetriNets,
  reset: state.reset,
});

const defaultEdgeOptions = {
  type: 'floating',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#000',
    width: 10,
    height: 10,
  },
};

const CPNCanvas = ({ onToggleAIAssistant }: { onToggleAIAssistant: () => void }) => {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [newPetriNetDialogOpen, setNewPetriNetDialogOpen] = useState(false);
  const [confirmNewDialogOpen, setConfirmNewDialogOpen] = useState(false);
  const [newPetriNetName, setNewPetriNetName] = useState('');
  const [renamePetriNetDialogOpen, setRenamePetriNetDialogOpen] = useState(false);
  const [renamePetriNetId, setRenamePetriNetId] = useState<string | null>(null);
  const [renamePetriNetValue, setRenamePetriNetValue] = useState('');
  const [deleteConfirmDialogOpen, setDeleteConfirmDialogOpen] = useState(false);
  const [deleteConfirmPetriNetId, setDeleteConfirmPetriNetId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');

  const [isDialOpen, setIsDialOpen] = useState(false);
  const [dialPosition, setDialPosition] = useState({ x: 0, y: 0 });
  
  // Track snapped positions during node drag - these override React Flow's positions
  const nodeDragRef = useRef<{
    snappedPositions: Map<string, { x: number; y: number }>;
    isDragging: boolean;
    isSnapping: boolean;
  }>({ snappedPositions: new Map(), isDragging: false, isSnapping: false });

  const simulationContext = useContext(SimulationContext); // Get simulation context
  
  const {
    ocpnName,
    setOcpnName,
    petriNetOrder,
    petriNetsById,
    activePetriNetId,
    activeMode,
    colorSets,
    variables,
    priorities,
    functions,
    uses,
    values,
    simulationEpoch,
    setSimulationEpoch,
    createPetriNet,
    setActivePetriNet,
    setNodes,
    setEdges,
    setColorSets,
    setVariables,
    setPriorities,
    setFunctions,
    setUses,
    setValues,
    setFusionSets,
    setMonitors,
    toggleArcMode,
    deletePetriNet,
    duplicatePetriNet,
    reorderPetriNets,
    reset,
  } = useStore(
    useShallow(selector),
  );

  const petriNet = useStore(state => activePetriNetId ? state.petriNetsById[activePetriNetId] : null);
  const activeSpecialTab = useStore(state => state.activeSpecialTab);
  const setActiveSpecialTab = useStore(state => state.setActiveSpecialTab);
  const stateSpaceResult = useStore(state => state.stateSpaceResult);
  const petriNetHandlers = usePetriNetHandlers(activePetriNetId || '');
  const { onNodesChange, onEdgesChange, onConnect } = activePetriNetId
    ? petriNetHandlers
    : { onNodesChange: () => {}, onEdgesChange: () => {}, onConnect: () => {} };

  const { fitView, screenToFlowPosition, getViewport, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [type] = useDnD();

  // Store viewport per tab so switching tabs preserves pan/zoom
  const viewportsRef = useRef<Record<string, Viewport>>({});
  const prevActiveTabRef = useRef<string | null>(activePetriNetId);

  // Subscribe to temporal store for undo/redo
  const { undo, redo } = useStore.temporal.getState();
  const canUndo = useSyncExternalStore(
    useStore.temporal.subscribe,
    () => useStore.temporal.getState().pastStates.length > 0,
  );
  const canRedo = useSyncExternalStore(
    useStore.temporal.subscribe,
    () => useStore.temporal.getState().futureStates.length > 0,
  );

  // Save viewport when switching away from a tab, restore when switching to it
  useEffect(() => {
    const prevId = prevActiveTabRef.current;
    if (prevId && prevId !== activePetriNetId) {
      // Save the viewport of the tab we're leaving
      viewportsRef.current[prevId] = getViewport();
    }
    prevActiveTabRef.current = activePetriNetId;

    // Sync selectedElement with React Flow's selected state on tab switch
    if (activePetriNetId) {
      const state = useStore.getState();
      const net = state.petriNetsById[activePetriNetId];
      if (net) {
        const selectedNode = net.nodes.find((n) => n.selected);
        const selectedEdge = !selectedNode ? net.edges.find((e) => e.selected) : undefined;
        if (selectedNode) {
          state.setSelectedElement(activePetriNetId, { type: 'node', element: selectedNode });
        } else if (selectedEdge) {
          state.setSelectedElement(activePetriNetId, { type: 'edge', element: selectedEdge });
        } else {
          state.setSelectedElement(activePetriNetId, null);
        }
      }
    }
  }, [activePetriNetId, getViewport]);

  // Restore viewport or fitView once nodes have been measured
  useEffect(() => {
    if (nodesInitialized && activePetriNetId) {
      const saved = viewportsRef.current[activePetriNetId];
      if (saved) {
        setViewport(saved);
      } else {
        fitView({ padding: 0.35, maxZoom: 4 });
      }
    }
  }, [nodesInitialized, activePetriNetId, fitView, setViewport]);

  // Handle focusRequest: navigate to the element, zoom in, select it, switch to Model tab
  const focusRequest = useStore(state => state.focusRequest);
  useEffect(() => {
    if (!focusRequest) return;
    const { netId, elementId, elementType } = focusRequest;
    const store = useStore.getState();

    // Clear the request immediately to avoid re-triggering
    store.requestFocus(null);

    // Switch to the correct Petri net tab and dismiss any special tab
    store.setActiveSpecialTab(null);
    store.setActivePetriNet(netId);

    // Switch to "model" mode so the properties panel is visible
    store.setActiveMode('model');

    // Select the element
    const net = store.petriNetsById[netId];
    if (!net) return;

    if (elementType === 'node') {
      const node = net.nodes.find(n => n.id === elementId);
      if (node) {
        store.setSelectedElement(netId, { type: 'node', element: node });
        // Mark as selected in React Flow's node state (for visual highlight)
        store.setNodes(netId, net.nodes.map(n => ({ ...n, selected: n.id === elementId })));
        store.setEdges(netId, net.edges.map(e => ({ ...e, selected: false })));
        // Zoom to the node after a short delay to let React Flow render
        requestAnimationFrame(() => {
          fitView({ nodes: [{ id: elementId }], padding: 0.5, maxZoom: 2, duration: 400 });
        });
      }
    } else {
      const edge = net.edges.find(e => e.id === elementId);
      if (edge) {
        store.setSelectedElement(netId, { type: 'edge', element: edge });
        // Mark as selected in React Flow's edge state (for visual highlight)
        store.setNodes(netId, net.nodes.map(n => ({ ...n, selected: false })));
        store.setEdges(netId, net.edges.map(e => ({ ...e, selected: e.id === elementId })));
        // For edges, zoom to the source node as a reasonable target
        const sourceNode = net.nodes.find(n => n.id === edge.source);
        const targetNode = net.nodes.find(n => n.id === edge.target);
        if (sourceNode && targetNode) {
          requestAnimationFrame(() => {
            fitView({ nodes: [{ id: sourceNode.id }, { id: targetNode.id }], padding: 0.5, maxZoom: 2, duration: 400 });
          });
        }
      }
    }
  }, [focusRequest, fitView]);

  // Keyboard shortcuts for simulation controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs, textareas, or contenteditable
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isMeta = event.metaKey || event.ctrlKey;

      // Ctrl/Cmd + Z: Undo
      if (event.code === 'KeyZ' && isMeta && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      // Ctrl/Cmd + Shift + Z: Redo
      if (event.code === 'KeyZ' && isMeta && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }

      // Check if simulation context is available
      if (!simulationContext) return;

      const { isRunning, runStep, runMultipleStepsAnimated, runMultipleStepsFast, reset: resetSimulation, stop, simulationConfig } = simulationContext;

      // Space: Play animated simulation
      if (event.code === 'Space' && !event.shiftKey && !isMeta) {
        event.preventDefault();
        if (isRunning) {
          stop();
        } else {
          runMultipleStepsAnimated(simulationConfig.stepsPerRun, simulationConfig.animationDelayMs);
        }
        return;
      }

      // Ctrl/Cmd + ArrowRight: Step forward
      if (event.code === 'ArrowRight' && isMeta && !event.shiftKey) {
        event.preventDefault();
        if (!isRunning) {
          runStep();
        }
        return;
      }

      // Ctrl/Cmd + Shift + ArrowRight: Fast forward (run multiple steps without animation)
      if (event.code === 'ArrowRight' && isMeta && event.shiftKey) {
        event.preventDefault();
        if (!isRunning) {
          runMultipleStepsFast(simulationConfig.stepsPerRun);
        }
        return;
      }

      // Ctrl/Cmd + ArrowLeft: Reset simulation
      if (event.code === 'ArrowLeft' && isMeta && !event.shiftKey) {
        event.preventDefault();
        if (!isRunning) {
          resetSimulation();
        }
        return;
      }

      // Escape: Stop running simulation
      if (event.code === 'Escape') {
        if (isRunning) {
          event.preventDefault();
          stop();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [simulationContext, undo, redo]);

  const slices = [
    { key: 'bottom', label: [''], angle: 90 },
    { key: 'undo', label: ['Undo'], angle: 150, disabled: !canUndo },
    { key: 'redo', label: ['Redo'], angle: 30, disabled: !canRedo },
    { key: 'new-place', label: ['New', 'Place'], angle: 210 },
    { key: 'create-aux', label: ['Create aux', 'text'], angle: 270, disabled: true },
    { key: 'new-transition', label: ['New', 'Transition'], angle: 330 },
  ];

  const onOpenPetriNet = (data: PetriNetData, fileName: string) => {
    if (data) {
      // Reset the current state
      reset();

      // Restore OCPN name from file, or derive from filename
      if (data.ocpnName) {
        setOcpnName(data.ocpnName);
      } else {
        // Derive name from filename without extension
        const baseName = fileName.replace(/\.\w+$/, '');
        setOcpnName(baseName);
      }

      // Iterate over the array of Petri nets and add them to the store
      Object.values(data.petriNetsById).forEach((petriNet) => {
        useStore.getState().addPetriNet(petriNet);
      });

      // Set the active Petri net to the first one in the order
      if (data.petriNetOrder.length > 0) {
        useStore.getState().setActivePetriNet(data.petriNetOrder[0]);
      }

      // Update declarations if available
      if (data.colorSets) setColorSets(data.colorSets);
      if (data.variables) setVariables(data.variables);
      if (data.priorities) setPriorities(data.priorities);
      if (data.functions) setFunctions(data.functions);
      if (data.uses) setUses(data.uses);
      if (data.values) setValues(data.values);
      if (data.fusionSets) setFusionSets(data.fusionSets);
      if (data.monitors) setMonitors(data.monitors);
      
      // Restore simulation settings if available
      if (data.simulationSettings) {
        // Restore simulation epoch
        if (data.simulationSettings.simulationEpoch !== undefined) {
          setSimulationEpoch(data.simulationSettings.simulationEpoch);
        }
        // Restore simulation config (stepsPerRun, animationDelayMs)
        if (simulationContext?.setSimulationConfig) {
          const currentConfig = simulationContext.simulationConfig;
          simulationContext.setSimulationConfig({
            ...currentConfig,
            stepsPerRun: data.simulationSettings.stepsPerRun ?? currentConfig.stepsPerRun,
            animationDelayMs: data.simulationSettings.animationDelayMs ?? currentConfig.animationDelayMs,
          });
        }
      }

      // If we imported a JSON file, layout the graph
      if (fileName.endsWith('.json')) {
        const layoutOptions: LayoutOptions = {
          algorithm: 'dagre',
          direction: 'TB',
          nodeSeparation: 150,
          rankSeparation: 50,
          objectAttraction: 0.5,
        };

        // Apply layout to all Petri nets (applyLayout will call fitView after completion)
        Object.values(data.petriNetsById).forEach((petriNet) => {
          applyLayout(layoutOptions, petriNet.nodes, petriNet.edges);
        });
      } else {
        // For other formats (OCPN, CPN), fit the view immediately after loading
        window.requestAnimationFrame(() => {
          fitView({ padding: 0.35, maxZoom: 4 });
        });
      }

      // Mark the store as clean (no unsaved changes)
      markClean();
    }
  };

  const handleFileLoaded = (fileContent: string, fileName: string) => {
    // Reset simulation state before loading new file
    if (simulationContext) {
      simulationContext.reset(); // Call simulation reset
    } else {
      console.error("Simulation context not found, cannot reset simulation state.");
    }

    const data = parseFileContent(fileContent, fileName)
    if (data) {
      onOpenPetriNet(data, fileName);
      // Show import warnings (e.g., untranslated SML expressions)
      if (data.importWarnings && data.importWarnings.length > 0) {
        toast.warning('CPN import completed with warnings', {
          description: data.importWarnings.join('\n'),
          duration: 15000,
        });
      }
    } else {
      // Show error notification
      toast.error("Failed to parse the file. Please check the file format.")
    }
  }

  /** Create a blank OCPN with just a "Main" subpage and default declarations. */
  const handleNewOCPN = () => {
    // Reset simulation
    if (simulationContext) {
      simulationContext.reset();
    }

    // Reset the store to empty state
    reset();

    // Set up the fresh OCPN
    setOcpnName('Untitled Petri Net');
    setColorSets(initialColorSets.map(cs => ({ ...cs, id: uuidv4() })));
    setPriorities(initialPriorities.map(p => ({ ...p, id: uuidv4() })));
    setVariables([]);
    setFunctions([]);
    setUses([]);
    setValues([]);
    setFusionSets([]);
    setMonitors([]);

    // Create the "Main" subpage
    createPetriNet('Main');

    // Mark as clean (no unsaved changes)
    markClean();

    // Clear undo history
    useStore.temporal.getState().clear();

    // Fit view
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.35, maxZoom: 4 });
    });
  }

  /** Handle the "New" toolbar button: ask to confirm if dirty. */
  const handleNewClick = () => {
    if (isStoreDirty()) {
      setConfirmNewDialogOpen(true);
    } else {
      handleNewOCPN();
    }
  }

  const handleSave = (format: string) => {
    let content: string
    let filename: string

    const petriNetData: PetriNetData = {
      ocpnName,
      petriNetsById,
      petriNetOrder,
      colorSets,
      variables,
      priorities,
      functions,
      uses,
      values,
      fusionSets: useStore.getState().fusionSets,
      monitors: useStore.getState().monitors,
      // Include simulation settings for JSON/OCPN format
      simulationSettings: {
        stepsPerRun: simulationContext?.simulationConfig?.stepsPerRun,
        animationDelayMs: simulationContext?.simulationConfig?.animationDelayMs,
        simulationEpoch: simulationEpoch,
      },
    }

    switch (format) {
      case "cpn-tools":
        content = convertToCPNToolsXML({
          ...petriNetData,
          petriNetsById: Object.fromEntries(
            Object.entries(petriNetData.petriNetsById).map(([id, net]) => [
              id,
              {
                ...net,
                nodes: net.nodes.map((node) => ({
                  ...node,
                  position: {
                    ...node.position,
                    y: -node.position.y, // Invert y-axis for CPN Tools
                  },
                })),
              },
            ])
          ),
        });
        //filename = `${petriNetsById.name.replace(/\s+/g, "_")}.cpn`;
        filename = `${ocpnName.replace(/\s+/g, '_')}.cpn`;
        break;
      case "pnml":
        content = convertToPNML(petriNetData);
        filename = `${ocpnName.replace(/\s+/g, '_')}.pnml`;
        break;
      case "cpn-py":
        content = convertToCPNPyJSON(petriNetData);
        //filename = `${petriNetData.name.replace(/\s+/g, "_")}.json`;
        filename = `${ocpnName.replace(/\s+/g, '_')}.json`;
        break;
      case "json":
      default:
        content = convertToJSON(petriNetData);
        //filename = `${petriNetData.name.replace(/\s+/g, "_")}.ocpn`;
        filename = `${ocpnName.replace(/\s+/g, '_')}.ocpn`;
        break;
    }

    saveFile(content, filename);
    markClean();
  }

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      if (!type || typeof type !== 'string') {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `node_${Date.now()}`,
        type,
        position,
        width: type === 'transition' ? 60 : 35,
        height: type === 'transition' ? 30 : 35,
        data: {
          label: type === 'auxText' ? 'Annotation' : `${type}`,
          ...(type === 'place' ? { colorSet: '' } : type === 'transition' ? { guard: '' } : {}),
        },
      };

      if (activePetriNetId) {
        useStore.getState().addNode(activePetriNetId, newNode);
      } else {
        console.error("Cannot add node: activePetriNetId is null.");
      }
    },
    [screenToFlowPosition, type, activePetriNetId]
  );

  // Handle node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setIsDialOpen(false);
    if (activePetriNetId) {
      useStore.getState().setSelectedElement(activePetriNetId, { type: "node", element: node });
    } else {
      console.error("Cannot set selected element: activePetriNetId is null.");
    }
  }, [activePetriNetId]);

  // Handle node drag start
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onNodeDragStart = useCallback((_event: React.MouseEvent, _node: Node, _nodes: Node[]) => {
    pauseUndo();
    nodeDragRef.current.isDragging = true;
    nodeDragRef.current.isSnapping = false;
    nodeDragRef.current.snappedPositions.clear();
  }, []);

  // Handle node drag - apply shift-snap to align with connected edges
  // When snapping, we find the snap offset for ONE node and apply it to ALL nodes in the group
  const onNodeDrag = useCallback((event: React.MouseEvent, _node: Node, nodes: Node[]) => {
    if (!activePetriNetId || nodes.length === 0) return;
    
    const petriNet = useStore.getState().petriNetsById[activePetriNetId];
    if (!petriNet) return;
    
    // Clear snapped positions if shift is not pressed
    if (!event.shiftKey) {
      nodeDragRef.current.isSnapping = false;
      nodeDragRef.current.snappedPositions.clear();
      return;
    }
    
    const SNAP_THRESHOLD = 20;
    
    // Find a snap offset by checking all dragged nodes against their connected edges
    let snapDeltaX: number | null = null;
    let snapDeltaY: number | null = null;
    
    // Get the set of dragged node IDs for quick lookup
    const draggedNodeIds = new Set(nodes.map(n => n.id));
    
    // Check each dragged node for snap opportunities
    for (const draggedNode of nodes) {
      if (snapDeltaX !== null && snapDeltaY !== null) break; // Already found both snaps
      
      const nodeCenter = {
        x: draggedNode.position.x + (draggedNode.measured?.width || 50) / 2,
        y: draggedNode.position.y + (draggedNode.measured?.height || 30) / 2,
      };
      
      // Find all connected edges to nodes NOT in the dragged group
      const connectedEdges = petriNet.edges.filter(
        (edge) => {
          const isConnected = edge.source === draggedNode.id || edge.target === draggedNode.id;
          if (!isConnected) return false;
          // Only consider edges to nodes outside the dragged group
          const otherNodeId = edge.source === draggedNode.id ? edge.target : edge.source;
          return !draggedNodeIds.has(otherNodeId);
        }
      );
      
      for (const edge of connectedEdges) {
        if (snapDeltaX !== null && snapDeltaY !== null) break;
        
        // Find the other node (which is NOT being dragged)
        const otherNodeId = edge.source === draggedNode.id ? edge.target : edge.source;
        const otherNode = petriNet.nodes.find((n) => n.id === otherNodeId);
        if (!otherNode) continue;
        
        const otherCenter = {
          x: otherNode.position.x + (otherNode.measured?.width || 50) / 2,
          y: otherNode.position.y + (otherNode.measured?.height || 30) / 2,
        };
        
        // Check if we have bendpoints - if so, use the first/last bendpoint as reference
        const bendpoints = edge.data?.bendpoints as { x: number; y: number }[] | undefined;
        let referencePoint = otherCenter;
        
        if (bendpoints && bendpoints.length > 0) {
          // Use the bendpoint closest to the dragged node
          if (edge.source === draggedNode.id) {
            referencePoint = bendpoints[0]; // First bendpoint for outgoing edge
          } else {
            referencePoint = bendpoints[bendpoints.length - 1]; // Last bendpoint for incoming edge
          }
        }
        
        // Check for horizontal alignment (same Y) - snap the center
        if (snapDeltaY === null && Math.abs(nodeCenter.y - referencePoint.y) < SNAP_THRESHOLD) {
          snapDeltaY = referencePoint.y - nodeCenter.y;
        }
        
        // Check for vertical alignment (same X) - snap the center
        if (snapDeltaX === null && Math.abs(nodeCenter.x - referencePoint.x) < SNAP_THRESHOLD) {
          snapDeltaX = referencePoint.x - nodeCenter.x;
        }
      }
    }
    
    // If we found a snap, store the snapped positions
    if (snapDeltaX !== null || snapDeltaY !== null) {
      nodeDragRef.current.isSnapping = true;
      nodeDragRef.current.snappedPositions.clear();
      
      // Calculate and store snapped positions for all dragged nodes
      nodes.forEach((draggedNode) => {
        const snappedPos = {
          x: draggedNode.position.x + (snapDeltaX ?? 0),
          y: draggedNode.position.y + (snapDeltaY ?? 0),
        };
        nodeDragRef.current.snappedPositions.set(draggedNode.id, snappedPos);
      });
      
      // Apply snapped positions to store
      const updatedNodes = petriNet.nodes.map((node) => {
        const snappedPos = nodeDragRef.current.snappedPositions.get(node.id);
        if (snappedPos) {
          return { ...node, position: snappedPos };
        }
        return node;
      });
      
      setNodes(activePetriNetId, updatedNodes);
    } else {
      nodeDragRef.current.isSnapping = false;
      nodeDragRef.current.snappedPositions.clear();
    }
  }, [activePetriNetId, setNodes]);
  
  // Handle node drag stop
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onNodeDragStop = useCallback((_event: React.MouseEvent, _node: Node, _nodes: Node[]) => {
    resumeUndo();
    // Keep snapped positions for one more cycle to override React Flow's final position
    // The onNodesChange handler will use these
    setTimeout(() => {
      nodeDragRef.current.isDragging = false;
      nodeDragRef.current.isSnapping = false;
      nodeDragRef.current.snappedPositions.clear();
    }, 50);
  }, []);
  
  // Custom onNodesChange that respects snapped positions
  const customOnNodesChange = useCallback((changes: import('@xyflow/react').NodeChange[]) => {
    if (!activePetriNetId) return;
    
    // If we're snapping, override position changes with our snapped positions
    if (nodeDragRef.current.isSnapping && nodeDragRef.current.snappedPositions.size > 0) {
      const modifiedChanges = changes.map((change) => {
        if (change.type === 'position' && 'id' in change && change.position) {
          const snappedPos = nodeDragRef.current.snappedPositions.get(change.id);
          if (snappedPos) {
            return {
              ...change,
              position: snappedPos,
            };
          }
        }
        return change;
      });
      onNodesChange(modifiedChanges);
    } else {
      onNodesChange(changes);
    }
  }, [activePetriNetId, onNodesChange]);

  // Handle edge selection
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setIsDialOpen(false);
    if (activePetriNetId) {
      useStore.getState().setSelectedElement(activePetriNetId, { type: "edge", element: edge });
    } else {
      console.error("Cannot set selected element: activePetriNetId is null.");
    }
  }, [activePetriNetId])

  // Handle background click (deselect)
  const onPaneClick = useCallback(() => {
    if (activePetriNetId) {
      useStore.getState().setSelectedElement(activePetriNetId, null);
    } else {
      console.error("Cannot set selected element: activePetriNetId is null.");
    }
    setIsDialOpen(false);
  }, [activePetriNetId])

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    const reactEvent = event as React.MouseEvent<Element, MouseEvent>;
    const position = {
      x: reactEvent.clientX,
      y: reactEvent.clientY,
    };

    // Show context menu
    setDialPosition(position);
    setIsDialOpen(true);
  }
  , []);

  const handleSliceClick = (_: number, slice: Slice) => {
    if (slice.disabled) return;
    // Handle undo/redo slices
    if (slice.key === 'undo') {
      undo();
      setIsDialOpen(false);
      return;
    }
    if (slice.key === 'redo') {
      redo();
      setIsDialOpen(false);
      return;
    }
    // Perform action based on slice.id
    const nodeWidth = slice.key === 'new-place' ? 35 : 60; // Adjust width based on node type
    const nodeHeight = slice.key === 'new-place' ? 35 : 30;
    const position = {
      x: screenToFlowPosition(dialPosition).x - nodeWidth / 2,
      y: screenToFlowPosition(dialPosition).y - nodeHeight / 2,
    };
    if (slice.key === 'new-place') {
      const newNode = {
        id: `node_${Date.now()}`,
        type: 'place',
        position,
        width: 35,
        height: 35,
        data: { label: 'place', isArcMode: false, colorSet: '' },
      };
      if (activePetriNetId) {
        useStore.getState().addNode(activePetriNetId, newNode);
      }
    } else if (slice.key === 'new-transition') {
      const newNode = {
        id: `node_${Date.now()}`,
        type: 'transition',
        position,
        width: 60,
        height: 30,
        data: { label: 'transition', isArcMode: false, guard: '' },
      };
      if (activePetriNetId) {
        useStore.getState().addNode(activePetriNetId, newNode);
      }
    }
    setIsDialOpen(false);
  }

  const applyLayout = useCallback(
    async (options: LayoutOptions, currentNodes: Node[], currentEdges: Edge[]) => {
      if (!currentNodes.length) return;

      // Clear bendpoints from all edges before applying layout
      const edgesWithoutBendpoints = currentEdges.map((edge) => ({
        ...edge,
        data: edge.data ? { ...edge.data, bendpoints: undefined } : edge.data,
      }));
      
      if (activePetriNetId) {
        setEdges(activePetriNetId, edgesWithoutBendpoints);
      }

      try {
        if (options.algorithm === "dagre") {
          // Dynamically import dagre
          const Dagre = await import('@dagrejs/dagre');

          // Create a new graph
          const g = new Dagre.graphlib.Graph();
          g.setGraph({
            rankdir: options.direction,
            nodesep: options.nodeSeparation,
            ranksep: options.rankSeparation,
            ranker: "network-simplex",
          });
          g.setDefaultEdgeLabel(() => ({}));

          currentEdges.forEach((edge) => g.setEdge(edge.source, edge.target));
          currentNodes.forEach((node) =>
            g.setNode(node.id, {
              ...node,
              width: node.measured?.width ?? 0,
              height: node.measured?.height ?? 0,
            }),
          );

          // Apply the layout
          Dagre.layout(g);

          const layoutedNodes = currentNodes.map((node) => {
            const position = g.node(node.id);
            const x = position.x - (node.measured?.width ?? 0) / 2;
            const y = position.y - (node.measured?.height ?? 0) / 2;

            return { ...node, position: { x, y } };
          });

          if (activePetriNetId) {
            setNodes(activePetriNetId, [...layoutedNodes]);
            //setEdges(activePetriNetId, [...currentEdges]);
          }
        } else if (options.algorithm === "elk") {
          // Dynamically import ELK
          const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

          const elk = new ELK();

          // Prepare the graph for ELK
          const graph = {
            id: "root",
            layoutOptions: {
              "elk.algorithm": "layered",
              "elk.direction": options.direction === "TB" ? "DOWN" : "RIGHT",
              "elk.spacing.nodeNode": options.nodeSeparation.toString(),
              "elk.layered.spacing.nodeNodeBetweenLayers": options.rankSeparation.toString(),
            },
            children: currentNodes.map((node) => ({
              id: node.id,
              width: Number(node.style?.width || 80),
              height: Number(node.style?.height || 80),
            })),
            edges: currentEdges.map((edge) => ({
              id: edge.id,
              sources: [edge.source],
              targets: [edge.target],
            })),
          };

          // Apply the layout
          const elkGraph = await elk.layout(graph);

          // Get the new node positions
          if (elkGraph.children) {
            const layoutedNodes = currentNodes.map((node) => {
              const elkNode = elkGraph.children?.find((n) => n.id === node.id);
              if (elkNode && elkNode.x !== undefined && elkNode.y !== undefined) {
                return {
                  ...node,
                  position: {
                    x: elkNode.x,
                    y: elkNode.y,
                  },
                };
              }
              return node;
            });

            // Update the nodes
            if (activePetriNetId) {
              setNodes(activePetriNetId, [...layoutedNodes]);
            } 
          }
        } else if (options.algorithm === "oc-sugiyama") {
          // OC-Sugiyama layout using ocpn-viz library
          const layoutedNodes = await applySugiyamaLayout(
            currentNodes,
            currentEdges,
            {
              direction: options.direction,
              nodeSeparation: options.nodeSeparation,
              rankSeparation: options.rankSeparation,
              objectAttraction: options.objectAttraction ?? 0.5,
            },
          );

          if (activePetriNetId) {
            setNodes(activePetriNetId, [...layoutedNodes]);
          }
        }

        // After layout is applied, fit the view using requestAnimationFrame
        window.requestAnimationFrame(() => {
          fitView({ padding: 0.35 }); // Keep fitView here for layout adjustments
        });
      } catch (error) {
        console.error("Error applying layout:", error);
      }
    },
    [setNodes, setEdges, fitView, activePetriNetId], // Keep fitView dependency if layout calls it
  );

  const handleAddPetriNet = (e: React.FormEvent) => {
    e.preventDefault();

    createPetriNet(newPetriNetName); // Add the new Petri net to the store
    // close dialog
    setNewPetriNetDialogOpen(false);
    setNewPetriNetName(''); // Clear the input field
  };

  // Import a saved .ocpn/.cpn/.json file as a new subpage with remapped IDs
  const handleImportSubpage = (fileContent: string, fileName: string) => {
    const data = parseFileContent(fileContent, fileName);
    if (!data) {
      toast.error('Failed to parse the file. Please check the file format.');
      return;
    }

    // Show import warnings if any
    if (data.importWarnings && data.importWarnings.length > 0) {
      toast.warning('CPN import completed with warnings', {
        description: data.importWarnings.join('\n'),
        duration: 15000,
      });
    }

    // Import each petri net from the file as a new subpage
    const addPetriNet = useStore.getState().addPetriNet;
    for (const oldId of data.petriNetOrder) {
      const source = data.petriNetsById[oldId];
      if (!source) continue;

      // Remap all IDs to avoid collisions
      const idMap = new Map<string, string>();
      source.nodes.forEach((n) => idMap.set(n.id, uuidv4()));
      source.edges.forEach((e) => idMap.set(e.id, uuidv4()));

      const newId = uuidv4();
      const remappedNodes = source.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        data: {
          ...n.data,
          // Clear hierarchy links — imported net is a fresh subpage
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

      addPetriNet({
        id: newId,
        name: source.name,
        nodes: remappedNodes,
        edges: remappedEdges,
        selectedElement: null,
      });
    }

    // Also merge color sets, variables, etc. from the imported file if they are new
    if (data.colorSets?.length) {
      const existing = new Set(colorSets.map((cs) => cs.name));
      const newCS = data.colorSets.filter((cs) => !existing.has(cs.name));
      if (newCS.length > 0) setColorSets([...colorSets, ...newCS]);
    }
    if (data.variables?.length) {
      const existing = new Set(variables.map((v) => v.name));
      const newVars = data.variables.filter((v) => !existing.has(v.name));
      if (newVars.length > 0) setVariables([...variables, ...newVars]);
    }

    setNewPetriNetDialogOpen(false);
    setNewPetriNetName('');
  };

  const handleSubpageFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) handleImportSubpage(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleSubpageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) handleImportSubpage(content, file.name);
    };
    reader.readAsText(file);
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  const handleRenamePetriNet = (e: React.FormEvent) => {
    e.preventDefault();
    if (renamePetriNetId && renamePetriNetValue.trim()) {
      useStore.getState().renamePetriNet(renamePetriNetId, renamePetriNetValue.trim());
      setRenamePetriNetDialogOpen(false);
      setRenamePetriNetId(null);
      setRenamePetriNetValue('');
    }
  };

  const openRenameDialog = (id: string) => {
    const petriNet = petriNetsById[id];
    if (petriNet) {
      setRenamePetriNetId(id);
      setRenamePetriNetValue(petriNet.name);
      setRenamePetriNetDialogOpen(true);
    }
  };

  // Check if deleting a subpage would affect substitution transitions
  const handleDeleteSubpage = (id: string) => {
    // Check if any substitution transition references this subpage
    const referencingNets = Object.values(petriNetsById).filter(
      (net) => net.id !== id && net.nodes.some((n) => n.type === 'transition' && n.data?.subPageId === id)
    );
    if (referencingNets.length > 0) {
      setDeleteConfirmPetriNetId(id);
      setDeleteConfirmDialogOpen(true);
    } else {
      deletePetriNet(id);
    }
  };

  const confirmDeleteSubpage = () => {
    if (deleteConfirmPetriNetId) {
      deletePetriNet(deleteConfirmPetriNetId);
    }
    setDeleteConfirmDialogOpen(false);
    setDeleteConfirmPetriNetId(null);
  };

  const handleSaveSubpageAsNet = (id: string) => {
    const petriNet = petriNetsById[id];
    if (!petriNet) return;
    const singleNetData: PetriNetData = {
      ocpnName: petriNet.name,
      petriNetsById: { [id]: petriNet },
      petriNetOrder: [id],
      colorSets,
      variables,
      priorities,
      functions,
      uses,
      values,
    };
    const content = convertToJSON(singleNetData);
    saveFile(content, `${petriNet.name.replace(/\s+/g, '_')}.ocpn`);
  };

  const handleSaveSubpageAsPNML = (id: string) => {
    const petriNet = petriNetsById[id];
    if (!petriNet) return;
    const singleNetData: PetriNetData = {
      ocpnName: petriNet.name,
      petriNetsById: { [id]: petriNet },
      petriNetOrder: [id],
      colorSets,
      variables,
      priorities,
      functions,
      uses,
      values,
    };
    const content = convertToPNML(singleNetData);
    saveFile(content, `${petriNet.name.replace(/\s+/g, '_')}.pnml`);
  };

  // Export the state space graph as a Graphviz DOT file
  const handleSaveGraphviz = () => {
    const graph = stateSpaceResult?.graph;
    if (!graph) return;

    // Build place name lookup from all nets
    const placeNames = new Map<string, string>();
    for (const net of Object.values(petriNetsById)) {
      for (const node of net.nodes) {
        if (node.type === 'place') {
          const label = (node.data?.label as string) || node.id;
          placeNames.set(node.id, label.replace(/\n/g, ' '));
        }
      }
    }

    // Format a state marking for DOT label
    const formatMarking = (marking: Record<string, string[]>): string => {
      const entries = Object.entries(marking);
      if (entries.length === 0) return 'empty';
      return entries
        .map(([placeId, tokens]) => {
          const name = placeNames.get(placeId) || placeId;
          return `${name}: ${tokens.length}'(${tokens.join(', ')})`;
        })
        .join('\\n');
    };

    const lines: string[] = [];
    lines.push('digraph StateSpace {');
    lines.push('  rankdir=TB;');
    lines.push('  node [shape=ellipse, style=filled, fillcolor="#f0f0f0", fontsize=10];');
    lines.push('  edge [fontsize=9];');
    lines.push('');

    for (const sn of graph.nodes) {
      const tooltip = formatMarking(sn.marking);
      const timeStr = sn.time > 0 ? ` @${sn.time}` : '';
      lines.push(`  s${sn.id} [label="S${sn.id}${timeStr}", tooltip="${tooltip}"];`);
    }

    lines.push('');

    for (const arc of graph.arcs) {
      const label = arc.transitionName.replace(/\n/g, ' ');
      const binding = arc.binding ? ` [${arc.binding}]` : '';
      lines.push(`  s${arc.from} -> s${arc.to} [label="${label}${binding}"];`);
    }

    lines.push('}');
    lines.push('');

    saveFile(lines.join('\n'), 'state-space.dot');
  };

  // Tab drag-to-reorder state
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const handleTabDragStart = (e: React.DragEvent, id: string) => {
    // Don't allow dragging the main (first) tab
    if (petriNetOrder[0] === id) {
      e.preventDefault();
      return;
    }
    setDraggedTabId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleTabDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!draggedTabId || draggedTabId === id) return;
    // Don't allow dropping before the main tab
    if (petriNetOrder[0] === id) return;
    e.dataTransfer.dropEffect = 'move';
    setDragOverTabId(id);
  };

  const handleTabDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverTabId(null);
    if (!draggedTabId || draggedTabId === targetId) return;
    // Don't allow dropping before the main tab
    if (petriNetOrder[0] === targetId) return;

    const oldIndex = petriNetOrder.indexOf(draggedTabId);
    const newIndex = petriNetOrder.indexOf(targetId);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...petriNetOrder];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, draggedTabId);
    reorderPetriNets(newOrder);
    setDraggedTabId(null);
  };

  const handleTabDragEnd = () => {
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  return (
    <div className="dndflow flex flex-col grow"> {/* Ensure this container allows growth */}
      <div className="flex flex-col grow" style={{ height: 100 }}> {/* Ensure this container allows growth */}
        {/* Toolbar Panel */}
        <div className="flex items-center justify-between p-2 border-b">
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="icon" title="New" onClick={handleNewClick}>
                      <FilePlus2 className="h-5 w-5" />
                      <span className="sr-only">New Petri Net</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>New Petri Net</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="icon" title="Open" onClick={() => setOpenDialogOpen(true)}>
                      <FolderOpen className="h-5 w-5" />
                      <span className="sr-only">Open Petri Net</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open Petri Net</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="icon" title="Save" onClick={() => setSaveDialogOpen(true)}>
                      <Save className="h-5 w-5" />
                      <span className="sr-only">Save Petri Net</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Save Petri Net</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Undo"
                      onClick={() => undo()}
                      disabled={!canUndo}
                    >
                      <Undo2 className="h-5 w-5" />
                      <span className="sr-only">Undo</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Undo</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Redo"
                      onClick={() => redo()}
                      disabled={!canRedo}
                    >
                      <Redo2 className="h-5 w-5" />
                      <span className="sr-only">Redo</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Redo</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* Editable OCPN Name */}
          <div className="flex items-center">
            {isEditingName ? (
              <input
                className="text-base font-semibold bg-transparent border-b border-foreground/30 outline-none px-1 py-0.5 text-center"
                value={editingNameValue}
                onChange={(e) => setEditingNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (editingNameValue.trim()) {
                      setOcpnName(editingNameValue.trim());
                    }
                    setIsEditingName(false);
                  } else if (e.key === 'Escape') {
                    setIsEditingName(false);
                  }
                }}
                onBlur={() => {
                  if (editingNameValue.trim()) {
                    setOcpnName(editingNameValue.trim());
                  }
                  setIsEditingName(false);
                }}
                autoFocus
              />
            ) : (
              <button
                className="text-base font-semibold text-foreground hover:text-foreground/70 transition-colors cursor-pointer px-1 py-0.5"
                onClick={() => {
                  setEditingNameValue(ocpnName);
                  setIsEditingName(true);
                }}
                title="Click to rename"
              >
                {ocpnName}
              </button>
            )}
          </div>
          <AssistanceToolbar onToggleAIAssistant={onToggleAIAssistant} />
        </div>

        <OpenDialog open={openDialogOpen} onOpenChange={setOpenDialogOpen} onFileLoaded={handleFileLoaded} />

        <SaveDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          onSave={handleSave}
          petriNetName={ocpnName}
        />

        {/* Confirm discard dialog for New Petri Net */}
        <Dialog open={confirmNewDialogOpen} onOpenChange={setConfirmNewDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes. Creating a new Petri net will discard them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmNewDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => { setConfirmNewDialogOpen(false); handleNewOCPN(); }}>
                Discard &amp; Create New
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Subpage tab bar */}
        <div className="flex items-end w-full bg-muted/50 px-1 pt-1 gap-0 overflow-x-auto border-b border-border">
          {petriNetOrder.map((id, index) => {
            const isMain = index === 0;
            const isActive = id === activePetriNetId && !activeSpecialTab;
            const isDragOver = id === dragOverTabId;
            return (
              <div
                key={id}
                className={`
                  group relative flex items-center gap-0.5 px-3 py-1.5 text-sm cursor-pointer select-none
                  border border-b-0 rounded-t-md transition-colors
                  ${isActive
                    ? 'bg-background border-border text-foreground font-medium z-10 -mb-px'
                    : 'bg-muted/60 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                  }
                  ${isMain && !isActive ? 'bg-muted border-border/50' : ''}
                  ${isDragOver ? 'ring-2 ring-primary/50' : ''}
                `}
                draggable={!isMain}
                onDragStart={(e) => handleTabDragStart(e, id)}
                onDragOver={(e) => handleTabDragOver(e, id)}
                onDragLeave={() => setDragOverTabId(null)}
                onDrop={(e) => handleTabDrop(e, id)}
                onDragEnd={handleTabDragEnd}
                onClick={() => { setActiveSpecialTab(null); setActivePetriNet(id); }}
              >
                {/* Drag handle for non-main tabs */}
                {!isMain && (
                  <GripVertical className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shrink-0 -ml-1" />
                )}
                {/* Main page icon */}
                {isMain && (
                  <svg className="h-3.5 w-3.5 mr-0.5 shrink-0 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 6l6-4 6 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" />
                    <path d="M6 14V9h4v5" />
                  </svg>
                )}
                <span className="truncate max-w-[140px]">{petriNetsById[id]?.name}</span>
                {/* Three-dot menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`
                        ml-1 p-0.5 rounded hover:bg-foreground/10 transition-opacity shrink-0
                        ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}
                      `}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem onClick={() => openRenameDialog(id)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => duplicatePetriNet(id)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleSaveSubpageAsNet(id)}>
                      Save as Petri Net
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleSaveSubpageAsPNML(id)}>
                      Save as PNML
                    </DropdownMenuItem>
                    {!isMain && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDeleteSubpage(id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          {/* Add subpage button */}
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-t-md transition-colors border border-transparent ml-0.5"
            onClick={() => setNewPetriNetDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {/* State Space Graph tab (shown when a state space has been calculated) */}
          {stateSpaceResult?.graph && (
            <>
              <div className="mx-1 self-stretch flex items-center">
                <div className="h-4 w-px bg-border" />
              </div>
              <div
                className={`
                  group relative flex items-center gap-1 px-3 py-1.5 text-sm cursor-pointer select-none
                  border border-b-0 rounded-t-md transition-colors
                  ${activeSpecialTab === 'stateSpaceGraph'
                    ? 'bg-background border-border text-foreground font-medium z-10 -mb-px'
                    : 'bg-muted/60 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                  }
                `}
                onClick={() => setActiveSpecialTab('stateSpaceGraph')}
              >
                <GitGraph className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">State Space</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`
                        ml-1 p-0.5 rounded hover:bg-foreground/10 transition-opacity shrink-0
                        ${activeSpecialTab === 'stateSpaceGraph' ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}
                      `}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => handleSaveGraphviz()}>
                      <Download className="h-4 w-4 mr-2" />
                      Save as Graphviz (.dot)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>

        {/* New Subpage Dialog */}
        <Dialog open={newPetriNetDialogOpen} onOpenChange={setNewPetriNetDialogOpen}>
          <DialogContent className="p-4">
            <DialogHeader>
              <DialogTitle>Add New Subpage</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddPetriNet} className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="petri-net-name">Subpage Name</Label>
                <Input
                  id="petri-net-name"
                  placeholder="Enter subpage name"
                  value={newPetriNetName}
                  onChange={(e) => setNewPetriNetName(e.target.value)}
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Add Empty Subpage
              </Button>
            </form>

            <div className="relative flex items-center my-1">
              <div className="flex-grow border-t border-border" />
              <span className="mx-3 text-xs text-muted-foreground">or import from file</span>
              <div className="flex-grow border-t border-border" />
            </div>

            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleSubpageFileDrop}
              onClick={() => document.getElementById('import-subpage-file')?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Drop an <span className="font-medium text-foreground">.ocpn</span>, <span className="font-medium text-foreground">.cpn</span>, or <span className="font-medium text-foreground">.pnml</span> file here
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">or click to browse</p>
              <input
                id="import-subpage-file"
                type="file"
                accept=".ocpn,.cpn,.json,.xml,.pnml"
                className="hidden"
                onChange={handleSubpageFileSelect}
              />
            </div>
          </DialogContent>
        </Dialog>
        {/* Rename Subpage Dialog */}
        <Dialog open={renamePetriNetDialogOpen} onOpenChange={setRenamePetriNetDialogOpen}>
          <DialogContent className="p-4" onOpenAutoFocus={(e) => {
            e.preventDefault();
            setTimeout(() => {
              const input = document.getElementById('rename-petri-net-name') as HTMLInputElement | null;
              if (input) {
                input.focus();
                input.select();
              }
            }, 50);
          }}>
            <DialogHeader>
              <DialogTitle>Rename Subpage</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRenamePetriNet} className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="rename-petri-net-name">New Name</Label>
                <Input
                  id="rename-petri-net-name"
                  placeholder="Enter new name"
                  value={renamePetriNetValue}
                  onChange={(e) => setRenamePetriNetValue(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full">
                Rename
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        {/* Delete Subpage Confirmation Dialog */}
        <Dialog open={deleteConfirmDialogOpen} onOpenChange={setDeleteConfirmDialogOpen}>
          <DialogContent className="p-4">
            <DialogHeader>
              <DialogTitle>Delete Subpage</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This subpage is referenced by a substitution transition. Deleting it will convert the substitution transition back to a regular transition, which may result in an incomplete model.
              </p>
              <p className="text-sm font-medium">
                Are you sure you want to delete &quot;{deleteConfirmPetriNetId ? petriNetsById[deleteConfirmPetriNetId]?.name : ''}&quot;?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDeleteConfirmDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDeleteSubpage}>
                  Delete
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ReactFlow Component Wrapper */}
        {/* Add w-full and h-full to ensure the wrapper takes available space */}
        {/* <div className="reactflow-wrapper w-full h-full" ref={reactFlowWrapper}> */}
        {activeSpecialTab === 'stateSpaceGraph' ? (
          <ReachabilityGraphTab />
        ) : (
          <ReactFlow
            nodes={petriNet?.nodes || []}
            nodeTypes={nodeTypes}
            edges={petriNet?.edges || []}
            edgeTypes={edgeTypes}
            onNodesChange={customOnNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={(event, node, nodes) => {
              onNodeClick(event, node);
              onNodeDragStart(event, node, nodes);
            }}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionLineComponent={CustomConnectionLine}
            maxZoom={4}
            selectionOnDrag
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
          >
            <Background />
            <MiniMap />
            <Controls />
            <Panel position="top-center">
              {activeMode === 'simulation' ? (
                <div className="bg-background border rounded-lg p-2 shadow-sm">
                  <SimulationToolbar />
                </div>
              ) : (
                <Toolbar toggleArcMode={toggleArcMode} onApplyLayout={(options) => petriNet && applyLayout(options, petriNet.nodes, petriNet.edges)}/>
              )}
            </Panel>
            <BoomerDial
              slices={slices}
              position={dialPosition}
              isOpen={isDialOpen}
              onClose={() => setIsDialOpen(false)}
              onSliceClick={handleSliceClick}
              size={200}
            />
          </ReactFlow>
        )}
        {/* </div> */}
      </div>
    </div>
  );
};

export default CPNCanvas;
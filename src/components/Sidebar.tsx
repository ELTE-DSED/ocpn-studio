import { useCallback, useRef, useState } from 'react';
import useStore from '@/stores/store';
import { useShallow } from 'zustand/react/shallow';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, FastForward, Network } from 'lucide-react';

import PlaceProperties from './PlaceProperties';
import TransitionProperties from './TransitionProperties';
import PlaceBatchProperties from './PlaceBatchProperties';
import TransitionBatchProperties from './TransitionBatchProperties';
import AuxTextProperties from './AuxTextProperties';
import ArcProperties from './ArcProperties';
import DeclareConstraintProperties from './DeclareConstraintProperties';
import { DeleteElementButton } from '@/components/DeleteElementButton';
import { SimulationPanel } from '@/components/SimulationPanel';
import { AnalysisPanel } from '@/components/AnalysisPanel';

import { DeclarationManager } from '@/components/DeclarationManager';
import { AboutLegalMenu } from '@/components/AboutLegalMenu';
import { TabsContent } from '@radix-ui/react-tabs';

import type { ActiveMode } from '@/types';

const SIDEBAR_MIN_PX = 400;

const Sidebar = () => {
  // Access selectedElement from the store
  const selectedElement = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return activePetriNet?.selectedElement;
  });

  // React Flow's own per-node `selected` flag (kept in sync via onNodesChange) is the
  // source of truth for multi-selection — `selectedElement` above only ever reflects the
  // single node/edge that was last individually clicked.
  //
  // These are two separate selectors (rather than one returning `{ type, ids }`) because
  // `useShallow` only shallow-compares the value it's given directly: nested inside an
  // object, a freshly-mapped `ids` array would never compare equal across renders and the
  // subscription would never settle, which is exactly what happened here the first time
  // (an infinite re-render loop, "Maximum update depth exceeded"). A directly-returned
  // array is exactly what `useShallow` is for, so `selectedNodeIds` stays stable on its own.
  const selectedNodeIds = useStore(useShallow((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return (activePetriNet?.nodes ?? []).filter((n) => n.selected).map((n) => n.id);
  }));
  const selectedNodesTypeKey = useStore((state) => {
    const activePetriNet = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    const selectedNodes = (activePetriNet?.nodes ?? []).filter((n) => n.selected);
    if (selectedNodes.length <= 1) return null;
    const firstType = selectedNodes[0].type;
    return selectedNodes.every((n) => n.type === firstType) ? firstType : 'mixed';
  });
  const multiSelect = selectedNodeIds.length > 1
    ? {
        type: (selectedNodesTypeKey === 'place' || selectedNodesTypeKey === 'transition') ? selectedNodesTypeKey : null,
        ids: selectedNodeIds,
      }
    : null;

  const colorSets = useStore((state) => state.colorSets);
  const priorities = useStore((state) => state.priorities);
  const activeMode = useStore((state) => state.activeMode);
  const setActiveMode = useStore((state) => state.setActiveMode);

  // Pixel-based sidebar width with drag-to-resize handle
  const [width, setWidth] = useState(SIDEBAR_MIN_PX);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(SIDEBAR_MIN_PX, startWidth + (moveEvent.clientX - startX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  const renderElementProperties = () => {
    if (multiSelect) {
      if (multiSelect.type === 'place') {
        return <PlaceBatchProperties nodeIds={multiSelect.ids} colorSets={colorSets} />;
      }
      if (multiSelect.type === 'transition') {
        return <TransitionBatchProperties nodeIds={multiSelect.ids} priorities={priorities} />;
      }
      return (
        <div className="p-4 text-center text-muted-foreground text-sm">
          {multiSelect.ids.length} elements selected. Select only places or only transitions to batch-edit their properties.
        </div>
      );
    }

    if (!selectedElement) {
      return <div className="p-4 text-center text-muted-foreground">Select an element to edit its properties</div>;
    }

    if (selectedElement.type === 'node') {
      const nodeType = selectedElement.element.type;

      if (nodeType === 'place') {
        return (
          <PlaceProperties
            colorSets={colorSets}
          />
        );
      } else if (nodeType === 'transition') {
        return (
          <TransitionProperties
            priorities={priorities}
          />
        );
      } else if (nodeType === 'auxText') {
        return (
          <AuxTextProperties />
        );
      }
    } else if (selectedElement.type === 'edge') {
      if (selectedElement.element.type === 'declare-constraint') {
        return (
          <DeclareConstraintProperties />
        );
      }
      return (
        <ArcProperties />
      );
    }

    return null;
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden shrink-0 border-r bg-sidebar shadow-[inset_-8px_0_12px_-10px_rgba(0,0,0,0.35)]" style={{ width }}>
      <div className="px-4 py-2 flex-shrink-0 flex items-center gap-2">
        <img src="/favicon-32x32.png" alt="" className="h-5 w-5 shrink-0" />
        <h3 className="text-xl font-bold">OCPN Studio</h3>
      </div>
      <div className="px-4 py-2 flex-1 flex flex-col overflow-hidden">
        <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as ActiveMode)} className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0 h-10 bg-card">
            <TabsTrigger value="model"><Network />Model</TabsTrigger>
            <TabsTrigger value="simulation"><FastForward />Simulation</TabsTrigger>
            <TabsTrigger value="analysis"><BarChart3 />Analysis</TabsTrigger>
          </TabsList>
          <TabsContent value="model" className="space-y-4 mt-2 flex-1 overflow-auto">

            <div className="space-y-4">
                <div className="space-y-2">
                  <div className="border border-border rounded-lg p-4 bg-card">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-sm font-semibold leading-none tracking-tight">
                        {multiSelect
                          ? multiSelect.type === 'place'
                            ? `${multiSelect.ids.length} Places Selected`
                            : multiSelect.type === 'transition'
                              ? `${multiSelect.ids.length} Transitions Selected`
                              : `${multiSelect.ids.length} Elements Selected`
                          : selectedElement
                            ? selectedElement.type === 'node'
                              ? selectedElement.element.type === 'place'
                                ? 'Place Properties'
                                : selectedElement.element.type === 'auxText'
                                  ? 'Text Properties'
                                  : 'Transition Properties'
                              : selectedElement.element.type === 'declare-constraint'
                                ? 'Declare Constraint Properties'
                                : 'Arc Properties'
                            : 'Element Properties'}
                      </span>
                      {!multiSelect && selectedElement && (
                        <DeleteElementButton
                          elementType={selectedElement.type === 'node' ? 'node' : 'edge'}
                          elementId={selectedElement.element.id}
                          elementLabel={(selectedElement.element.data as { label?: string })?.label}
                        />
                      )}
                    </div>
                    <div>
                      {renderElementProperties()}
                    </div>
                  </div>
                </div>

                <Separator orientation="horizontal" className="mt-2" />

                <div className="pt-4">
                  <DeclarationManager />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="simulation" className="mt-2 flex-1 overflow-hidden">
              <SimulationPanel />
            </TabsContent>
            <TabsContent value="analysis" className="mt-2 flex-1 overflow-auto">
              <AnalysisPanel />
            </TabsContent>
          </Tabs>

          <div className="pt-2 shrink-0">
            <AboutLegalMenu />
          </div>
        </div>
      {/* Drag handle for resizing */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-border active:bg-blue-400 transition-colors z-10"
      />
    </div>
  );
};

export default Sidebar;

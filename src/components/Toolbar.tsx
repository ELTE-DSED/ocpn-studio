import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Circle, Square, LetterText, ArrowRight, SquareStack, Milestone, ChevronDown, Workflow } from "lucide-react"

import { Toggle } from '@/components/ui/toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

import { Separator } from '@/components/ui/separator';

import { LayoutPopover, LayoutOptions } from "@/components/LayoutPopover";

import { useDnD } from '@/utils/DnDContext';
import useStore from '@/stores/store';
import { useShallow } from 'zustand/react/shallow';
import type { ArcType, BinaryDeclareTemplate } from '@/types';

const ARC_TYPES: { value: ArcType; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal Arc', description: 'Moves tokens between a place and a transition' },
  { value: 'inhibitor', label: 'Inhibitor Arc', description: 'Enabled only when the place is empty' },
  { value: 'reset', label: 'Reset Arc', description: 'Removes all tokens from the place when firing' },
];

const DECLARE_TEMPLATE_GROUPS: { label: string; items: { value: BinaryDeclareTemplate; label: string; description: string; color: string }[] }[] = [
  {
    label: 'Ordering',
    items: [
      { value: 'response', label: 'Response', description: 'a fires ⇒ b eventually fires', color: '#15803d' },
      { value: 'precedence', label: 'Precedence', description: 'b may only fire after a', color: '#15803d' },
      { value: 'succession', label: 'Succession', description: 'Response + Precedence', color: '#15803d' },
      { value: 'alternate-response', label: 'Alternate Response', description: 'Like Response, but a can’t refire before b', color: '#15803d' },
      { value: 'alternate-precedence', label: 'Alternate Precedence', description: 'Like Precedence, needs a fresh a before each b', color: '#15803d' },
      { value: 'alternate-succession', label: 'Alternate Succession', description: 'Alternate Response + Alternate Precedence', color: '#15803d' },
      { value: 'chain-response', label: 'Chain Response', description: 'b must be the very next event after a', color: '#15803d' },
      { value: 'chain-precedence', label: 'Chain Precedence', description: 'a must be the event immediately before b', color: '#15803d' },
      { value: 'chain-succession', label: 'Chain Succession', description: 'Chain Response + Chain Precedence', color: '#15803d' },
    ],
  },
  {
    label: 'Existence',
    items: [
      { value: 'responded-existence', label: 'Responded Existence', description: 'a fires ⇒ b fires (any order)', color: '#7e22ce' },
      { value: 'co-existence', label: 'Co-Existence', description: 'a fires ⇔ b fires', color: '#7e22ce' },
      { value: 'choice', label: 'Choice', description: 'a or b must fire', color: '#7e22ce' },
      { value: 'exclusive-choice', label: 'Exclusive Choice', description: 'exactly one of a, b must fire', color: '#7e22ce' },
    ],
  },
  {
    label: 'Negation',
    items: [
      { value: 'not-succession', label: 'Not Succession', description: 'a fires ⇒ b never fires after', color: '#b91c1c' },
      { value: 'not-coexistence', label: 'Not Coexistence', description: 'a and b never both fire', color: '#b91c1c' },
      { value: 'not-chain-succession', label: 'Not Chain Succession', description: 'b may never fire immediately after a', color: '#b91c1c' },
    ],
  },
];

const DECLARE_TEMPLATES = DECLARE_TEMPLATE_GROUPS.flatMap((g) => g.items);

interface ToolbarProps {
  toggleArcMode: (pressed: boolean, arcType?: ArcType) => void;
  onApplyLayout: (options: LayoutOptions) => void;
}

function ArcTypeIcon({ type, className }: { type: ArcType; className?: string }) {
  if (type === 'inhibitor') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="12" x2="16" y2="12" />
        <circle cx="19" cy="12" r="3" fill="none" />
      </svg>
    );
  }
  if (type === 'reset') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
        <polygon points="12,6 20,12 12,18" />
        <polygon points="6,6 14,12 6,18" />
      </svg>
    );
  }
  return <ArrowRight className={className} />;
}

export function Toolbar({ toggleArcMode, onApplyLayout }: ToolbarProps) {
  const [, setType] = useDnD();
  const showMarkingDisplay = useStore((state) => state.showMarkingDisplay);
  const setShowMarkingDisplay = useStore((state) => state.setShowMarkingDisplay);
  const activeArcType = useStore((state) => state.activeArcType);
  const isArcMode = useStore((state) => state.isArcMode);
  const isDeclareMode = useStore((state) => state.isDeclareMode);
  const activeDeclareTemplate = useStore((state) => state.activeDeclareTemplate);
  const toggleDeclareMode = useStore((state) => state.toggleDeclareMode);
  const showDeclareLayer = useStore((state) => state.showDeclareLayer);
  const setShowDeclareLayer = useStore((state) => state.setShowDeclareLayer);
  const isChainMode = useStore((state) => state.isChainMode);
  const toggleChainMode = useStore((state) => state.toggleChainMode);
  const [isArcMenuOpen, setIsArcMenuOpen] = useState(false);
  const [isDeclareMenuOpen, setIsDeclareMenuOpen] = useState(false);

  // Hierarchy: get selected element info
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const selectedElement = useStore((state) => {
    const net = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return net?.selectedElement;
  });
  // Get all selected nodes (for multi-select move to subpage)
  const selectedNodes = useStore(useShallow((state) => {
    const net = state.activePetriNetId ? state.petriNetsById[state.activePetriNetId] : null;
    return net?.nodes.filter((n) => n.selected) || [];
  }));
  const moveTransitionToSubpage = useStore((state) => state.moveTransitionToSubpage);
  const moveNodesToSubpage = useStore((state) => state.moveNodesToSubpage);
  const flattenSubstitutionTransition = useStore((state) => state.flattenSubstitutionTransition);

  // Determine if selected element is a single transition (and whether it's a substitution transition)
  const isTransitionSelected = selectedElement?.type === 'node' && selectedElement.element?.type === 'transition';
  const selectedTransitionId = isTransitionSelected ? selectedElement.element.id : null;
  const isSubstitutionTransition = isTransitionSelected && !!selectedElement.element?.data?.subPageId;

  // Multi-selection: at least one transition selected, none are substitution transitions
  const multiSelectedTransitions = selectedNodes.filter((n) => n.type === 'transition');
  const hasMultiSelection = selectedNodes.length > 1 && multiSelectedTransitions.length > 0;
  const multiHasSubstitution = multiSelectedTransitions.some((t) => t.data?.subPageId);

  // Can move to subpage: either single transition or multi-selection with transitions
  const canMoveToSubpage = (!hasMultiSelection && isTransitionSelected && !isSubstitutionTransition)
    || (hasMultiSelection && !multiHasSubstitution);

  const handleMoveToSubpage = () => {
    if (!activePetriNetId) return;
    if (hasMultiSelection) {
      // Multi-node move
      const nodeIds = selectedNodes.map((n) => n.id);
      moveNodesToSubpage(activePetriNetId, nodeIds);
    } else if (selectedTransitionId && !isSubstitutionTransition) {
      // Single transition move
      moveTransitionToSubpage(activePetriNetId, selectedTransitionId);
    }
  };

  const handleFlattenSubpage = () => {
    if (activePetriNetId && selectedTransitionId && isSubstitutionTransition) {
      flattenSubstitutionTransition(activePetriNetId, selectedTransitionId);
    }
  };

  const onDragStart = (event: React.DragEvent<HTMLElement>, nodeType: string) => {
      //event.dataTransfer.setData("application/reactflow", nodeType);
      if (setType) {
        setType(nodeType);
      }
      event.dataTransfer.effectAllowed = "move";
    }

  return (
    <>
      <div className="flex items-center gap-2 bg-background border rounded-lg p-2 shadow-sm">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Place"
                    className="cursor-grab"
                  >
                    <div
                      draggable
                      onDragStart={(event) => onDragStart(event, "place")}
                    >
                      <Circle className="h-5 w-5" />
                      <span className="sr-only">Drag a Place from Here</span>
                    </div>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Drag a Place from Here</p>
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
                    title="Transition"
                    className="cursor-grab"
                  >
                    <div
                      draggable
                      onDragStart={(event) => onDragStart(event, "transition")}
                    >
                      <Square className="h-5 w-5" />
                      <span className="sr-only">Drag a Transition from Here</span>
                    </div>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Drag a Transition from Here</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Toggle
                    aria-label="Toggle Chain Mode"
                    pressed={isChainMode}
                    onPressedChange={toggleChainMode}
                  >
                    <Workflow className="h-4 w-4" style={{ color: isChainMode ? '#0891b2' : undefined }} />
                    <span className="sr-only">Toggle Chain Mode</span>
                  </Toggle>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Chain Mode — click to place alternating places/transitions, auto-connected</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu open={isArcMenuOpen} onOpenChange={setIsArcMenuOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    <DropdownMenuTrigger asChild>
                      <Toggle
                        aria-label="Toggle Arc Mode"
                        pressed={isArcMode}
                        onPressedChange={(pressed) => {
                          if (pressed) {
                            setIsArcMenuOpen(true);
                          } else {
                            toggleArcMode(false);
                          }
                        }}
                        className="gap-0.5 px-2"
                      >
                        <ArcTypeIcon type={activeArcType} className="h-4 w-4" />
                        <ChevronDown className="h-3 w-3 opacity-60" />
                        <span className="sr-only">Toggle Arc Mode</span>
                      </Toggle>
                    </DropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Arc {isArcMode && `— ${ARC_TYPES.find(t => t.value === activeArcType)?.label}`}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="start" className="w-64">
              {ARC_TYPES.map((t) => (
                <DropdownMenuItem
                  key={t.value}
                  className="flex-col items-start gap-0"
                  onClick={() => {
                    toggleArcMode(true, t.value);
                    setIsArcMenuOpen(false);
                  }}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ArcTypeIcon type={t.value} className="h-3.5 w-3.5" />
                    {t.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={isDeclareMenuOpen} onOpenChange={setIsDeclareMenuOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    <DropdownMenuTrigger asChild>
                      <Toggle
                        aria-label="Toggle Declare Constraint Mode"
                        pressed={isDeclareMode}
                        onPressedChange={(pressed) => {
                          if (pressed) {
                            setIsDeclareMenuOpen(true);
                          } else {
                            toggleDeclareMode(false);
                          }
                        }}
                        className="gap-0.5 px-2"
                      >
                        <Milestone className="h-4 w-4" style={{ color: isDeclareMode ? DECLARE_TEMPLATES.find(t => t.value === activeDeclareTemplate)?.color : undefined }} />
                        <ChevronDown className="h-3 w-3 opacity-60" />
                        <span className="sr-only">Toggle Declare Constraint Mode</span>
                      </Toggle>
                    </DropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Declare Constraint {isDeclareMode && `— ${DECLARE_TEMPLATES.find(t => t.value === activeDeclareTemplate)?.label}`}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="start" className="w-72 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-muted-foreground px-2 pb-1 pt-1">Pick a template, then drag between two transitions</p>
              {DECLARE_TEMPLATE_GROUPS.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{group.label}</DropdownMenuLabel>
                  {group.items.map((t) => (
                    <DropdownMenuItem
                      key={t.value}
                      className="flex-col items-start gap-0"
                      onClick={() => {
                        toggleDeclareMode(true, t.value);
                        setIsDeclareMenuOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        {t.label}
                      </span>
                      <span className="text-xs text-muted-foreground pl-4">{t.description}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Annotation"
                    className="cursor-grab"
                  >
                    <div
                      draggable
                      onDragStart={(event) => onDragStart(event, "auxText")}
                    >
                      <LetterText className="h-5 w-5" />
                      <span className="sr-only">Drag a Text Annotation from Here</span>
                    </div>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Drag a Text Annotation from Here</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-2 h-6">
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Hierarchy buttons */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Move to Subpage"
                    disabled={!canMoveToSubpage}
                    onClick={handleMoveToSubpage}
                  >
                    {/* Hierarchy: transition with arrow to subpage icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="8" height="6" rx="0.5" />
                      <rect x="16" y="3" width="6" height="4" rx="0.5" />
                      <rect x="16" y="10" width="6" height="4" rx="0.5" />
                      <path d="M10 9h3m0 0l-1.5-1.5M13 9l-1.5 1.5" />
                      <line x1="13" y1="5" x2="16" y2="5" />
                      <line x1="13" y1="12" x2="16" y2="12" />
                    </svg>
                    <span className="sr-only">Move to Subpage</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Move to Subpage</p>
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
                    title="Replace Substitution Transition by Subpage"
                    disabled={!isSubstitutionTransition}
                    onClick={handleFlattenSubpage}
                  >
                    {/* Flatten: subpage content replacing transition icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="14" y="6" width="8" height="6" rx="0.5" />
                      <rect x="2" y="3" width="6" height="4" rx="0.5" />
                      <rect x="2" y="10" width="6" height="4" rx="0.5" />
                      <path d="M14 9h-3m0 0l1.5-1.5M11 9l1.5 1.5" />
                      <line x1="8" y1="5" x2="11" y2="5" />
                      <line x1="8" y1="12" x2="11" y2="12" />
                    </svg>
                    <span className="sr-only">Replace Substitution Transition by Subpage</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Replace Substitution Transition by Subpage</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-2 h-6">
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Toggle
                    aria-label="Toggle Marking Display"
                    pressed={showMarkingDisplay}
                    onPressedChange={setShowMarkingDisplay}
                  >
                    <SquareStack className="h-4 w-4 text-green-600" />
                    <span className="sr-only">Toggle Marking Display</span>
                  </Toggle>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle Marking Display</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Toggle
                    aria-label="Toggle Declare Constraint Layer"
                    pressed={showDeclareLayer}
                    onPressedChange={setShowDeclareLayer}
                  >
                    <Milestone className="h-4 w-4" style={{ color: showDeclareLayer ? '#4f46e5' : undefined }} />
                    <span className="sr-only">Toggle Declare Constraint Layer</span>
                  </Toggle>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show/Hide Declare Constraints</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <LayoutPopover onApplyLayout={onApplyLayout} />
        {/* <Popover>
          <PopoverTrigger>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="icon" title="Layout Petri Net" onClick={layoutGraph}>
                      <Network className="h-5 w-5" />
                      <span className="sr-only">Layout Petri Net</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Layout Petri Net</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </PopoverTrigger>
          <PopoverContent>Place content for the popover here.</PopoverContent>
        </Popover> */}
        </div>

      </div>
    </>
  )
}


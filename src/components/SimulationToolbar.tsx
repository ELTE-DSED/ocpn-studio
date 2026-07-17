import { Button } from "@/components/ui/button";
import { RotateCcw, Power, Square, SkipForward, Play, FastForward, Loader2, MousePointerClick } from "lucide-react";
import { useContext, useEffect, useState } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

import { SimulationContext } from '@/context/useSimulationContextHook';
import useStore from '@/stores/store';

type RunMode = 'animated' | 'fast' | null;

export function SimulationToolbar() {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('SimulationToolbar must be used within a SimulationProvider');
  }
  const {
    reset,
    runStep,
    runMultipleStepsAnimated,
    runMultipleStepsFast,
    stop,
    isRunning,
    isInitialized,
    simulationConfig
  } = context;

  // Before the simulator has ever been initialized, "Reset Simulation" reads as a strange
  // no-op ("reset to what?") — the same button doubles as the very first initialization, so
  // label/icon it as "Start" until that's happened at least once.
  const isFirstRun = !isInitialized;

  // Track which button started the current run
  const [runMode, setRunMode] = useState<RunMode>(null);

  const isFireMode = useStore((state) => state.isFireMode);
  const toggleFireMode = useStore((state) => state.toggleFireMode);

  // Show wait cursor globally while the simulation is running
  useEffect(() => {
    if (isRunning) {
      document.body.style.cursor = 'wait';
      const style = document.createElement('style');
      style.id = 'simulation-busy-cursor';
      style.textContent = '* { cursor: wait !important; }';
      document.head.appendChild(style);
      return () => {
        document.body.style.cursor = '';
        style.remove();
      };
    }
  }, [isRunning]);

  const handleReset = () => {
    reset();
  };

  const handleStop = () => {
    stop();
  };

  const handleRunStep = () => {
    runStep();
  };

  const handleRunAnimated = () => {
    setRunMode('animated');
    runMultipleStepsAnimated(simulationConfig.stepsPerRun, simulationConfig.animationDelayMs);
  };

  const handleRunFast = () => {
    setRunMode('fast');
    runMultipleStepsFast(simulationConfig.stepsPerRun);
  };

  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        {/* Rewind/Reset Button — reads as "Initialize Simulation" before the first run */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReset}
                disabled={isRunning}
              >
                {isFirstRun ? <Power className="h-5 w-5" /> : <RotateCcw className="h-5 w-5" />}
                <span className="sr-only">{isFirstRun ? 'Initialize Simulation' : 'Reset Simulation'}</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isFirstRun ? 'Initialize Simulation' : 'Reset Simulation'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Stop Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleStop}
                disabled={!isRunning}
              >
                <Square className="h-5 w-5" />
                <span className="sr-only">Stop Simulation</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Stop Simulation</p>
          </TooltipContent>
        </Tooltip>

        {/* Fire Transition Mode Toggle — click a specific enabled transition on the
            canvas to fire it directly, instead of letting the engine pick one. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant={isFireMode ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => toggleFireMode(!isFireMode)}
                disabled={isRunning}
                aria-pressed={isFireMode}
                aria-label="Toggle Fire Transition Mode"
              >
                <MousePointerClick className={`h-5 w-5 ${isFireMode ? 'text-primary' : ''}`} />
                <span className="sr-only">Toggle Fire Transition Mode</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click an enabled transition on the canvas to fire it</p>
          </TooltipContent>
        </Tooltip>

        {/* Single Step Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRunStep}
                disabled={isRunning}
              >
                <SkipForward className="h-5 w-5" />
                <span className="sr-only">Execute One Step</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Execute One Step</p>
          </TooltipContent>
        </Tooltip>

        {/* Play Button - Run steps with animation */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRunAnimated}
                disabled={isRunning}
                className="relative"
              >
                {isRunning && runMode === 'animated' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.75 text-[10px] text-primary-foreground font-medium leading-none">
                  {simulationConfig.stepsPerRun}
                </span>
                <span className="sr-only">Run {simulationConfig.stepsPerRun} Steps (Animated)</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Run {simulationConfig.stepsPerRun} Steps (with intermediate markings)</p>
          </TooltipContent>
        </Tooltip>

        {/* Fast Forward Button - Run steps instantly */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRunFast}
                disabled={isRunning}
                className="relative"
              >
                {isRunning && runMode === 'fast' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <FastForward className="h-5 w-5" />
                )}
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.75 text-[10px] text-primary-foreground font-medium leading-none">
                  {simulationConfig.stepsPerRun}
                </span>
                <span className="sr-only">Run {simulationConfig.stepsPerRun} Steps (Fast)</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Run {simulationConfig.stepsPerRun} Steps (without intermediate markings)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

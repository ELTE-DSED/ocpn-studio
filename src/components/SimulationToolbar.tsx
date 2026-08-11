import { Button } from "@/components/ui/button";
import { RotateCcw, Power, Square, SkipForward, Play, FastForward, Loader2, MousePointerClick, SquareStack, Timer, Infinity as InfinityIcon } from "lucide-react";
import { useContext, useState } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

import { Separator } from '@/components/ui/separator';
import { SimulationContext } from '@/context/useSimulationContextHook';
import { useRunProgress, type RunProgress } from '@/hooks/useRunProgress';
import useStore from '@/stores/store';
import { formatSimulationTime, formatDuration } from '@/utils/timeFormat';

type RunMode = 'animated' | 'fast' | 'untilTime' | null;

/**
 * The left-hand side of the progress readout.
 *
 * While firing — which is all but the tail of a run — the phase name would be a constant,
 * so the space goes to the transition that just fired instead: that's the part that
 * actually moves, and the counts beside it already say a run is in progress. The label
 * only appears for the wrap-up pass, where the bar sits at 100% and nothing else would
 * explain the wait.
 */
function statusText(progress: RunProgress): string {
  if (progress.phase === 'analyzing') return 'Evaluating monitors…';
  return progress.lastTransitionName ?? 'Firing…';
}

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
    runUntilSimulationTime,
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
  const showMarkingDisplay = useStore((state) => state.showMarkingDisplay);
  const setShowMarkingDisplay = useStore((state) => state.setShowMarkingDisplay);
  const simulationEpoch = useStore((state) => state.simulationEpoch);

  // "Run to end time" comes in two flavours, and the icon is what tells them apart: a
  // target time to reach, or no end at all. Both are set in Simulation Settings.
  const endTimeMs = simulationConfig.endTimeMs;
  const isOpenEnded = endTimeMs === null;
  const endTimeLabel = isOpenEnded
    ? null
    : formatSimulationTime(endTimeMs, simulationEpoch ? new Date(simulationEpoch) : null);

  // Live progress of the current run. Comes from its own tiny store rather than the
  // simulation context so these several-per-second updates repaint this readout only,
  // instead of every context consumer (the canvas included).
  const progress = useRunProgress();

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

  const handleRunUntilTime = () => {
    setRunMode('untilTime');
    runUntilSimulationTime(endTimeMs);
  };

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-center gap-1">
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
              <p>Run {simulationConfig.stepsPerRun} Steps (no delay between steps)</p>
            </TooltipContent>
          </Tooltip>

          {/* Run to End Time — the run whose length is set in simulation time rather than
              in steps. The icon distinguishes the two cases so the button says which one
              it will do without being pressed: a target to run to, or no end at all. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRunUntilTime}
                  disabled={isRunning}
                >
                  {isRunning && runMode === 'untilTime' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isOpenEnded ? (
                    <InfinityIcon className="h-5 w-5" />
                  ) : (
                    <Timer className="h-5 w-5" />
                  )}
                  <span className="sr-only">
                    {isOpenEnded ? 'Run Until Stopped' : `Run Until ${endTimeLabel}`}
                  </span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isOpenEnded ? (
                <p>Run open-ended — until the net deadlocks or you press Stop<br />
                  {/* Not `text-muted-foreground`: that gray is tuned for the card
                      background, and a tooltip paints `bg-primary`. De-emphasis inside one
                      has to come from its own foreground colour at reduced opacity. */}
                  <span className="text-primary-foreground/75">Set an end time in Simulation Settings</span></p>
              ) : (
                <p>Run until simulation time {endTimeLabel}</p>
              )}
            </TooltipContent>
          </Tooltip>

          {/* The wrapper's explicit height is load-bearing: Radix gives the vertical
              separator `h-full`, which collapses to nothing inside an auto-height row.
              Same construction as the model toolbar's dividers. */}
          <div className="flex h-6 items-center">
            <Separator orientation="vertical" className="mx-1 h-6" />
          </div>

          {/* Marking Display Toggle — the same view switch the model toolbar carries;
              watching a run is exactly when you want to turn the token lists off. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant={showMarkingDisplay ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setShowMarkingDisplay(!showMarkingDisplay)}
                  aria-pressed={showMarkingDisplay}
                  aria-label="Toggle Marking Display"
                >
                  <SquareStack className="h-5 w-5 text-green-600" />
                  <span className="sr-only">Toggle Marking Display</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle Marking Display</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Busy indicator: what the engine is doing, how far along it is and how fast, so a
          long run reads as working rather than as a frozen tab.

          `w-0 min-w-full` keeps it from sizing the toolbar: its contents change several
          times a second (transition name, counts), and a shrink-to-fit toolbar would
          resize with every one of them. A definite width of 0 contributes nothing to the
          toolbar's intrinsic width — so the buttons alone decide that — and min-width
          stretches the row back out to fill it. Anything that doesn't fit truncates on
          the left, which is why the counts are `shrink-0`: those stay readable. */}
      {progress && (
        <div className="mt-2 w-0 min-w-full px-1" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 text-[11px] leading-none">
            <span className="text-muted-foreground truncate">{statusText(progress)}</span>
            <span className="text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
              {progress.countsLabel ?? `${progress.current}/${progress.total}`}
              {progress.stepsPerSecond > 0 && ` · ${Math.round(progress.stepsPerSecond)}/s`}
              {/* Only while still firing: during the wrap-up pass the bar sits at 100% and a
                  countdown to a moment already reached would be nonsense. The tilde is doing
                  real work — this is an extrapolation, not a deadline. */}
              {progress.phase === 'firing' && progress.etaMs !== undefined &&
                ` · ~${formatDuration(progress.etaMs)} left`}
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            {/* An open-ended run has no distance to its end, so there is no honest bar to
                fill: it pulses to show work in progress instead of implying a position. */}
            <div
              className={progress.indeterminate
                ? "h-full w-full rounded-full bg-primary animate-pulse"
                : "h-full rounded-full bg-primary transition-[width] duration-150 ease-linear"}
              style={progress.indeterminate ? undefined : { width: `${percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

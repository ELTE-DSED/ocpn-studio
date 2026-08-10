import { createContext, useContext } from 'react';
import type { SimulationEvent } from '@/components/EventLog';
import type { MonitorResult, StateSpaceResult, DeclareResult, BlockedTransitionInfo, EnabledTransitionInfo } from '@/types';

// Configuration for simulation controls
export interface SimulationConfig {
  /** Number of steps to run for animated/fast execution */
  stepsPerRun: number;
  /** Delay between steps in milliseconds for animated execution */
  animationDelayMs: number;
  /**
   * Where the "run to end time" mode stops, as model time in milliseconds.
   *
   * `null` leaves the run open-ended: it goes until the net deadlocks or the user presses
   * Stop. That is a deliberate choice rather than a missing value — a generator-driven
   * model has no natural step count, and "run it out" is the useful thing to ask for.
   */
  endTimeMs: number | null;
  /**
   * Hold a screen wake lock while a run-to-end-time run is in flight, so the display
   * timeout doesn't put the machine to sleep partway through a long one. See
   * `utils/wakeLock.ts` for what this can and cannot prevent.
   */
  keepAwakeWhileRunning: boolean;
}

// Default simulation configuration
export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  stepsPerRun: 50,
  animationDelayMs: 500,
  endTimeMs: null,
  keepAwakeWhileRunning: true,
};

// Define the type for the context value based on the hook's return type
// Ensure this matches exactly what useSimulationController returns
export type SimulationContextType = {
  runStep: () => Promise<void>;
  runMultipleStepsAnimated: (steps: number, delayMs?: number) => Promise<void>;
  runMultipleStepsFast: (steps: number) => Promise<void>;
  /**
   * Runs until model time reaches `endTimeMs`, or open-endedly when that is null. Either
   * way the run also stops on a deadlock, a breakpoint or Stop.
   */
  runUntilSimulationTime: (endTimeMs: number | null) => Promise<void>;
  stop: () => void;
  /** Fires the given transition. Resolves to whether it actually fired (false = wasn't enabled). */
  fireTransition: (transitionId: string) => Promise<boolean>;
  /** Overwrites a place's *current* marking mid-simulation. Resolves to whether it succeeded. */
  setPlaceMarking: (placeId: string, markingExpr: string) => Promise<boolean>;
  getEnabledTransitions: () => Promise<EnabledTransitionInfo[]>;
  reset: () => Promise<void>;
  events: SimulationEvent[];
  clearEvents: () => void;
  isInitialized: boolean;
  isRunning: boolean;
  simulationTime: number;
  stepCounter: number;
  simulationConfig: SimulationConfig;
  setSimulationConfig: (config: SimulationConfig) => void;
  ensureInitialized: () => Promise<void>;
  _executeWasmStep: () => void;
  monitorResults: MonitorResult[];
  declareResults: DeclareResult[];
  blockedTransitions: BlockedTransitionInfo[];
  enabledTransitions: EnabledTransitionInfo[];
  calculateStateSpace: (
    maxStates?: number,
    maxArcs?: number,
    isTimed?: boolean,
    distOverrides?: Record<string, number>,
    intRangeOverrides?: Record<string, number>,
  ) => Promise<StateSpaceResult | null>;
};

// Create the context with an initial value of null or a default object
export const SimulationContext = createContext<SimulationContextType | null>(null);

// Custom hook for consuming the context easily
export function useSimulationContext() {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulationContext must be used within a SimulationProvider');
  }
  return context;
}

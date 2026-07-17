import { createContext, useContext } from 'react';
import type { SimulationEvent } from '@/components/EventLog';
import type { MonitorResult, StateSpaceResult, DeclareResult, BlockedTransitionInfo, EnabledTransitionInfo } from '@/types';

// Configuration for simulation controls
export interface SimulationConfig {
  /** Number of steps to run for animated/fast execution */
  stepsPerRun: number;
  /** Delay between steps in milliseconds for animated execution */
  animationDelayMs: number;
}

// Default simulation configuration
export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  stepsPerRun: 50,
  animationDelayMs: 500,
};

// Define the type for the context value based on the hook's return type
// Ensure this matches exactly what useSimulationController returns
export type SimulationContextType = {
  runStep: () => Promise<void>;
  runMultipleStepsAnimated: (steps: number, delayMs?: number) => Promise<void>;
  runMultipleStepsFast: (steps: number) => Promise<void>;
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

import { setDebugLogging as setWasmDebugLogging } from '@rwth-pads/cpnsim';

/**
 * Whether the simulation engine writes its trace to the browser console.
 *
 * The engine traces every binding, code segment and priority selection — thousands of
 * lines for a few hundred steps, which buries anything else in the console and costs
 * real time to format and print. It is off by default and lives here rather than in the
 * model: it's a developer preference, not part of the net, so it must not end up in
 * saved .ocpn files. Persisted in localStorage so it survives a reload.
 */
const STORAGE_KEY = 'ocpn-studio:debug-logging';

export function isDebugLoggingEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private-mode / blocked storage: fall back to the default.
    return false;
  }
}

/**
 * Pushes the stored preference into the WASM module. Must be called after the module is
 * initialized — before that the exported function has no instance to talk to — so the
 * simulation controller calls this right after `init()`, including after every reset
 * (a fresh module would otherwise come up with tracing off regardless of the setting).
 */
export function applyDebugLoggingToWasm(): void {
  try {
    setWasmDebugLogging(isDebugLoggingEnabled());
  } catch (e) {
    console.warn('Could not apply the debug logging setting to the simulator:', e);
  }
}

/** Stores the preference and applies it immediately if the module is already loaded. */
export function setDebugLoggingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Ignore: the setting still applies to this session via the call below.
  }
  try {
    setWasmDebugLogging(enabled);
  } catch {
    // Module not initialized yet — applyDebugLoggingToWasm() will pick it up at init.
  }
}

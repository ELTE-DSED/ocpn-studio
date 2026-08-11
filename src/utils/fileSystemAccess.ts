/**
 * Thin wrapper over the File System Access API, which lets the app hold on to a handle for the
 * file the user opened and write back to it — Save that overwrites, rather than Save that
 * downloads another copy.
 *
 * The local-disk pickers are Chromium-only: Firefox has no support at all, and Safari
 * implements only the Origin Private File System, which is a sandbox rather than the user's
 * disk. Everything here is therefore optional — `isSupported()` gates the native path, and
 * callers fall back to a plain download when it returns false.
 */

/** Extensions of the File System Access API that `lib.dom` in this TypeScript version omits. */
interface FileSystemHandlePermissions {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

type PickerType = { description: string; accept: Record<string, string[]> };

interface FilePickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: PickerType[];
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: PickerType[];
  }) => Promise<FileSystemFileHandle>;
}

/** File type filter offered by both pickers, so the dialogs default to OCPN files. */
const OCPN_PICKER_TYPES: PickerType[] = [
  {
    description: 'OCPN Studio model',
    accept: { 'application/json': ['.ocpn'] },
  },
];

/** Types accepted when opening — the importable formats alongside the native one. */
const OPEN_PICKER_TYPES: PickerType[] = [
  {
    description: 'Petri net models',
    accept: {
      'application/json': ['.ocpn', '.json'],
      'application/xml': ['.cpn', '.pnml'],
    },
  },
];

/**
 * Whether this browser can open and overwrite files on the user's disk. False in Firefox and
 * Safari, where callers must fall back to `<input type="file">` and a download.
 */
export function isSupported(): boolean {
  const w = window as unknown as FilePickerWindow;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

/** True when a rejection is the user dismissing a picker, which is not an error worth reporting. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export type OpenedFile = {
  content: string;
  fileName: string;
  /** Present only when the browser supports the API *and* the file can be written back to. */
  handle: FileSystemFileHandle | null;
};

/**
 * Open a file through the native picker. Returns null if the user cancelled.
 * Throws only on genuine read failures.
 */
export async function openWithPicker(): Promise<OpenedFile | null> {
  const w = window as unknown as FilePickerWindow;
  if (!w.showOpenFilePicker) return null;

  let handle: FileSystemFileHandle;
  try {
    [handle] = await w.showOpenFilePicker({ multiple: false, types: OPEN_PICKER_TYPES });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }

  const file = await handle.getFile();
  return { content: await file.text(), fileName: file.name, handle };
}

/**
 * Ask the user where to write, and write there. Returns the new handle, or null if cancelled.
 */
export async function saveAsWithPicker(
  suggestedName: string,
  content: string
): Promise<FileSystemFileHandle | null> {
  const w = window as unknown as FilePickerWindow;
  if (!w.showSaveFilePicker) return null;

  let handle: FileSystemFileHandle;
  try {
    handle = await w.showSaveFilePicker({ suggestedName, types: OCPN_PICKER_TYPES });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }

  await writeToHandle(handle, content);
  return handle;
}

/**
 * Re-check write permission on a handle. Chromium keeps the grant for the session after the
 * picker, but it can lapse — after a reload with a restored handle, for instance — and
 * `requestPermission` needs to run inside a user gesture, which a Save click is.
 */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const permissions = handle as FileSystemFileHandle & FileSystemHandlePermissions;
  const descriptor = { mode: 'readwrite' as const };

  if (await permissions.queryPermission?.(descriptor) === 'granted') return true;
  return (await permissions.requestPermission?.(descriptor)) === 'granted';
}

/** Overwrite the file behind `handle`. Throws if permission was refused or the write failed. */
export async function writeToHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  if (!(await ensureWritePermission(handle))) {
    throw new Error('Permission to write this file was declined.');
  }

  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    // Closing is what actually commits the file; skipping it on the error path would leave
    // the original truncated.
    await writable.close();
  }
}

import { useState, useContext, useCallback, useMemo, useEffect } from 'react';
import { Clock, Hash, Settings, Play, MousePointerClick } from 'lucide-react';
import { EventLog, SimulationEvent, TransitionFilterItem } from '@/components/EventLog';
import { OCELExportDialog } from '@/components/dialogs/OCELExportDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
// Correct the import path for SimulationContext
import { SimulationContext, type SimulationConfig } from '@/context/useSimulationContextHook';
import useStore from '@/stores/store';
import { formatSimulationTime } from '@/utils/timeFormat';

// OCEL 2.0 Types
interface OCEL2ObjectType {
  name: string;
  attributes: { name: string; type: string }[];
}

interface OCEL2EventType {
  name: string;
  attributes: { name: string; type: string }[];
}

interface OCEL2Object {
  id: string;
  type: string;
  attributes: { name: string; time: string; value: string }[];
  relationships: { objectId: string; qualifier: string }[];
}

interface OCEL2Event {
  id: string;
  type: string;
  time: string;
  attributes: { name: string; value: string }[];
  relationships: { objectId: string; qualifier: string }[];
}

interface OCEL2Export {
  objectTypes: OCEL2ObjectType[];
  eventTypes: OCEL2EventType[];
  objects: OCEL2Object[];
  events: OCEL2Event[];
}

/**
 * Format a millisecond delay as a short relative label (e.g. "+1.5s", "+3m 20s") for the
 * "Enabled Transitions" list — how much simulation time firing a future-enabled transition
 * would advance the clock by.
 */
function formatRelativeDelay(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60000) return `+${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `+${minutes}m ${seconds}s` : `+${minutes}m`;
}

/**
 * Unwrap a timed token wrapper ({value, timestamp}) if present.
 * WASM tokens store timestamps separately, but some paths may still wrap them.
 */
function unwrapTimedToken(token: unknown): unknown {
  if (token && typeof token === 'object' && !Array.isArray(token)) {
    const obj = token as Record<string, unknown>;
    if ('value' in obj && 'timestamp' in obj) {
      return obj.value;
    }
  }
  return token;
}

/**
 * Format an attribute value for OCEL 2.0.
 * Avoids producing "[object Object]" for nested values.
 */
function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Generate a stable object ID from a record token using its 'id'/'ID' field.
 * Falls back to a content hash if no id field is present.
 */
function stableObjectId(token: unknown, typeName: string): string {
  const typePrefix = typeName.toLowerCase();
  const unwrapped = unwrapTimedToken(token);
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
    const record = unwrapped as Record<string, unknown>;
    if ('id' in record) return `${typePrefix}_${record.id}`;
    if ('ID' in record) return `${typePrefix}_${record.ID}`;
  }
  // Fallback: content hash
  const hash = JSON.stringify(unwrapped).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return `${typePrefix}_${Math.abs(hash)}`;
}

/**
 * Parse product color set definitions to extract component record type names.
 * e.g., "colset AircraftxGate = product Aircraft * Gate timed;" → ["Aircraft", "Gate"]
 */
function parseProductComponents(
  colorSets: { name: string; type: string; definition: string }[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const cs of colorSets) {
    if (cs.type !== 'product') continue;
    const match = cs.definition.match(/=\s*product\s+(.+?)(?:\s+timed)?;/);
    if (match) {
      const components = match[1].split('*').map(s => s.trim());
      result.set(cs.name, components);
    }
  }
  return result;
}

/**
 * Convert simulation events and model data to OCEL 2.0 format.
 *
 * Handles:
 * - Record color sets: tokens are objects with fields (id, name, etc.)
 * - Product color sets: tokens are arrays of component record objects
 * - Stable object identity based on record type + id field
 * - Proper attribute serialization (no "[object Object]")
 */
function convertToOCEL2(
  events: SimulationEvent[],
  colorSets: { name: string; type: string; definition: string }[],
  transitions: { id: string; name: string }[],
  places: { id: string; name: string; colorSet: string }[],
  simulationEpoch: string | null
): OCEL2Export {
  // --- Build ObjectTypes from Record ColorSets ---
  const objectTypes: OCEL2ObjectType[] = [];
  const recordColorSets = colorSets.filter(cs => cs.type === 'record');
  const recordColorSetNames = new Set(recordColorSets.map(cs => cs.name));

  for (const cs of recordColorSets) {
    const attributes: { name: string; type: string }[] = [];
    // Parse record fields: "colset X = record id: INT * name: STRING timed;"
    const recordMatch = cs.definition.match(/=\s*record\s+(.+?)(?:\s+timed)?;/);
    if (recordMatch) {
      const fieldsStr = recordMatch[1];
      const fields = fieldsStr.split('*').map(f => f.trim());
      for (const field of fields) {
        const [name, type] = field.split(':').map(s => s.trim());
        if (name && type && name.toLowerCase() !== 'id') {
          attributes.push({ name: name.toLowerCase(), type: type.toLowerCase() });
        }
      }
    }
    objectTypes.push({ name: cs.name, attributes });
  }

  // --- Parse product color sets → component types ---
  const productComponentsMap = parseProductComponents(colorSets);

  // --- Build EventTypes from transitions ---
  const eventTypes: OCEL2EventType[] = transitions.map(t => ({
    name: t.name || t.id,
    attributes: [],
  }));

  // --- Build place ID → ColorSet name map ---
  const placeColorSetMap = new Map<string, string>();
  for (const place of places) {
    placeColorSetMap.set(place.id, place.colorSet);
  }

  // --- Track unique objects ---
  const objectsMap = new Map<string, OCEL2Object>();

  /**
   * Register a single record object. Returns the stable objectId.
   * Only registers the object once (first occurrence sets attributes).
   */
  function registerObject(token: unknown, typeName: string, eventTime: string): string {
    const unwrapped = unwrapTimedToken(token);
    const objectId = stableObjectId(unwrapped, typeName);

    if (!objectsMap.has(objectId)) {
      const attributes: { name: string; time: string; value: string }[] = [];
      if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
        for (const [key, value] of Object.entries(unwrapped as Record<string, unknown>)) {
          if (key.toLowerCase() === 'id') continue; // id is the object identifier, not an attribute
          attributes.push({
            name: key.toLowerCase(),
            time: eventTime,
            value: formatAttributeValue(value),
          });
        }
      }
      objectsMap.set(objectId, {
        id: objectId,
        type: typeName,
        attributes,
        relationships: [],
      });
    }
    return objectId;
  }

  /**
   * Process a token from a place, potentially decomposing product tokens
   * into individual record objects.
   * Returns a map of objectId → typeName for all extracted objects.
   */
  function processToken(
    token: unknown,
    colorSetName: string,
    eventTime: string
  ): Map<string, string> {
    const result = new Map<string, string>();

    if (recordColorSetNames.has(colorSetName)) {
      // Direct record type — register the token as an object
      const oid = registerObject(token, colorSetName, eventTime);
      result.set(oid, colorSetName);
    } else if (productComponentsMap.has(colorSetName)) {
      // Product type — decompose into component record objects
      const componentTypes = productComponentsMap.get(colorSetName)!;
      const unwrapped = unwrapTimedToken(token);

      if (Array.isArray(unwrapped) && unwrapped.length === componentTypes.length) {
        for (let i = 0; i < componentTypes.length; i++) {
          const compType = componentTypes[i];
          if (recordColorSetNames.has(compType)) {
            const oid = registerObject(unwrapped[i], compType, eventTime);
            result.set(oid, compType);
          }
        }
      }
    }
    return result;
  }

  // --- Build OCEL Events ---
  const ocelEvents: OCEL2Event[] = [];
  const epochDate = simulationEpoch ? new Date(simulationEpoch) : null;

  for (const event of events) {
    const eventId = `e${event.step}`;
    const eventType = event.transitionName;
    const eventTime = epochDate
      ? new Date(epochDate.getTime() + event.time).toISOString()
      : event.timestamp.toISOString();

    // Collect all objects involved in this event (deduped by objectId)
    const involvedObjects = new Map<string, string>();

    // Process consumed and produced tokens
    const allTokenMovements = [
      ...event.tokens.consumed,
      ...event.tokens.produced,
    ];

    for (const movement of allTokenMovements) {
      const colorSetName = placeColorSetMap.get(movement.placeId);
      if (!colorSetName) continue;

      // Only process record and product types (skip UNIT, INT, STRING, etc.)
      const isRelevant =
        recordColorSetNames.has(colorSetName) ||
        productComponentsMap.has(colorSetName);
      if (!isRelevant) continue;

      try {
        const tokens = JSON.parse(movement.tokens);
        if (Array.isArray(tokens)) {
          for (const token of tokens) {
            const extracted = processToken(token, colorSetName, eventTime);
            for (const [oid, typeName] of extracted) {
              involvedObjects.set(oid, typeName);
            }
          }
        }
      } catch {
        // Skip if tokens can't be parsed
      }
    }

    // Create event-to-object relationships
    const relationships = Array.from(involvedObjects.entries()).map(
      ([objectId, typeName]) => ({
        objectId,
        qualifier: typeName.toLowerCase(),
      })
    );

    ocelEvents.push({
      id: eventId,
      type: eventType,
      time: eventTime,
      attributes: [],
      relationships,
    });
  }

  return {
    objectTypes,
    eventTypes,
    objects: Array.from(objectsMap.values()),
    events: ocelEvents,
  };
}

export function SimulationPanel() {
  // Consume context instead of calling the hook
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('SimulationPanel must be used within a SimulationProvider');
  }
  const { events, clearEvents, isInitialized, stepCounter, simulationTime, simulationConfig, setSimulationConfig, enabledTransitions, fireTransition, isRunning } = context;

  // Get model data from store for OCEL export
  const colorSets = useStore((state) => state.colorSets);
  const petriNetsById = useStore((state) => state.petriNetsById);
  const petriNetOrder = useStore((state) => state.petriNetOrder);
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const simulationEpoch = useStore((state) => state.simulationEpoch);
  const setSimulationEpoch = useStore((state) => state.setSimulationEpoch);

  const [ocelDialogOpen, setOcelDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tempConfig, setTempConfig] = useState<SimulationConfig>(simulationConfig);
  const [filteredTransitionIds, setFilteredTransitionIds] = useState<Set<string> | null>(null);
  const [firingId, setFiringId] = useState<string | null>(null);
  const isFireMode = useStore((state) => state.isFireMode);
  const toggleFireMode = useStore((state) => state.toggleFireMode);

  const handleFireTransition = useCallback(async (transitionId: string) => {
    setFiringId(transitionId);
    try {
      await fireTransition(transitionId);
    } finally {
      setFiringId(null);
    }
  }, [fireTransition]);

  // Determine if currently viewing the main (root) page
  const isMainPage = petriNetOrder.length > 0 && activePetriNetId === petriNetOrder[0];

  // Build transition filter items: list all transitions and mark which ones involve record-typed or product-typed places
  // On the main page, include transitions from ALL nets (including subpages)
  // On subpages, only include transitions from the active subpage
  const transitionFilterItems: TransitionFilterItem[] = useMemo(() => {
    if (!activePetriNetId) return [];

    const recordColorSetNames = new Set(
      colorSets.filter(cs => cs.type === 'record').map(cs => cs.name)
    );
    const productColorSetNames = new Set(
      colorSets.filter(cs => cs.type === 'product').map(cs => cs.name)
    );

    const netsToInclude = isMainPage
      ? Object.values(petriNetsById)
      : [petriNetsById[activePetriNetId]].filter(Boolean);

    const items: TransitionFilterItem[] = [];
    for (const petriNet of netsToInclude) {
      const objectPlaceIds = new Set(
        petriNet.nodes
          .filter(n => {
            if (n.type !== 'place') return false;
            const cs = (n.data?.colorSet as string) || '';
            return recordColorSetNames.has(cs) || productColorSetNames.has(cs);
          })
          .map(n => n.id)
      );

      const transitions = petriNet.nodes.filter(n => n.type === 'transition' && !n.data?.subPageId);
      for (const t of transitions) {
        const involvesRecord = petriNet.edges.some(
          e =>
            (e.source === t.id && objectPlaceIds.has(e.target)) ||
            (e.target === t.id && objectPlaceIds.has(e.source))
        );
        items.push({
          id: t.id,
          name: (t.data?.label as string) || t.id,
          involvesRecordType: involvesRecord,
        });
      }
    }
    return items;
  }, [activePetriNetId, petriNetsById, colorSets, isMainPage]);

  // Initialize filter to record-involving transitions when they change (e.g. model reload)
  useEffect(() => {
    const defaultIds = new Set(
      transitionFilterItems.filter(t => t.involvesRecordType).map(t => t.id)
    );
    setFilteredTransitionIds(defaultIds);
  }, [transitionFilterItems]);

  // Convert stored epoch (UTC ISO string) to local datetime string for the input
  const epochToLocal = (epoch: string | null | undefined): string => {
    if (!epoch) return '';
    const d = new Date(epoch);
    if (isNaN(d.getTime())) return epoch;
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  };

  const [tempEpoch, setTempEpoch] = useState<string>(epochToLocal(simulationEpoch));

  // Reset temp config when dialog opens
  const handleSettingsOpen = (open: boolean) => {
    if (open) {
      setTempConfig(simulationConfig);
      setTempEpoch(epochToLocal(simulationEpoch));
    }
    setSettingsOpen(open);
  };

  // Save settings
  const handleSaveSettings = () => {
    setSimulationConfig(tempConfig);
    // Convert naive local datetime to ISO string with timezone offset
    // so the Rust simulator interprets it correctly
    if (tempEpoch) {
      const localDate = new Date(tempEpoch);
      if (!isNaN(localDate.getTime())) {
        setSimulationEpoch(localDate.toISOString()); // Stores as UTC with Z suffix
      } else {
        setSimulationEpoch(tempEpoch); // Fallback: store as-is
      }
    } else {
      setSimulationEpoch(null);
    }
    setSettingsOpen(false);
  };

  // Collect the set of transition IDs on the active subpage (for event filtering)
  const activeSubpageTransitionIds: Set<string> | null = useMemo(() => {
    if (isMainPage || !activePetriNetId) return null; // null = no filtering
    const petriNet = petriNetsById[activePetriNetId];
    if (!petriNet) return null;
    return new Set(petriNet.nodes.filter(n => n.type === 'transition').map(n => n.id));
  }, [isMainPage, activePetriNetId, petriNetsById]);

  // Events to display: on main page show all, on subpage show only subpage transitions
  const displayEvents = useMemo(() => {
    if (!activeSubpageTransitionIds) return events; // main page: all events
    return events.filter(e => activeSubpageTransitionIds.has(e.transitionId));
  }, [events, activeSubpageTransitionIds]);

  // Subpage note for EventLog
  const subpageNote = !isMainPage && activePetriNetId ? 'Showing only events for transitions on this subpage.' : undefined;

  // Enabled transitions to display: same subpage-scoping as events, so the list only
  // shows transitions the user can actually see on the currently-viewed page.
  const visibleEnabledTransitions = useMemo(() => {
    if (!activeSubpageTransitionIds) return enabledTransitions;
    return enabledTransitions.filter((t) => activeSubpageTransitionIds.has(t.transitionId));
  }, [enabledTransitions, activeSubpageTransitionIds]);

  // Get transitions and places from all relevant Petri nets
  // On main page: include all nets (but exclude substitution transitions)
  // On subpage: include only the active net
  const getModelData = useCallback(() => {
    if (!activePetriNetId) return { transitions: [], places: [] };

    const netsToInclude = isMainPage
      ? Object.values(petriNetsById)
      : [petriNetsById[activePetriNetId]].filter(Boolean);

    const transitions: { id: string; name: string }[] = [];
    const places: { id: string; name: string; colorSet: string }[] = [];

    for (const petriNet of netsToInclude) {
      for (const node of petriNet.nodes) {
        if (node.type === 'transition' && !node.data?.subPageId) {
          transitions.push({
            id: node.id,
            name: (node.data?.label as string) || node.id,
          });
        } else if (node.type === 'place') {
          places.push({
            id: node.id,
            name: (node.data?.label as string) || node.id,
            colorSet: (node.data?.colorSet as string) || '',
          });
        }
      }
    }

    return { transitions, places };
  }, [activePetriNetId, petriNetsById, isMainPage]);

  const handleExportOcel = (format: 'json' | 'xml' | 'sqlite') => {
    const { transitions, places } = getModelData();
    // Apply the transition filter to exported events
    const exportEvents = filteredTransitionIds && filteredTransitionIds.size > 0
      ? events.filter(e => filteredTransitionIds.has(e.transitionId))
      : events;
    const ocelData = convertToOCEL2(exportEvents, colorSets, transitions, places, simulationEpoch || null);
    
    const ocpnName = useStore.getState().ocpnName || 'simulation';
    const prefix = ocpnName.replace(/\s+/g, '');
    let content = "";
    let filename = `${prefix}_simulation_${stepCounter}_events_ocel2`;
    let mimeType = "application/octet-stream";

    switch (format) {
      case "json":
        content = JSON.stringify(ocelData, null, 2);
        filename += ".json";
        mimeType = "application/json";
        break;
      case "xml":
        // Generate XML from OCEL data
        content = `<?xml version="1.0" encoding="UTF-8"?>
<ocel>
  <objectTypes>
${ocelData.objectTypes.map(ot => `    <objectType name="${ot.name}">
${ot.attributes.map(a => `      <attribute name="${a.name}" type="${a.type}"/>`).join('\n')}
    </objectType>`).join('\n')}
  </objectTypes>
  <eventTypes>
${ocelData.eventTypes.map(et => `    <eventType name="${et.name}">
${et.attributes.map(a => `      <attribute name="${a.name}" type="${a.type}"/>`).join('\n')}
    </eventType>`).join('\n')}
  </eventTypes>
  <objects>
${ocelData.objects.map(obj => `    <object id="${obj.id}" type="${obj.type}">
${obj.attributes.map(a => `      <attribute name="${a.name}" time="${a.time}" value="${a.value}"/>`).join('\n')}
    </object>`).join('\n')}
  </objects>
  <events>
${ocelData.events.map(evt => `    <event id="${evt.id}" type="${evt.type}" time="${evt.time}">
${evt.relationships.map(r => `      <relationship objectId="${r.objectId}" qualifier="${r.qualifier}"/>`).join('\n')}
    </event>`).join('\n')}
  </events>
</ocel>`;
        filename += ".xml";
        mimeType = "application/xml";
        break;
      case "sqlite":
        content = "SQLite format not yet implemented - please use JSON or XML format";
        filename += ".txt";
        mimeType = "text/plain";
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setOcelDialogOpen(false);
  };

  const canExport = isInitialized && events.length > 0;

  // Format simulation time for display (time is in milliseconds)
  const epoch = simulationEpoch ? new Date(simulationEpoch) : null;
  
  const formatTime = (time: number | undefined) => formatSimulationTime(time ?? 0, epoch);

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Simulation Status Box */}
      <div className="border border-border rounded-lg p-4 bg-card flex-shrink-0">
        <div className="flex justify-between items-start mb-3">
          <span className="text-sm font-semibold leading-none tracking-tight">Simulation Status</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="Simulation Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Step</div>
              <div className="text-lg font-mono font-semibold">{stepCounter ?? 0}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Time</div>
              <div className="text-lg font-mono font-semibold">{formatTime(simulationTime)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Enabled Transitions Box */}
      <div className="border border-border rounded-lg p-4 bg-card flex-shrink-0">
        <div className="flex justify-between items-start mb-3">
          <span className="text-sm font-semibold leading-none tracking-tight">
            Enabled Transitions
            {visibleEnabledTransitions.length > 0 && (
              <span className="text-muted-foreground font-normal ml-1">({visibleEnabledTransitions.length})</span>
            )}
          </span>
          <Button
            variant={isFireMode ? 'secondary' : 'outline'}
            size="icon"
            onClick={() => toggleFireMode(!isFireMode)}
            disabled={isRunning}
            aria-pressed={isFireMode}
            title="Click a transition on the canvas to fire it"
          >
            <MousePointerClick className={`h-4 w-4 ${isFireMode ? 'text-primary' : ''}`} />
          </Button>
        </div>
        {!isInitialized ? (
          <p className="text-xs text-muted-foreground">Start the simulation to see enabled transitions.</p>
        ) : visibleEnabledTransitions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No transitions enabled — the simulation is deadlocked.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {visibleEnabledTransitions.map((t) => (
              <div
                key={t.transitionId}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-accent"
              >
                <button
                  type="button"
                  className="text-sm truncate flex items-center gap-1.5 text-left hover:underline"
                  title={`Highlight "${t.transitionName}" on the canvas`}
                  onClick={() => {
                    if (activePetriNetId) {
                      useStore.getState().requestFocus({
                        netId: activePetriNetId,
                        elementId: t.transitionId,
                        elementType: 'node',
                        keepMode: true,
                      });
                    }
                  }}
                >
                  {t.transitionName}
                  {t.isFuture && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 font-mono"
                      title={`Not enabled yet at the current time — firing this will advance simulation time to ${formatTime(t.atTime)}`}
                    >
                      <Clock className="h-3 w-3" />
                      {formatRelativeDelay(t.atTime - simulationTime)}
                    </span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  disabled={isRunning || firingId === t.transitionId}
                  onClick={() => handleFireTransition(t.transitionId)}
                  title={t.isFuture
                    ? `Fire "${t.transitionName}" (advances time by ${formatRelativeDelay(t.atTime - simulationTime)})`
                    : `Fire "${t.transitionName}"`}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Event Log */}
      <div className="flex-1 overflow-hidden min-h-0">
        <EventLog
          events={displayEvents}
          onClearLog={clearEvents}
          onExport={() => setOcelDialogOpen(true)}
          canExport={canExport}
          exportDisabledReason={!isInitialized ? "Simulation not initialized" : events.length === 0 ? "No simulation events to export" : undefined}
          transitions={transitionFilterItems}
          filteredTransitionIds={filteredTransitionIds ?? undefined}
          onFilterChange={setFilteredTransitionIds}
          subpageNote={subpageNote}
        />
      </div>
      <OCELExportDialog open={ocelDialogOpen} onOpenChange={setOcelDialogOpen} onExport={handleExportOcel} />
      
      {/* Simulation Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={handleSettingsOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Simulation Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="stepsPerRun" className="text-right col-span-2">
                Steps per run
              </Label>
              <Input
                id="stepsPerRun"
                type="number"
                min={1}
                max={1000}
                value={tempConfig.stepsPerRun}
                onChange={(e) => setTempConfig({ ...tempConfig, stepsPerRun: parseInt(e.target.value) || 1 })}
                className="col-span-2"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="animationDelay" className="text-right col-span-2">
                Animation delay (ms)
              </Label>
              <Input
                id="animationDelay"
                type="number"
                min={0}
                max={5000}
                step={50}
                value={tempConfig.animationDelayMs}
                onChange={(e) => setTempConfig({ ...tempConfig, animationDelayMs: parseInt(e.target.value) || 0 })}
                className="col-span-2"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="simulationEpoch" className="text-right col-span-2">
                Simulation epoch
              </Label>
              <Input
                id="simulationEpoch"
                type="datetime-local"
                step="0.001"
                value={tempEpoch}
                onChange={(e) => setTempEpoch(e.target.value)}
                className="col-span-2"
              />
              <div className="col-span-2 col-start-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    // Format as YYYY-MM-DDTHH:MM:SS.mmm in local timezone for datetime-local input
                    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
                    const formatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
                    setTempEpoch(formatted);
                  }}
                >
                  Now
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTempEpoch('')}
                >
                  Reset
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The simulation epoch is the real-world datetime that corresponds to simulation time 0.
              When set, simulation times will be displayed relative to this epoch.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useContext, useCallback, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { Clock, Hash, Settings, Play, MousePointerClick, Timer, Infinity as InfinityIcon } from 'lucide-react';
import { EventLog, SimulationEvent, TransitionFilterItem, type EventOcelSummary, type EventLogStats } from '@/components/EventLog';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { SimulationContext, type SimulationConfig } from '@/context/useSimulationContextHook';
import useStore from '@/stores/store';
import { formatSimulationTime } from '@/utils/timeFormat';
import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '@/utils/debugLogging';
import { isWakeLockSupported } from '@/utils/wakeLock';
import { objectPlaceIds, resolveIncludeInOcel, touchesAnyPlace } from '@/utils/ocelInclusion';

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
/**
 * A reference carried by a record field, from which the export derives a qualified
 * OCEL object-to-object relationship. Structural references (a field that embeds
 * another record, directly or as a list) are detected from the colorset definitions;
 * plain id-typed fields become references via the colorset's `refs` annotations.
 */
interface O2ORefSpec {
  field: string; // Field name as it appears in tokens
  target: string; // Referenced object type (record colorset name)
  qualifier: string; // o2o qualifier (object → object)
  eventQualifier: string; // e2o qualifier: role of objects reached through this field
  reverse: boolean; // Emit target→owner instead of owner→target
  embedded: boolean; // Field embeds record token(s) rather than carrying plain id(s)
}

/** "colset Items = list Item;" → "Item" */
function parseListElementName(definition: string): string | null {
  const m = definition.match(/=\s*list\s+(\w+)/);
  return m ? m[1] : null;
}

function convertToOCEL2(
  events: SimulationEvent[],
  colorSets: { name: string; type: string; definition: string; refs?: { field: string; target: string; qualifier?: string; reverse?: boolean; eventQualifier?: string }[] }[],
  transitions: { id: string; name: string }[],
  places: { id: string; name: string; colorSet: string }[],
  simulationEpoch: string | null,
  arcs: { source: string; target: string; qualifier?: string; isBidirectional?: boolean }[] = [],
  /**
   * Which transitions are exported as events. Undefined exports all of them.
   *
   * Deliberately passed in rather than applied by pre-filtering `events`: objects, their
   * attribute history and their o2o relations are derived from *every* firing, because a
   * transition being scaffolding rather than a business activity says nothing about the
   * objects it moved. Pre-filtering instead loses every object that only a scaffolding
   * transition ever touches — in the order-management model that is all 20 Products,
   * taking the `product` role and the price history with them.
   */
  includedTransitionIds?: Set<string>
): OCEL2Export {
  // --- Build ObjectTypes and reference specs from Record ColorSets ---
  const objectTypes: OCEL2ObjectType[] = [];
  const recordColorSets = colorSets.filter(cs => cs.type === 'record');
  const recordColorSetNames = new Set(recordColorSets.map(cs => cs.name));
  const refSpecsByType = new Map<string, O2ORefSpec[]>();

  for (const cs of recordColorSets) {
    // Parse record fields: "colset X = record id: INT * name: STRING timed;"
    const fields: { name: string; type: string }[] = [];
    const recordMatch = cs.definition.match(/=\s*record\s+(.+?)(?:\s+timed)?;/);
    if (recordMatch) {
      for (const field of recordMatch[1].split('*').map(f => f.trim())) {
        const [name, type] = field.split(':').map(s => s.trim());
        if (name && type) fields.push({ name, type });
      }
    }

    // Derive reference specs: structural (field type resolves to a record colorset,
    // directly or through a list) or annotated (plain id-typed field with a `refs` entry)
    const annotations = new Map((cs.refs ?? []).map(r => [r.field, r]));
    const specs: O2ORefSpec[] = [];
    for (const { name: fieldName, type: fieldType } of fields) {
      let structuralTarget: string | null = null;
      if (recordColorSetNames.has(fieldType)) {
        structuralTarget = fieldType;
      } else {
        const listCs = colorSets.find(c => c.name === fieldType && c.type === 'list');
        const element = listCs ? parseListElementName(listCs.definition) : null;
        if (element && recordColorSetNames.has(element)) structuralTarget = element;
      }
      const ann = annotations.get(fieldName);
      if (structuralTarget || ann?.target) {
        const qualifier = ann?.qualifier ?? fieldName.toLowerCase();
        specs.push({
          field: fieldName,
          target: structuralTarget ?? ann!.target,
          qualifier,
          eventQualifier: ann?.eventQualifier ?? qualifier,
          reverse: ann?.reverse ?? false,
          embedded: !!structuralTarget,
        });
      }
    }
    if (specs.length > 0) refSpecsByType.set(cs.name, specs);

    // Reference fields are exported as o2o relationships, not attributes
    const refFieldNames = new Set(specs.map(s => s.field.toLowerCase()));
    const attributes = fields
      .filter(f => f.name.toLowerCase() !== 'id' && !refFieldNames.has(f.name.toLowerCase()))
      .map(f => ({ name: f.name.toLowerCase(), type: f.type.toLowerCase() }));
    objectTypes.push({ name: cs.name, attributes });
  }

  // --- Parse product color sets → component types ---
  const productComponentsMap = parseProductComponents(colorSets);

  // --- Build EventTypes from the transitions that are exported as events ---
  const isExported = (transitionId: string) =>
    !includedTransitionIds || includedTransitionIds.has(transitionId);
  const eventTypes: OCEL2EventType[] = transitions
    .filter(t => isExported(t.id))
    .map(t => ({
      name: t.name || t.id,
      attributes: [],
    }));

  // --- Build place ID → ColorSet name map ---
  const placeColorSetMap = new Map<string, string>();
  for (const place of places) {
    placeColorSetMap.set(place.id, place.colorSet);
  }

  // --- Build arc role qualifier lookup: (transition, place, direction) → qualifier ---
  // An object's role in an event follows from how the transition touches it, which
  // structurally is the arc: an input arc and an output arc on the same place are
  // different roles (e.g. "shipped package" vs "creates").
  const placeIds = new Set(places.map(p => p.id));
  const transitionIds = new Set(transitions.map(t => t.id));
  const arcQualifierByKey = new Map<string, string>();
  for (const arc of arcs) {
    const qualifier = arc.qualifier?.trim();
    if (!qualifier) continue;
    let placeId: string;
    let transitionId: string;
    let direction: 'in' | 'out';
    if (placeIds.has(arc.source) && transitionIds.has(arc.target)) {
      placeId = arc.source;
      transitionId = arc.target;
      direction = 'in';
    } else if (transitionIds.has(arc.source) && placeIds.has(arc.target)) {
      transitionId = arc.source;
      placeId = arc.target;
      direction = 'out';
    } else {
      continue; // not a place↔transition arc (e.g. it targets a substitution transition)
    }
    arcQualifierByKey.set(`${transitionId}|${placeId}|${direction}`, qualifier);
    if (arc.isBidirectional) {
      // A bidirectional arc both consumes and produces, in the same role
      arcQualifierByKey.set(`${transitionId}|${placeId}|${direction === 'in' ? 'out' : 'in'}`, qualifier);
    }
  }

  // --- Track unique objects and their evolving attribute state ---
  const objectsMap = new Map<string, OCEL2Object>();
  // Last known formatted attribute values per object, used to detect changes
  const objectAttrState = new Map<string, Map<string, string>>();

  const epochDate = simulationEpoch ? new Date(simulationEpoch) : null;
  // Simulation time zero, used to stamp initial attribute values of objects that
  // pre-exist the log (first seen in consumed tokens, i.e. from the initial marking).
  // Without an explicit epoch it is derived from the first event's wall-clock
  // timestamp minus its elapsed simulation time.
  const timeZeroISO = epochDate
    ? epochDate.toISOString()
    : events.length > 0
      ? new Date(events[0].timestamp.getTime() - events[0].time).toISOString()
      : null;

  /**
   * Extract a record token's attribute values, formatted. Excludes the id field
   * (it is the object identifier) and reference fields (they are exported as o2o
   * relationships, not attributes).
   */
  function extractAttributes(unwrapped: unknown, excludeFields?: Set<string>): Map<string, string> {
    const attrs = new Map<string, string>();
    if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
      for (const [key, value] of Object.entries(unwrapped as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (lower === 'id') continue; // id is the object identifier, not an attribute
        if (excludeFields?.has(lower)) continue;
        attrs.set(lower, formatAttributeValue(value));
      }
    }
    return attrs;
  }

  // Derived o2o relationship candidates, resolved and deduped after the event loop
  // (a reference may point at an object that is only registered by a later event)
  const pendingRelations: Array<{ source: string; target: string; qualifier: string }> = [];

  /**
   * Register a record object occurrence and track attribute changes.
   * Returns the stable objectId.
   *
   * Timed-CPN semantics: a firing is atomic, so state produced by an event exists
   * from the event's time onward — token availability delays play no role here.
   * - First seen in consumed tokens → the object pre-existed the event (initial
   *   marking): its attributes are initial values, stamped at simulation time zero.
   * - First seen in produced tokens → created by this event: initial values are
   *   stamped at the event's time.
   * - Produced with attribute values differing from the last known state → a
   *   change entry per differing attribute, stamped at the event's time.
   */
  function registerObject(
    token: unknown,
    typeName: string,
    eventTime: string,
    produced: boolean,
    role: string | null,
    involved: Map<string, { objectId: string; qualifier: string }>
  ): string {
    const unwrapped = unwrapTimedToken(token);
    const objectId = stableObjectId(unwrapped, typeName);
    const refSpecs = refSpecsByType.get(typeName);
    const refFieldNames = refSpecs && new Set(refSpecs.map(s => s.field.toLowerCase()));
    const attrs = extractAttributes(unwrapped, refFieldNames || undefined);

    // The role this object plays in the current event. An object can legitimately
    // play more than one role (OCEL 2.0 keys e2o on the event/object/qualifier
    // triple), so entries are deduped on the object-plus-qualifier pair.
    const qualifier = role || typeName.toLowerCase();
    involved.set(`${objectId}|${qualifier}`, { objectId, qualifier });

    const existing = objectsMap.get(objectId);
    if (!existing) {
      const initialTime = produced ? eventTime : (timeZeroISO ?? eventTime);
      objectsMap.set(objectId, {
        id: objectId,
        type: typeName,
        attributes: Array.from(attrs, ([name, value]) => ({ name, time: initialTime, value })),
        relationships: [],
      });
      objectAttrState.set(objectId, attrs);
    } else if (produced) {
      // Only produced tokens carry post-firing state; consumed tokens hold the
      // pre-firing state and can never introduce a change.
      const state = objectAttrState.get(objectId)!;
      for (const [name, value] of attrs) {
        if (state.get(name) !== value) {
          existing.attributes.push({ name, time: eventTime, value });
          state.set(name, value);
        }
      }
    }

    // --- Derive o2o relationships from reference fields of this token state ---
    // Relationships are cumulative in OCEL 2.0 (no time dimension), so every
    // occurrence contributes and duplicates are dropped at the end.
    if (refSpecs && unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
      const record = unwrapped as Record<string, unknown>;
      for (const spec of refSpecs) {
        const raw = record[spec.field] ?? record[spec.field.toLowerCase()];
        if (raw === null || raw === undefined || raw === '') continue;
        const elements = Array.isArray(raw) ? raw : [raw];
        for (const element of elements) {
          let targetId: string | null = null;
          if (spec.embedded) {
            // The field embeds the referenced object's token — register it too;
            // it is genuinely part of the state. Its role in this event comes from
            // the field it was reached through, not from the arc.
            const inner = unwrapTimedToken(element);
            if (inner && typeof inner === 'object') {
              targetId = registerObject(element, spec.target, eventTime, produced, spec.eventQualifier, involved);
            }
          } else if (typeof element === 'string' || typeof element === 'number') {
            // The field carries the referenced object's id. The object itself is not
            // part of this token, but the event does touch it through the reference;
            // dangling ids are filtered out once all objects are known.
            targetId = `${spec.target.toLowerCase()}_${element}`;
            involved.set(`${targetId}|${spec.eventQualifier}`, {
              objectId: targetId,
              qualifier: spec.eventQualifier,
            });
          }
          if (targetId && targetId !== objectId) {
            pendingRelations.push(
              spec.reverse
                ? { source: targetId, target: objectId, qualifier: spec.qualifier }
                : { source: objectId, target: targetId, qualifier: spec.qualifier }
            );
          }
        }
      }
    }

    return objectId;
  }

  /**
   * Process a token from a place, potentially decomposing product tokens
   * into individual record objects, recording each in `involved` with the role
   * it plays in the current event.
   *
   * `arcQualifier` is the role declared on the arc that moved this token. It applies
   * to the objects the arc carries directly; objects reached through reference fields
   * take their role from the field instead (see registerObject). Product components
   * all share the arc's qualifier — a product has no field names to tell its
   * components apart, which is a reason to prefer records for object types.
   */
  function processToken(
    token: unknown,
    colorSetName: string,
    eventTime: string,
    produced: boolean,
    arcQualifier: string | null,
    involved: Map<string, { objectId: string; qualifier: string }>
  ): void {
    if (recordColorSetNames.has(colorSetName)) {
      // Direct record type — register the token as an object
      registerObject(token, colorSetName, eventTime, produced, arcQualifier, involved);
    } else if (productComponentsMap.has(colorSetName)) {
      // Product type — decompose into component record objects
      const componentTypes = productComponentsMap.get(colorSetName)!;
      const unwrapped = unwrapTimedToken(token);

      if (Array.isArray(unwrapped) && unwrapped.length === componentTypes.length) {
        for (let i = 0; i < componentTypes.length; i++) {
          const compType = componentTypes[i];
          if (recordColorSetNames.has(compType)) {
            registerObject(unwrapped[i], compType, eventTime, produced, arcQualifier, involved);
          }
        }
      }
    }
  }

  // --- Build OCEL Events ---
  const ocelEvents: OCEL2Event[] = [];

  for (const event of events) {
    const eventId = `e${event.step}`;
    const eventType = event.transitionName;
    const eventTime = epochDate
      ? new Date(epochDate.getTime() + event.time).toISOString()
      : event.timestamp.toISOString();

    // Objects involved in this event, keyed by object-plus-qualifier so one object
    // can hold several roles
    const involvedObjects = new Map<string, { objectId: string; qualifier: string }>();

    // Process consumed tokens (pre-firing state) before produced tokens
    // (post-firing state) so attribute changes are diffed in firing order
    const allTokenMovements = [
      ...event.tokens.consumed.map((movement) => ({ movement, produced: false })),
      ...event.tokens.produced.map((movement) => ({ movement, produced: true })),
    ];

    for (const { movement, produced } of allTokenMovements) {
      const colorSetName = placeColorSetMap.get(movement.placeId);
      if (!colorSetName) continue;

      // Only process record and product types (skip UNIT, INT, STRING, etc.)
      const isRelevant =
        recordColorSetNames.has(colorSetName) ||
        productComponentsMap.has(colorSetName);
      if (!isRelevant) continue;

      // The arc that moved these tokens declares the role they play. Firing events
      // identify token movements by place, so the arc is resolved by
      // (transition, place, direction) — unique except for parallel arcs, which
      // validation flags when they disagree.
      const arcQualifier = arcQualifierByKey.get(
        `${event.transitionId}|${movement.placeId}|${produced ? 'out' : 'in'}`
      ) ?? null;

      try {
        const tokens = JSON.parse(movement.tokens);
        if (Array.isArray(tokens)) {
          for (const token of tokens) {
            processToken(token, colorSetName, eventTime, produced, arcQualifier, involvedObjects);
          }
        }
      } catch {
        // Skip if tokens can't be parsed
      }
    }

    // Every firing above contributed to the objects, their attribute history and their
    // o2o relations; only the exported ones become events. An excluded transition is a
    // statement about the *event* log ("this is scaffolding, not a business activity"),
    // not about the objects it happened to move: in OCEL 2.0 objects exist independently
    // of events, and the reference order-management log is exactly this shape — products
    // carry five price changes each while no `update price` event type exists.
    if (isExported(event.transitionId)) {
      ocelEvents.push({
        id: eventId,
        type: eventType,
        time: eventTime,
        attributes: [],
        relationships: Array.from(involvedObjects.values()),
      });
    }
  }

  // Objects referenced only by id may never appear as a token of their own; drop
  // those e2o relations rather than pointing at objects the log does not contain
  for (const event of ocelEvents) {
    event.relationships = event.relationships.filter(r => objectsMap.has(r.objectId));
  }

  // --- Attach derived o2o relationships (deduped, only between logged objects) ---
  const seenRelations = new Set<string>();
  for (const rel of pendingRelations) {
    const sourceObj = objectsMap.get(rel.source);
    if (!sourceObj || !objectsMap.has(rel.target)) continue;
    const key = `${rel.source}|${rel.target}|${rel.qualifier}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    sourceObj.relationships.push({ objectId: rel.target, qualifier: rel.qualifier });
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

    const netsToInclude = isMainPage
      ? Object.values(petriNetsById)
      : [petriNetsById[activePetriNetId]].filter(Boolean);

    const items: TransitionFilterItem[] = [];
    for (const petriNet of netsToInclude) {
      const placeIds = objectPlaceIds(petriNet, colorSets);

      const transitions = petriNet.nodes.filter(n => n.type === 'transition' && !n.data?.subPageId);
      for (const t of transitions) {
        const involvesRecord = touchesAnyPlace(petriNet, t.id, placeIds);
        items.push({
          id: t.id,
          name: (t.data?.label as string) || t.id,
          involvesRecordType: involvesRecord,
          includeInOcel: resolveIncludeInOcel(t.data?.includeInOcel as boolean | undefined, involvesRecord),
          excludedByModel: t.data?.includeInOcel === false,
        });
      }
    }
    return items;
  }, [activePetriNetId, petriNetsById, colorSets, isMainPage]);

  // Seed the log filter from the model's own OCEL-inclusion settings — a model reload, a
  // transition added or removed, or one of those settings being changed. The filter itself
  // stays a view-level override: narrowing it to inspect a run does not touch the model,
  // and must not be silently undone either.
  //
  // Keyed on the settings rather than on the array, because the array is rebuilt whenever
  // anything in the model changes — including the markings, which change several times a
  // second during a run. Re-seeding on that would wipe a filter the user had just set.
  const ocelInclusionKey = useMemo(
    () => transitionFilterItems.map(t => `${t.id}:${t.includeInOcel ? 1 : 0}`).join('|'),
    [transitionFilterItems]
  );
  const seededInclusionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededInclusionKeyRef.current === ocelInclusionKey) return;
    seededInclusionKeyRef.current = ocelInclusionKey;
    const defaultIds = new Set(
      transitionFilterItems.filter(t => t.includeInOcel).map(t => t.id)
    );
    setFilteredTransitionIds(defaultIds);
    // transitionFilterItems is read here but deliberately not a dependency: the key above
    // is what decides whether re-seeding is warranted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocelInclusionKey]);

  // Convert stored epoch (UTC ISO string) to local datetime string for the input
  const epochToLocal = (epoch: string | null | undefined): string => {
    if (!epoch) return '';
    const d = new Date(epoch);
    if (isNaN(d.getTime())) return epoch;
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  };

  const [tempEpoch, setTempEpoch] = useState<string>(epochToLocal(simulationEpoch));

  // The epoch being edited in this dialog, as ms since the Unix epoch — the run end time is
  // stored as model time, so both directions of the conversion have to follow the epoch
  // field as it is edited rather than the saved one.
  const tempEpochMs = useMemo(() => {
    if (!tempEpoch) return null;
    const parsed = new Date(tempEpoch);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
  }, [tempEpoch]);

  /** Model time in ms → value for the end-time `datetime-local` input. */
  const endTimeToLocal = (endTimeMs: number | null): string => {
    if (endTimeMs === null || tempEpochMs === null) return '';
    return epochToLocal(new Date(tempEpochMs + endTimeMs).toISOString());
  };

  // Engine trace logging. Unlike the settings above this is a machine-local developer
  // preference rather than part of the model, so it is not saved with the net and is
  // applied immediately instead of on Save.
  const [debugLogging, setDebugLogging] = useState<boolean>(isDebugLoggingEnabled);
  // A property of the browser, not of the model: checked once so the wake-lock setting can
  // say it is unavailable rather than offering something that will silently do nothing.
  const wakeLockSupported = useMemo(() => isWakeLockSupported(), []);

  // Reset temp config when dialog opens
  const handleSettingsOpen = (open: boolean) => {
    if (open) {
      setTempConfig(simulationConfig);
      setTempEpoch(epochToLocal(simulationEpoch));
      setDebugLogging(isDebugLoggingEnabled());
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
    const arcs: { source: string; target: string; qualifier?: string; isBidirectional?: boolean }[] = [];

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
      for (const edge of petriNet.edges) {
        const edgeData = edge.data as { qualifier?: string; isBidirectional?: boolean } | undefined;
        arcs.push({
          source: edge.source,
          target: edge.target,
          qualifier: edgeData?.qualifier,
          isBidirectional: edgeData?.isBidirectional,
        });
      }
    }

    return { transitions, places, arcs };
  }, [activePetriNetId, petriNetsById, isMainPage]);

  // Summary counts shown above the event list. Derived from the same OCEL conversion
  // the export uses, so the tiles can never disagree with the exported file — a
  // separate "cheap count" would drift from it the moment either side changes.
  //
  // Types are counted as those actually present in the log, not as those declared in
  // the model: an empty log then reads 0/0/0/0 rather than claiming object types for
  // which no object exists.
  //
  // Deferred because the conversion walks every event: during a fast run this would
  // otherwise recompute per step and make the log stutter. The tiles lag the list by
  // a frame or two under load and catch up when it settles.
  const deferredEvents = useDeferredValue(displayEvents);
  // Last computed analysis, reused verbatim while a run is in progress — see below.
  const lastAnalysisRef = useRef<{ stats: EventLogStats; summaries: Map<string, EventOcelSummary> }>({
    stats: { objectTypes: 0, objects: 0, eventTypes: 0, events: 0 },
    summaries: new Map(),
  });
  const logAnalysis = useMemo(() => {
    const empty = {
      stats: { objectTypes: 0, objects: 0, eventTypes: 0, events: 0 },
      summaries: new Map<string, EventOcelSummary>(),
    };
    // This walks every event and every token in the log, so its cost grows with the log.
    // The log grows several times a second during a run (events are flushed in batches),
    // and re-deriving the whole thing on each flush is what makes a long run crawl
    // towards its end. Freeze it for the duration and recompute once the run stops: the
    // tiles then lag a run rather than taxing every batch of it.
    if (isRunning) return lastAnalysisRef.current;

    if (deferredEvents.length === 0) {
      lastAnalysisRef.current = empty;
      return empty;
    }
    const { transitions, places, arcs } = getModelData();
    const ocel = convertToOCEL2(
      deferredEvents, colorSets, transitions, places, simulationEpoch || null, arcs,
      filteredTransitionIds ?? undefined,
    );

    // Per-event figures for the log rows, read off the same conversion the tiles and the
    // export use — so a row can never claim something the exported file wouldn't.
    const typeByObjectId = new Map(ocel.objects.map(o => [o.id, o.type]));
    const summaries = new Map<string, EventOcelSummary>();
    for (const e of ocel.events) {
      const types = new Set<string>();
      for (const r of e.relationships) {
        const type = typeByObjectId.get(r.objectId);
        if (type) types.add(type);
      }
      summaries.set(e.id, { objects: e.relationships.length, objectTypes: types.size });
    }

    const analysis = {
      stats: {
        objectTypes: new Set(ocel.objects.map(o => o.type)).size,
        objects: ocel.objects.length,
        eventTypes: new Set(ocel.events.map(e => e.type)).size,
        events: ocel.events.length,
      },
      summaries,
    };
    lastAnalysisRef.current = analysis;
    return analysis;
  }, [deferredEvents, filteredTransitionIds, getModelData, colorSets, simulationEpoch, isRunning]);

  const handleExportOcel = (format: 'json' | 'xml' | 'sqlite') => {
    const { transitions, places, arcs } = getModelData();
    // The transition filter selects which firings become events; the conversion still sees
    // the whole log, so objects touched only by unselected transitions stay in the export.
    const ocelData = convertToOCEL2(
      events, colorSets, transitions, places, simulationEpoch || null, arcs,
      filteredTransitionIds ?? undefined,
    );
    
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
${obj.relationships.map(r => `      <relationship objectId="${r.objectId}" qualifier="${r.qualifier}"/>`).join('\n')}
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
            {!isRunning && visibleEnabledTransitions.length > 0 && (
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
        ) : isRunning ? (
          /* The list is a snapshot from before the run started — it is only recomputed
             once the run ends — and firing from it mid-run would inject a step the run
             never accounted for. Show neither the stale entries nor their Fire buttons. */
          <p className="text-xs text-muted-foreground">Paused while the simulation is running — the list is recomputed when the run finishes.</p>
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
          stats={logAnalysis.stats}
          eventSummaries={logAnalysis.summaries}
        />
      </div>
      <OCELExportDialog open={ocelDialogOpen} onOpenChange={setOcelDialogOpen} onExport={handleExportOcel} />
      
      {/* Simulation Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={handleSettingsOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Simulation Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-5 items-center gap-4">
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
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-5 items-center gap-4">
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
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-5 items-center gap-4">
              <Label htmlFor="simulationEpoch" className="text-right col-span-2">
                Simulation epoch
              </Label>
              <Input
                id="simulationEpoch"
                type="datetime-local"
                step="0.001"
                value={tempEpoch}
                onChange={(e) => setTempEpoch(e.target.value)}
                className="col-span-3"
              />
              <div className="col-span-3 col-start-3 flex gap-2">
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

            <Separator />

            {/* Where the toolbar's "run to end time" button stops. Held as model time, so
                the field is a datetime once an epoch gives that a real-world meaning and a
                plain millisecond count otherwise. */}
            <div className="grid grid-cols-5 items-center gap-4">
              <Label htmlFor="runEndTime" className="text-right col-span-2">
                Run end time
              </Label>
              {tempEpochMs !== null ? (
                <Input
                  id="runEndTime"
                  // Same step as the epoch field above, for two reasons: the two datetimes
                  // sit next to each other and should read identically, and the value fed
                  // in carries milliseconds — a coarser step makes the browser drop them.
                  type="datetime-local"
                  step="0.001"
                  disabled={tempConfig.endTimeMs === null}
                  value={endTimeToLocal(tempConfig.endTimeMs)}
                  onChange={(e) => {
                    const picked = new Date(e.target.value);
                    if (!isNaN(picked.getTime())) {
                      // Model time cannot be negative, so an end time before the epoch is
                      // clamped rather than saved as something the engine would reject.
                      setTempConfig({ ...tempConfig, endTimeMs: Math.max(0, picked.getTime() - tempEpochMs) });
                    }
                  }}
                  className="col-span-3"
                />
              ) : (
                <div className="col-span-3 flex items-center gap-2">
                  <Input
                    id="runEndTime"
                    type="number"
                    min={0}
                    disabled={tempConfig.endTimeMs === null}
                    value={tempConfig.endTimeMs ?? ''}
                    onChange={(e) => setTempConfig({
                      ...tempConfig,
                      endTimeMs: Math.max(0, parseInt(e.target.value) || 0),
                    })}
                  />
                  <span className="text-xs text-muted-foreground shrink-0">ms</span>
                </div>
              )}
              <div className="col-span-3 col-start-3 flex items-start gap-2">
                <Checkbox
                  id="openEndedRun"
                  checked={tempConfig.endTimeMs === null}
                  onCheckedChange={(checked) => setTempConfig({
                    ...tempConfig,
                    // Coming back off open-ended needs *some* time to show; a day of model
                    // time past the epoch is a starting point to edit, not a guess at what
                    // the model needs.
                    endTimeMs: checked === true ? null : 24 * 60 * 60 * 1000,
                  })}
                  className="mt-0.5"
                />
                <Label htmlFor="openEndedRun" className="text-xs font-normal leading-snug">
                  Open-ended — run until deadlock or Stop
                </Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Used by the <Timer className="inline h-3 w-3" aria-hidden />/<InfinityIcon className="inline h-3 w-3" aria-hidden /> button
              in the simulation toolbar. Unlike a step count, this stops the run at a point in
              simulated time: no transition fires past it.
            </p>

            <div className="flex items-start gap-3">
              <Checkbox
                id="keepAwake"
                checked={tempConfig.keepAwakeWhileRunning}
                onCheckedChange={(checked) => setTempConfig({
                  ...tempConfig,
                  keepAwakeWhileRunning: checked === true,
                })}
                className="mt-0.5"
                disabled={!wakeLockSupported}
              />
              <div className="grid gap-1">
                <Label htmlFor="keepAwake">Keep the screen awake while running</Label>
                <p className="text-xs text-muted-foreground">
                  {wakeLockSupported
                    ? 'Holds a screen wake lock during a run to end time, so the display timeout cannot cut a long run short. It cannot stop the machine sleeping when you close the lid, and the lock is dropped while this tab is in the background.'
                    : 'Unavailable in this browser — the Screen Wake Lock API needs a secure context (https) and is not supported everywhere. A long run can be interrupted by the display timeout.'}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-start gap-3">
              <Checkbox
                id="debugLogging"
                checked={debugLogging}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setDebugLogging(enabled);
                  setDebugLoggingEnabled(enabled);
                }}
                className="mt-0.5"
              />
              <div className="grid gap-1">
                <Label htmlFor="debugLogging">Engine debug logging</Label>
                <p className="text-xs text-muted-foreground">
                  Writes the engine's variable bindings, code segment runs and priority
                  selections to the browser console — thousands of lines for a long run, and
                  slower. Applies immediately; kept on this machine, not saved with the model.
                </p>
              </div>
            </div>
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

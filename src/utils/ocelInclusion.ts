/**
 * Which transitions become events in an OCEL 2.0 export.
 *
 * A firing is an event, so in principle every transition qualifies. In practice a model
 * carries transitions that exist to move bookkeeping tokens around — counters, clocks,
 * dispatchers — and exporting those produces event types with no objects attached, which
 * is noise in the log rather than information about the process.
 *
 * The automatic rule is structural: a transition is a business event when it is connected
 * to an object place, i.e. one whose colour set is a record or a product. That is a good
 * default and a poor law, so `TransitionNodeData.includeInOcel` overrides it per
 * transition and is saved with the model.
 */

import type { ColorSet } from '@/declarations';
import type { PetriNet } from '@/types';

/**
 * The places in `net` that hold objects — record- or product-typed colour sets.
 *
 * Product types count because a tuple place is how a model carries an object together
 * with something else (a counter, a flag), and the object in it is still an object.
 */
export function objectPlaceIds(net: PetriNet, colorSets: ColorSet[]): Set<string> {
  const objectColorSetNames = new Set(
    colorSets.filter((cs) => cs.type === 'record' || cs.type === 'product').map((cs) => cs.name)
  );
  return new Set(
    net.nodes
      .filter((node) => node.type === 'place' && objectColorSetNames.has((node.data?.colorSet as string) || ''))
      .map((node) => node.id)
  );
}

/** Whether any arc connects `transitionId` to one of `placeIds`, in either direction. */
export function touchesAnyPlace(net: PetriNet, transitionId: string, placeIds: Set<string>): boolean {
  return net.edges.some(
    (edge) =>
      (edge.source === transitionId && placeIds.has(edge.target)) ||
      (edge.target === transitionId && placeIds.has(edge.source))
  );
}

/**
 * The effective answer for one transition: its explicit setting when it has one, the
 * structural default otherwise.
 *
 * Undefined is not "no" — a model that has never been told anything about OCEL export
 * still has to produce a sensible log, and every model saved before this setting existed
 * is in exactly that state.
 */
export function resolveIncludeInOcel(
  explicit: boolean | undefined,
  involvesObjectPlace: boolean
): boolean {
  return typeof explicit === 'boolean' ? explicit : involvesObjectPlace;
}

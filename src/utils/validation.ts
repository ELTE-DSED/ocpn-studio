/**
 * Validation engine for OCPN models.
 * Checks for type mismatches, undefined references, and structural issues.
 */

import type { ColorSet, Variable, Priority } from '@/declarations';
import type { PetriNet } from '@/types';
import type { PlaceNodeData } from '@/nodes/PlaceNode';
import type { TransitionNodeData } from '@/nodes/TransitionNode';

export type ErrorSeverity = 'error' | 'warning';

export interface ValidationError {
  severity: ErrorSeverity;
  message: string;
}

/** Maps element IDs to their validation errors */
export type ValidationErrors = Record<string, ValidationError[]>;

// ─── Color set definition parsing ─────────────────────────────────────────

/**
 * Extracts component color set names from a product type definition.
 * E.g. "colset AircraftxGate = product Aircraft * Gate timed;" → ["Aircraft", "Gate"]
 */
function parseProductComponents(definition: string): string[] | null {
  const match = definition.match(/=\s*product\s+(.+?)(?:\s+timed)?\s*;?\s*$/i);
  if (!match) return null;
  return match[1].split('*').map(s => s.trim()).filter(Boolean);
}

/**
 * Checks if a color set is a product type.
 */
function isProductType(cs: ColorSet): boolean {
  return cs.definition.includes('= product ') || cs.definition.includes('=product ');
}

// ─── Arc inscription parsing ──────────────────────────────────────────────

/**
 * Checks if an inscription is a default/empty inscription that doesn't need validation.
 */
function isDefaultInscription(inscription: string): boolean {
  const trimmed = inscription.trim();
  return !trimmed || trimmed === '()' || /^\d+`\(\)$/.test(trimmed);
}

/**
 * Parses a tuple inscription like "[ac, rw]" or "(ac, rw)" into component names.
 * Returns null if not a tuple.
 */
function parseTupleInscription(inscription: string): string[] | null {
  const trimmed = inscription.trim();
  // Match [a, b, c] or (a, b, c) patterns
  const match = trimmed.match(/^[\[(]\s*(.+?)\s*[\])]$/);
  if (!match) return null;
  return match[1].split(',').map(s => s.trim());
}

/**
 * Extracts the variable name from a simple inscription (possibly with multiplicity).
 * E.g. "var1" → "var1", "2`var1" → "var1"
 */
function parseSimpleInscription(inscription: string): string | null {
  const trimmed = inscription.trim();
  // Handle multiplicity prefix: "2`var1" → "var1"
  const multMatch = trimmed.match(/^\d+`(.+)$/);
  const varName = multMatch ? multMatch[1].trim() : trimmed;
  // Only treat as simple variable if it looks like an identifier
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
    return varName;
  }
  return null;
}

/**
 * Extracts the names of declared variables referenced by an inscription.
 * Ignores string literals, record field accesses (`p.price` → not "price"),
 * and function call names.
 */
function extractReferencedVariables(
  inscription: string,
  variableByName: Map<string, Variable>,
): string[] {
  const withoutStrings = inscription.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
  const identifiers = withoutStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const found = new Set<string>();
  for (const ident of identifiers) {
    if (!variableByName.has(ident)) continue;
    if (new RegExp(`\\.\\s*${ident}\\b`).test(withoutStrings)) continue;
    if (new RegExp(`\\b${ident}\\s*\\(`).test(withoutStrings)) continue;
    found.add(ident);
  }
  return [...found];
}

/**
 * True for color sets the simulator binds automatically when a variable is otherwise
 * unbound: integer ranges, enums and unit. Variables of these types may legitimately
 * appear on an output arc without being bound by any input arc — the simulator picks
 * a random value. Mirrors the IntRange/Enum/Unit cases in cpnsim's firing logic.
 */
function isAutoBoundColorSet(cs: ColorSet | undefined): boolean {
  if (!cs) return false;
  const def = cs.definition.toLowerCase();
  if (/=\s*unit\s*;?/.test(def)) return true;
  if (/=\s*with\s+/.test(def)) return true;
  if (/\bwith\b/.test(def) && def.includes('..')) return true;
  return false;
}

/**
 * Extracts variable names assigned by a transition's code segment (`let out = ...`).
 * These are pushed into the firing scope before output arcs are evaluated, so an
 * output arc may reference them even though no input arc binds them.
 */
function extractCodeSegmentAssignments(codeSegment: string): Set<string> {
  const assigned = new Set<string>();
  const pattern = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
  let match;
  while ((match = pattern.exec(codeSegment)) !== null) {
    assigned.add(match[1]);
  }
  return assigned;
}

// ─── Main validation ──────────────────────────────────────────────────────

/**
 * Validates a single Petri net page and returns errors keyed by element ID.
 */
function validatePetriNet(
  petriNet: PetriNet,
  colorSets: ColorSet[],
  variables: Variable[],
  priorities: Priority[],
  errors: ValidationErrors,
): void {
  const addError = (id: string, severity: ErrorSeverity, message: string) => {
    if (!errors[id]) errors[id] = [];
    errors[id].push({ severity, message });
  };

  const colorSetByName = new Map(colorSets.map(cs => [cs.name, cs]));
  const variableByName = new Map(variables.map(v => [v.name, v]));

  // ── Validate places ──────────────────────────────────────────────
  for (const node of petriNet.nodes) {
    if (node.type !== 'place') continue;
    const data = node.data as unknown as PlaceNodeData;

    // Check color set exists
    if (data.colorSet && !colorSetByName.has(data.colorSet)) {
      addError(node.id, 'error', `Undefined color set "${data.colorSet}"`);
    }
  }

  // ── Validate transitions ─────────────────────────────────────────
  for (const node of petriNet.nodes) {
    if (node.type !== 'transition') continue;
    const data = node.data as unknown as TransitionNodeData;

    // Check priority exists (if set and not empty)
    if (data.priority && data.priority.trim() !== '') {
      const isNumeric = /^\d+$/.test(data.priority.trim());
      const priorityExists = priorities.some(p => p.name === data.priority);
      if (!isNumeric && !priorityExists) {
        addError(node.id, 'error', `Undefined priority "${data.priority}"`);
      }
    }

    // Check guard references valid variables
    if (data.guard && data.guard.trim() !== '') {
      validateGuardVariables(data.guard, variableByName, colorSetByName, node.id, addError);
    }
  }

  // ── Validate arcs ────────────────────────────────────────────────
  for (const edge of petriNet.edges) {
    const inscription = typeof edge.label === 'string' ? edge.label : '';
    if (isDefaultInscription(inscription)) continue;

    // Find connected place
    const sourceNode = petriNet.nodes.find(n => n.id === edge.source);
    const targetNode = petriNet.nodes.find(n => n.id === edge.target);
    const placeNode = sourceNode?.type === 'place' ? sourceNode :
                      targetNode?.type === 'place' ? targetNode : null;

    if (!placeNode) continue;

    const placeData = placeNode.data as unknown as PlaceNodeData;
    const placeColorSet = colorSetByName.get(placeData.colorSet);

    if (!placeColorSet) continue; // Place already has its own error

    // Names the attached transition's code segment puts into the firing scope. They
    // are legitimate references in an inscription without being declared variables —
    // the conditional output arc pattern (`if ok { [tok] } else { [] }`) depends on it.
    const transitionNode = sourceNode?.type === 'transition' ? sourceNode :
                           targetNode?.type === 'transition' ? targetNode : null;
    const localVars = extractCodeSegmentAssignments(
      (transitionNode?.data as unknown as TransitionNodeData | undefined)?.codeSegment || ''
    );

    validateArcInscription(
      inscription, placeColorSet, variableByName, colorSetByName, edge.id, addError, localVars
    );
  }

  // ── Check for delays on input arcs ───────────────────────────────
  // In timed CPNs, delays belong on output arcs and transitions: they state when a
  // produced token becomes available. cpnsim evaluates arc delays only when producing
  // tokens, so a delay on a place→transition arc is silently ignored. (Bidirectional
  // arcs are exempt: their delay applies to the producing direction.)
  for (const edge of petriNet.edges) {
    const edgeData = edge.data as { delay?: string; isBidirectional?: boolean } | undefined;
    if (!edgeData?.delay?.trim()) continue;
    if (edgeData.isBidirectional) continue;
    const sourceNode = petriNet.nodes.find(n => n.id === edge.source);
    const targetNode = petriNet.nodes.find(n => n.id === edge.target);
    if (sourceNode?.type === 'place' && targetNode?.type === 'transition') {
      addError(edge.id, 'warning',
        `Time delay on an input arc has no effect and is ignored by the simulator. ` +
        `To delay this firing, delay the availability of the tokens it consumes — ` +
        `put the delay on the arc or transition that produces them.`);
    }
  }

  // ── Validate output-arc variable binding ─────────────────────────
  // Every variable an output arc uses must be bound somewhere: by an input arc of the
  // same transition, by the transition's code segment, or by the simulator's automatic
  // binding for int-range/enum/unit types. An unbound one is not a type error (the
  // variable can be perfectly well declared), so the checks above miss it — but at
  // runtime the output inscription fails to evaluate, and cpnsim has already removed
  // the input tokens by then, so firing silently destroys them.
  for (const node of petriNet.nodes) {
    if (node.type !== 'transition') continue;
    const transitionData = node.data as unknown as TransitionNodeData;

    // Substitution transitions never fire, so their arcs are never evaluated: before
    // simulating, the hierarchy is flattened — the substitution transition and its arcs
    // are dropped and each port place is merged into its assigned socket place, so the
    // real binding happens on the subpage. Checking those arcs here would flag every
    // socket arc, since a substitution transition has no input arcs to bind anything.
    if (transitionData.subPageId) continue;

    const edgeArcType = (edge: (typeof petriNet.edges)[number]) =>
      (edge.data as { arcType?: string } | undefined)?.arcType ?? 'normal';
    const isBidirectional = (edge: (typeof petriNet.edges)[number]) =>
      (edge.data as { isBidirectional?: boolean } | undefined)?.isBidirectional === true;

    // Variables bound by input arcs. Inhibitor and reset arcs are excluded: they test
    // or clear a place rather than consuming a token into a binding.
    const boundVariables = new Set<string>();
    for (const edge of petriNet.edges) {
      if (edge.target !== node.id) continue;
      if (edgeArcType(edge) !== 'normal') continue;
      const sourceNode = petriNet.nodes.find(n => n.id === edge.source);
      if (sourceNode?.type !== 'place') continue;
      const inscription = typeof edge.label === 'string' ? edge.label : '';
      for (const v of extractReferencedVariables(inscription, variableByName)) {
        boundVariables.add(v);
      }
    }

    const codeSegmentVars = extractCodeSegmentAssignments(transitionData.codeSegment || '');

    for (const edge of petriNet.edges) {
      const isOutputArc =
        edge.source === node.id || (isBidirectional(edge) && edge.target === node.id);
      if (!isOutputArc) continue;
      if (edgeArcType(edge) !== 'normal') continue;
      const inscription = typeof edge.label === 'string' ? edge.label : '';
      if (isDefaultInscription(inscription)) continue;

      for (const varName of extractReferencedVariables(inscription, variableByName)) {
        if (boundVariables.has(varName)) continue;
        if (codeSegmentVars.has(varName)) continue;
        if (isAutoBoundColorSet(colorSetByName.get(variableByName.get(varName)!.colorSet))) continue;

        const transitionName = transitionData.label || node.id;
        addError(edge.id, 'error',
          `Variable "${varName}" is never bound: no input arc of "${transitionName}" binds it. ` +
          `Firing will consume the input tokens and produce nothing.`);
      }
    }
  }

  // ── Check for conflicting OCEL role qualifiers on parallel arcs ──
  // Firing events identify token movements by place, not by arc, so the OCEL export
  // resolves an arc's role qualifier by (transition, place, direction). Parallel arcs
  // share that key: if they declare different qualifiers, one silently wins.
  const qualifiersByArcKey = new Map<string, { edgeIds: string[]; qualifiers: Set<string> }>();
  for (const edge of petriNet.edges) {
    const edgeData = edge.data as { qualifier?: string; isBidirectional?: boolean } | undefined;
    const sourceNode = petriNet.nodes.find(n => n.id === edge.source);
    const targetNode = petriNet.nodes.find(n => n.id === edge.target);
    let key: string | null = null;
    if (sourceNode?.type === 'place' && targetNode?.type === 'transition') {
      key = `${edge.target}|${edge.source}|in`;
    } else if (sourceNode?.type === 'transition' && targetNode?.type === 'place') {
      key = `${edge.source}|${edge.target}|out`;
    }
    if (!key) continue;
    const entry = qualifiersByArcKey.get(key) ?? { edgeIds: [], qualifiers: new Set<string>() };
    entry.edgeIds.push(edge.id);
    entry.qualifiers.add(edgeData?.qualifier?.trim() || '');
    qualifiersByArcKey.set(key, entry);
  }
  for (const { edgeIds, qualifiers } of qualifiersByArcKey.values()) {
    if (edgeIds.length < 2 || qualifiers.size < 2) continue;
    const named = [...qualifiers].filter(Boolean);
    for (const edgeId of edgeIds) {
      addError(edgeId, 'warning',
        `Parallel arcs between the same place and transition declare different OCEL role ` +
        `qualifiers (${named.map(q => `"${q}"`).join(', ')}${qualifiers.has('') ? ', and one left blank' : ''}). ` +
        `The export cannot tell them apart — give them the same qualifier.`);
    }
  }

  // ── Check for disconnected nodes ─────────────────────────────────
  const connectedNodeIds = new Set<string>();
  for (const edge of petriNet.edges) {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  }
  for (const node of petriNet.nodes) {
    if (node.type === 'auxText') continue;
    // Skip port places and substitution transitions — they connect through hierarchy
    const nodeData = node.data as Record<string, unknown>;
    if (nodeData.portType) continue;
    if (nodeData.subPageId) continue;
    if (!connectedNodeIds.has(node.id)) {
      const kind = node.type === 'place' ? 'Place' : 'Transition';
      addError(node.id, 'warning', `${kind} has no connected arcs`);
    }
  }
}

/**
 * Validates that guard expressions reference existing variables.
 * Uses a simple heuristic: extract identifiers and check if they're known variables/fields.
 */
function validateGuardVariables(
  guard: string,
  variableByName: Map<string, Variable>,
  colorSetByName: Map<string, ColorSet>,
  nodeId: string,
  addError: (id: string, severity: ErrorSeverity, message: string) => void,
): void {
  // Extract identifiers from the guard expression
  // Skip string literals, numbers, operators, and known keywords
  const keywords = new Set([
    'true', 'false', 'if', 'then', 'else', 'let', 'in', 'val', 'fun',
    'andalso', 'orelse', 'not', 'mod', 'div', 'nil', 'hd', 'tl',
    'current_time', 'is_workday', 'hour_of_day',
    'Int', 'Real', 'String', 'Bool', 'size', 'concat', 'substring',
    'implode', 'explode', 'chr', 'ord', 'toString', 'fromString',
    'length', 'nth', 'rev', 'map', 'filter', 'foldl', 'foldr',
  ]);

  // Remove string literals before extracting identifiers
  const withoutStrings = guard.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');

  // Extract locally-defined variables from let bindings (e.g., "let t = ...")
  const localVars = new Set<string>();
  const letPattern = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
  let letMatch;
  while ((letMatch = letPattern.exec(withoutStrings)) !== null) {
    localVars.add(letMatch[1]);
  }

  const identifiers = withoutStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const reported = new Set<string>();

  for (const ident of identifiers) {
    if (keywords.has(ident)) continue;
    // Skip if already reported (deduplicate)
    if (reported.has(ident)) continue;
    // Skip if it's a known variable
    if (variableByName.has(ident)) continue;
    // Skip if it's a locally-defined let binding
    if (localVars.has(ident)) continue;
    // Skip if it looks like a color set name (used in type checks)
    if (colorSetByName.has(ident)) continue;
    // Skip if it looks like a record field access (preceded by a dot)
    const fieldPattern = new RegExp(`\\.\\s*${ident}\\b`);
    if (fieldPattern.test(withoutStrings)) continue;
    // Skip if it looks like a function call (followed by "(")
    const funcCallPattern = new RegExp(`\\b${ident}\\s*\\(`);
    if (funcCallPattern.test(withoutStrings)) continue;
    // Skip common function names and numeric-ish tokens
    if (/^\d/.test(ident)) continue;

    // This identifier is not a known variable — could be an error
    // But we only flag it if it appears as a standalone token (not after a dot)
    const standalonePattern = new RegExp(`(?<![.])\\b${ident}\\b`);
    if (standalonePattern.test(withoutStrings) && !variableByName.has(ident)) {
      // Only report as warning since we can't perfectly parse CPN ML
      reported.add(ident);
      addError(nodeId, 'warning', `Guard may reference undefined variable "${ident}"`);
    }
  }
}

/**
 * Validates an arc inscription against the connected place's color set.
 */
function validateArcInscription(
  inscription: string,
  placeColorSet: ColorSet,
  variableByName: Map<string, Variable>,
  colorSetByName: Map<string, ColorSet>,
  edgeId: string,
  addError: (id: string, severity: ErrorSeverity, message: string) => void,
  localVars: Set<string> = new Set(),
): void {
  // Try tuple inscription: [ac, rw] or (ac, gate)
  const tupleComponents = parseTupleInscription(inscription);
  if (tupleComponents) {
    validateTupleInscription(tupleComponents, placeColorSet, variableByName, colorSetByName, edgeId, addError, localVars);
    return;
  }

  // Try simple variable inscription: var1 or 2`var1
  const simpleVar = parseSimpleInscription(inscription);
  if (simpleVar) {
    if (localVars.has(simpleVar)) return; // value produced by the transition's code segment
    validateSimpleInscription(simpleVar, placeColorSet, variableByName, colorSetByName, edgeId, addError);
    return;
  }

  // Complex expression — we can't fully validate these yet but check for obvious issues
  // Extract all potential variable references
  const withoutStrings = inscription.replace(/"[^"]*"/g, '');
  const identifiers = withoutStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const keywords = new Set(['if', 'then', 'else', 'true', 'false', 'let', 'in', 'val', 'hd', 'tl', 'nil']);

  for (const ident of identifiers) {
    if (keywords.has(ident)) continue;
    if (colorSetByName.has(ident)) continue;
    if (localVars.has(ident)) continue; // set by the transition's code segment
    // Check if identifier appears standalone (not as a record field after a dot)
    const fieldPattern = new RegExp(`\\.\\s*${ident}\\b`);
    if (fieldPattern.test(withoutStrings)) continue;
    // Skip if it looks like a function call (followed by "(")
    const funcCallPattern = new RegExp(`\\b${ident}\\s*\\(`);
    if (funcCallPattern.test(withoutStrings)) continue;

    if (!variableByName.has(ident)) {
      addError(edgeId, 'warning', `Arc inscription may reference undefined variable "${ident}"`);
    }
  }
}

/**
 * Validates a tuple inscription [v1, v2, ...] against a product color set.
 */
function validateTupleInscription(
  components: string[],
  placeColorSet: ColorSet,
  variableByName: Map<string, Variable>,
  colorSetByName: Map<string, ColorSet>,
  edgeId: string,
  addError: (id: string, severity: ErrorSeverity, message: string) => void,
  localVars: Set<string> = new Set(),
): void {
  // Check if place expects a product type
  if (!isProductType(placeColorSet)) {
    addError(edgeId, 'error',
      `Tuple inscription [${components.join(', ')}] but place expects non-product type "${placeColorSet.name}"`);
    return;
  }

  const expectedComponents = parseProductComponents(placeColorSet.definition);
  if (!expectedComponents) return;

  // Check component count
  if (components.length !== expectedComponents.length) {
    addError(edgeId, 'error',
      `Tuple has ${components.length} component(s) but "${placeColorSet.name}" expects ${expectedComponents.length}`);
    return;
  }

  // Check each component's type
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const expectedTypeName = expectedComponents[i];

    // Check if it's a variable
    if (localVars.has(component)) continue; // set by the transition's code segment
    const variable = variableByName.get(component);
    if (!variable) {
      // Could be a literal or expression — check if it's a known identifier
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(component)) {
        addError(edgeId, 'error', `Undefined variable "${component}" in arc inscription`);
      }
      continue;
    }

    // Check type compatibility: variable's color set should match expected component type
    if (!isColorSetCompatible(variable.colorSet, expectedTypeName, colorSetByName)) {
      addError(edgeId, 'error',
        `Type mismatch: "${component}" is ${variable.colorSet} but position ${i + 1} of "${placeColorSet.name}" expects ${expectedTypeName}`);
    }
  }
}

/**
 * Validates a simple variable inscription against a place's color set.
 */
function validateSimpleInscription(
  varName: string,
  placeColorSet: ColorSet,
  variableByName: Map<string, Variable>,
  colorSetByName: Map<string, ColorSet>,
  edgeId: string,
  addError: (id: string, severity: ErrorSeverity, message: string) => void,
): void {
  const variable = variableByName.get(varName);
  if (!variable) {
    addError(edgeId, 'error', `Undefined variable "${varName}" in arc inscription`);
    return;
  }

  // Check type compatibility
  if (!isColorSetCompatible(variable.colorSet, placeColorSet.name, colorSetByName)) {
    addError(edgeId, 'error',
      `Type mismatch: variable "${varName}" is ${variable.colorSet} but place expects ${placeColorSet.name}`);
  }
}

/**
 * Extracts the element color set name from a list type definition.
 * E.g. "colset Items = list Item;" → "Item"
 */
function parseListElementType(definition: string): string | null {
  const match = definition.match(/=\s*list\s+(\w+)(?:\s+timed)?\s*;?\s*$/i);
  return match ? match[1] : null;
}

/**
 * Checks if two color set references are compatible.
 * Direct name match, resolves aliases / "with" ranges, and handles
 * list types (a list of X is compatible with a place of type X, because
 * it represents consuming/producing multiple tokens).
 */
function isColorSetCompatible(
  actualType: string,
  expectedType: string,
  colorSetByName: Map<string, ColorSet>,
): boolean {
  if (actualType === expectedType) return true;

  // Check if actual type is a subtype or alias of expected type
  // E.g., "INT with 1..10" is compatible with INT
  const actualCs = colorSetByName.get(actualType);
  if (actualCs) {
    // "colset X = int with 1..10;" is compatible with INT
    const baseMatch = actualCs.definition.match(/=\s*(\w+)\s+with\b/i);
    if (baseMatch && baseMatch[1].toUpperCase() === expectedType.toUpperCase()) return true;

    // List type: "colset Items = list Item;" is compatible with a place of type Item
    // because it represents consuming/producing multiple tokens of the element type
    const elementType = parseListElementType(actualCs.definition);
    if (elementType && isColorSetCompatible(elementType, expectedType, colorSetByName)) return true;
  }

  const expectedCs = colorSetByName.get(expectedType);
  if (expectedCs) {
    const baseMatch = expectedCs.definition.match(/=\s*(\w+)\s+with\b/i);
    if (baseMatch && baseMatch[1].toUpperCase() === actualType.toUpperCase()) return true;
  }

  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Validates the entire OCPN model across all Petri net pages.
 * Returns errors keyed by element ID.
 */
export function validateModel(
  petriNetsById: Record<string, PetriNet>,
  colorSets: ColorSet[],
  variables: Variable[],
  priorities: Priority[],
): ValidationErrors {
  const errors: ValidationErrors = {};

  // Validate variable declarations
  const colorSetNames = new Set(colorSets.map(cs => cs.name));
  for (const variable of variables) {
    if (variable.colorSet && !colorSetNames.has(variable.colorSet)) {
      if (variable.id) {
        if (!errors[variable.id]) errors[variable.id] = [];
        errors[variable.id].push({
          severity: 'error',
          message: `Variable "${variable.name}" references undefined color set "${variable.colorSet}"`,
        });
      }
    }
  }

  // Validate each Petri net page
  for (const petriNet of Object.values(petriNetsById)) {
    validatePetriNet(petriNet, colorSets, variables, priorities, errors);
  }

  return errors;
}

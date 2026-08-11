import type { ColorSet } from '@/declarations';

/**
 * Turns a colour set into a set of table columns for the marking editors.
 *
 * A record already maps onto a table cleanly — one column per field. A *product* did not, and
 * used to fall back to a single cramped input holding the whole token as JSON, which is
 * unreadable for something like `colset Catalog = product Product * INT;` where each token is
 * a nested record plus a number.
 *
 * The rule here is to flatten whatever can be flattened and summarise the rest:
 *
 *   * a scalar component becomes one column;
 *   * a record component whose fields are *all* scalars expands into one column per field,
 *     labelled `Component.field`;
 *   * anything else — a list, a record with nested structure — stays a single column whose
 *     cell holds JSON, because there is no honest fixed set of columns for it.
 *
 * So `product Product * INT` becomes `Product.id | Product.weight | Product.price | INT`,
 * while `product STRING * Items * STRING * INT` keeps `Items` as one JSON cell and flattens
 * nothing else.
 */

export interface MarkingColumn {
  /** Header text. */
  label: string;
  /**
   * Where this cell lives inside the token value: array indices for product components,
   * field names for record fields. An empty path addresses the whole value.
   */
  path: (number | string)[];
  /** Colour set name of the value at this path, used to coerce what the user types. */
  type: string;
  /** Scalars get a plain input; `json` cells hold structure the table cannot flatten. */
  kind: 'scalar' | 'json';
}

const BASIC_TYPES = new Set(['UNIT', 'BOOL', 'INT', 'REAL', 'STRING']);

/** Whether a colour set name denotes a scalar that fits in a single input. */
function isScalarType(name: string, colorSets: ColorSet[]): boolean {
  if (BASIC_TYPES.has(name.toUpperCase())) return true;
  const cs = colorSets.find((c) => c.name === name);
  // An enumeration or an aliased basic type is still a single value.
  return !!cs && (cs.type === 'basic' || cs.type === 'enum' || cs.type === 'index');
}

/**
 * Fields of a record colour set.
 * "colset Product = record id: STRING * weight: REAL * price: REAL timed;"
 *   → [{ name: 'id', type: 'STRING' }, …]
 */
export function parseRecordFields(definition: string): { name: string; type: string }[] {
  const body = definition.match(/=\s*record\s+(.+?)(?:\s+timed)?\s*;?\s*$/is);
  if (!body) return [];

  const fields: { name: string; type: string }[] = [];
  for (const part of body[1].split('*')) {
    const field = part.trim().match(/^(\w+)\s*:\s*(\w+)$/);
    if (field) fields.push({ name: field[1], type: field[2] });
  }
  return fields;
}

/**
 * Component types of a product colour set.
 * "colset Catalog = product Product * INT timed;" → ['Product', 'INT']
 */
export function parseProductComponents(definition: string): string[] {
  const body = definition.match(/=\s*product\s+(.+?)(?:\s+timed)?\s*;?\s*$/is);
  if (!body) return [];
  return body[1].split('*').map((part) => part.trim()).filter(Boolean);
}

/**
 * Columns for a colour set's marking table, or null when the type is not tabular at all
 * (a basic type, a list, an unknown name) and the caller should fall back to the row editor.
 */
export function deriveMarkingColumns(
  colorSetName: string,
  colorSets: ColorSet[]
): MarkingColumn[] | null {
  const cs = colorSets.find((c) => c.name === colorSetName);
  if (!cs) return null;

  if (cs.type === 'record') {
    const fields = parseRecordFields(cs.definition);
    if (fields.length === 0) return null;
    return fields.map((field) => ({
      label: field.name,
      path: [field.name],
      type: field.type,
      kind: isScalarType(field.type, colorSets) ? 'scalar' : 'json',
    }));
  }

  if (cs.type === 'product') {
    const components = parseProductComponents(cs.definition);
    if (components.length === 0) return null;

    const columns: MarkingColumn[] = [];
    components.forEach((component, index) => {
      if (isScalarType(component, colorSets)) {
        columns.push({ label: component, path: [index], type: component, kind: 'scalar' });
        return;
      }

      const componentSet = colorSets.find((c) => c.name === component);
      if (componentSet?.type === 'record') {
        const fields = parseRecordFields(componentSet.definition);
        // Only flatten a record all of whose fields are scalars: half-flattening would put a
        // nested structure in a column labelled as if it were a plain field.
        if (fields.length > 0 && fields.every((f) => isScalarType(f.type, colorSets))) {
          for (const field of fields) {
            columns.push({
              label: `${component}.${field.name}`,
              path: [index, field.name],
              type: field.type,
              kind: 'scalar',
            });
          }
          return;
        }
      }

      columns.push({ label: component, path: [index], type: component, kind: 'json' });
    });
    return columns;
  }

  return null;
}

/** Reads the value a column addresses out of a token value. */
export function getAtPath(value: unknown, path: (number | string)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * Returns a copy of `value` with the slot a column addresses replaced. Missing containers are
 * created along the way — an array when the next key is an index, an object otherwise — so
 * editing a cell of a token that arrived incomplete does not throw.
 */
export function setAtPath(
  value: unknown,
  path: (number | string)[],
  next: unknown
): unknown {
  if (path.length === 0) return next;

  const [key, ...rest] = path;
  const isIndex = typeof key === 'number';
  const container: unknown = value ?? (isIndex ? [] : {});

  if (isIndex) {
    const copy = Array.isArray(container) ? [...container] : [];
    copy[key] = setAtPath(copy[key], rest, next);
    return copy;
  }

  const copy = { ...(container as Record<string, unknown>) };
  copy[key] = setAtPath(copy[key], rest, next);
  return copy;
}

/** Coerces text typed into a cell to the column's colour set. */
export function coerceCellValue(raw: string, type: string, kind: 'scalar' | 'json'): unknown {
  if (kind === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // let the user finish typing; the JSON tab is there for anything hairy
    }
  }

  switch (type.toUpperCase()) {
    case 'INT': {
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'REAL': {
      const parsed = parseFloat(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'BOOL':
      return raw.toLowerCase() === 'true';
    default:
      return raw;
  }
}

/** Text for a cell — JSON columns show their structure, scalars show themselves. */
export function formatCellValue(value: unknown, kind: 'scalar' | 'json'): string {
  if (value === undefined || value === null) return '';
  return kind === 'json' ? JSON.stringify(value) : String(value);
}

/** A token value with every column's slot filled with a type-appropriate blank. */
export function createDefaultValue(columns: MarkingColumn[]): unknown {
  let value: unknown = undefined;
  for (const column of columns) {
    const blank =
      column.kind === 'json'
        ? []
        : column.type.toUpperCase() === 'INT' || column.type.toUpperCase() === 'REAL'
          ? 0
          : column.type.toUpperCase() === 'BOOL'
            ? false
            : '';
    value = setAtPath(value, column.path, blank);
  }
  return value;
}

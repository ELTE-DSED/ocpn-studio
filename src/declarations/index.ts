import { v4 as uuidv4 } from 'uuid';

export interface ColorSet {
  id?: string
  name: string
  type: string
  definition: string
  color?: string // Add color property
  timed?: boolean // Whether this is a timed color set
  refs?: ColorSetFieldRef[] // Object references carried by record fields (for OCEL o2o export)
}

/**
 * Declares that a record field holds a reference to another object type, so the
 * OCEL export can derive a qualified object-to-object relationship from it.
 * Fields that structurally embed another record colorset (directly or as a list)
 * are detected automatically; this annotation is for plain id-typed fields, or to
 * override the default qualifier/direction.
 */
export interface ColorSetFieldRef {
  field: string // Record field name carrying the reference
  target: string // Referenced object type (a record colorset name)
  qualifier?: string // OCEL o2o qualifier; defaults to the field name
  reverse?: boolean // Emit target→owner instead of owner→target (e.g. customer "places" order)
  /**
   * OCEL e2o qualifier for objects reached through this field — the role they play in
   * events touching the owning token. Defaults to `qualifier`. Needed when the two read
   * differently: a package relates to its employee as "shipped by" (o2o) while the send
   * event relates to the same employee as "shipper" (e2o).
   */
  eventQualifier?: string
}

export interface Variable {
  id?: string
  name: string
  colorSet: string
}

export interface Priority {
  id?: string
  name: string
  level: number
}

export interface FunctionPattern {
  id: string
  pattern: string
  expression: string
}

export interface Function {
  id?: string
  name: string
  code: string
  returnType?: string
}

export interface Use {
  id?: string
  name: string
  content: string
}

export interface Value {
  id?: string
  name: string
  expression: string
}

export const initialColorSets: ColorSet[] = [
  { id: uuidv4(), name: "UNIT", type: "basic", definition: "colset UNIT = unit;", color: "#3b82f6" },
  { id: uuidv4(), name: "BOOL", type: "basic", definition: "colset BOOL = bool;", color: "#10b981" },
  { id: uuidv4(), name: "INT", type: "basic", definition: "colset INT = int;", color: "#3b82f6" },
  { id: uuidv4(), name: "INTINF", type: "basic", definition: "colset INTINF = intinf;", color: "#3b82f6" },
  { id: uuidv4(), name: "TIME", type: "basic", definition: "colset TIME = time;", color: "#8b5cf6" },
  { id: uuidv4(), name: "REAL", type: "basic", definition: "colset REAL = real;", color: "#ef4444" },
  { id: uuidv4(), name: "STRING", type: "basic", definition: "colset STRING = string;", color: "#f59e0b" },
];

export const initialVariables: Variable[] = [
  { id: uuidv4(), name: "var1", colorSet: "INT" },
  // { id: uuidv4(), name: "b", colorSet: "BOOL" },
];

export const initialPriorities: Priority[] = [
  { id: uuidv4(), name: "P_HIGH", level: 100 },
  { id: uuidv4(), name: "P_NORMAL", level: 1000 },
  { id: uuidv4(), name: "P_LOW", level: 10000 },
];

export const initialFunctions: Function[] = [
  // {
  //   id: uuidv4(),
  //   name: "gen",
  //   patterns: [
  //     {
  //       id: uuidv4(),
  //       pattern: "(x, y)",
  //       expression: "if x > y then [] else [x]^^gen(x+1, y)",
  //     },
  //   ],
  // },
  // {
  //   id: uuidv4(),
  //   name: "listMult",
  //   patterns: [
  //     {
  //       id: uuidv4(),
  //       pattern: "(c, x::xs)",
  //       expression: "(c * x)::listMult(c, xs)",
  //     },
  //     {
  //       id: uuidv4(),
  //       pattern: "(_, nil)",
  //       expression: "nil",
  //     },
  //   ],
  // },
];

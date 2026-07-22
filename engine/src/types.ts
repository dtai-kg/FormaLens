/**
 * Core data structures.
 * ShapeTree: the SHACL-side syntax tree, one node per construct, carrying src lines.
 * FNode: the generic notation-side tree.
 */

export interface Src { line: number }

export interface Term {
  termType: "iri" | "literal" | "blank";
  /** iri: full IRI; literal: lexical form; blank: label */
  value: string;
  datatype?: string;
  lang?: string;
}

export type Param = Term | Term[];

export interface NodeShape {
  kind: "node";
  iri?: string;
  targets: TargetNode[];
  constraints: Constraint[];
  src: Src;
}

export interface TargetNode {
  kind: "target";
  construct: string; // sh:targetClass | sh:targetSubjectsOf | sh:targetObjectsOf | sh:targetNode
  params: Record<string, Param>;
  src: Src;
}

export interface PropertyShape {
  kind: "property";
  path: Term; // direct predicate IRI; composite paths are engine-deferred at parse time
  constraints: Constraint[];
  src: Src;
}

/**
 * Atomic constraint. sh:node (inline-expanded, ruling 3) and
 * sh:qualifiedValueShape (qualifiedMin/MaxCount merged at tree building)
 * carry their inner constraints in `children`.
 */
export interface Atomic {
  kind: "atomic";
  construct: string;
  params: Record<string, Param>;
  children?: Constraint[];
  src: Src;
}

export interface Logical {
  kind: "and" | "or" | "xone" | "not";
  children: Constraint[];
  src: Src;
}

/** nnf plugin product: negation stopped at an atom (internal construct not-atomic) */
export interface NotAtomic {
  kind: "not-atomic";
  child: Constraint;
  src: Src;
}

export type Constraint = Atomic | PropertyShape | Logical | NotAtomic;

export interface FNode {
  ruleId: string;
  params: Record<string, string>;
  children: FNode[];
  src?: Src;
}

/** prefix table: prefix -> namespace IRI */
export type Prefixes = Record<string, string>;

/** IRI display form: longest-matching prefix abbreviation, <...> when none matches */
export function shrinkIri(iri: string, prefixes: Prefixes): string {
  let best: { prefix: string; ns: string } | null = null;
  for (const [prefix, ns] of Object.entries(prefixes)) {
    if (iri.startsWith(ns) && (best === null || ns.length > best.ns.length)) {
      best = { prefix, ns };
    }
  }
  if (best !== null) {
    const local = iri.slice(best.ns.length);
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$|^$/.test(local)) return `${best.prefix}:${local}`;
  }
  return `<${iri}>`;
}

/** Term display form: IRIs abbreviated; numeric literals bare; other literals quoted (language tags kept) */
export function displayTerm(term: Term, prefixes: Prefixes): string {
  if (term.termType === "iri") return shrinkIri(term.value, prefixes);
  if (term.termType === "blank") return `_:${term.value}`;
  const XSD = "http://www.w3.org/2001/XMLSchema#";
  const numeric = new Set([XSD + "integer", XSD + "decimal", XSD + "double", XSD + "float",
    XSD + "int", XSD + "long", XSD + "short", XSD + "byte", XSD + "nonNegativeInteger",
    XSD + "positiveInteger", XSD + "negativeInteger", XSD + "nonPositiveInteger",
    XSD + "unsignedInt", XSD + "unsignedLong", XSD + "boolean"]);
  if (term.datatype !== undefined && numeric.has(term.datatype)) return term.value;
  if (term.lang !== undefined && term.lang !== "") return `"${term.value}"@${term.lang}`;
  return `"${term.value}"`;
}

export class EngineError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name; }
}

/** range rejection: unsupported construct; reason distinguishes paper-side from engine-side */
export class UnsupportedConstruct extends EngineError {
  constructor(
    public construct: string,
    public reason: "paper" | "engine",
    public detail?: string,
  ) {
    super(`unsupported construct ${construct} (${reason}${detail !== undefined ? ": " + detail : ""})`);
  }
}

export class ParseError extends EngineError {
  constructor(message: string, public line?: number) { super(message); }
}

/**
 * SHACL Core construct registry (fixed component).
 * IRIs, legal placeholders with classes, position, engine-deferred flags,
 * contextual placeholders. The loader injects `position` from this table;
 * the deferred list is derived as this table minus the supported positive list.
 */

export type Position = "target" | "constraint" | "wrapper";

export type ParamClass =
  | "iri" | "term" | "literal" | "int" | "list" | "formula" | "formulaList";

export interface ConstructEntry {
  construct: string;
  position: Position;
  /** placeholders a construct pattern may bind -> wildcard class */
  params: Record<string, ParamClass>;
  /** extra contextual placeholders legal on the template side (values supplied by the Translation Engine, e.g. {p} = the enclosing property shape's path) */
  contextParams?: Record<string, ParamClass>;
  /** engine-deferred: fixed list (composite paths, recursive references, SHACL-SPARQL) */
  engineDeferred?: string;
  /** this construct is a parameter of another construct: merged, no standalone rule, excluded from the supported-difference count */
  foldedInto?: string;
  /** engine-internal construct (e.g. the nnf product not-atomic): not SHACL Core, may carry a rule but never enters the supported list */
  internal?: boolean;
}

const E = (e: ConstructEntry) => e;

export const REGISTRY: ConstructEntry[] = [
  // ---- targets ----
  E({ construct: "sh:targetClass", position: "target", params: { c: "iri" } }),
  E({ construct: "sh:targetNode", position: "target", params: { c: "term" } }),
  E({ construct: "sh:targetSubjectsOf", position: "target", params: { p: "iri" } }),
  E({ construct: "sh:targetObjectsOf", position: "target", params: { p: "iri" } }),

  // ---- structural rules ----
  E({ construct: "sh:property", position: "wrapper", params: { p: "iri", body: "formula" } }),

  // ---- value constraints (no own path; templates may use contextual {p}) ----
  E({ construct: "sh:class", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:datatype", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:nodeKind", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:minInclusive", position: "constraint", params: { v: "literal" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:maxInclusive", position: "constraint", params: { v: "literal" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:minExclusive", position: "constraint", params: { v: "literal" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:maxExclusive", position: "constraint", params: { v: "literal" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:minLength", position: "constraint", params: { n: "int" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:maxLength", position: "constraint", params: { n: "int" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:pattern", position: "constraint", params: { v: "literal" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:flags", position: "constraint", params: {}, foldedInto: "sh:pattern" }),
  E({ construct: "sh:languageIn", position: "constraint", params: { L: "list" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:in", position: "constraint", params: { L: "list" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:hasValue", position: "constraint", params: { c: "term" }, contextParams: { p: "iri" } }),

  // ---- counting constraints (templates carry their own path via contextual {p}) ----
  E({ construct: "sh:minCount", position: "constraint", params: { n: "int" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:maxCount", position: "constraint", params: { m: "int" }, contextParams: { p: "iri" } }),
  E({
    construct: "sh:qualifiedValueShape", position: "constraint",
    params: { n: "int", m: "int", body: "formula" }, contextParams: { p: "iri" },
  }),
  E({ construct: "sh:qualifiedMinCount", position: "constraint", params: {}, foldedInto: "sh:qualifiedValueShape" }),
  E({ construct: "sh:qualifiedMaxCount", position: "constraint", params: {}, foldedInto: "sh:qualifiedValueShape" }),
  E({ construct: "sh:qualifiedValueShapesDisjoint", position: "constraint", params: {} }),

  // ---- pair constraints ({c} is the second predicate; {p} is the contextual path) ----
  E({ construct: "sh:equals", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:disjoint", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:lessThan", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:lessThanOrEquals", position: "constraint", params: { c: "iri" }, contextParams: { p: "iri" } }),
  E({ construct: "sh:uniqueLang", position: "constraint", params: {}, contextParams: { p: "iri" } }),

  // ---- logical and structural ----
  E({ construct: "sh:and", position: "constraint", params: { body: "formula", bodies: "formulaList" } }),
  E({ construct: "sh:or", position: "constraint", params: { body: "formula", bodies: "formulaList" } }),
  E({ construct: "sh:xone", position: "constraint", params: { body: "formula", bodies: "formulaList" } }),
  E({ construct: "sh:not", position: "constraint", params: { body: "formula" } }),
  E({ construct: "not-atomic", position: "constraint", params: { body: "formula" }, internal: true }),
  E({ construct: "sh:node", position: "constraint", params: { body: "formula" } }),
  // closed's {L} (allowed predicates = declared properties + ignoredProperties) is computed by the engine at translation time
  E({ construct: "sh:closed", position: "constraint", params: {}, contextParams: { L: "list" } }),
  E({ construct: "sh:ignoredProperties", position: "constraint", params: {}, foldedInto: "sh:closed" }),

  // ---- engine-deferred ----
  E({ construct: "composite-path", position: "constraint", params: {}, internal: true,
    engineDeferred: "composite path expressions are out of engine scope" }),
  E({ construct: "recursive-shape", position: "constraint", params: {}, internal: true,
    engineDeferred: "recursive shape references break tree structure; detected at parse time" }),
  E({ construct: "sh:sparql", position: "constraint", params: {},
    engineDeferred: "SHACL-SPARQL is out of engine scope" }),
];

const byConstruct = new Map(REGISTRY.map((e) => [e.construct, e]));

export function lookupConstruct(construct: string): ConstructEntry | undefined {
  return byConstruct.get(construct);
}

export function derivePosition(construct: string): Position | undefined {
  return byConstruct.get(construct)?.position;
}

/** fresh-variable placeholders are legal for every construct */
export const UNIVERSAL_PARAMS: Record<string, ParamClass> = { x: "iri", y: "iri" };

/** the full supportable SHACL Core set (domain of the supported difference): non-internal, non-folded, not engine-deferred */
export function coreConstructs(): string[] {
  return REGISTRY
    .filter((e) => e.internal !== true && e.foldedInto === undefined && e.engineDeferred === undefined)
    .map((e) => e.construct);
}

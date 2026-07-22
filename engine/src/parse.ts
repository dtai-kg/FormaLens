/**
 * Turtle -> ShapeTree (forward translation, step 1).
 * N3.js parsing; one tree per named shape, blank-node property shapes appear
 * only as branches of their parent. Line numbers come from n3's internal lexer
 * at quad completion (n3 is pinned exactly). sh:node is inline-expanded per its
 * semantic equivalence (ruling 3/S3); recursive references and composite paths
 * are engine-deferred. qualifiedMin/MaxCount merge into the sh:qualifiedValueShape
 * node; ignoredProperties merges into sh:closed (fixed tree-building behavior).
 */
import N3 from "n3";
import type { Quad, Term as N3Term } from "n3";
import {
  type NodeShape, type TargetNode, type PropertyShape, type Constraint, type Atomic,
  type Logical, type Term, type Param, type Prefixes, type Src,
  UnsupportedConstruct, ParseError,
} from "./types.js";

const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

export interface ParsedShapes {
  shapes: NodeShape[];
  prefixes: Prefixes;
}

interface IndexedQuad { quad: Quad; line: number }

function toTerm(t: N3Term): Term {
  if (t.termType === "NamedNode") return { termType: "iri", value: t.value };
  if (t.termType === "BlankNode") return { termType: "blank", value: t.value };
  if (t.termType === "Literal") {
    const lit: Term = { termType: "literal", value: t.value };
    if (t.language !== "") lit.lang = t.language;
    else if (t.datatype !== undefined && t.datatype.value !== "http://www.w3.org/2001/XMLSchema#string") {
      lit.datatype = t.datatype.value;
    }
    return lit;
  }
  throw new ParseError(`unsupported term type ${t.termType}`);
}

function parseQuads(ttl: string): Promise<{ quads: IndexedQuad[]; prefixes: Prefixes }> {
  return new Promise((resolve, reject) => {
    const parser = new N3.Parser();
    const quads: IndexedQuad[] = [];
    const prefixes: Prefixes = {};
    parser.parse(ttl, (error, quad, prefixDecls) => {
      if (error) {
        const m = /line (\d+)/.exec(error.message);
        reject(new ParseError(error.message, m ? Number(m[1]) : undefined));
        return;
      }
      if (quad) {
        // n3 internal lexer line: current line at quad completion (deterministic under the pinned version)
        const line = (parser as unknown as { _lexer?: { _line?: number } })._lexer?._line ?? 0;
        quads.push({ quad, line });
      } else {
        for (const [p, iri] of Object.entries(prefixDecls ?? {})) {
          prefixes[p] = typeof iri === "string" ? iri : (iri as N3Term).value;
        }
        resolve({ quads, prefixes });
      }
    });
  });
}

class GraphIndex {
  bySubject = new Map<string, IndexedQuad[]>();
  constructor(quads: IndexedQuad[]) {
    for (const iq of quads) {
      const key = iq.quad.subject.value;
      const list = this.bySubject.get(key) ?? [];
      list.push(iq);
      this.bySubject.set(key, list);
    }
  }
  props(subject: string): IndexedQuad[] {
    return this.bySubject.get(subject) ?? [];
  }
  objects(subject: string, predicate: string): IndexedQuad[] {
    return this.props(subject).filter((iq) => iq.quad.predicate.value === predicate);
  }
  one(subject: string, predicate: string): IndexedQuad | undefined {
    return this.objects(subject, predicate)[0];
  }
  /** RDF list -> item array */
  list(head: N3Term): { items: N3Term[]; line: number } {
    const items: N3Term[] = [];
    let line = 0;
    let cur = head;
    while (cur.value !== RDF + "nil") {
      const first = this.one(cur.value, RDF + "first");
      const rest = this.one(cur.value, RDF + "rest");
      if (first === undefined || rest === undefined) {
        throw new ParseError(`malformed RDF list at ${cur.value}`);
      }
      items.push(first.quad.object);
      line = line || first.line;
      cur = rest.quad.object;
    }
    return { items, line };
  }
}

const TARGET_PREDICATES: Record<string, { construct: string; param: string }> = {
  [SH + "targetClass"]: { construct: "sh:targetClass", param: "c" },
  [SH + "targetNode"]: { construct: "sh:targetNode", param: "c" },
  [SH + "targetSubjectsOf"]: { construct: "sh:targetSubjectsOf", param: "p" },
  [SH + "targetObjectsOf"]: { construct: "sh:targetObjectsOf", param: "p" },
};

/** predicate IRI -> atomic constraint's construct abbreviation and parameter name */
const ATOMIC_PREDICATES: Record<string, { construct: string; param: string; kind: "term" | "list" }> = {
  [SH + "class"]: { construct: "sh:class", param: "c", kind: "term" },
  [SH + "datatype"]: { construct: "sh:datatype", param: "c", kind: "term" },
  [SH + "nodeKind"]: { construct: "sh:nodeKind", param: "c", kind: "term" },
  [SH + "minInclusive"]: { construct: "sh:minInclusive", param: "v", kind: "term" },
  [SH + "maxInclusive"]: { construct: "sh:maxInclusive", param: "v", kind: "term" },
  [SH + "minExclusive"]: { construct: "sh:minExclusive", param: "v", kind: "term" },
  [SH + "maxExclusive"]: { construct: "sh:maxExclusive", param: "v", kind: "term" },
  [SH + "minLength"]: { construct: "sh:minLength", param: "n", kind: "term" },
  [SH + "maxLength"]: { construct: "sh:maxLength", param: "n", kind: "term" },
  [SH + "pattern"]: { construct: "sh:pattern", param: "v", kind: "term" },
  [SH + "languageIn"]: { construct: "sh:languageIn", param: "L", kind: "list" },
  [SH + "in"]: { construct: "sh:in", param: "L", kind: "list" },
  [SH + "hasValue"]: { construct: "sh:hasValue", param: "c", kind: "term" },
  [SH + "minCount"]: { construct: "sh:minCount", param: "n", kind: "term" },
  [SH + "maxCount"]: { construct: "sh:maxCount", param: "m", kind: "term" },
  [SH + "equals"]: { construct: "sh:equals", param: "c", kind: "term" },
  [SH + "disjoint"]: { construct: "sh:disjoint", param: "c", kind: "term" },
  [SH + "lessThan"]: { construct: "sh:lessThan", param: "c", kind: "term" },
  [SH + "lessThanOrEquals"]: { construct: "sh:lessThanOrEquals", param: "c", kind: "term" },
};

const LOGICAL_PREDICATES: Record<string, Logical["kind"]> = {
  [SH + "and"]: "and",
  [SH + "or"]: "or",
  [SH + "xone"]: "xone",
};

/** predicates consumed during tree building that yield no standalone node */
const CONSUMED = new Set<string>([
  RDF + "type", SH + "path", SH + "property", SH + "node", SH + "not",
  SH + "qualifiedValueShape", SH + "qualifiedMinCount", SH + "qualifiedMaxCount",
  SH + "closed", SH + "ignoredProperties", SH + "flags", SH + "uniqueLang",
  SH + "name", SH + "description", SH + "message", SH + "severity", SH + "deactivated",
  SH + "order", SH + "group", SH + "defaultValue",
  ...Object.keys(TARGET_PREDICATES),
]);

export async function parseShapes(ttl: string): Promise<ParsedShapes> {
  const { quads, prefixes } = await parseQuads(ttl);
  const g = new GraphIndex(quads);

  // named node shapes: explicit `a sh:NodeShape`, or a named subject with a target declaration
  const shapeIris = new Set<string>();
  for (const { quad } of quads) {
    if (quad.subject.termType !== "NamedNode") continue;
    const p = quad.predicate.value;
    if (p === RDF + "type" && quad.object.value === SH + "NodeShape") shapeIris.add(quad.subject.value);
    if (TARGET_PREDICATES[p] !== undefined) shapeIris.add(quad.subject.value);
  }

  const shapes: NodeShape[] = [];
  for (const iri of shapeIris) {
    shapes.push(buildNodeShape(g, iri, [iri]));
  }
  shapes.sort((a, b) => a.src.line - b.src.line);
  return { shapes, prefixes };
}

function buildNodeShape(g: GraphIndex, subject: string, visited: string[]): NodeShape {
  const props = g.props(subject);
  const firstLine = props.length > 0 ? Math.min(...props.map((q) => q.line)) : 0;
  const targets: TargetNode[] = [];
  for (const iq of props) {
    const t = TARGET_PREDICATES[iq.quad.predicate.value];
    if (t !== undefined) {
      targets.push({
        kind: "target", construct: t.construct,
        params: { [t.param]: toTerm(iq.quad.object) }, src: { line: iq.line },
      });
    }
  }
  const constraints = buildConstraints(g, subject, visited);
  const shape: NodeShape = { kind: "node", targets, constraints, src: { line: firstLine } };
  if (!subject.startsWith("_:") && g.bySubject.has(subject)) shape.iri = subject;
  return shape;
}

/** all constraint nodes under one (node or property) shape subject */
function buildConstraints(g: GraphIndex, subject: string, visited: string[]): Constraint[] {
  const constraints: Constraint[] = [];
  const props = g.props(subject);

  // sh:closed merges ignoredProperties with the declared property paths to compute {L}
  const closedIq = props.find((iq) => iq.quad.predicate.value === SH + "closed");
  if (closedIq !== undefined && closedIq.quad.object.value === "true") {
    const allowed: Term[] = [];
    for (const propIq of g.objects(subject, SH + "property")) {
      const pathIq = g.one(propIq.quad.object.value, SH + "path");
      if (pathIq !== undefined && pathIq.quad.object.termType === "NamedNode") {
        allowed.push(toTerm(pathIq.quad.object));
      }
    }
    const ignoredIq = props.find((iq) => iq.quad.predicate.value === SH + "ignoredProperties");
    if (ignoredIq !== undefined) {
      for (const item of g.list(ignoredIq.quad.object).items) allowed.push(toTerm(item));
    }
    constraints.push({
      kind: "atomic", construct: "sh:closed",
      params: { L: allowed }, src: { line: closedIq.line },
    });
  }

  for (const iq of props) {
    const { quad, line } = iq;
    const p = quad.predicate.value;
    const src: Src = { line };

    if (p === SH + "property") {
      constraints.push(buildPropertyShape(g, quad.object, visited, src));
      continue;
    }
    if (LOGICAL_PREDICATES[p] !== undefined) {
      const { items } = g.list(quad.object);
      const children = items.map((item) =>
        wrapInlineShape(g, item, visited, src));
      constraints.push({ kind: LOGICAL_PREDICATES[p], children, src });
      continue;
    }
    if (p === SH + "not") {
      constraints.push({
        kind: "not",
        children: [wrapInlineShape(g, quad.object, visited, src)],
        src,
      });
      continue;
    }
    if (p === SH + "node") {
      constraints.push(buildNodeRef(g, quad.object, visited, src));
      continue;
    }
    if (p === SH + "qualifiedValueShape") {
      const nIq = g.one(subject, SH + "qualifiedMinCount");
      const mIq = g.one(subject, SH + "qualifiedMaxCount");
      const params: Record<string, Param> = {};
      if (nIq !== undefined) params.n = toTerm(nIq.quad.object);
      if (mIq !== undefined) params.m = toTerm(mIq.quad.object);
      const inner = wrapInlineShape(g, quad.object, visited, src);
      constraints.push({
        kind: "atomic", construct: "sh:qualifiedValueShape",
        params, children: [inner], src,
      });
      continue;
    }
    const atomic = ATOMIC_PREDICATES[p];
    if (atomic !== undefined) {
      let value: Param;
      if (atomic.kind === "list") {
        value = g.list(quad.object).items.map(toTerm);
      } else {
        value = toTerm(quad.object);
      }
      const node: Atomic = { kind: "atomic", construct: atomic.construct, params: { [atomic.param]: value }, src };
      if (atomic.construct === "sh:pattern") {
        const flagsIq = g.one(subject, SH + "flags");
        if (flagsIq !== undefined) node.params.flags = toTerm(flagsIq.quad.object);
      }
      constraints.push(node);
      continue;
    }
    if (p === SH + "uniqueLang" && quad.object.value === "true") {
      constraints.push({ kind: "atomic", construct: "sh:uniqueLang", params: {}, src });
      continue;
    }
    if (p === SH + "sparql") {
      throw new UnsupportedConstruct("sh:sparql", "engine");
    }
    if (!CONSUMED.has(p)) {
      // non-SHACL-vocabulary triples (e.g. documentation) are ignored; unrecognized terms inside the SHACL namespace are errors
      if (p.startsWith(SH)) {
        throw new ParseError(`unrecognized SHACL predicate ${p}`, line);
      }
    }
  }
  return constraints;
}

function buildPropertyShape(g: GraphIndex, obj: N3Term, visited: string[], src: Src): PropertyShape {
  const pathIq = g.one(obj.value, SH + "path");
  if (pathIq === undefined) throw new ParseError(`property shape ${obj.value} has no sh:path`, src.line);
  if (pathIq.quad.object.termType !== "NamedNode") {
    throw new UnsupportedConstruct("composite-path", "engine",
      `sh:path at line ${pathIq.line} is not a direct predicate IRI`);
  }
  return {
    kind: "property",
    path: toTerm(pathIq.quad.object),
    constraints: buildConstraints(g, obj.value, visited),
    src: { line: pathIq.line },
  };
}

/** sh:node / logical-list member: target is a (named or anonymous) node shape, inline-expanded into its constraints */
function wrapInlineShape(g: GraphIndex, obj: N3Term, visited: string[], src: Src): Constraint {
  if (obj.termType === "NamedNode" && visited.includes(obj.value)) {
    throw new UnsupportedConstruct("recursive-shape", "engine",
      `shape ${obj.value} references itself (cycle: ${[...visited, obj.value].join(" -> ")})`);
  }
  const nextVisited = obj.termType === "NamedNode" ? [...visited, obj.value] : visited;
  const inner = buildConstraints(g, obj.value, nextVisited);
  if (inner.length === 1) return inner[0];
  return { kind: "and", children: inner, src };
}

function buildNodeRef(g: GraphIndex, obj: N3Term, visited: string[], src: Src): Atomic {
  if (obj.termType === "NamedNode" && visited.includes(obj.value)) {
    throw new UnsupportedConstruct("recursive-shape", "engine",
      `sh:node ${obj.value} forms a cycle (${[...visited, obj.value].join(" -> ")})`);
  }
  const nextVisited = obj.termType === "NamedNode" ? [...visited, obj.value] : visited;
  return {
    kind: "atomic", construct: "sh:node", params: {},
    children: buildConstraints(g, obj.value, nextVisited), src,
  };
}

/**
 * Reverse translation: menu-built FNode -> (per-node rule lookup) -> ShapeTree -> Turtle.
 * FNodes come from the menus, so ruleId is known; lookup rebuilds each node by
 * the rule's construct class. Output is a complete shape; nested shapes are
 * anonymous inline structures (inline form is the accepted result).
 */
import N3 from "n3";
import type { CompiledProfile, CompiledRule } from "./profile.js";
import type { FNode } from "./types.js";

const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const { namedNode, literal, blankNode, quad } = N3.DataFactory;
type Quad = ReturnType<typeof quad>;
type Subject = ReturnType<typeof namedNode> | ReturnType<typeof blankNode>;
type Obj = ReturnType<typeof namedNode> | ReturnType<typeof blankNode> | ReturnType<typeof literal>;

export interface ReverseInput {
  /** top level: target-domain selections (possibly several) and the constraint-domain formula */
  targets: FNode[];
  constraint?: FNode;
  /** prefixes for the reverse output (incl. prefixes used in user-typed parameters) */
  prefixes: Record<string, string>;
}

export class ReverseError extends Error {}

class ShapeBuilder {
  quads: Quad[] = [];
  private blankCounter = 0;
  constructor(private compiled: CompiledProfile, private prefixes: Record<string, string>) {}

  fresh(): ReturnType<typeof blankNode> {
    return blankNode(`b${this.blankCounter++}`);
  }

  rule(id: string): CompiledRule {
    const r = this.compiled.rules.find((x) => x.id === id);
    if (r === undefined) throw new ReverseError(`unknown ruleId ${id}`);
    return r;
  }

  /** parameter string -> RDF term: prefixed name / bare integer / quoted string / IRI */
  term(raw: string): Obj {
    const s = raw.trim();
    if (/^<.*>$/.test(s)) return namedNode(s.slice(1, -1));
    if (/^-?\d+$/.test(s)) return literal(s, namedNode(XSD + "integer"));
    if (/^-?\d*\.\d+$/.test(s)) return literal(s, namedNode(XSD + "decimal"));
    const quoted = /^"(.*)"(?:@([A-Za-z-]+))?$/.exec(s);
    if (quoted !== null) {
      return quoted[2] !== undefined ? literal(quoted[1], quoted[2]) : literal(quoted[1]);
    }
    const prefixed = /^([A-Za-z_][A-Za-z0-9_-]*)?:(.*)$/.exec(s);
    if (prefixed !== null) {
      const ns = this.prefixes[prefixed[1] ?? ""];
      if (ns === undefined) throw new ReverseError(`unknown prefix in "${s}"`);
      return namedNode(ns + prefixed[2]);
    }
    if (s === "true" || s === "false") return literal(s, namedNode(XSD + "boolean"));
    return literal(s);
  }

  iri(raw: string): ReturnType<typeof namedNode> {
    const t = this.term(raw);
    if (t.termType !== "NamedNode") throw new ReverseError(`expected an IRI, got "${raw}"`);
    return t;
  }

  listOf(items: Obj[]): Subject {
    let tail: Subject = namedNode(RDF + "nil") as unknown as Subject;
    for (let i = items.length - 1; i >= 0; i--) {
      const cell = this.fresh();
      this.quads.push(quad(cell, namedNode(RDF + "first"), items[i]));
      this.quads.push(quad(cell, namedNode(RDF + "rest"), tail as Obj));
      tail = cell;
    }
    return tail;
  }

  splitList(raw: string): Obj[] {
    return raw.split(",").map((x) => this.term(x));
  }

  /** target FNode -> target triples */
  emitTarget(shape: Subject, node: FNode): void {
    const rule = this.rule(node.ruleId);
    switch (rule.construct) {
      case "sh:targetClass":
        this.quads.push(quad(shape, namedNode(SH + "targetClass"), this.iri(param(node, "c"))));
        return;
      case "sh:targetNode":
        this.quads.push(quad(shape, namedNode(SH + "targetNode"), this.term(param(node, "c"))));
        return;
      case "sh:targetSubjectsOf":
        this.quads.push(quad(shape, namedNode(SH + "targetSubjectsOf"), this.iri(param(node, "p"))));
        return;
      case "sh:targetObjectsOf":
        this.quads.push(quad(shape, namedNode(SH + "targetObjectsOf"), this.iri(param(node, "p"))));
        return;
      default:
        throw new ReverseError(`rule ${rule.id} is not a target rule`);
    }
  }

  /**
   * constraint/wrapper FNode -> triples attached to subject (node shape or nested shape).
   * Counting constraints and the wrapper carry a path -> they emit their own property shape.
   */
  emitConstraint(subject: Subject, node: FNode): void {
    if (node.ruleId === "$composition") {
      for (const child of node.children) this.emitConstraint(subject, child);
      return;
    }
    const rule = this.rule(node.ruleId);
    const c = rule.construct;

    // wrapper：∀p.body → sh:property [sh:path p; body]
    if (c === "sh:property") {
      const ps = this.fresh();
      this.quads.push(quad(subject, namedNode(SH + "property"), ps));
      this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
      this.emitConstraint(ps, node.children[0]);
      return;
    }
    // counting constraints: property shape with their own path
    if (c === "sh:minCount" || c === "sh:maxCount") {
      const ps = this.fresh();
      this.quads.push(quad(subject, namedNode(SH + "property"), ps));
      this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
      const pred = c === "sh:minCount" ? "minCount" : "maxCount";
      const val = c === "sh:minCount" ? param(node, "n") : param(node, "m");
      this.quads.push(quad(ps, namedNode(SH + pred), literal(val, namedNode(XSD + "integer"))));
      return;
    }
    if (c === "sh:qualifiedValueShape") {
      const ps = this.fresh();
      this.quads.push(quad(subject, namedNode(SH + "property"), ps));
      this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
      const inner = this.fresh();
      this.quads.push(quad(ps, namedNode(SH + "qualifiedValueShape"), inner));
      this.emitConstraint(inner, node.children[0]);
      const n = node.params.n;
      const m = node.params.m;
      if (n !== undefined && n !== "") {
        this.quads.push(quad(ps, namedNode(SH + "qualifiedMinCount"), literal(n, namedNode(XSD + "integer"))));
      }
      if (m !== undefined && m !== "") {
        this.quads.push(quad(ps, namedNode(SH + "qualifiedMaxCount"), literal(m, namedNode(XSD + "integer"))));
      }
      return;
    }
    // logical
    if (c === "sh:and" || c === "sh:or" || c === "sh:xone") {
      const members = node.children.map((child) => {
        const inner = this.fresh();
        this.emitConstraint(inner, child);
        return inner as Obj;
      });
      this.quads.push(quad(subject, namedNode(SH + c.slice(3)), this.listOf(members) as Obj));
      return;
    }
    if (c === "sh:not" || c === "not-atomic") {
      const inner = this.fresh();
      this.emitConstraint(inner, node.children[0]);
      this.quads.push(quad(subject, namedNode(SH + "not"), inner));
      return;
    }
    if (c === "sh:node") {
      const inner = this.fresh();
      this.emitConstraint(inner, node.children[0]);
      this.quads.push(quad(subject, namedNode(SH + "node"), inner));
      return;
    }
    if (c === "sh:closed") {
      // closed's {L} = allowed predicate set; reverse approximation: list all as ignoredProperties with closed true
      this.quads.push(quad(subject, namedNode(SH + "closed"), literal("true", namedNode(XSD + "boolean"))));
      const L = node.params.L;
      if (L !== undefined && L.trim() !== "") {
        this.quads.push(quad(subject, namedNode(SH + "ignoredProperties"),
          this.listOf(this.splitList(L)) as Obj));
      }
      return;
    }
    // Pair constraints and uniqueLang carry their own path (template contains {p});
    // reverse must emit their own property shape (in SHACL these are property shape
    // constraint components; the verify-and-repair run of 2026-07-22 found the earlier
    // implementation attached them to the node shape without sh:path)
    if (c === "sh:uniqueLang") {
      const ps = this.fresh();
      this.quads.push(quad(subject, namedNode(SH + "property"), ps));
      this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
      this.quads.push(quad(ps, namedNode(SH + "uniqueLang"), literal("true", namedNode(XSD + "boolean"))));
      return;
    }
    const RELATION: Record<string, string> = {
      "sh:equals": "equals", "sh:disjoint": "disjoint",
      "sh:lessThan": "lessThan", "sh:lessThanOrEquals": "lessThanOrEquals",
    };
    if (RELATION[c] !== undefined) {
      const ps = this.fresh();
      this.quads.push(quad(subject, namedNode(SH + "property"), ps));
      this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
      this.quads.push(quad(ps, namedNode(SH + RELATION[c]), this.iri(param(node, "c"))));
      return;
    }
    // value atomics: the construct pattern's placeholder is the parameter
    const ATOMIC: Record<string, { pred: string; kind: "term" | "int" | "list" | "iri" }> = {
      "sh:class": { pred: "class", kind: "iri" },
      "sh:datatype": { pred: "datatype", kind: "iri" },
      "sh:nodeKind": { pred: "nodeKind", kind: "iri" },
      "sh:minInclusive": { pred: "minInclusive", kind: "term" },
      "sh:maxInclusive": { pred: "maxInclusive", kind: "term" },
      "sh:minExclusive": { pred: "minExclusive", kind: "term" },
      "sh:maxExclusive": { pred: "maxExclusive", kind: "term" },
      "sh:minLength": { pred: "minLength", kind: "int" },
      "sh:maxLength": { pred: "maxLength", kind: "int" },
      "sh:pattern": { pred: "pattern", kind: "term" },
      "sh:hasValue": { pred: "hasValue", kind: "term" },
      "sh:in": { pred: "in", kind: "list" },
      "sh:languageIn": { pred: "languageIn", kind: "list" },
    };
    const atomic = ATOMIC[c];
    if (atomic !== undefined) {
      const rule2 = this.rule(node.ruleId);
      const paramName = rule2.patternParams[0] ?? Object.keys(node.params).find((k) => k !== "p");
      if (paramName === undefined) throw new ReverseError(`rule ${rule2.id}: no parameter to emit`);
      const raw = param(node, paramName);
      let obj: Obj;
      switch (atomic.kind) {
        case "iri": obj = this.iri(raw); break;
        case "int": obj = literal(raw, namedNode(XSD + "integer")); break;
        case "list": obj = this.listOf(this.splitList(raw)) as Obj; break;
        default: {
          // sh:pattern values are always string literals
          obj = c === "sh:pattern" ? literal(stripQuotes(raw)) : this.term(raw);
        }
      }
      // atomics whose template contains {p} carry their own path (e.g. existential hasValue) and emit their own property shape
      let host: Subject = subject;
      if (rule2.template.includes("{p}")) {
        const ps = this.fresh();
        this.quads.push(quad(subject, namedNode(SH + "property"), ps));
        this.quads.push(quad(ps, namedNode(SH + "path"), this.iri(param(node, "p"))));
        host = ps;
      }
      this.quads.push(quad(host, namedNode(SH + atomic.pred), obj));
      return;
    }
    throw new ReverseError(`no reverse mapping for construct ${c} (rule ${rule.id})`);
  }
}

function param(node: FNode, name: string): string {
  const v = node.params[name];
  if (v === undefined || v.trim() === "") {
    throw new ReverseError(`missing parameter {${name}} for rule ${node.ruleId}`);
  }
  return v;
}

function stripQuotes(s: string): string {
  const m = /^"(.*)"$/.exec(s.trim());
  return m !== null ? m[1] : s.trim();
}

/** reverse translation entry: FNode -> Turtle */
export function reverseShape(compiled: CompiledProfile, input: ReverseInput): string {
  const prefixes: Record<string, string> = {
    sh: SH, xsd: XSD, rdf: RDF, ...input.prefixes,
  };
  const b = new ShapeBuilder(compiled, prefixes);
  const shape = N3.DataFactory.namedNode(
    (prefixes["ex"] ?? "http://example.org/") + "Shape");
  b.quads.push(quad(shape, namedNode(RDF + "type"), namedNode(SH + "NodeShape")));
  for (const t of input.targets) b.emitTarget(shape, t);
  if (input.constraint !== undefined) b.emitConstraint(shape, input.constraint);

  const writer = new N3.Writer({ prefixes });
  for (const q of b.quads) writer.addQuad(q as Parameters<typeof writer.addQuad>[0]);
  let out = "";
  writer.end((err, result) => {
    if (err) throw err;
    out = result;
  });
  return out;
}

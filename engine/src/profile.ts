/**
 * Notation Profile loader.
 * Order: construct pattern parsing + position injection -> ajv -> template
 * parameter legality -> supported consistency -> static ambiguity check
 * (emitted as warnings that feed the verify-and-repair loop as inputs).
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import profileSchema from "../../schema/profile.schema.json" with { type: "json" };
import {
  lookupConstruct, derivePosition, coreConstructs, UNIVERSAL_PARAMS,
  type Position, type ParamClass,
} from "./registry.js";

export interface ProfileRule {
  id?: string;
  construct: string;
  position: Position;
  template: string;
  source: string;
}

export interface Profile {
  meta: { paperTitle: string; paperId?: string };
  rules: ProfileRule[];
  composition: {
    connective: string;
    parens?: "always" | "onMixed" | "never";
    byContext?: Partial<Record<"node-shape" | "property-shape", string>>;
  };
  coverage: { supported: string[] };
}

/** compiled rule: pattern parsed, id derived */
export interface CompiledRule {
  id: string;
  construct: string;       // construct IRI abbreviation (first pattern token)
  pattern: string;         // original construct pattern string
  patternParams: string[]; // placeholders bound on the pattern side
  position: Position;
  template: string;
  source: string;
}

export interface CompiledProfile {
  profile: Profile;
  rules: CompiledRule[];
  /** construct IRI -> rule (two rules per construct is a load error, keeping reverse lookup unique) */
  byConstruct: Map<string, CompiledRule>;
  supported: Set<string>;
  /** derived deferred = supportable registry set minus supported */
  deferred: string[];
}

export type LoadErrorCode =
  | "schema" | "position-mismatch" | "unknown-construct" | "folded-construct"
  | "duplicate-rule" | "template-param" | "pattern-param"
  | "unsupported-ruled"    // a rule's construct is missing from supported
  | "engine-deferred-supported"; // supported lists an engine-deferred construct

export interface LoadError {
  code: LoadErrorCode;
  message: string;
  pointer?: string;
  ruleIds?: string[];
}

/** load warnings (non-fatal): inputs to the verify-and-repair loop */
export interface LoadWarning {
  code: "ambiguity" | "supported-unruled";
  message: string;
  ruleIds?: string[];
  conflict?: string;
  construct?: string;
}

export type LoadResult =
  | { ok: true; compiled: CompiledProfile; warnings: LoadWarning[] }
  | { ok: false; errors: LoadError[] };

// ---------------------------------------------------------------- construct patterns

/** first pattern token is the construct name; placeholders are scanned over the whole pattern (bracket structure is documentary, order-insensitive) */
export function parsePattern(pattern: string): { construct: string; params: string[] } {
  const construct = pattern.trim().split(/[\s[]/, 1)[0];
  const params = [...pattern.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]);
  return { construct, params };
}

// ---------------------------------------------------------------- template tokenization (for the ambiguity check)

export type TemplateToken =
  | { kind: "lit"; text: string; cls: "cmd" | "name" | "num" | "punct" }
  | { kind: "wild"; param: string; cls: ParamClass };

const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/;

export class TemplateParamError extends Error {
  constructor(public param: string) {
    super(`template references unregistered parameter {${param}}`);
  }
}

export function tokenizeTemplate(
  template: string,
  legalParams: Record<string, ParamClass>,
): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let rest = template;
  while (rest.length > 0) {
    const m = PLACEHOLDER_RE.exec(rest);
    const litPart = m ? rest.slice(0, m.index) : rest;
    for (const t of tokenizeLiteral(litPart)) tokens.push(t);
    if (!m) break;
    const name = m[1];
    const cls = legalParams[name] ?? UNIVERSAL_PARAMS[name];
    if (cls === undefined) throw new TemplateParamError(name);
    tokens.push({ kind: "wild", param: name, cls });
    rest = rest.slice(m.index + m[0].length);
  }
  return tokens;
}

/**
 * Shared lexer (used by both templates and reverse text input so tokenization agrees):
 * LaTeX command | quoted string | prefixed name (incl. leading-colon :local form)
 * | name | integer | single char. Dots are not name characters, so ":year.test"
 * splits into [:year][.][test].
 */
export const LIT_RE = /\\[A-Za-z]+|"[^"]*"|[A-Za-z_][A-Za-z0-9_-]*(?::[A-Za-z0-9_-]+)?|:[A-Za-z0-9_-]+|\d+|\S/g;

function tokenizeLiteral(text: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  for (const m of text.matchAll(LIT_RE)) {
    const s = m[0];
    const cls = s.startsWith("\\") ? "cmd" : /^\d+$/.test(s) ? "num" : /^[A-Za-z_:"]/.test(s) ? "name" : "punct";
    out.push({ kind: "lit", text: s, cls });
  }
  return out;
}

// ---------------------------------------------------------------- ambiguity check (product automaton)

type Edge = { label: TemplateToken; to: number };
interface Nfa { edges: Edge[][]; accept: number }

function buildNfa(tokens: TemplateToken[]): Nfa {
  const edges: Edge[][] = [[]];
  let cur = 0;
  const pushState = () => { edges.push([]); return edges.length - 1; };
  for (const tok of tokens) {
    if (tok.kind === "wild" && (tok.cls === "list" || tok.cls === "formulaList")) {
      const elemCls: ParamClass = tok.cls === "list" ? "term" : "formula";
      const s1 = pushState();
      edges[cur].push({ label: { kind: "wild", param: tok.param, cls: elemCls }, to: s1 });
      const s2 = pushState();
      edges[s1].push({ label: { kind: "lit", text: ",", cls: "punct" }, to: s2 });
      edges[s2].push({ label: { kind: "wild", param: tok.param, cls: elemCls }, to: s1 });
      cur = s1;
    } else {
      const next = pushState();
      edges[cur].push({ label: tok, to: next });
      cur = next;
    }
  }
  return { edges, accept: cur };
}

const CLASS_REP: Record<string, string> = {
  iri: "ex:p", term: "ex:c", literal: "0", int: "1", formula: "\\top",
};

function wildOverlap(a: ParamClass, b: ParamClass): string | null {
  if (a === b) return CLASS_REP[a] ?? "\\top";
  const pair = new Set([a, b]);
  const has = (x: ParamClass, y: ParamClass) => pair.has(x) && pair.has(y);
  if (has("iri", "term")) return "ex:p";
  if (has("literal", "term")) return "0";
  if (has("int", "literal")) return "1";
  if (has("int", "term")) return "1";
  return null;
}

function litInClass(tok: Extract<TemplateToken, { kind: "lit" }>, cls: ParamClass): string | null {
  switch (cls) {
    case "int": return tok.cls === "num" ? tok.text : null;
    case "literal": return tok.cls === "num" ? tok.text : null;
    case "iri": return tok.cls === "name" ? tok.text : null;
    case "term": return tok.cls === "name" || tok.cls === "num" ? tok.text : null;
    case "formula": return tok.cls === "cmd" && (tok.text === "\\top" || tok.text === "\\bot") ? tok.text : null;
    default: return null;
  }
}

function unify(a: TemplateToken, b: TemplateToken): string | null {
  if (a.kind === "lit" && b.kind === "lit") return a.text === b.text ? a.text : null;
  if (a.kind === "lit" && b.kind === "wild") return litInClass(a, b.cls);
  if (b.kind === "lit" && a.kind === "wild") return litInClass(b, a.cls);
  if (a.kind === "wild" && b.kind === "wild") return wildOverlap(a.cls, b.cls);
  return null;
}

export function shortestCommonString(ta: TemplateToken[], tb: TemplateToken[]): string | null {
  const A = buildNfa(ta);
  const B = buildNfa(tb);
  const key = (i: number, j: number) => i * (B.edges.length + 1) + j;
  const seen = new Set<number>([key(0, 0)]);
  const queue: { i: number; j: number; path: string[] }[] = [{ i: 0, j: 0, path: [] }];
  while (queue.length > 0) {
    const { i, j, path } = queue.shift()!;
    if (i === A.accept && j === B.accept && path.length > 0) return path.join(" ");
    for (const ea of A.edges[i]) {
      for (const eb of B.edges[j]) {
        const rep = unify(ea.label, eb.label);
        if (rep === null) continue;
        const k = key(ea.to, eb.to);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ i: ea.to, j: eb.to, path: [...path, rep] });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- main loading flow

export function loadProfile(input: unknown): LoadResult {
  const errors: LoadError[] = [];
  const doc = structuredClone(input) as Record<string, unknown>;

  // 1. construct pattern parsing + position injection (registry gaps surface via ajv's required)
  const rawRules = Array.isArray(doc.rules) ? (doc.rules as Record<string, unknown>[]) : [];
  for (const rule of rawRules) {
    if (typeof rule !== "object" || rule === null || typeof rule.construct !== "string") continue;
    const { construct } = parsePattern(rule.construct);
    const derived = derivePosition(construct);
    if (derived === undefined) continue;
    if (rule.position !== undefined && rule.position !== derived) {
      errors.push({
        code: "position-mismatch",
        ruleIds: [String(rule.id ?? rule.construct)],
        message: `rule "${String(rule.id ?? rule.construct)}": explicit position "${String(rule.position)}" conflicts with derived "${derived}"`,
      });
    }
    rule.position = derived;
  }
  if (errors.length > 0) return { ok: false, errors };

  // 2. ajv
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(profileSchema);
  if (!validate(doc)) {
    for (const e of (validate.errors ?? []) as ErrorObject[]) {
      errors.push({
        code: "schema",
        pointer: e.instancePath || "/",
        message: `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
      });
    }
    return { ok: false, errors };
  }
  const profile = doc as unknown as Profile;
  const supported = new Set(profile.coverage.supported);

  // 3. rule compilation: construct legality, pattern/template placeholder legality, id derivation, reverse-lookup uniqueness
  const compiledRules: CompiledRule[] = [];
  const byConstruct = new Map<string, CompiledRule>();
  const tokenized = new Map<string, TemplateToken[]>();
  for (const rule of profile.rules) {
    const { construct, params: patternParams } = parsePattern(rule.construct);
    const id = rule.id ?? construct;
    const entry = lookupConstruct(construct);
    if (entry === undefined) {
      errors.push({ code: "unknown-construct", ruleIds: [id],
        message: `rule "${id}": construct ${construct} is not in the engine registry` });
      continue;
    }
    if (entry.foldedInto !== undefined) {
      errors.push({ code: "folded-construct", ruleIds: [id],
        message: `rule "${id}": ${construct} is a parameter of ${entry.foldedInto} and cannot carry its own rule` });
      continue;
    }
    if (entry.engineDeferred !== undefined) {
      errors.push({ code: "unknown-construct", ruleIds: [id],
        message: `rule "${id}": ${construct} is engine-deferred (${entry.engineDeferred})` });
      continue;
    }
    if (entry.internal !== true && !supported.has(construct)) {
      errors.push({ code: "unsupported-ruled", ruleIds: [id],
        message: `rule "${id}": construct ${construct} has a rule but is missing from coverage.supported (S4: omissions must fail toward rejection, so add it or drop the rule)` });
      continue;
    }
    for (const p of patternParams) {
      if (entry.params[p] === undefined && UNIVERSAL_PARAMS[p] === undefined) {
        errors.push({ code: "pattern-param", ruleIds: [id],
          message: `rule "${id}": construct pattern binds {${p}} which is not a registered parameter of ${construct}` });
      }
    }
    const legal = { ...entry.params, ...(entry.contextParams ?? {}) };
    try {
      tokenized.set(id, tokenizeTemplate(rule.template, legal));
    } catch (err) {
      if (err instanceof TemplateParamError) {
        errors.push({ code: "template-param", ruleIds: [id],
          message: `rule "${id}" (${construct}): {${err.param}} is not a registered or contextual parameter of ${construct}` });
      } else throw err;
    }
    if (byConstruct.has(construct)) {
      errors.push({ code: "duplicate-rule", ruleIds: [byConstruct.get(construct)!.id, id],
        message: `construct ${construct} has two rules ("${byConstruct.get(construct)!.id}", "${id}"); reverse lookup requires one rule per construct` });
      continue;
    }
    const compiled: CompiledRule = {
      id, construct, pattern: rule.construct, patternParams,
      position: rule.position, template: rule.template, source: rule.source,
    };
    compiledRules.push(compiled);
    byConstruct.set(construct, compiled);
  }

  // 4. supported consistency: engine-deferred constructs must not enter supported
  for (const c of supported) {
    const entry = lookupConstruct(c);
    if (entry?.engineDeferred !== undefined) {
      errors.push({ code: "engine-deferred-supported",
        message: `coverage.supported lists ${c}, but it is engine-deferred (${entry.engineDeferred})` });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // 5. warnings (verify-and-repair loop inputs):
  const warnings: LoadWarning[] = [];
  //    5a. supported but unruled with no ruled host: forward translation would fail
  const ruled = new Set(compiledRules.map((r) => r.construct));
  const RULE_FALLBACKS: Record<string, string[]> = {
    // sh:not is eliminated by the nnf plugin; the internal not-atomic rule takes over rendering
    "sh:not": ["not-atomic"],
  };
  for (const c of coreConstructs()) {
    if (!supported.has(c) || ruled.has(c)) continue;
    const fallback = (RULE_FALLBACKS[c] ?? []).some((f) => ruled.has(f));
    if (!fallback) {
      warnings.push({ code: "supported-unruled", construct: c,
        message: `construct ${c} is in coverage.supported but has no rule (and no plugin-target rule); forward translation of it will fail` });
    }
  }
  //    5b. ambiguity: pairwise comparison per position domain
  const byPosition = new Map<Position, CompiledRule[]>();
  for (const rule of compiledRules) {
    const list = byPosition.get(rule.position) ?? [];
    list.push(rule);
    byPosition.set(rule.position, list);
  }
  for (const [position, domainRules] of byPosition) {
    for (let i = 0; i < domainRules.length; i++) {
      for (let j = i + 1; j < domainRules.length; j++) {
        const a = domainRules[i];
        const b = domainRules[j];
        const witness = shortestCommonString(tokenized.get(a.id)!, tokenized.get(b.id)!);
        if (witness !== null) {
          warnings.push({ code: "ambiguity", ruleIds: [a.id, b.id], conflict: witness,
            message: `position "${position}": rules "${a.id}" (${a.construct}) and "${b.id}" (${b.construct}) both recognize "${witness}"; forward output of these constructs is ambiguous to the reader` });
        }
      }
    }
  }

  const deferred = coreConstructs().filter((c) => !supported.has(c));
  return {
    ok: true,
    compiled: { profile, rules: compiledRules, byConstruct, supported, deferred },
    warnings,
  };
}

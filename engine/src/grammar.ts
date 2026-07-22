/**
 * Templates -> menu grammar (reverse translation).
 * One production per rule; slots derive from template placeholders in order of
 * appearance. Drives the webapp's cascading dropdown menus (depth cap and the
 * text fallback beyond it live in the webapp layer).
 */
import { tokenizeTemplate, LIT_RE, type CompiledProfile, type TemplateToken } from "./profile.js";
import { lookupConstruct, UNIVERSAL_PARAMS, type ParamClass, type Position } from "./registry.js";
import type { FNode } from "./types.js";

export interface Slot {
  name: string;
  cls: ParamClass;
  /** input: parameter text box; formula: nested subformula menu; formulaList: growable subformula list */
  widget: "input" | "formula" | "formulaList";
}

export interface Production {
  ruleId: string;
  construct: string;
  /** menu display: the raw template (rendered with KaTeX) */
  display: string;
  source: string;
  slots: Slot[];
  /** binary fold rule: menus allow 2..n subformulas, left-folded */
  foldable: boolean;
}

export type Grammar = Record<Position, Production[]>;

export function deriveGrammar(compiled: CompiledProfile): Grammar {
  const grammar: Grammar = { target: [], constraint: [], wrapper: [] };
  for (const rule of compiled.rules) {
    const entry = lookupConstruct(rule.construct)!;
    const legal: Record<string, ParamClass> = { ...entry.params, ...(entry.contextParams ?? {}), ...UNIVERSAL_PARAMS };
    const slots: Slot[] = [];
    const seen = new Set<string>();
    const bodyCount = [...rule.template.matchAll(/\{body\}/g)].length;
    for (const m of rule.template.matchAll(/\{([A-Za-z]+)\}/g)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const cls = legal[name];
      slots.push({
        name, cls,
        widget: cls === "formula" ? "formula" : cls === "formulaList" ? "formulaList" : "input",
      });
    }
    grammar[rule.position].push({
      ruleId: rule.id,
      construct: rule.construct,
      display: rule.template,
      source: rule.source,
      slots,
      foldable: bodyCount === 2,
    });
  }
  return grammar;
}

// ---------------------------------------------------------------- textual formula parsing (fallback beyond the menu depth cap)

/** common paper Unicode symbols -> LaTeX commands (tolerates copy-paste from the PDF) */
const UNICODE_MAP: [RegExp, string][] = [
  [/∀/g, " \\forall "], [/∧/g, " \\wedge "], [/∨/g, " \\vee "],
  [/¬/g, " \\neg "], [/≥/g, " \\geq"], [/≤/g, " \\leq"],
  [/⊤/g, " \\top "], [/⊥/g, " \\bot "], [/#/g, " \\# "],
];

interface InputToken { text: string; cls: "cmd" | "name" | "num" | "punct" }

function lexInput(text: string): InputToken[] {
  let s = text;
  for (const [re, rep] of UNICODE_MAP) s = s.replace(re, rep);
  // isolate the subscript marker as its own token (input "\geq_1" vs template "\geq" "_" {n})
  s = s.replace(/_/g, " _ ");
  const out: InputToken[] = [];
  for (const m of s.matchAll(LIT_RE)) {
    const t = m[0];
    // template subscript brace convention (\geq_{1}): braces carry no parsing meaning, skip
    if (t === "{" || t === "}") continue;
    const cls = t.startsWith("\\") ? "cmd" : /^\d+$/.test(t) ? "num" : /^[A-Za-z_:"]/.test(t) ? "name" : "punct";
    out.push({ text: t, cls: cls as InputToken["cls"] });
  }
  return out;
}

function tokenFits(tok: InputToken, cls: ParamClass): boolean {
  switch (cls) {
    case "int": return tok.cls === "num";
    case "literal": return tok.cls === "num" || tok.cls === "name";
    case "iri": return tok.cls === "name";
    case "term": return tok.cls === "name" || tok.cls === "num";
    default: return false;
  }
}

export class NotationParseError extends Error {}

interface PartialParse { node: FNode; next: number }

/**
 * Parse a textual formula with the template-derived grammar -> FNode.
 * Handles: left-recursive infix templates (starting with {body}, e.g.
 * {body} ∧ {body}) via primary-then-infix-extension parsing; parenthesized
 * groups; scalar wildcards matching one token; {L} matching comma-separated tokens.
 */
export function parseNotation(compiled: CompiledProfile, text: string): FNode {
  const tokens = lexInput(text);
  if (tokens.length === 0) throw new NotationParseError("empty formula");
  const rules = compiled.rules.filter((r) => r.position === "constraint" || r.position === "wrapper");
  const templates = new Map<string, TemplateToken[]>();
  for (const r of rules) {
    const entry = lookupConstruct(r.construct)!;
    templates.set(r.id, tokenizeTemplate(r.template, { ...entry.params, ...(entry.contextParams ?? {}), ...UNIVERSAL_PARAMS }));
  }
  const primaries = rules.filter((r) => {
    const t = templates.get(r.id)!;
    return !(t[0]?.kind === "wild" && (t[0].cls === "formula" || t[0].cls === "formulaList"));
  });
  const infixes = rules.filter((r) => !primaries.includes(r));

  /** match remaining template tokens from i (start at index 1 when the infix left side is already consumed) */
  function matchTemplate(
    ruleId: string, tmpl: TemplateToken[], ti: number, i: number,
    params: Record<string, string>, children: FNode[],
  ): PartialParse[] {
    if (ti === tmpl.length) {
      return [{ node: { ruleId, params: { ...params }, children: [...children] }, next: i }];
    }
    const tok = tmpl[ti];
    if (tok.kind === "lit") {
      if (i < tokens.length && tokens[i].text === tok.text) {
        return matchTemplate(ruleId, tmpl, ti + 1, i + 1, params, children);
      }
      return [];
    }
    if (tok.cls === "formula") {
      const out: PartialParse[] = [];
      for (const sub of parseFormula(i)) {
        out.push(...matchTemplate(ruleId, tmpl, ti + 1, sub.next, params, [...children, sub.node]));
      }
      return out;
    }
    if (tok.cls === "formulaList") {
      // comma-separated subformula list
      const out: PartialParse[] = [];
      const walk = (from: number, acc: FNode[]): void => {
        for (const sub of parseFormula(from)) {
          const acc2 = [...acc, sub.node];
          out.push(...matchTemplate(ruleId, tmpl, ti + 1, sub.next, params, [...children, ...acc2]));
          if (tokens[sub.next]?.text === ",") walk(sub.next + 1, acc2);
        }
      };
      walk(i, []);
      return out;
    }
    if (tok.cls === "list") {
      const out: PartialParse[] = [];
      const items: string[] = [];
      let j = i;
      while (j < tokens.length && tokenFits(tokens[j], "term")) {
        items.push(tokens[j].text);
        j += 1;
        out.push(...matchTemplate(ruleId, tmpl, ti + 1, j,
          { ...params, [tok.param]: items.join(", ") }, children));
        if (tokens[j]?.text === ",") j += 1;
        else break;
      }
      return out;
    }
    // scalar wildcard: one token
    if (i < tokens.length && tokenFits(tokens[i], tok.cls)) {
      return matchTemplate(ruleId, tmpl, ti + 1, i + 1,
        { ...params, [tok.param]: tokens[i].text }, children);
    }
    return [];
  }

  const depthGuard: number[] = [];
  function parseFormula(i: number): PartialParse[] {
    if (depthGuard.length > 64) throw new NotationParseError("formula nests too deeply");
    depthGuard.push(i);
    try {
      const bases: PartialParse[] = [];
      // parenthesized group
      if (tokens[i]?.text === "(") {
        for (const inner of parseFormula(i + 1)) {
          if (tokens[inner.next]?.text === ")") bases.push({ node: inner.node, next: inner.next + 1 });
        }
      }
      for (const r of primaries) {
        bases.push(...matchTemplate(r.id, templates.get(r.id)!, 0, i, {}, []));
      }
      // infix extension (left-associative): after each base, try the remainder of every left-recursive template
      const results: PartialParse[] = [];
      const extend = (p: PartialParse): void => {
        results.push(p);
        for (const r of infixes) {
          const tmpl = templates.get(r.id)!;
          for (const ext of matchTemplate(r.id, tmpl, 1, p.next, {}, [p.node])) {
            extend(ext);
          }
        }
      };
      for (const b of bases) extend(b);
      return results;
    } finally {
      depthGuard.pop();
    }
  }

  const all = parseFormula(0);
  const complete = all.filter((p) => p.next === tokens.length);
  if (complete.length === 0) {
    const best = all.reduce((a, b) => (b.next > a ? b.next : a), 0);
    throw new NotationParseError(
      `cannot parse formula; matched up to token ${best} ("${tokens.slice(0, best).map((t) => t.text).join(" ")}")`);
  }
  return complete[0].node;
}

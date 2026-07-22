/**
 * Forward translation, steps 3 and 4: ShapeTree -> FNode -> LaTeX string + src map.
 * Rules apply bottom-up by construct; multiple constraints of one shape join via
 * composition; targets become separate formulas. Constraints whose templates carry
 * their own path (contextual {p}) are not wrapped by the property-shape rule's
 * forall; value constraints are. Constructs outside supported -> UnsupportedConstruct.
 */
import type { CompiledProfile, CompiledRule } from "./profile.js";
import { lookupConstruct } from "./registry.js";
import {
  type NodeShape, type Constraint, type PropertyShape, type FNode, type Term,
  type Param, type Prefixes, type Src, displayTerm, UnsupportedConstruct,
} from "./types.js";

export interface RenderedFormula {
  latex: string;
  root: FNode;
  /** subexpression span <-> Turtle line (mutual highlighting) */
  spans: { start: number; end: number; line: number }[];
}

export interface ShapeTranslation {
  shapeIri?: string;
  targets: RenderedFormula[];
  /** combined constraint formula; undefined for a shape with no constraints */
  constraint?: RenderedFormula;
}

interface Ctx {
  compiled: CompiledProfile;
  prefixes: Prefixes;
  /** annotated rendering: wrap every subformula in \htmlData{line=..,rule=..}{..} (webapp highlight/tooltip anchors) */
  annotate?: boolean;
  /** the enclosing property shape's path (contextual placeholder {p}) */
  path?: Term;
}

function ruleFor(ctx: Ctx, construct: string): CompiledRule {
  const rule = ctx.compiled.byConstruct.get(construct);
  if (rule !== undefined) return rule;
  const entry = lookupConstruct(construct);
  if (entry?.engineDeferred !== undefined) {
    throw new UnsupportedConstruct(construct, "engine", entry.engineDeferred);
  }
  // no rule: reject either way; reason distinguishes paper-side from the supported-but-unruled warning state
  throw new UnsupportedConstruct(construct, "paper",
    ctx.compiled.supported.has(construct)
      ? "listed as supported but no rule renders it"
      : "the paper does not formalize this construct");
}

const display = (ctx: Ctx, p: Param): string =>
  Array.isArray(p)
    ? p.map((t) => displayTerm(t, ctx.prefixes)).join(", ")
    : displayTerm(p, ctx.prefixes);

/** constraint node -> FNode */
function toFNode(ctx: Ctx, c: Constraint): FNode {
  switch (c.kind) {
    case "atomic": {
      const rule = ruleFor(ctx, c.construct);
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.params)) params[k] = display(ctx, v);
      if (ctx.path !== undefined) params.p ??= display(ctx, ctx.path);
      const children = (c.children ?? []).length > 0
        ? [composeFNode(ctx, c.children!, "node-shape", c.src)]
        : [];
      return { ruleId: rule.id, params, children, src: c.src };
    }
    case "property": {
      return propertyToFNode(ctx, c);
    }
    case "not-atomic": {
      const rule = ruleFor(ctx, "not-atomic");
      return { ruleId: rule.id, params: {}, children: [toFNode(ctx, c.child)], src: c.src };
    }
    case "and": case "or": case "xone": {
      const rule = ruleFor(ctx, `sh:${c.kind}`);
      return { ruleId: rule.id, params: {}, children: c.children.map((ch) => toFNode(ctx, ch)), src: c.src };
    }
    case "not": {
      const rule = ruleFor(ctx, "sh:not");
      return { ruleId: rule.id, params: {}, children: c.children.map((ch) => toFNode(ctx, ch)), src: c.src };
    }
  }
}

/**
 * Constraints that carry their own path are not wrapped by the property-shape rule.
 * The criterion derives from the template: referencing contextual {p} means the
 * construct carries its own path (in Definition 2.4, #m_n p.phi, eq(p,p'),
 * uniqueLang(p) etc. are top-level productions carrying their path; only
 * "remaining property-level constraints" fall under forall p.phi').
 * Found by the verify-and-repair loop (step 4, 2026-07-22): the earlier hardcoded
 * counting-only list missed the pair constraints, composing duplicated-path
 * formulas like forall :p.eq(:p,:q).
 */
function carriesOwnPath(ctx: Ctx, c: Constraint): boolean {
  if (c.kind !== "atomic") return false;
  const rule = ctx.compiled.byConstruct.get(c.construct);
  return rule !== undefined && rule.template.includes("{p}");
}

function propertyToFNode(ctx: Ctx, ps: PropertyShape): FNode {
  const inner: Ctx = { ...ctx, path: ps.path };
  const standalone = ps.constraints.filter((c) => carriesOwnPath(ctx, c)).map((c) => toFNode(inner, c));
  const wrapped = ps.constraints.filter((c) => !carriesOwnPath(ctx, c));

  const parts: FNode[] = [...standalone];
  if (wrapped.length > 0) {
    const rule = ruleFor(ctx, "sh:property");
    const body = composeFNode(inner, wrapped, "property-shape", ps.src);
    parts.push({
      ruleId: rule.id,
      params: { p: display(ctx, ps.path) },
      children: [body],
      src: ps.src,
    });
  }
  if (parts.length === 0) {
    throw new UnsupportedConstruct("sh:property", "paper", "empty property shape has no notation");
  }
  return parts.length === 1 ? parts[0] : compositionNode(ctx, parts, "node-shape", ps.src);
}

/** implicit conjunction: multiple constraints join via composition (connective overridable by context) */
function composeFNode(ctx: Ctx, cs: Constraint[], context: "node-shape" | "property-shape", src: Src): FNode {
  const nodes = cs.map((c) => toFNode(ctx, c));
  return nodes.length === 1 ? nodes[0] : compositionNode(ctx, nodes, context, src);
}

/** internal composition node: reserved ruleId $composition */
function compositionNode(ctx: Ctx, children: FNode[], context: "node-shape" | "property-shape", src: Src): FNode {
  const connective = ctx.compiled.profile.composition.byContext?.[context]
    ?? ctx.compiled.profile.composition.connective;
  return { ruleId: "$composition", params: { connective }, children, src };
}

// ---------------------------------------------------------------- rendering

class Renderer {
  out = "";
  spans: { start: number; end: number; line: number }[] = [];
  constructor(private ctx: Ctx) {}

  emit(text: string): void { this.out += text; }

  render(node: FNode): void {
    const start = this.out.length;
    const annotated = this.ctx.annotate === true && node.src !== undefined;
    if (annotated) {
      const rule = node.ruleId === "$composition" ? "composition" : node.ruleId;
      this.emit(`\\htmlData{line=${node.src!.line},rule=${rule}}{`);
    }
    if (node.ruleId === "$composition") {
      const conn = node.params.connective;
      node.children.forEach((child, i) => {
        if (i > 0) this.emit(` ${conn} `);
        this.renderChild(node, child);
      });
    } else {
      const rule = this.ctx.compiled.rules.find((r) => r.id === node.ruleId);
      if (rule === undefined) throw new Error(`unknown ruleId ${node.ruleId}`);
      this.renderTemplate(rule, node);
    }
    if (annotated) this.emit("}");
    if (node.src !== undefined) {
      this.spans.push({ start, end: this.out.length, line: node.src.line });
    }
  }

  /**
   * Parenthesize subformulas with a top-level connective (parens=onMixed default).
   * Top-level connective = a $composition node, or an infix rule node (template
   * starting with {body}, e.g. {body} ∧ {body}). Found by the verify-and-repair
   * loop (step 4, 2026-07-22): without parens, forall :p.A ∧ B reads as
   * (forall :p.A) ∧ B under the paper's Example 1 convention, contradicting the
   * intended semantics.
   */
  private renderChild(parent: FNode, child: FNode): void {
    const parens = this.ctx.compiled.profile.composition.parens ?? "onMixed";
    const needs = parens === "always"
      || (parens === "onMixed" && (child.ruleId === "$composition" || this.isInfix(child)));
    if (needs) this.emit("(");
    this.render(child);
    if (needs) this.emit(")");
  }

  private isInfix(node: FNode): boolean {
    if (node.children.length < 2) return false;
    const rule = this.ctx.compiled.rules.find((r) => r.id === node.ruleId);
    return rule !== undefined && /^\s*\{body\}/.test(rule.template);
  }

  private renderTemplate(rule: CompiledRule, node: FNode): void {
    const re = /\{([A-Za-z]+)\}/g;
    let last = 0;
    let bodyIndex = 0;
    let m: RegExpExecArray | null;
    // binary fold template ({body} appears twice): left-fold n-ary children (ruling 4)
    const bodySlots = [...rule.template.matchAll(/\{body\}/g)].length;
    const foldNeeded = bodySlots === 2 && node.children.length > 2;
    if (foldNeeded) {
      this.renderFold(rule, node.children);
      return;
    }
    while ((m = re.exec(rule.template)) !== null) {
      this.emit(rule.template.slice(last, m.index));
      last = m.index + m[0].length;
      const name = m[1];
      if (name === "body") {
        const child = node.children[bodyIndex++];
        if (child === undefined) throw new Error(`rule ${rule.id}: missing child for {body}`);
        this.renderChild(node, child);
      } else if (name === "bodies") {
        node.children.forEach((child, i) => {
          if (i > 0) this.emit(", ");
          this.renderChild(node, child);
        });
      } else {
        const v = node.params[name];
        if (v === undefined) throw new Error(`rule ${rule.id}: missing parameter {${name}}`);
        this.emit(v);
      }
    }
    this.emit(rule.template.slice(last));
  }

  private renderFold(rule: CompiledRule, children: FNode[]): void {
    // ((a . b) . c) ...: expand pairwise with copies of the template
    const renderPair = (nodes: FNode[]): void => {
      if (nodes.length === 1) { this.render(nodes[0]); return; }
      const left = nodes.slice(0, -1);
      const right = nodes[nodes.length - 1];
      const re = /\{body\}/g;
      const parts = rule.template.split(re);
      // a binary template has exactly two {body}: parts = [pre, mid, post]
      this.emit(parts[0]);
      if (left.length > 1) this.emit("(");
      renderPair(left);
      if (left.length > 1) this.emit(")");
      this.emit(parts[1]);
      this.render(right);
      this.emit(parts[2]);
    };
    renderPair(children);
  }
}

function renderFormula(ctx: Ctx, root: FNode): RenderedFormula {
  const r = new Renderer(ctx);
  r.render(root);
  return { latex: r.out, root, spans: r.spans };
}

/** forward translation entry: ShapeTree (plugins already run) -> per-shape target and constraint formulas */
export function translateShape(
  compiled: CompiledProfile,
  shape: NodeShape,
  prefixes: Prefixes,
  options?: { annotate?: boolean },
): ShapeTranslation {
  const ctx: Ctx = { compiled, prefixes, annotate: options?.annotate };
  const targets: RenderedFormula[] = [];
  for (const t of shape.targets) {
    const rule = ruleFor(ctx, t.construct);
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.params)) params[k] = display(ctx, v);
    targets.push(renderFormula(ctx, { ruleId: rule.id, params, children: [], src: t.src }));
  }
  const result: ShapeTranslation = { targets };
  if (shape.iri !== undefined) result.shapeIri = shape.iri;
  if (shape.constraints.length > 0) {
    result.constraint = renderFormula(ctx, composeFNode(ctx, shape.constraints, "node-shape", shape.src));
  }
  return result;
}

/** render a menu-built FNode directly to LaTeX (reverse panel live preview; no shape context) */
export function renderFNode(compiled: CompiledProfile, node: FNode): string {
  const ctx: Ctx = { compiled, prefixes: {} };
  const r = new Renderer(ctx);
  r.render(node);
  return r.out;
}

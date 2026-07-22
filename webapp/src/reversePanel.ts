/**
 * Tab 2: Notation -> Shapes.
 * Left pane: cascading dropdown builder (each operator shows its paper source,
 * symmetric with Tab 1's tooltips; binary-fold rules get + add subformula;
 * nesting beyond MAX_DEPTH falls back to text input). Right pane: live preview
 * of the assembled formula (KaTeX) and the corresponding Turtle shape.
 * No data graphs, no validation demo.
 */
import { deriveGrammar, parseNotation, NotationParseError, type Production } from "../../engine/src/grammar";
import { reverseShape } from "../../engine/src/reverse";
import { renderFNode } from "../../engine/src/forward";
import type { FNode } from "../../engine/src/types";
import type { AppData } from "./data";
import { renderLatex } from "./katexRender";
import { underlineSlots, underlineEmptyParam } from "./latex";

const MAX_DEPTH = 4;

interface FormulaSlot { getFNode(): FNode }

export function mountReversePanel(root: HTMLElement, data: AppData): void {
  const grammar = deriveGrammar(data.compiled);
  const constraintProductions = [...grammar.wrapper, ...grammar.constraint];

  root.innerHTML = `
    <div class="split">
      <div class="card">
        <div class="card-head"><span class="card-title">Formula builder</span></div>
        <div class="card-body">
          <p class="section-label">Target declaration τ</p>
          <div id="rv-target"></div>
          <p class="section-label">Constraint formula φ</p>
          <div id="rv-formula"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Live preview</span></div>
        <div class="card-body tight">
          <div id="rv-preview" class="preview-formula"><span class="placeholder">Pick operators on the left to assemble a formula.</span></div>
          <div class="preview-ttl">
            <pre id="rv-output" class="ttl-view"></pre>
          </div>
        </div>
      </div>
    </div>`;

  const targetHost = root.querySelector<HTMLElement>("#rv-target")!;
  const formulaHost = root.querySelector<HTMLElement>("#rv-formula")!;
  const preview = root.querySelector<HTMLElement>("#rv-preview")!;
  const out = root.querySelector<HTMLPreElement>("#rv-output")!;

  const targetBuilder = buildProductionSelect(targetHost, grammar.target, 0, true);
  const formulaBuilder = buildProductionSelect(formulaHost, constraintProductions, 0, true);

  // live preview: recompute on any input/selection change inside the builder
  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);

  function refresh(): void {
    let targetNode: FNode | null = null;
    let constraintNode: FNode | null = null;
    try {
      const t = targetBuilder.getFNode();
      if (t.ruleId !== "") targetNode = t;
    } catch { /* incomplete subtrees do not block the preview */ }
    try {
      const c = formulaBuilder.getFNode();
      if (c.ruleId !== "") constraintNode = c;
    } catch { /* as above */ }

    // formula preview
    preview.innerHTML = "";
    if (targetNode === null && constraintNode === null) {
      preview.innerHTML = `<span class="placeholder">Pick operators on the left to assemble a formula.</span>`;
    } else {
      for (const [label, node] of [["τ", targetNode], ["φ", constraintNode]] as const) {
        if (node === null) continue;
        const row = document.createElement("div");
        row.className = "formula-row";
        row.innerHTML = `<span class="formula-label">${label}</span>`;
        const f = document.createElement("span");
        try {
          renderLatex(f, renderFNode(data.compiled, fillPlaceholders(node)));
        } catch {
          f.textContent = "(incomplete)";
        }
        row.appendChild(f);
        preview.appendChild(row);
      }
    }

    // Turtle preview
    try {
      out.textContent = reverseShape(data.compiled, {
        targets: targetNode !== null ? [targetNode] : [],
        constraint: constraintNode ?? undefined,
        prefixes: { "": "http://example.org/", ex: "http://example.org/" },
      });
    } catch (err) {
      out.textContent = targetNode === null && constraintNode === null
        ? "" : "# shape incomplete: fill in the remaining fields on the left";
    }
  }

  /** give empty parameters a visible placeholder when rendering the preview (underlined slot name) */
  function fillPlaceholders(node: FNode): FNode {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(node.params)) {
      params[k] = v.trim() === "" ? underlineEmptyParam(k) : v;
    }
    return { ...node, params, children: node.children.map(fillPlaceholders) };
  }

  function buildProductionSelect(
    host: HTMLElement,
    productions: Production[],
    depth: number,
    optional: boolean,
  ): FormulaSlot {
    if (depth >= MAX_DEPTH) return buildTextFallback(host);

    const wrap = document.createElement("div");
    wrap.className = "builder";
    host.appendChild(wrap);

    const select = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = optional ? "(none)" : "choose an operator";
    select.appendChild(none);
    for (const p of productions) {
      const opt = document.createElement("option");
      opt.value = p.ruleId;
      opt.textContent = `${p.display}    (${p.construct})`;
      select.appendChild(opt);
    }
    wrap.appendChild(select);

    const detail = document.createElement("div");
    detail.className = "builder-detail";
    wrap.appendChild(detail);

    let current: {
      production: Production;
      inputs: Map<string, HTMLInputElement>;
      children: FormulaSlot[];
      extraChildren: FormulaSlot[];
    } | null = null;

    select.addEventListener("change", (ev) => {
      if (ev.target !== select) return;
      detail.innerHTML = "";
      current = null;
      const p = productions.find((x) => x.ruleId === select.value);
      if (p === undefined) return;

      // source badge (symmetric with Tab 1's tooltips)
      const previewEl = document.createElement("div");
      previewEl.className = "production-preview";
      const rendered = document.createElement("span");
      renderLatex(rendered, underlineSlots(p.display));
      previewEl.appendChild(rendered);
      const src = document.createElement("span");
      src.className = "source-badge";
      src.textContent = `source: ${p.source}`;
      previewEl.appendChild(src);
      detail.appendChild(previewEl);

      const inputs = new Map<string, HTMLInputElement>();
      const children: FormulaSlot[] = [];
      const extraChildren: FormulaSlot[] = [];
      for (const slot of p.slots) {
        if (slot.widget === "input") {
          const label = document.createElement("label");
          label.innerHTML = `<span class="pname">{${slot.name}}</span>`;
          const inp = document.createElement("input");
          inp.placeholder = slot.cls === "int" ? "integer"
            : slot.cls === "list" ? "comma-separated" : slot.cls;
          label.appendChild(inp);
          detail.appendChild(label);
          inputs.set(slot.name, inp);
        } else {
          const sub = document.createElement("div");
          sub.className = "child-slot";
          sub.innerHTML = `<span class="slot-label">{${slot.name}}</span>`;
          detail.appendChild(sub);
          children.push(buildProductionSelect(sub, constraintProductions, depth + 1, false));
        }
      }
      if (p.foldable) {
        const addBtn = document.createElement("button");
        addBtn.className = "btn subtle add-child";
        addBtn.type = "button";
        addBtn.textContent = "+ add subformula";
        addBtn.addEventListener("click", () => {
          const sub = document.createElement("div");
          sub.className = "child-slot";
          detail.insertBefore(sub, addBtn);
          extraChildren.push(buildProductionSelect(sub, constraintProductions, depth + 1, false));
          refresh();
        });
        detail.appendChild(addBtn);
      }
      current = { production: p, inputs, children, extraChildren };
    });

    return {
      getFNode(): FNode {
        if (current === null) return { ruleId: "", params: {}, children: [] };
        const params: Record<string, string> = {};
        for (const [name, inp] of current.inputs) params[name] = inp.value.trim();
        const children = [...current.children, ...current.extraChildren].map((c) => c.getFNode());
        return { ruleId: current.production.ruleId, params, children };
      },
    };
  }

  /** text fallback beyond the depth cap: parse paper notation with the template-derived grammar */
  function buildTextFallback(host: HTMLElement): FormulaSlot {
    const wrap = document.createElement("div");
    wrap.className = "builder text-fallback";
    wrap.innerHTML = `
      <p class="hint">Nesting deeper than ${MAX_DEPTH} levels. Type the subformula instead
      (paper notation or LaTeX commands):</p>`;
    const inp = document.createElement("input");
    inp.placeholder = "e.g. ∀:p.test(minLen(1)) or \\forall :p.test(minLen(1))";
    wrap.appendChild(inp);
    const status = document.createElement("span");
    status.className = "parse-status";
    wrap.appendChild(status);
    host.appendChild(wrap);

    let parsed: FNode | null = null;
    inp.addEventListener("input", () => {
      try {
        parsed = parseNotation(data.compiled, inp.value);
        status.textContent = "✓ parses";
        status.className = "parse-status ok";
      } catch (err) {
        parsed = null;
        status.textContent = err instanceof NotationParseError ? "✗ " + err.message : "✗ cannot parse";
        status.className = "parse-status bad";
      }
    });
    return {
      getFNode(): FNode {
        if (parsed === null) throw new Error("text subformula is empty or unparseable");
        return parsed;
      },
    };
  }
}

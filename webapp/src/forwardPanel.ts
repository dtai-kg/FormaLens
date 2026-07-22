/**
 * Tab 1: Shapes -> Notation.
 * Left pane: Turtle editor (monospace, line-number gutter, Load example);
 * swaps to a line-highlight view after translation. Right pane: KaTeX formulas;
 * the three gates reject in place (gate number, construct, paper/engine origin).
 * Interaction: mutual subexpression <-> source-line highlighting; per-subformula
 * tooltips (construct / template / paper source).
 */
import N3 from "n3";
import SHACLValidator from "rdf-validate-shacl";
import shaclShaclTtl from "../../assets/shacl-shacl.ttl?raw";
import { parseShapes } from "../../engine/src/parse";
import { runPlugins } from "../../engine/src/plugins";
import { translateShape, type ShapeTranslation } from "../../engine/src/forward";
import { UnsupportedConstruct, ParseError } from "../../engine/src/types";
import type { AppData } from "./data";
import { renderLatex } from "./katexRender";

const EXAMPLE = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix : <http://example.org/> .

:ArticleShape a sh:NodeShape ;
  sh:targetClass :Article ;
  sh:property [
    sh:path :year ;
    sh:maxInclusive 2026 ] ;
  sh:property [
    sh:path :title ;
    sh:minCount 1 ] .
`;

let shaclShapesStore: N3.Store | null = null;
function shaclShapes(): N3.Store {
  shaclShapesStore ??= new N3.Store(new N3.Parser().parse(shaclShaclTtl));
  return shaclShapesStore;
}

export function mountForwardPanel(root: HTMLElement, data: AppData): void {
  root.innerHTML = `
    <div class="split">
      <div class="card">
        <div class="card-head">
          <span class="card-title">SHACL shapes (Turtle)</span>
          <span class="btn-row">
            <button id="fw-example" class="btn">Load example</button>
            <button id="fw-run" class="btn primary">Translate</button>
          </span>
        </div>
        <div class="card-body tight">
          <div class="editor" id="fw-editor">
            <div class="editor-gutter" id="fw-gutter">1</div>
            <textarea id="fw-input" spellcheck="false"
              placeholder="Paste a Turtle shapes graph here…"></textarea>
          </div>
          <pre id="fw-mirror" class="ttl-view" hidden></pre>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Paper notation</span></div>
        <div class="card-body tight" id="fw-output">
          <p class="placeholder">Paste shapes on the left and press Translate.</p>
        </div>
      </div>
    </div>`;

  const input = root.querySelector<HTMLTextAreaElement>("#fw-input")!;
  const editor = root.querySelector<HTMLElement>("#fw-editor")!;
  const gutter = root.querySelector<HTMLElement>("#fw-gutter")!;
  const mirror = root.querySelector<HTMLPreElement>("#fw-mirror")!;
  const output = root.querySelector<HTMLDivElement>("#fw-output")!;

  const syncGutter = (): void => {
    const lines = input.value.split("\n").length;
    gutter.textContent = Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1).join("\n");
  };
  // One visual slot swaps between the editable textarea and the line-highlight
  // view: clicking anywhere in the highlight view returns to editing; press
  // Translate again after changes.
  const showEditor = (): void => {
    editor.hidden = false;
    mirror.hidden = true;
    input.focus();
  };
  input.addEventListener("input", syncGutter);
  mirror.addEventListener("click", showEditor);
  root.querySelector("#fw-example")!.addEventListener("click", () => {
    input.value = EXAMPLE;
    syncGutter();
    showEditor();
  });
  root.querySelector("#fw-run")!.addEventListener("click", () => { void translate(); });
  syncGutter();

  async function translate(): Promise<void> {
    output.innerHTML = "";
    const ttl = input.value;

    // Gate 1: n3 parsing (range rejections raised during tree building surface as gate-3 messages)
    let parsed;
    try {
      parsed = await parseShapes(ttl);
    } catch (err) {
      if (err instanceof UnsupportedConstruct) { renderRejection(err); return; }
      gateFail(1, "Turtle parsing failed", err instanceof ParseError && err.line !== undefined
        ? `line ${err.line}: ${err.message}` : String((err as Error).message));
      return;
    }
    if (parsed.shapes.length === 0) {
      gateFail(1, "No node shapes found",
        "The input has no subjects declared as sh:NodeShape and no target declarations.");
      return;
    }

    // Gate 2: SHACL-SHACL well-formedness (W3C recommendation appendix shapes, bundled validator)
    try {
      const dataStore = new N3.Store(new N3.Parser().parse(ttl));
      const report = await new SHACLValidator(shaclShapes()).validate(dataStore);
      if (!report.conforms) {
        const msgs = report.results.slice(0, 8).map((r) =>
          `• ${r.message.map((m) => m.value).join("; ") || (r.sourceConstraintComponent?.value ?? "violation")}`);
        gateFail(2, "Not a well-formed shapes graph (SHACL-SHACL)", msgs.join("\n"));
        return;
      }
    } catch (err) {
      gateFail(2, "Well-formedness check failed to run", String((err as Error).message));
      return;
    }

    // Gate 3: supported range check
    const translations: ShapeTranslation[] = [];
    for (const shape of parsed.shapes) {
      try {
        const normalized = runPlugins(shape, data.plugins);
        translations.push(translateShape(data.compiled, normalized, parsed.prefixes, { annotate: true }));
      } catch (err) {
        if (err instanceof UnsupportedConstruct) { renderRejection(err); return; }
        throw err;
      }
    }

    renderResults(translations, ttl);
    window.dispatchEvent(new CustomEvent("formalens:result", { detail: { ok: true } }));
  }

  function gateFail(gate: number, title: string, detail: string): void {
    window.dispatchEvent(new CustomEvent("formalens:result", { detail: { ok: false } }));
    output.innerHTML = `
      <div class="reject">
        <span class="reject-gate">Gate ${gate} of 3</span>
        <h3>${esc(title)}</h3>
        <pre>${esc(detail)}</pre>
      </div>`;
  }

  function renderRejection(err: UnsupportedConstruct): void {
    window.dispatchEvent(new CustomEvent("formalens:result", { detail: { ok: false } }));
    const label = err.reason === "paper"
      ? "not formalized by the paper" : "not implemented by the translator";
    output.innerHTML = `
      <div class="reject">
        <span class="reject-gate">Gate 3 of 3: ${err.reason}</span>
        <h3>Construct out of supported range</h3>
        <p><span class="construct">${esc(err.construct)}</span> is ${esc(label)}.</p>
        ${err.detail !== undefined ? `<p class="hint">${esc(err.detail)}</p>` : ""}
        <p class="hint">See the Transparency tab for the full construct list.</p>
      </div>`;
  }

  function renderResults(translations: ShapeTranslation[], ttl: string): void {
    // left pane swaps in place to the line-highlight view (click to edit again)
    editor.hidden = true;
    mirror.hidden = false;
    mirror.innerHTML = ttl.split("\n").map((line, i) =>
      `<span class="ttl-line" data-line="${i + 1}"><span class="ln">${i + 1}</span>${esc(line) || " "}</span>`).join("");

    for (const t of translations) {
      const box = document.createElement("div");
      box.className = "shape-block";
      const name = t.shapeIri !== undefined ? shrink(t.shapeIri) : "(anonymous shape)";
      box.innerHTML = `<p class="shape-name">${esc(name)}</p>`;
      for (const target of t.targets) {
        box.appendChild(formulaRow("τ", target.latex));
      }
      if (t.constraint !== undefined) {
        box.appendChild(formulaRow("φ", t.constraint.latex));
      }
      output.appendChild(box);
    }
    wireHighlighting();

    function formulaRow(label: string, latex: string): HTMLElement {
      const row = document.createElement("div");
      row.className = "formula-row";
      row.innerHTML = `<span class="formula-label">${label}</span>`;
      const f = document.createElement("span");
      renderLatex(f, latex);
      row.appendChild(f);
      return row;
    }
    function shrink(iri: string): string {
      const i = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
      return ":" + iri.slice(i + 1);
    }
  }

  function wireHighlighting(): void {
    const tooltip = document.getElementById("tooltip")!;
    const formulaSpans = output.querySelectorAll<HTMLElement>("[data-line]");
    const setLine = (line: string | null): void => {
      mirror.querySelectorAll(".ttl-line").forEach((el) =>
        el.classList.toggle("hl", line !== null && el.getAttribute("data-line") === line));
      formulaSpans.forEach((el) =>
        el.classList.toggle("hl", line !== null && el.getAttribute("data-line") === line));
    };
    formulaSpans.forEach((el) => {
      el.addEventListener("mouseenter", (ev) => {
        ev.stopPropagation();
        setLine(el.getAttribute("data-line"));
        const ruleId = el.getAttribute("data-rule");
        const rule = data.compiled.rules.find((r) => r.id === ruleId);
        if (rule !== undefined) {
          tooltip.innerHTML =
            `<b>${esc(rule.construct)}</b><br><code>${esc(rule.template)}</code><br><span class="tt-src">${esc(rule.source)}</span>`;
          tooltip.hidden = false;
          const rect = el.getBoundingClientRect();
          tooltip.style.left = `${rect.left + window.scrollX}px`;
          tooltip.style.top = `${rect.bottom + window.scrollY + 6}px`;
        }
      });
      el.addEventListener("mouseleave", () => { setLine(null); tooltip.hidden = true; });
    });
    mirror.querySelectorAll<HTMLElement>(".ttl-line").forEach((el) => {
      el.addEventListener("mouseenter", () => setLine(el.getAttribute("data-line")));
      el.addEventListener("mouseleave", () => setLine(null));
    });
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tab 3: Transparency.
 * Rule-by-rule review table, supported positive list, derived deferred split by
 * paper/engine origin, load-warnings section (verify-and-repair inputs with
 * dispositions), version table.
 */
import type { AppData } from "./data";
import { renderLatex } from "./katexRender";
import { underlineSlots } from "./latex";

const REVIEW_LABEL: Record<string, string> = {
  pending: "pending (not yet reviewed)",
  pass: "verified",
  fail: "mismatch",
};

export function mountTransparency(root: HTMLElement, data: AppData): void {
  const { compiled } = data;
  root.innerHTML = `
    <div class="transparency">
      <p class="intro">This page is the reader-facing record of how much to trust the translator.
      Every mapping rule is checked as <i>LLM-as-judge</i>: the compiling agent returns to where the
      paper defines each construct, compares the template against that definition, and must cite the
      passage as the ground for its judgment; a judgment without a supporting quote does not count
      as a pass. The table below records the latest completed review round, including repairs.</p>

      <section>
        <h2>Rule-by-rule review</h2>
        <table id="tp-rules">
          <thead><tr><th>SHACL construct</th><th>Notation template</th><th>Paper source</th><th>Review</th><th>Supporting quote</th></tr></thead>
          <tbody></tbody>
        </table>
      </section>

      <section>
        <h2>Construct coverage</h2>
        <h3>Supported: constructs the paper formalizes (positive list)</h3>
        <p id="tp-supported" class="chip-list"></p>
        <h3>Deferred: everything else, by origin</h3>
        <table id="tp-deferred">
          <thead><tr><th>Construct</th><th>Origin</th><th>Explanation</th></tr></thead>
          <tbody></tbody>
        </table>
      </section>

      <section>
        <h2>Load warnings</h2>
        <p class="note">Ambiguity and supported-unruled warnings feed the verification loop;
        anything still outstanding after it is listed here.</p>
        <table id="tp-warnings">
          <thead><tr><th>Kind</th><th>Detail</th></tr></thead>
          <tbody></tbody>
        </table>
      </section>

      <section>
        <h2>Versions</h2>
        <table id="tp-versions"><tbody></tbody></table>
      </section>
    </div>`;

  // rule-by-rule review table
  const rulesBody = root.querySelector("#tp-rules tbody")!;
  for (const rule of compiled.rules) {
    const review = data.reviews.find((r) => r.ruleId === rule.id);
    const tr = document.createElement("tr");
    const tpl = document.createElement("td");
    const f = document.createElement("span");
    renderLatex(f, underlineSlots(rule.template));
    tpl.appendChild(f);
    tr.innerHTML = `<td><code>${esc(rule.pattern)}</code></td>`;
    tr.appendChild(tpl);
    const quoteParts: string[] = [];
    if (review?.quote !== null && review?.quote !== undefined) quoteParts.push(`"${esc(review.quote)}"`);
    if (review?.fix !== undefined) quoteParts.push(`<span class="fix-note">${esc(review.fix)}</span>`);
    else if (review?.note !== undefined) quoteParts.push(`<span class="fix-note">${esc(review.note)}</span>`);
    tr.insertAdjacentHTML("beforeend",
      `<td>${esc(rule.source)}</td>
       <td class="status-${review?.status ?? "pending"}">${esc(REVIEW_LABEL[review?.status ?? "pending"])}</td>
       <td class="quote">${quoteParts.join("<br>")}</td>`);
    rulesBody.appendChild(tr);
  }

  // supported positive list
  root.querySelector("#tp-supported")!.innerHTML =
    [...compiled.supported].sort().map((c) => `<span class="chip ok">${esc(c)}</span>`).join("");

  // derived deferred: paper section + engine section
  const defBody = root.querySelector("#tp-deferred tbody")!;
  for (const c of compiled.deferred) {
    defBody.insertAdjacentHTML("beforeend",
      `<tr><td><code>${esc(c)}</code></td><td><span class="origin-tag paper">paper</span></td>
       <td>Not formalized by the paper (absent from the supported list).</td></tr>`);
  }
  for (const e of data.engineDeferred) {
    defBody.insertAdjacentHTML("beforeend",
      `<tr><td><code>${esc(e.construct)}</code></td><td><span class="origin-tag engine">engine</span></td>
       <td>${esc(e.detail)}</td></tr>`);
  }

  // warnings table: disposed warnings are resolved and not shown
  const warnBody = root.querySelector("#tp-warnings tbody")!;
  const outstanding = data.warnings.filter((w) =>
    data.warningsDisposed.find((d) =>
      d.code === w.code && JSON.stringify(d.ruleIds ?? null) === JSON.stringify(w.ruleIds ?? null)) === undefined);
  if (outstanding.length === 0) {
    warnBody.insertAdjacentHTML("beforeend",
      `<tr><td colspan="2">No outstanding warnings.</td></tr>`);
  }
  for (const w of outstanding) {
    warnBody.insertAdjacentHTML("beforeend",
      `<tr><td><code>${esc(w.code)}</code></td><td>${esc(w.message)}</td></tr>`);
  }

  // version table
  const verBody = root.querySelector("#tp-versions tbody")!;
  for (const [name, version] of Object.entries(data.versions)) {
    verBody.insertAdjacentHTML("beforeend",
      `<tr><td>${esc(name)}</td><td><code>${esc(version)}</code></td></tr>`);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

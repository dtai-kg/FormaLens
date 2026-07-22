import "./style.css";
import { initData } from "./data";
import { mountForwardPanel } from "./forwardPanel";
import { mountReversePanel } from "./reversePanel";
import { mountTransparency } from "./transparency";

function mountEmptyState(): void {
  document.getElementById("paper-subtitle")!.textContent =
    "understanding SHACL formalization papers";
  document.title = "FormaLens translator template";
  document.querySelector<HTMLElement>(".app-main")!.innerHTML = `
    <div class="card" style="max-width: 44rem; margin: 3rem auto;">
      <div class="card-head"><span class="card-title">No compilation loaded</span></div>
      <div class="card-body">
        <p>This is the FormaLens translator template with an empty compilation
        slot. It becomes a paper-specific translator once a coding agent,
        following <code>skill/SKILL.md</code>, writes
        <code>compilation/profile.json</code> (plus optional
        <code>compilation/plugins/</code> and <code>compilation/review.json</code>)
        and the webpage is rebuilt with <code>npm run build:webapp</code>.</p>
        <p class="hint">See the repository README for the full walkthrough.</p>
      </div>
    </div>`;
}

function mountError(err: Error): void {
  document.querySelector<HTMLElement>(".app-main")!.innerHTML = `
    <div class="reject" style="max-width: 44rem; margin: 3rem auto;">
      <span class="reject-gate">compilation error</span>
      <h3>The compilation slot failed to load</h3>
      <pre>${err.message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
    </div>`;
}

try {
  const data = initData();
  if (data === null) {
    mountEmptyState();
  } else {
    const paperName = data.compiled.profile.meta.paperId?.toUpperCase()
      ?? data.compiled.profile.meta.paperTitle;
    document.getElementById("paper-subtitle")!.textContent =
      "understanding SHACL formalization papers";
    document.title = `FormaLens: ${paperName} notation translator`;

    mountForwardPanel(document.getElementById("tab-forward")!, data);
    mountReversePanel(document.getElementById("tab-reverse")!, data);
    mountTransparency(document.getElementById("tab-transparency")!, data);

    for (const btn of document.querySelectorAll<HTMLButtonElement>(".tabs .tab")) {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tabs .tab").forEach((b) => b.classList.toggle("active", b === btn));
        for (const tab of ["forward", "reverse", "transparency"]) {
          document.getElementById(`tab-${tab}`)!.hidden = tab !== btn.dataset.tab;
        }
      });
    }
  }
} catch (err) {
  mountError(err as Error);
}

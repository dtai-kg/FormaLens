/**
 * FormaLens mascot: a small owl (a nod to OWL, the Web Ontology Language) that
 * perches on the active tab, slides across when you switch tabs, and changes
 * expression per tab. Pure inline SVG + CSS; nothing external, nothing that
 * touches the engine.
 * - forward tab: curious, watching the shapes
 * - reverse tab: a wink, as it helps you build
 * - transparency tab: reading glasses, as it reviews
 * - translation success: a happy hop; gate rejection: a worried tilt
 * - pupils track the cursor; idle breathing + blinking; click to hop
 */

const SVG = `
<svg class="owl-svg" viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="owl-scene">
    <polygon class="owl-tuft" points="34,28 47,9 53,31" />
    <polygon class="owl-tuft" points="86,28 73,9 67,31" />
    <ellipse class="owl-wing" cx="21" cy="80" rx="12" ry="26" />
    <ellipse class="owl-wing" cx="99" cy="80" rx="12" ry="26" />
    <ellipse class="owl-body" cx="60" cy="76" rx="42" ry="50" />
    <ellipse class="owl-belly" cx="60" cy="84" rx="27" ry="37" />
    <g class="owl-eyes">
      <circle class="owl-eye" cx="45" cy="60" r="16" />
      <circle class="owl-eye" cx="75" cy="60" r="16" />
      <g class="owl-pupil"><circle cx="45" cy="60" r="6.5" /></g>
      <g class="owl-pupil"><circle cx="75" cy="60" r="6.5" /></g>
      <ellipse class="owl-lid owl-lid-l" cx="45" cy="60" rx="16.5" ry="16.5" />
      <ellipse class="owl-lid owl-lid-r" cx="75" cy="60" rx="16.5" ry="16.5" />
    </g>
    <g class="owl-glasses">
      <circle cx="45" cy="60" r="18" />
      <circle cx="75" cy="60" r="18" />
      <line x1="61" y1="60" x2="59" y2="60" />
    </g>
    <polygon class="owl-beak" points="60,68 53,76 67,76" />
    <ellipse class="owl-foot" cx="49" cy="123" rx="8" ry="5" />
    <ellipse class="owl-foot" cx="71" cy="123" rx="8" ry="5" />
  </g>
</svg>`;

export type OwlMode = "forward" | "reverse" | "transparency";

export interface Owl {
  perchOn(btn: HTMLElement): void;
  setMode(mode: OwlMode): void;
  react(kind: "happy" | "worried"): void;
}

export function mountOwl(tabs: HTMLElement): Owl {
  const host = document.createElement("div");
  host.className = "owl owl-forward";
  host.innerHTML = `<div class="owl-inner">${SVG}</div>`;
  tabs.appendChild(host);

  const pupils = Array.from(host.querySelectorAll<SVGGElement>(".owl-pupil"));
  let reacting = false;

  window.addEventListener("mousemove", (e) => {
    if (reacting) return;
    const r = host.getBoundingClientRect();
    if (r.width === 0) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.46;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const max = 2.4;
    for (const p of pupils) p.style.transform = `translate(${(dx / d) * max}px, ${(dy / d) * max}px)`;
  });

  function hop(cls: string, ms: number): void {
    host.classList.remove(cls);
    void host.offsetWidth;
    host.classList.add(cls);
    window.setTimeout(() => host.classList.remove(cls), ms);
  }

  function perchOn(btn: HTMLElement): void {
    const left = btn.offsetLeft + btn.offsetWidth / 2 - host.offsetWidth / 2;
    host.style.left = `${left}px`;
    hop("owl-land", 650);
  }

  function setMode(mode: OwlMode): void {
    host.classList.remove("owl-forward", "owl-reverse", "owl-transparency");
    host.classList.add(`owl-${mode}`);
  }

  let resetTimer = 0;
  function react(kind: "happy" | "worried"): void {
    host.classList.remove("owl-happy", "owl-worried");
    void host.offsetWidth;
    host.classList.add(`owl-${kind}`);
    if (kind === "happy") {
      reacting = true;
      for (const p of pupils) p.style.transform = "translateY(-3px)";
    }
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      host.classList.remove("owl-happy", "owl-worried");
      reacting = false;
    }, kind === "worried" ? 1300 : 750);
  }

  host.addEventListener("click", () => react("happy"));
  return { perchOn, setMode, react };
}

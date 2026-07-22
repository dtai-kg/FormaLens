import katex from "katex";
import "katex/dist/katex.min.css";

const OPTS = { trust: true, strict: "ignore" as const, throwOnError: false, output: "html" as const };
const SENT = "ZZHTMLDATAZZ";

/**
 * Annotated LaTeX (with \htmlData) -> DOM.
 * - wrapped in \mathrm so identifiers (test, maxIncl, paths) render upright like
 *   function names rather than italic math variables;
 * - prefixed-name colons (:year, rdf:type) are made ordinary so KaTeX does not
 *   add relation spacing (": year" -> ":year"); colons inside \htmlData rule ids
 *   are protected from that rewrite.
 */
export function renderLatex(el: HTMLElement, latex: string): void {
  if (latex.trim() === "") { katex.render("", el, OPTS); return; }
  const blocks: string[] = [];
  let s = latex.replace(/\\htmlData\{[^}]*\}/g, (m) => `${SENT}${blocks.push(m) - 1}${SENT}`);
  s = s.replace(/:/g, "{:}");
  s = s.replace(new RegExp(SENT + "(\\d+)" + SENT, "g"), (_, i) => blocks[Number(i)]);
  katex.render(`\\mathrm{${s}}`, el, OPTS);
}

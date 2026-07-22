import katex from "katex";
import "katex/dist/katex.min.css";

/** annotated LaTeX (with \htmlData) -> DOM; trust enabled for the data-* anchors */
export function renderLatex(el: HTMLElement, latex: string): void {
  katex.render(latex, el, {
    trust: true,
    strict: "ignore",
    throwOnError: false,
    output: "html",
  });
}

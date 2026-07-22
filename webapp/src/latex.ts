/**
 * Uniform transforms from template placeholders to renderable LaTeX.
 * Replacements must be brace-wrapped: a placeholder may sit in sub/superscript
 * position (e.g. \geq_{n}), and KaTeX rejects a bare function there
 * (_\underline{..} errors, _{\underline{..}} is legal). A regression suite
 * renders every golden template through these transforms to hold the line.
 */

/** menu/transparency display: {n} -> underlined slot name */
export function underlineSlots(template: string): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_, n) => `{\\underline{${n}}}`);
}

/** live preview: empty parameter -> underlined empty slot */
export function underlineEmptyParam(name: string): string {
  return `{\\underline{\\;${name}\\;}}`;
}

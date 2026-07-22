/**
 * Normalization plugin contract.
 * A plugin is a tree->tree pure function; the Translation Engine runs plugins
 * in lexical filename order; compile time and the webpage share the same code.
 * File discovery belongs to the harness/build layer; the engine only receives
 * an ordered array of functions.
 */
import type { NodeShape } from "./types.js";

export type Plugin = (tree: NodeShape) => NodeShape;

export interface NamedPlugin {
  /** filename (without extension); determines execution order */
  name: string;
  fn: Plugin;
}

/** run all plugins in lexical filename order */
export function runPlugins(tree: NodeShape, plugins: NamedPlugin[]): NodeShape {
  const ordered = [...plugins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let current = tree;
  for (const { name, fn } of ordered) {
    const next = fn(current);
    if (next === undefined || next === null || next.kind !== "node") {
      throw new Error(`plugin "${name}" violated the tree->tree contract (returned ${String(next)})`);
    }
    current = next;
  }
  return current;
}

# Normalization plugin contract (plugin-guide.md, draft pending review)

Plugins are **tree->tree pure functions** (TypeScript) the agent may write,
placed under `compilation/plugins/`; the Translation Engine runs them between parsing and
rule application in **lexical filename order**. Compile time and the published
webpage run the same code. Write a plugin only when the paper assumes its
input in a normal form (example: SHACL2RML assumes NNF).

## ShapeTree types (engine/src/types.ts — plugin input and output)

```ts
interface Src { line: number }                    // line numbers travel with nodes; never drop them

interface Term {
  termType: "iri" | "literal" | "blank";
  value: string;                                  // iri: full IRI; literal: lexical form
  datatype?: string;
  lang?: string;
}
type Param = Term | Term[];

interface NodeShape {                             // tree root
  kind: "node";
  iri?: string;
  targets: TargetNode[];
  constraints: Constraint[];
  src: Src;
}
interface TargetNode {
  kind: "target";
  construct: string;                              // sh:targetClass etc.
  params: Record<string, Param>;
  src: Src;
}
interface PropertyShape {
  kind: "property";
  path: Term;                                     // direct predicate IRI
  constraints: Constraint[];
  src: Src;
}
interface Atomic {
  kind: "atomic";
  construct: string;                              // e.g. "sh:maxInclusive"
  params: Record<string, Param>;
  children?: Constraint[];                        // inner constraints of sh:node / qualified
  src: Src;
}
interface Logical {
  kind: "and" | "or" | "xone" | "not";
  children: Constraint[];
  src: Src;
}
interface NotAtomic {                             // nnf product: negation stopped at an atom
  kind: "not-atomic";
  child: Constraint;
  src: Src;
}
type Constraint = Atomic | PropertyShape | Logical | NotAtomic;
```

## Function signature and constraints

```ts
import type { NodeShape } from "../../engine/src/types.js";

export default function myPlugin(tree: NodeShape): NodeShape;
```

Constraints (violations either throw in the engine or produce untrustworthy
translations):

1. **Pure function**: never mutate the input tree (build new nodes with
   spreads), no I/O, no global state, same input same output — compile time
   and the browser must produce byte-identical results;
2. **Preserve treeness**: the return value must still be a legal ShapeTree
   with `kind:"node"`;
3. **Preserve line numbers**: pass the original node's `src` through when
   rewriting (mutual highlighting depends on it);
4. **Only the normal form the paper declares**: do not "optimize" anything the
   paper does not assume.

One default-exported function per file; execution order = lexical filename
order (use prefixes like `10-nnf.ts`, `20-merge.ts` to control ordering when
you need several plugins).

## Reference implementation: nnf (push negation to the atoms)

```ts
/**
 * De Morgan over and/or; double negation cancels; negation on an atom stops as
 * a not-atomic node. The notation side needs a rule for not-atomic (e.g.
 * template "\neg {body}") to take over rendering.
 */
import type { NodeShape, Constraint } from "../../engine/src/types.js";

function push(c: Constraint): Constraint {
  switch (c.kind) {
    case "not":      return negate(push(c.children[0]));
    case "and": case "or": case "xone":
                     return { ...c, children: c.children.map(push) };
    case "property": return { ...c, constraints: c.constraints.map(push) };
    case "atomic":   return c.children !== undefined
                       ? { ...c, children: c.children.map(push) } : c;
    case "not-atomic": return c;
  }
}

function negate(c: Constraint): Constraint {
  switch (c.kind) {
    case "and":        return { kind: "or",  children: c.children.map(negate), src: c.src };
    case "or":         return { kind: "and", children: c.children.map(negate), src: c.src };
    case "not-atomic": return c.child;                       // double negation
    case "not":        return push(c.children[0]);
    default:           return { kind: "not-atomic", child: c, src: c.src };
  }
}

export default function nnf(tree: NodeShape): NodeShape {
  return { ...tree, constraints: tree.constraints.map(push) };
}
```

## Local self-test

```bash
# type check (compilation/plugins/ is covered by the repo tsconfig)
npx tsc --noEmit

# quick behavioral check: parse -> plugin -> forward, eyeball the formula
npx tsx -e '
import { parseShapes } from "./engine/src/parse.js";
import { runPlugins } from "./engine/src/plugins.js";
import myPlugin from "./compilation/plugins/10-my-plugin.js";
const ttl = `...your test shape...`;
const { shapes } = await parseShapes(ttl);
console.dir(runPlugins(shapes[0], [{ name: "10-my-plugin", fn: myPlugin }]), { depth: null });
'

# composition check (same as verify-and-repair step 4): confirm post-plugin formulas match the paper
npm run compose-check
```

Passing standard: the composition check matches the paper's notation, and
mutual highlighting in the webpage still points at the correct source lines.

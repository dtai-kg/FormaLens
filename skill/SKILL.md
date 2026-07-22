# FormaLens compilation task instructions (SKILL.md, draft pending review)

> Audience: a coding agent given the PDF of a paper that defines a formal
> notation for SHACL, tasked with compiling it into an interactive translation
> webpage. You produce exactly two kinds of artifacts: `compilation/profile.json`
> (the Notation Profile) and normalization plugins under `compilation/plugins/`.
> The Translation
> Engine, the JSON Schema, and the webapp template are fixed components: never
> modify them, never work around them.
> The pipeline has six steps: (1) locate and extract, (2) write the Notation
> Profile with a supported positive list, (3) apply the four decision rules,
> (4) plugins, (5) the verify-and-repair loop (LLM-as-judge), (6) assemble the
> webpage. The two hard constraints of step 5 (cross-rule composition checking,
> and "no supporting quote, no pass") must never be weakened.

---

## Step 1: Locate and extract

Read the paper and find where it defines its notation, typically:

- a shape expression grammar (productions of the form `φ ::= …`);
- a target declaration definition;
- a construct coverage table (which SHACL constructs are supported);
- a semantics table in an appendix (when each notation form holds).

For each place record a **locator** (definition / table / section / page
number); these go into each rule's `source` field later. Also record the
paper's writing assumptions (e.g. "all formulas are in negation normal form"):
they decide whether step 4 needs plugins.

## Step 2: Write the Notation Profile

`compilation/profile.json`, constrained by `schema/profile.schema.json`. Fields:

```jsonc
{
  "meta": { "paperTitle": "...", "paperId": "..." },
  "rules": [ { "construct": "...", "template": "...", "source": "..." } ],
  "composition": { "connective": "\\wedge" },       // optional parens, byContext
  "coverage": { "supported": [ "sh:..." ] }
}
```

### rules

Three fields per rule (`id` may be omitted, the loader derives it from the
construct; never write `position`, the loader injects it from the registry):

- **construct**: a SHACL construct pattern, a pseudo-Turtle snippet. The first
  token must be a construct IRI abbreviation from the engine registry;
  placeholders mark parameter binding sites. Examples:
  `"sh:maxInclusive {v}"`, `"sh:property [sh:path {p}; {body}]"`.
  Bracket structure is documentary; matching goes by the first token plus the
  placeholder set.
- **template**: the paper's notation template, sharing placeholders with the
  construct side. Placeholder inventory:
  `{p}` path IRI (a **contextual placeholder**: may appear on the template side
  only, its value comes from the enclosing property shape's sh:path);
  `{v}` literal; `{c}` IRI/constant; `{n}` `{m}` integers;
  `{L}` list (rendered comma-separated; for sh:closed the engine computes `{L}`
  as declared properties plus ignoredProperties); `{body}` one subformula;
  `{bodies}` a subformula list; `{x}` `{y}` fresh variables (for FOL-style
  notations). A template referencing a placeholder not registered for its
  construct fails loading.
- **source**: the locator recorded in step 1, free form.

**Engine composition semantics (two things to know before writing templates):**

1. Multiple constraints of one shape join into one formula via
   `composition.connective`; targets become separate formulas.
2. **A constraint whose template contains `{p}` is treated as carrying its own
   path**: it renders standalone and is not wrapped again by the
   property-shape rule's wrapper template (e.g. `\forall {p}.{body}`). Value
   constraints whose templates lack `{p}` fall into the wrapper. Papers whose
   grammars give counting (`≥ₙp.⊤`) or pair constraints (`eq(p,p′)`) as
   path-carrying productions depend on this. Infix templates (starting with
   `{body}`, e.g. `{body} \wedge {body}`) are parenthesized automatically when
   embedded as subformulas.

### coverage.supported (a positive list; a locked safety design)

List the constructs whose formalization the paper covers. **Anything absent is
rejected.** Omitting a construct fails conservatively (rejection, safe); a
negative list would let omissions pass unreviewed translations through
(dangerous), so omissions must fail toward rejection. The loader enforces two
consistency rules:

- every ruled construct must be in supported (otherwise loading fails, forcing
  you to extend the list or drop the rule);
- supported must not contain engine-deferred constructs (composite paths,
  recursive references, SHACL-SPARQL).

When the paper has a coverage table, register row by row from the table; do
not work from memory.

### Reading the loading output

- **Errors** (loading fails, must fix): schema violations, unknown constructs,
  position conflicts, illegal template parameters, duplicate rules per
  construct, supported inconsistencies.
- **Warnings** (non-fatal, but mandatory inputs to step 5): `ambiguity` (two
  rules in one position domain can produce indistinguishable formulas, with a
  shortest conflict witness); `supported-unruled` (a supported construct that
  no rule renders).

## Step 3: The four decision rules (applicable to any paper)

Standard resolutions for misalignments between the paper's notation and SHACL
constructs. Apply them one by one; **do not invent a fifth**. When none
applies, use "constructs that cannot be faithfully supported" (end of step 5),
or escalate per the decision boundaries below.

1. **The paper lacks a dedicated notation, but its semantics is expressible by
   an idiom the paper uses elsewhere: reuse it and cite the source.**
   Criterion: the paper contains an idiom whose semantics (by the paper's own
   semantic definitions) covers the construct exactly.
   Action: use the idiom as the template; annotate `source` with the idiom's
   location and mark it as a reuse.
   Example: SHACL2RML gives no dedicated notation for sh:class, but the
   Definition 2.3 idiom `≥₁rdf:type.hasValue(c)` applied at the value node is
   exactly its semantics.

2. **The paper's grammar cannot express the construct's semantics: move it out
   of supported, do not invent notation.**
   Criterion: any template would need an operator the grammar does not have
   (e.g. "exactly one branch holds").
   Action: no rule, not in supported; the rejection message automatically
   reports the paper-side origin.
   Example: SHACL2RML's grammar has no exactly-one operator, so sh:xone is
   unsupported.

3. **The paper expresses nested shapes by named reference: inline-expand per
   the paper's semantic equivalence and annotate the surface difference.**
   Criterion: the paper writes named references like `hasShape(s)` and states
   a semantic equivalence like `hasShape(s) ⟺ def(s,H)`.
   Action: use a template of the form `hasShape({body})` with inline
   expansion; annotate `source` with the equivalence relied on and the surface
   difference from the paper (which writes a name). This also covers anonymous
   shapes, which have no name to reference. Reverse translation producing
   inline anonymous structures is the accepted result; no name recovery.

4. **Two rules' templates would be ambiguous in one position domain: keep only
   the paper's general form, do not add sugar.**
   Criterion: the `ambiguity` load warning reports the two rules with a
   shortest conflict witness.
   Action: keep the template the paper marks as the general form (e.g.
   `#ᵐₙ p.φ`) and drop the sugar templates (e.g. `≥ₙ p.φ`), which are
   indistinguishable from other constructs' templates (minCount).
   Caution: identical strings **across** position domains are not ambiguous
   (one `≥₁p.⊤` in the target domain and one in the constraint domain is
   legitimate); do not delete those.

## Decision boundaries: what to decide, what to ask, what never to bypass

> Governing principle: the agent decides **how to write**, but **whether it is
> right** is judged against the paper. Where the paper is clear, the agent
> checks itself against the paper and repairs its own work; where the paper
> itself is ambiguous, the agent stops and hands the ambiguity to the user to
> judge.

This section fixes the agent's autonomy boundaries for compiling **any**
paper, without assuming the user is watching. It prevents both failure modes:
plowing ahead where you should have asked, and pestering the user where you
could have decided.

### Class 1: Decide yourself. Do not ask.

**Criterion**: the decision has an objective ground and needs no human domain
judgment. This covers:

- construct/notation alignments that fit one of the four decision rules of
  step 3;
- mismatches found by the verify-and-repair loop (step 5) that are fixable by
  changing the profile or a plugin;
- pure implementation choices: file organization, naming, Turtle serialization
  style, menu depth thresholds, and the like.

**Action**: do it, and leave the ground in the review record or check report.
Do not interrupt the user.

**Example**: the paper gives no dedicated notation for sh:class but has a
reusable idiom; apply decision rule 1 and reuse it on your own authority, with
the source annotated. No question needed.

### Class 2: Stop and ask, bringing a structured proposal.

**Criterion**: the paper's own semantics is ambiguous or missing, human domain
judgment is required, and none of the four decision rules applies. This
covers:

- the paper admits two defensible readings for some construct;
- the paper's definitions contradict each other, or a passage looks like a
  typo;
- a construct appears in the user's data that the paper never mentions and no
  reusable idiom covers.

**Action**: stop, but never ask empty-handed. The question must contain
exactly these four items (hard requirement):

1. **what the paper says**, quoting the sentence(s) with their location;
2. **the candidate readings** you identified (two or more);
3. **the consequence of each reading** for the translation;
4. **which one you lean toward, and why**.

**Example** (from the SHACL2RML compilation): a sentence sweeps an
existential-semantics construct into the universal fallback (sh:hasValue
falling under the ∀-wrap of "remaining property-level constraints"). This
could be a typo or intentional. The agent stops, quotes that sentence, offers
the two candidates ("typo, should be the existential form ≥₁p.hasValue(c)" /
"intentional, keep the universal form"), states the consequence of each for
translated formulas, adds its own leaning, and asks the user to rule.

### Class 3: Never bypass, even when stuck.

**Criterion**: the change would break a fixed component or relax a promise of
the method. This covers:

- modifying the Translation Engine, the check logic, the JSON Schema, or any
  other fixed component;
- relaxing the "no supporting quote, no pass" standard to make the
  verify-and-repair loop pass;
- forcing a construct the paper does not formalize into supported so it slips
  through.

**Action**: none of these, ever. If a construct cannot be faithfully
supported, move it out of supported per the end of step 5 (conservative
rejection). If the mechanism itself is stuck, stop and report to the user
rather than modifying fixed components to get around it.

**Example**: no template for some construct is faithful to the paper. Move it
out of supported; do not keep a wrong rule, and do not bend the engine to
accommodate it.

## Step 4: Normalization plugins

When the paper assumes its input in a normal form (most commonly negation
normal form), write tree->tree pure-function plugins; the Translation Engine
runs them between parsing and rule application in **lexical filename order**.
Contract, types, reference implementation, and self-test commands are in
`plugin-guide.md`. If the paper assumes no normal form, write no plugins; do
not invent transformations for needs that do not exist.

## Step 5: The verify-and-repair loop (LLM-as-judge)

> Two hard constraints: **sub-step 4 cross-rule composition checking** and
> **sub-step 5 "no supporting quote, no pass"**. Review every rule; no
> sampling.

For every rule r in the profile, do these five sub-steps:

1. **Return to the paper.** Locate the exact place where the paper defines the
   notation for r.construct (a definition, a grammar production, a table row).
   This place should agree with r.source; if r.source points somewhere that
   does not define this construct, that is itself a failure.

2. **Extract the paper's notation facts**, written down item by item as the
   grounds for judgment (each item must be quotable from the text):
   - what the paper's top-level notation form for this construct is (a
     quantifier like ≥ₙ, a predicate like test(...), or something else);
   - where each parameter of the notation comes from (where the path p comes
     from, where the value v comes from, where the count n comes from);
   - whether the construct is wrapped by an outer operator in the paper's
     notation (e.g. under ∀) or is itself top-level.

3. **Compare the template.** Check three things:
   - whether the template's top-level operator matches the paper (the paper
     says ≥ₙ but the template is ∀ over ≥ₙ: mismatch);
   - whether each placeholder matches the paper's parameter sources, checking
     in particular **whether the same parameter is represented twice** (e.g.
     the path p appearing once in this rule and once in the rule it composes
     with, duplicating the path after composition);
   - whether the template introduces operators or structure the paper does not
     have.

4. **Cross-rule consistency check (the critical one).** If r describes a
   constraint that appears inside a property shape (like minCount), check its
   **composition** with the property-shape structural rule: compose the two
   rules the way the engine composes them — executably, build a minimal
   `sh:property [sh:path :p; <the constraint>]` shape and run the real forward
   translation (`npx tsx tools/compose-check.ts` runs exactly this over every
   ruled constraint construct in your profile) — and check
   whether the result equals the paper's notation for "a property shape with
   that constraint". If the paper gives a single `≥ₙp.⊤` but the two rules
   compose to `∀p.≥ₙp.⊤` (duplicated p, an extra ∀), that is a mismatch.

5. **Verdict and grounds.** Give pass / fail. A fail must state: what the
   paper's text says (**quote the sentence**), what the template says, and
   where they conflict. **A judgment without a supporting quote does not
   count — neither as a pass nor as a valid fail; redo that rule.**

**On a fail**: repair the relevant rules in the profile (possibly this rule,
possibly the structural rule it composes with) and rerun the **entire**
review. Dispose of the loading-time ambiguity and supported-unruled warnings
as review inputs in the same pass.

**Termination**: all rules pass with no undisposed warnings -> success; a
round that neither reduces fails nor changes the profile -> stop (anti-spin);
the iteration hard cap (default 10) -> stop and report unresolved items.

**Constructs that cannot be faithfully supported**: if no template is faithful
to the paper (the paper does not formalize the construct, or its grammar
cannot express it), **move it out of supported** instead of keeping a wrong
rule.

**Review record**: for every rule, the final verdict, the paper location and
quote grounding it, and any repair made, written as `compilation/review.json`:

```jsonc
{
  "meta": {
    "date": "...", "iterations": 2,
    "outcome": "...",
    "warningsDisposed": [ { "code": "ambiguity", "ruleIds": ["..."], "disposition": "..." } ]
  },
  "reviews": [
    { "ruleId": "sh:...", "status": "pass" | "fail",
      "paperLoc": "...", "quote": "...", "note": "...", "fix": "..." }
  ]
}
```

It feeds the transparency page at assembly.

## Step 6: Assemble the webpage

1. Your artifacts live in the compilation slot: `compilation/profile.json`,
   `compilation/plugins/` (optional), `compilation/review.json`. The webpage
   discovers the slot at build time; nothing else needs wiring.
2. `npm run build:webapp` produces the single-file
   `webapp/dist/index.html` (self-contained, opens offline, zero model and
   zero network at runtime);
3. Walk through the build: forward panel's three gates, reverse menus, and the
   transparency review table (verdict + grounds complete per rule);
4. The deliverable is that one index.html. These instructions are not
   deliverables.

## Self-test commands

```bash
npx tsc --noEmit                 # type check (covers your compilation/plugins/)
npm run compose-check            # step 5.4 composition check over compilation/profile.json
npm run build:webapp             # single-file build
```

If `npx tsc --noEmit` or the build fails on files you never touched, you have
modified a fixed component; revert (class 3 of the decision boundaries).

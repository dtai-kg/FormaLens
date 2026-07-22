# Verify-and-repair loop instructions (LLM-as-judge)

> Role: the self-check loop the agent runs after writing the Notation Profile;
> the executor of the paper's LLM-as-judge claim.
> This file is the ruled draft of the review chapter of SKILL.md (which now
> embeds it as step 5). Two hard constraints must never be weakened:
> **step 4 cross-rule composition checking** and **step 5 "no supporting
> quote, no pass"**.

## Scope

Every rule in the profile, one by one, **no sampling**.

## Per-rule steps (for one rule r)

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
     the path p appearing once in this rule and once in its composing rule,
     duplicating the path after composition);
   - whether the template introduces operators or structure the paper does not
     have.

4. **Cross-rule consistency check (the critical one).** If r describes a
   constraint that appears inside a property shape (like minCount), check its
   **composition** with the property-shape structural rule: compose the two
   rules the way the engine composes them, and check whether the result equals
   the paper's notation for "a property shape with that constraint". If the
   paper gives a single `≥ₙp.⊤` for "path + minCount" but the two rules
   compose to `∀p.≥ₙp.⊤` (duplicated p, an extra ∀), that is a mismatch.

5. **Verdict and grounds.** Give pass / fail. A fail must state: what the
   paper's text says (**quote the sentence**), what the template says, and
   where they conflict. **A judgment without a supporting quote does not
   count — neither as a pass nor as a valid fail; redo that rule.**

## On a fail

Repair the relevant rules in the profile (possibly this rule, possibly the
structural rule it composes with) and rerun the **entire** review. Dispose of
the loading-time ambiguity and supported-unruled warnings as review inputs in
the same pass.

## Termination

- All rules pass and no warning is undisposed: success.
- A round that neither reduces fails nor changes the profile: stop
  (anti-spin).
- The iteration hard cap is reached: stop and report unresolved items.

## Constructs that cannot be faithfully supported

If no template is faithful to the paper (the paper does not formalize the
construct, or its grammar cannot express it), **move it out of supported**
instead of keeping a wrong rule.

## Review record

For every rule: the final verdict, the paper location grounding it, and any
repair made, written into the transparency page's review table.

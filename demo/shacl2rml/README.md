# Demo: SHACL2RML notation translator

`index.html` is a complete FormaLens output: the SHACL2RML paper
(*Constraint-Guided RDF Construction with Provenance*) compiled into a
bidirectional translator webpage. Open the file directly in a browser; it is
fully self-contained and works offline.

**Shapes → Notation.** Paste a SHACL shapes graph in Turtle (or load the
built-in example). The input passes three gates: Turtle parsing, a
well-formedness check against the W3C SHACL-SHACL shapes, and a range check
against the construct list the paper formalizes. You get the paper's formulas
(τ for targets, φ for constraints); hovering a subexpression highlights the
Turtle lines it came from and cites the definition in the paper it is based
on, and vice versa. Unsupported constructs are rejected by name, stating
whether the paper does not formalize them or the translator does not
implement them.

**Notation → Shapes.** Assemble a formula from cascading menus over the
paper's operators; each operator shows its source in the paper. The
corresponding SHACL shape appears live as you build.

**Transparency.** The compilation is verified rule by rule against the paper
(LLM-as-judge): for every mapping rule the tab shows the verdict, the paper
location, and the quoted passage grounding it, plus the full supported /
deferred construct lists and the versions of everything involved.

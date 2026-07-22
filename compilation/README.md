# Compilation slot

This directory is where a coding agent, following `skill/SKILL.md`, places the
artifacts of compiling one paper:

```
compilation/
├── profile.json     # the Notation Profile (schema/profile.schema.json)
├── plugins/         # normalization plugins (see skill/plugin-guide.md), optional
│   └── 10-nnf.ts
└── review.json      # the verify-and-repair record (structure documented in SKILL.md step 5)
```

`npm run build:webapp` assembles whatever is in this slot into the single-file
translator webpage at `webapp/dist/index.html`. With the slot empty, the built
page shows an instructional empty state.

The slot's contents are gitignored in this repository; commit yours in your
own fork if you want to version them.

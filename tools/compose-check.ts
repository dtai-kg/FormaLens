/**
 * Executable form of verify-and-repair step 4 (cross-rule composition check).
 * For every ruled constraint-domain construct in a Notation Profile, build a
 * minimal `sh:property [sh:path :p; <constraint>]` shape (node-level constructs
 * attach to the node shape directly), run the real parse -> plugins -> forward
 * pipeline, and print the composed formula for comparison against the paper's
 * notation.
 *
 * Usage:
 *   npx tsx tools/compose-check.ts [profile.json] [pluginsDir]
 * Defaults: compilation/profile.json and compilation/plugins/.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProfile } from "../engine/src/profile.js";
import { parseShapes } from "../engine/src/parse.js";
import { runPlugins, type NamedPlugin, type Plugin } from "../engine/src/plugins.js";
import { translateShape } from "../engine/src/forward.js";

const PREFIX = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix : <http://ex.org/> .
`;

/** construct -> minimal constraint snippet inside a property shape (or a complete node-level snippet) */
const FIXTURES: Record<string, { snippet: string; level: "property" | "node" }> = {
  "sh:minInclusive": { snippet: "sh:minInclusive 5", level: "property" },
  "sh:maxInclusive": { snippet: "sh:maxInclusive 5", level: "property" },
  "sh:minExclusive": { snippet: "sh:minExclusive 5", level: "property" },
  "sh:maxExclusive": { snippet: "sh:maxExclusive 5", level: "property" },
  "sh:minLength": { snippet: "sh:minLength 2", level: "property" },
  "sh:maxLength": { snippet: "sh:maxLength 8", level: "property" },
  "sh:pattern": { snippet: 'sh:pattern "^a"', level: "property" },
  "sh:languageIn": { snippet: 'sh:languageIn ( "en" "de" )', level: "property" },
  "sh:datatype": { snippet: "sh:datatype xsd:integer", level: "property" },
  "sh:nodeKind": { snippet: "sh:nodeKind sh:IRI", level: "property" },
  "sh:in": { snippet: "sh:in ( 1 2 )", level: "property" },
  "sh:hasValue": { snippet: "sh:hasValue :c", level: "property" },
  "sh:class": { snippet: "sh:class :C", level: "property" },
  "sh:minCount": { snippet: "sh:minCount 1", level: "property" },
  "sh:maxCount": { snippet: "sh:maxCount 3", level: "property" },
  "sh:qualifiedValueShape": {
    snippet: "sh:qualifiedValueShape [ sh:datatype xsd:string ] ; sh:qualifiedMinCount 1 ; sh:qualifiedMaxCount 3",
    level: "property",
  },
  "sh:equals": { snippet: "sh:equals :q", level: "property" },
  "sh:disjoint": { snippet: "sh:disjoint :q", level: "property" },
  "sh:lessThan": { snippet: "sh:lessThan :q", level: "property" },
  "sh:lessThanOrEquals": { snippet: "sh:lessThanOrEquals :q", level: "property" },
  "sh:uniqueLang": { snippet: "sh:uniqueLang true", level: "property" },
  "sh:and": { snippet: "sh:and ( [ sh:minLength 2 ] [ sh:maxLength 8 ] )", level: "property" },
  "sh:or": { snippet: "sh:or ( [ sh:minLength 2 ] [ sh:maxLength 8 ] )", level: "property" },
  "sh:xone": { snippet: "sh:xone ( [ sh:minLength 2 ] [ sh:maxLength 8 ] )", level: "property" },
  "sh:not": { snippet: "sh:not [ sh:datatype xsd:string ]", level: "property" },
  "not-atomic": { snippet: "sh:not [ sh:datatype xsd:string ]", level: "property" },
  "sh:node": { snippet: "sh:node [ sh:property [ sh:path :name ; sh:minCount 1 ] ]", level: "property" },
  "sh:closed": { snippet: "sh:closed true ; sh:ignoredProperties ( :extra )", level: "node" },
};

const profilePath = resolve(process.argv[2] ?? "compilation/profile.json");
const pluginsDir = resolve(process.argv[3] ?? "compilation/plugins");

const loaded = loadProfile(JSON.parse(readFileSync(profilePath, "utf8")));
if (!loaded.ok) {
  console.error("profile failed to load:");
  for (const e of loaded.errors) console.error("  " + e.message);
  process.exit(2);
}
const compiled = loaded.compiled;

const plugins: NamedPlugin[] = [];
if (existsSync(pluginsDir)) {
  for (const file of readdirSync(pluginsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(resolve(pluginsDir, file)).href) as { default: Plugin };
    plugins.push({ name: file.replace(/\.(ts|js)$/, ""), fn: mod.default });
  }
}

const ruled = compiled.rules
  .filter((r) => r.position === "constraint")
  .map((r) => r.construct);

for (const construct of ruled) {
  const fx = FIXTURES[construct];
  if (fx === undefined) {
    console.log(`${construct.padEnd(24)} (no fixture for this construct; check its composition manually)`);
    continue;
  }
  const ttl = fx.level === "property"
    ? PREFIX + `:S a sh:NodeShape ; sh:targetClass :C ;\n  sh:property [ sh:path :p ; ${fx.snippet} ] .\n`
    : PREFIX + `:S a sh:NodeShape ; sh:targetClass :C ;\n  ${fx.snippet} ;\n  sh:property [ sh:path :p ; sh:minCount 1 ] .\n`;
  try {
    const { shapes, prefixes } = await parseShapes(ttl);
    const t = translateShape(compiled, runPlugins(shapes[0], plugins), prefixes);
    console.log(`${construct.padEnd(24)} ${t.constraint?.latex ?? "(no constraint formula)"}`);
  } catch (err) {
    console.log(`${construct.padEnd(24)} !! ${String((err as Error).message)}`);
  }
}

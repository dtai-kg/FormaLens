/**
 * Webapp data assembly.
 * Everything paper-specific comes from the compilation slot (compilation/):
 * profile.json, plugins/*.ts, review.json, written there by the compiling
 * agent per skill/SKILL.md. The slot is discovered at build time via glob
 * imports; with an empty slot the page renders an instructional empty state.
 */
import { loadProfile, type CompiledProfile, type LoadWarning } from "../../engine/src/profile";
import { REGISTRY } from "../../engine/src/registry";
import type { NamedPlugin, Plugin } from "../../engine/src/plugins";
import pkg from "../../package.json";

const profileModules = import.meta.glob("../../compilation/profile.json", { eager: true });
const reviewModules = import.meta.glob("../../compilation/review.json", { eager: true });
const pluginModules = import.meta.glob("../../compilation/plugins/*.ts", { eager: true });

export interface RuleReview {
  ruleId: string;
  status: "pending" | "pass" | "fail";
  /** paper passage quoted by the LLM-as-judge (hard constraint: no supporting quote, no pass) */
  quote: string | null;
  /** paper location grounding the verdict */
  paperLoc?: string;
  /** note (e.g. ruling background) */
  note?: string;
  /** fail -> fix history when the rule went through a repair round */
  fix?: string;
}

export interface WarningDisposal {
  code: string;
  ruleIds?: string[];
  disposition: string;
}

export interface AppData {
  compiled: CompiledProfile;
  warnings: LoadWarning[];
  warningsDisposed: WarningDisposal[];
  plugins: NamedPlugin[];
  reviews: RuleReview[];
  engineDeferred: { construct: string; detail: string }[];
  versions: Record<string, string>;
}

interface ReviewFile {
  meta?: { warningsDisposed?: WarningDisposal[] };
  reviews?: RuleReview[];
}

/** null = empty compilation slot (the page then shows how to fill it) */
export function initData(): AppData | null {
  const profileModule = Object.values(profileModules)[0] as { default: unknown } | undefined;
  if (profileModule === undefined) return null;

  const result = loadProfile(profileModule.default);
  if (!result.ok) {
    throw new Error("compilation/profile.json failed to load:\n"
      + result.errors.map((e) => e.message).join("\n"));
  }

  const plugins: NamedPlugin[] = Object.entries(pluginModules)
    .map(([path, mod]) => ({
      name: path.split("/").pop()!.replace(/\.ts$/, ""),
      fn: (mod as { default: Plugin }).default,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const reviewFile = (Object.values(reviewModules)[0] as { default: ReviewFile } | undefined)?.default;
  const reviewRecords = reviewFile?.reviews ?? [];

  return {
    compiled: result.compiled,
    warnings: result.warnings,
    warningsDisposed: reviewFile?.meta?.warningsDisposed ?? [],
    plugins,
    reviews: result.compiled.rules.map((r) => {
      const rec = reviewRecords.find((x) => x.ruleId === r.id);
      return rec ?? { ruleId: r.id, status: "pending" as const, quote: null };
    }),
    engineDeferred: REGISTRY
      .filter((e) => e.engineDeferred !== undefined)
      .map((e) => ({ construct: e.construct, detail: e.engineDeferred! })),
    versions: { ...(pkg.dependencies as Record<string, string>) },
  };
}

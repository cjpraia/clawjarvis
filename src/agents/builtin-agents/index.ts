/**
 * Built-in Subagents Index
 *
 * Subagentes nativos do OpenClaw.
 */

export { BUILDER_AGENT } from "./builder.js";
export { RESEARCHER_AGENT } from "./researcher.js";
export { REVIEWER_AGENT } from "./reviewer.js";
export { OPS_AGENT } from "./ops.js";

export const BUILTIN_AGENTS = [
  // Import individual agents
] as const;

/**
 * Get all built-in agents
 */
export async function getBuiltinAgents() {
  // Dynamic import to avoid circular dependencies
  return [
    import("./builder.js").then((m) => m.BUILDER_AGENT),
    import("./researcher.js").then((m) => m.RESEARCHER_AGENT),
    import("./reviewer.js").then((m) => m.REVIEWER_AGENT),
    import("./ops.js").then((m) => m.OPS_AGENT),
  ];
}

/**
 * Find agent by ID
 */
export async function getBuiltinAgentById(id: string) {
  const agents: Record<string, () => Promise<unknown>> = {
    builder: () => import("./builder.js").then((m) => m.BUILDER_AGENT),
    researcher: () => import("./researcher.js").then((m) => m.RESEARCHER_AGENT),
    reviewer: () => import("./reviewer.js").then((m) => m.REVIEWER_AGENT),
    ops: () => import("./ops.js").then((m) => m.OPS_AGENT),
  };

  return agents[id]?.() || null;
}

/**
 * Built-in Subagents Index
 *
 * Subagentes nativos do OpenClaw.
 */

export { BUILDER_AGENT } from "./builder.js";
export { RESEARCHER_AGENT } from "./researcher.js";
export { REVIEWER_AGENT } from "./reviewer.js";
export { OPS_AGENT } from "./ops.js";

/**
 * Built-in agent IDs
 */
export const BUILTIN_AGENT_IDS = ["builder", "researcher", "reviewer", "ops"] as const;

/**
 * Check if agent ID is a built-in
 */
export function isBuiltinAgent(agentId: string): boolean {
  return BUILTIN_AGENT_IDS.includes(agentId as (typeof BUILTIN_AGENT_IDS)[number]);
}

/**
 * Get built-in agent config (sync version)
 */
export function getBuiltinAgentConfig(agentId: string) {
  switch (agentId) {
    case "builder":
      return {
        id: "builder",
        name: "Builder",
        description: "Agente para criar, editar e refatorar código",
        systemPrompt:
          "You are the builder agent of OpenClaw. Your job is to write, edit, and refactor code.",
        tools: ["read", "write", "edit", "bash", "glob", "grep", "exec"],
        triggers: [
          "crie",
          "faça",
          "implemente",
          "refatore",
          "corriga",
          "build",
          "create",
          "fix",
          "code",
          "coding",
        ],
      };
    case "researcher":
      return {
        id: "researcher",
        name: "Researcher",
        description: "Agente para pesquisar e analisar o codebase",
        systemPrompt:
          "You are the researcher agent of OpenClaw. Your job is to explore and understand the codebase.",
        tools: ["read", "glob", "grep", "web_search", "web_fetch"],
        triggers: ["pesquise", "analise", "busque", "investigue", "search", "analyze"],
      };
    case "reviewer":
      return {
        id: "reviewer",
        name: "Reviewer",
        description: "Agente para revisar código e PRs",
        systemPrompt:
          "You are the reviewer agent of OpenClaw. Your job is to review code and provide feedback.",
        tools: ["read", "glob", "grep"],
        triggers: ["revise", "review", "analise código", "verifique", "check", "examine"],
      };
    case "ops":
      return {
        id: "ops",
        name: "Ops",
        description: "Agente para infraestrutura e deploy",
        systemPrompt:
          "You are the ops agent of OpenClaw. Your job is to handle infrastructure and operations.",
        tools: ["read", "write", "bash", "exec"],
        triggers: ["deploy", "configure", "instale", "setup", "start", "restart", "docker", "npm"],
      };
    default:
      return null;
  }
}

/**
 * Built-in Subagents Index
 *
 * Subagentes nativos do OpenClaw.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
 * Tools permitidas para cada built-in agent (ENFORCED via código)
 */
export const BUILTIN_AGENT_TOOLS: Record<string, string[]> = {
  builder: ["read", "write", "edit", "bash", "glob", "grep", "exec", "mkdir", "rm", "cp", "mv"],
  researcher: ["read", "glob", "grep", "web_search", "web_fetch"],
  reviewer: ["read", "glob", "grep"],
  ops: ["read", "write", "bash", "exec", "mkdir", "rm", "cp", "mv"],
};

/**
 * Get tools allowed for a specific built-in agent
 * Returns null if not a built-in agent
 */
export function getBuiltinAgentTools(agentId: string): string[] | null {
  if (!isBuiltinAgent(agentId)) {
    return null;
  }
  return BUILTIN_AGENT_TOOLS[agentId] || null;
}

/**
 * Check if a tool is allowed for a built-in agent
 */
export function isToolAllowedForBuiltinAgent(agentId: string, toolName: string): boolean {
  const allowedTools = getBuiltinAgentTools(agentId);
  if (!allowedTools) {
    return true; // Not a built-in, allow all
  }
  return allowedTools.includes(toolName);
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

/**
 * Built-in agent templates
 */
const BUILTIN_AGENT_TEMPLATES: Record<string, { name: string; systemPrompt: string }> = {
  builder: {
    name: "Builder",
    systemPrompt: `# Builder Agent

You are the **builder agent** of OpenClaw. Your job is to write, edit, and refactor code.

## Responsibilities

- Create new files and components
- Edit existing code
- Fix bugs and errors
- Refactor for better structure
- Ensure code compiles and works

## Guidelines

- Follow project's coding standards
- Write clean, maintainable code
- Add comments when needed
- Test your changes when possible
- Don't break existing functionality

## Available Tools

You have access to: read, write, edit, bash, glob, grep, exec`,
  },
  researcher: {
    name: "Researcher",
    systemPrompt: `# Researcher Agent

You are the **researcher agent** of OpenClaw. Your job is to explore and understand the codebase.

## Responsibilities

- Find relevant files and code
- Understand how the codebase works
- Search for patterns and implementations
- Provide analysis and insights

## Guidelines

- Be thorough in your exploration
- Read files to understand context
- Use grep/glob to find relevant code
- Provide clear explanations
- Don't modify code (that's builder's job)

## Tools Restriction

You can ONLY read and search. Do NOT write or edit files.

Available tools: read, glob, grep, web_search, web_fetch`,
  },
  reviewer: {
    name: "Reviewer",
    systemPrompt: `# Reviewer Agent

You are the **reviewer agent** of OpenClaw. Your job is to review code and provide feedback.

## Responsibilities

- Review code changes
- Identify bugs and issues
- Check for security vulnerabilities
- Verify code quality

## Guidelines

- Be thorough but constructive
- Provide specific suggestions
- Explain why something is an issue
- Don't rewrite code, suggest changes

## Tools Restriction

You can ONLY read. Do NOT write or edit files.

Available tools: read, glob, grep`,
  },
  ops: {
    name: "Ops",
    systemPrompt: `# Ops Agent

You are the **ops agent** of OpenClaw. Your job is to handle infrastructure and operations.

## Responsibilities

- Deploy applications
- Configure environments
- Install dependencies
- Run scripts and commands
- Manage containers

## Guidelines

- Follow best practices for deployment
- Ensure security in configurations
- Test deployments before going to production
- Be careful with destructive commands

## Available Tools

You have access to: read, write, bash, exec`,
  },
};

/**
 * Ensure all built-in agent workspaces exist
 * Creates workspace directory and AGENT.md for each built-in agent
 */
export async function ensureBuiltinAgentWorkspaces(): Promise<void> {
  const agentsDir = path.join(os.homedir(), ".openclaw", "agents");

  for (const agentId of BUILTIN_AGENT_IDS) {
    const agentDir = path.join(agentsDir, agentId);
    const workspaceDir = path.join(agentDir, "workspace");
    const agentFile = path.join(workspaceDir, "AGENT.md");

    // Check if workspace already exists
    try {
      await fs.access(workspaceDir);
      // Workspace exists, check if AGENT.md exists
      try {
        await fs.access(agentFile);
        // AGENT.md exists, skip
        continue;
      } catch {
        // AGENT.md doesn't exist, create it
      }
    } catch {
      // Workspace doesn't exist, create it
      await fs.mkdir(workspaceDir, { recursive: true });
    }

    // Create AGENT.md with system prompt
    const template = BUILTIN_AGENT_TEMPLATES[agentId];
    if (template) {
      await fs.writeFile(agentFile, template.systemPrompt, { encoding: "utf-8" });
    }
  }
}

/**
 * Orchestrator Agent - Auto-routing to subagents
 *
 * Módulo que decide automaticamente qual subagente usar
 * baseado na tarefa recebida.
 *
 * O Main analisa primeiro - só delega se necessário.
 */

import { getBuiltinAgentConfig } from "./builtin-agents/index.js";
import type { SpawnSubagentParams, SpawnSubagentResult } from "./subagent-spawn.js";
import { spawnSubagentDirect } from "./subagent-spawn.js";

export interface OrchestratorDecision {
  shouldDelegate: boolean;
  targetAgent: string | null;
  reason: string;
  confidence: number;
}

export interface OrchestratorConfig {
  enableAutoRouting: boolean;
  minConfidence: number;
}

/**
 * Analisa a tarefa e decide se deve delegar para um subagente
 */
export function analyzeTask(task: string): OrchestratorDecision {
  const lowerTask = task.toLowerCase();

  // Palavras-chave para cada tipo de tarefa
  const patterns = {
    builder: [
      "crie",
      "faça",
      "implemente",
      "refatore",
      "corriga",
      "build",
      "create",
      "fix",
      "escreva código",
      "programar",
      "desenvolvimento",
      "componente",
      "função",
      "code",
      "coding",
      "write code",
      "create file",
      "edit file",
    ],
    researcher: [
      "pesquise",
      "analise",
      "busque",
      "investigue",
      "search",
      "analyze",
      "o que é",
      "como funciona",
      "onde está",
      "encontre",
      "explique",
      "what is",
      "how does",
      "where is",
      "find",
      "research",
    ],
    reviewer: [
      "revise",
      "review",
      "analise código",
      "verifique",
      "check",
      "examine",
      "revisar",
      "code review",
      "pr review",
      "review pr",
    ],
    ops: [
      "deploy",
      "configure",
      "instale",
      "setup",
      "start",
      "restart",
      "docker",
      "npm",
      "pnpm",
      "yarn",
      "environment",
      "env",
      "infra",
      "infraestrutura",
      "servidor",
      "server",
      "production",
    ],
  };

  // Score para cada agente
  const scores: Record<string, number> = {
    builder: 0,
    researcher: 0,
    reviewer: 0,
    ops: 0,
  };

  // Calcula score baseado em triggers
  for (const [agent, keywords] of Object.entries(patterns)) {
    for (const keyword of keywords) {
      if (lowerTask.includes(keyword.toLowerCase())) {
        scores[agent] += keyword.length; // Palavras mais longas = mais específicas
      }
    }
  }

  // Encontrar o melhor candidato
  let bestAgent: string | null = null;
  let bestScore = 0;

  for (const [agent, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  // Decisão
  const minScore = 5; // Threshold mínimo para delegar

  if (bestScore >= minScore && bestAgent) {
    const confidence = Math.min(bestScore / 20, 1); // Normaliza 0-1

    return {
      shouldDelegate: true,
      targetAgent: bestAgent,
      reason: `Detectado trigger: ${Object.entries(scores).find(([, s]) => s === bestScore)?.[0]}`,
      confidence,
    };
  }

  // Não deve delegar - tarefa simples
  return {
    shouldDelegate: false,
    targetAgent: null,
    reason: "Tarefa simples - main pode resolver",
    confidence: 0,
  };
}

/**
 * Executa a tarefa - decide se delega ou não
 */
export async function routeTask(
  task: string,
  spawnParams: Omit<SpawnSubagentParams, "task" | "agentId">,
  ctx: unknown,
): Promise<{ type: "delegate"; result: SpawnSubagentResult } | { type: "direct" }> {
  const decision = analyzeTask(task);

  if (!decision.shouldDelegate || !decision.targetAgent) {
    // Não delega - main resolve direto
    return { type: "direct" };
  }

  // Delega para o subagente
  const result = await spawnSubagentDirect(
    {
      ...spawnParams,
      task,
      agentId: decision.targetAgent,
    },
    ctx as Parameters<typeof spawnSubagentDirect>[1],
  );

  return {
    type: "delegate",
    result,
  };
}

/**
 * Get agent description for display
 */
export function getAgentDescription(agentId: string): string | null {
  const config = getBuiltinAgentConfig(agentId);
  return config?.description || null;
}

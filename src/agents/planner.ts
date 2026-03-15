/**
 * Planner Agent Module
 *
 * Módulo robusto de planejamento que força o modelo a seguir
 * um fluxo estruturado de execução passo a passo.
 *
 * Este módulo substitui as instruções de prompt por código real
 * que controla o comportamento do agente.
 */

export interface PlanStep {
  id: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
  error?: string;
}

export interface Plan {
  id: string;
  task: string;
  steps: PlanStep[];
  currentStep: number;
  status: "planning" | "executing" | "completed" | "failed";
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface PlannerConfig {
  maxSteps: number;
  timeoutPerStep: number;
  autoExecute: boolean;
  requireApproval: boolean;
  minComplexity: "low" | "medium" | "high";
}

export interface DecompositionResult {
  steps: string[];
  complexity: "low" | "medium" | "high";
  reasoning: string;
}

/**
 * PlannerAgent - Classe principal para criação e execução de planos
 *
 * Este módulo implementa o padrão Plan-and-Execute de forma robusta,
 * forçando o modelo a seguir o fluxo controlado por código.
 */
export class PlannerAgent {
  private config: PlannerConfig;
  private currentPlan: Plan | null = null;
  private llmClient: unknown;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = {
      maxSteps: config.maxSteps ?? 20,
      timeoutPerStep: config.timeoutPerStep ?? 60000,
      autoExecute: config.autoExecute ?? true,
      requireApproval: config.requireApproval ?? false,
      minComplexity: config.minComplexity ?? "medium",
    };
  }

  /**
   * Define o cliente LLM a ser usado para decomposição
   */
  setLLMClient(client: unknown): void {
    this.llmClient = client;
  }

  /**
   * Avalia se uma tarefa requer planejamento
   */
  async shouldUsePlanner(task: string): Promise<boolean> {
    // Tarefas muito simples não precisam de planner
    if (task.length < 50) {
      const simplePatterns = [
        /^(oi|olá|ola|hi|hello|hey)/i,
        /^(qual a|what is the|que hora)/i,
        /^(me diga|tell me)/i,
      ];
      if (simplePatterns.some((p) => p.test(task.trim()))) {
        return false;
      }
    }

    // Tarefas com action verbs geralmente precisam de planner
    const actionVerbs = [
      "crie",
      "faça",
      "rode",
      "execute",
      "refatore",
      "corriga",
      "implemente",
      "build",
      "run",
      "create",
      "make",
      "fix",
      "develop",
      "implement",
      "deploy",
      "configure",
      "setup",
    ];

    const hasActionVerb = actionVerbs.some((verb) => task.toLowerCase().includes(verb));

    return hasActionVerb;
  }

  /**
   * Decompõe uma tarefa em passos menores
   * Este é o coração do Planner - chama o LLM para estruturar a tarefa
   */
  private async decomposeTask(task: string): Promise<DecompositionResult> {
    if (!this.llmClient) {
      // Fallback: retorna tarefa como único passo
      return {
        steps: [task],
        complexity: "low",
        reasoning: "No LLM client available",
      };
    }

    const prompt = `
You are a task planner. Decompose the following task into smaller, executable steps.

Task: ${task}

Requirements:
1. Break down into 3-10 specific steps
2. Each step should be actionable and verifiable
3. Steps should be in logical order
4. Consider dependencies between steps

Respond in JSON format:
{
  "steps": ["step 1", "step 2", ...],
  "complexity": "low|medium|high",
  "reasoning": "brief explanation of the decomposition"
}
`.trim();

    try {
      const response = await this.llmClient.chat([
        {
          role: "system",
          content: "You are a task planning assistant. Always respond with valid JSON.",
        },
        { role: "user", content: prompt },
      ]);

      const content = response.content || response;
      const parsed = JSON.parse(content);

      return {
        steps: parsed.steps || [task],
        complexity: parsed.complexity || "medium",
        reasoning: parsed.reasoning || "",
      };
    } catch (error) {
      // Fallback em caso de erro
      return {
        steps: [task],
        complexity: "low",
        reasoning: `Decomposition failed: ${String(error)}`,
      };
    }
  }

  /**
   * Cria um plano de execução para a tarefa
   */
  async createPlan(task: string): Promise<Plan> {
    const decomposition = await this.decomposeTask(task);

    const steps: PlanStep[] = decomposition.steps.map((desc, idx) => ({
      id: idx + 1,
      description: desc,
      status: "pending" as const,
    }));

    this.currentPlan = {
      id: this.generateId(),
      task,
      steps,
      currentStep: 0,
      status: "planning",
      createdAt: new Date(),
    };

    return this.currentPlan;
  }

  /**
   * Retorna o próximo passo pendente
   */
  getNextStep(): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    return this.currentPlan.steps.find((s) => s.status === "pending") || null;
  }

  /**
   * Retorna o passo atual (em execução)
   */
  getCurrentStep(): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    return this.currentPlan.steps.find((s) => s.status === "in_progress") || null;
  }

  /**
   * Marca um passo como em execução
   */
  startStep(stepId: number): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = "in_progress";
      this.currentPlan.status = "executing";
    }

    return step || null;
  }

  /**
   * Completa um passo com resultado
   */
  completeStep(stepId: number, result: string): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = "completed";
      step.result = result;
      this.currentPlan.currentStep++;
    }

    return step || null;
  }

  /**
   * Falha um passo com erro
   */
  failStep(stepId: number, error: string): PlanStep | null {
    if (!this.currentPlan) {
      return null;
    }

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = "failed";
      step.error = error;
      this.currentPlan.status = "failed";
    }

    return step || null;
  }

  /**
   * Retorna o status atual do plano
   */
  getStatus(): Plan | null {
    return this.currentPlan;
  }

  /**
   * Verifica se o plano está completo
   */
  isCompleted(): boolean {
    if (!this.currentPlan) {
      return false;
    }
    return this.currentPlan.status === "completed";
  }

  /**
   * Verifica se o plano falhou
   */
  isFailed(): boolean {
    if (!this.currentPlan) {
      return false;
    }
    return this.currentPlan.status === "failed";
  }

  /**
   * Retorna o progresso do plano (0-100)
   */
  getProgress(): number {
    if (!this.currentPlan) {
      return 0;
    }

    const completed = this.currentPlan.steps.filter((s) => s.status === "completed").length;

    return Math.round((completed / this.currentPlan.steps.length) * 100);
  }

  /**
   * Gera um ID único para o plano
   */
  private generateId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Formata o plano para exibição
   */
  formatForDisplay(): string {
    if (!this.currentPlan) {
      return "Nenhum plano ativo";
    }

    const lines = [
      `📋 **Plano:** ${this.currentPlan.task}`,
      "",
      "**Passos:**",
      ...this.currentPlan.steps.map((step) => {
        const statusIcon = {
          pending: "⏳",
          in_progress: "→",
          completed: "✓",
          failed: "✗",
        }[step.status];

        return `${statusIcon} ${step.id}. ${step.description}`;
      }),
      "",
      `**Progresso:** ${this.getProgress()}%`,
      `**Status:** ${this.currentPlan.status}`,
    ];

    return lines.join("\n");
  }

  /**
   * Reseta o planner para uma nova tarefa
   */
  reset(): void {
    this.currentPlan = null;
  }
}

/**
 * Factory function para criar um PlannerAgent com config padrão
 */
export function createPlanner(config?: Partial<PlannerConfig>): PlannerAgent {
  return new PlannerAgent(config);
}

/**
 * Evaluator/Optimizer Agent Module
 *
 * Módulo robusto de avaliação que verifica a qualidade da resposta
 * antes de enviar, refina automaticamente se necessário.
 *
 * Este módulo força o modelo a avaliar e refinar suas respostas.
 */

export interface EvaluationResult {
  isComplete: boolean;
  quality: "good" | "needs_work" | "failed";
  issues: EvaluationIssue[];
  score: number; // 0-100
}

export interface EvaluationIssue {
  type: "missing" | "incorrect" | "incomplete" | "error" | "style";
  description: string;
  severity: "critical" | "major" | "minor";
  suggestion?: string;
}

export interface EvaluationConfig {
  maxIterations: number;
  qualityThreshold: number;
  autoRefine: boolean;
  checkTypes: ("completeness" | "correctness" | "syntax" | "style")[];
}

export interface RefineResult {
  success: boolean;
  iterations: number;
  finalResult: string;
  issuesFixed: number;
}

/**
 * EvaluatorAgent - Classe principal para avaliação e refinamento
 *
 * Este módulo implementa o loop de avaliação-revisão:
 * 1. Gera resposta inicial
 * 2. Avalia qualidade
 * 3. Se necessário, refina
 * 4. Repete até atingir threshold ou max iterations
 */
export class EvaluatorAgent {
  private config: EvaluationConfig;
  private llmClient: unknown;

  constructor(config: Partial<EvaluationConfig> = {}) {
    this.config = {
      maxIterations: config.maxIterations ?? 3,
      qualityThreshold: config.qualityThreshold ?? 80,
      autoRefine: config.autoRefine ?? true,
      checkTypes: config.checkTypes ?? ["completeness", "correctness", "syntax"],
    };
  }

  /**
   * Define o cliente LLM a ser usado
   */
  setLLMClient(client: unknown): void {
    this.llmClient = client;
  }

  /**
   * Avalia a completude da resposta
   */
  private async checkCompleteness(task: string, response: string): Promise<EvaluationIssue[]> {
    const issues: EvaluationIssue[] = [];

    // Verifica se a resposta aborda os pontos principais
    const taskLower = task.toLowerCase();
    const responseLower = response.toLowerCase();

    // Detecta palavras-chave da tarefa
    const keyTerms = taskLower
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 4);

    // Verifica se termos importantes estão presentes
    const missingTerms = keyTerms.filter((term) => !responseLower.includes(term));

    if (missingTerms.length > 0 && keyTerms.length > 2) {
      issues.push({
        type: "incomplete",
        description: `Termos importantes não encontrados: ${missingTerms.slice(0, 3).join(", ")}`,
        severity: "major",
      });
    }

    // Verifica se é muito curta para a tarefa
    if (task.length > 100 && response.length < 50) {
      issues.push({
        type: "incomplete",
        description: "Resposta muito curta para a complexidade da tarefa",
        severity: "critical",
      });
    }

    return issues;
  }

  /**
   * Avalia correção (para código)
   */
  private async checkCorrectness(task: string, response: string): Promise<EvaluationIssue[]> {
    const issues: EvaluationIssue[] = [];

    // Detecta se é código
    const isCode =
      response.includes("```") ||
      response.includes("function ") ||
      response.includes("const ") ||
      response.includes("import ");

    if (isCode) {
      // Verificações básicas de código
      const codeBlocks = response.match(/```[\s\S]*?```/g) || [];

      for (const block of codeBlocks) {
        // Verifica balanceamento de chaves
        const openBraces = (block.match(/{/g) || []).length;
        const closeBraces = (block.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
          issues.push({
            type: "error",
            description: "Chaves desbalanceadas no código",
            severity: "critical",
            suggestion: "Verificar fechamento de chaves",
          });
        }

        // Verifica balanceamento de parênteses
        const openParens = (block.match(/\(/g) || []).length;
        const closeParens = (block.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
          issues.push({
            type: "error",
            description: "Parênteses desbalanceados no código",
            severity: "critical",
            suggestion: "Verificar fechamento de parênteses",
          });
        }
      }
    }

    return issues;
  }

  /**
   * Avalia sintaxe (para código)
   */
  private async checkSyntax(response: string): Promise<EvaluationIssue[]> {
    const issues: EvaluationIssue[] = [];

    // Detecta se é código
    const isCode =
      response.includes("```") ||
      response.includes("function ") ||
      response.includes("const ") ||
      response.includes("import ");

    if (isCode) {
      const codeBlocks = response.match(/```[\s\S]*?```/g) || [];

      for (const block of codeBlocks) {
        const code = block.replace(/```\w*/, "").replace(/```$/, "");

        // Verifica console.log vs console.error
        if (code.includes("console.log") && !code.includes("//")) {
          // Apenas avisa, não é erro crítico
        }

        // Verifica código commented out grande
        const commentedLines = (code.match(/\/\/.*$/gm) || []).length;
        const totalLines = code.split("\n").length;
        if (commentedLines > totalLines * 0.5 && totalLines > 10) {
          issues.push({
            type: "style",
            description: "Muito código comentado",
            severity: "minor",
            suggestion: "Remover código comentado ou mover para documentação",
          });
        }
      }
    }

    return issues;
  }

  /**
   * Avalia estilo
   */
  private async checkStyle(task: string, response: string): Promise<EvaluationIssue[]> {
    const issues: EvaluationIssue[] = [];

    // Verifica se a resposta é apenas uma pergunta
    if (response.trim().endsWith("?")) {
      issues.push({
        type: "incomplete",
        description: "Resposta termina com pergunta, pode estar incompleta",
        severity: "major",
      });
    }

    // Verifica tom
    const isTooShort = response.length < 20 && task.length > 50;
    if (isTooShort) {
      issues.push({
        type: "incomplete",
        description: "Resposta muito curta para o pedido",
        severity: "major",
      });
    }

    return issues;
  }

  /**
   * Avalia a qualidade da resposta
   */
  async evaluate(task: string, response: string): Promise<EvaluationResult> {
    const allIssues: EvaluationIssue[] = [];

    // Executa as verificações configuradas
    if (this.config.checkTypes.includes("completeness")) {
      const issues = await this.checkCompleteness(task, response);
      allIssues.push(...issues);
    }

    if (this.config.checkTypes.includes("correctness")) {
      const issues = await this.checkCorrectness(task, response);
      allIssues.push(...issues);
    }

    if (this.config.checkTypes.includes("syntax")) {
      const issues = await this.checkSyntax(response);
      allIssues.push(...issues);
    }

    if (this.config.checkTypes.includes("style")) {
      const issues = await this.checkStyle(task, response);
      allIssues.push(...issues);
    }

    // Calcula score
    const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
    const majorCount = allIssues.filter((i) => i.severity === "major").length;
    const minorCount = allIssues.filter((i) => i.severity === "minor").length;

    let score = 100;
    score -= criticalCount * 25;
    score -= majorCount * 10;
    score -= minorCount * 5;
    score = Math.max(0, score);

    // Determina qualidade
    let quality: "good" | "needs_work" | "failed";
    if (criticalCount > 0 || score < 50) {
      quality = "failed";
    } else if (majorCount > 0 || score < this.config.qualityThreshold) {
      quality = "needs_work";
    } else {
      quality = "good";
    }

    const isComplete = criticalCount === 0 && majorCount === 0;

    return {
      isComplete,
      quality,
      issues: allIssues,
      score,
    };
  }

  /**
   * Refina a resposta com base nos problemas encontrados
   */
  async refine(task: string, currentResponse: string, issues: EvaluationIssue[]): Promise<string> {
    if (!this.llmClient) {
      return currentResponse;
    }

    const criticalIssues = issues.filter(
      (i) => i.severity === "critical" || i.severity === "major",
    );

    if (criticalIssues.length === 0) {
      return currentResponse;
    }

    const issuesList = criticalIssues
      .map(
        (i) => `- ${i.type}: ${i.description}${i.suggestion ? ` (sugestão: ${i.suggestion})` : ""}`,
      )
      .join("\n");

    const prompt = `
You need to improve the following response based on the issues found:

Original Task: ${task}

Current Response:
${currentResponse}

Issues to Fix:
${issuesList}

Requirements:
1. Fix all critical and major issues
2. Keep what is good in the original response
3. Maintain the same format and structure
4. Only output the improved response, nothing else

Improved Response:
`.trim();

    try {
      const llm = this.llmClient as {
        chat(messages: Array<{ role: string; content: string }>): Promise<{ content?: string }>;
      };
      const response = await llm.chat([
        {
          role: "system",
          content:
            "You are an expert code reviewer and response improver. Always output only the improved content.",
        },
        { role: "user", content: prompt },
      ]);

      return response.content || response;
    } catch (error) {
      console.error("Refinement failed:", error);
      return currentResponse;
    }
  }

  /**
   * Loop completo: avaliar e refinar até atingir threshold
   */
  async evaluateAndRefine(task: string, initialResponse: string): Promise<RefineResult> {
    let currentResponse = initialResponse;
    let iterations = 0;
    let issuesFixed = 0;
    let previousScore = 0;
    let stuckCount = 0; // Contador para detectar loop

    while (iterations < this.config.maxIterations) {
      iterations++;

      // Avalia a resposta atual
      const result = await this.evaluate(task, currentResponse);

      // Se está boa o suficiente, sai
      if (result.quality === "good" || result.score >= this.config.qualityThreshold) {
        return {
          success: true,
          iterations,
          finalResult: currentResponse,
          issuesFixed,
        };
      }

      // Se score não melhorou desde a última iteração, incrementa stuckCount
      if (result.score <= previousScore) {
        stuckCount++;
        // Se stuck 2x seguidas, sai do loop (não está melhorando)
        if (stuckCount >= 2) {
          return {
            success: false,
            iterations,
            finalResult: currentResponse,
            issuesFixed,
          };
        }
      } else {
        stuckCount = 0;
      }
      previousScore = result.score;

      // Se não está boa e auto-refine está ativado, refina
      if (this.config.autoRefine && result.issues.length > 0) {
        const previousIssueCount = result.issues.length;
        currentResponse = await this.refine(task, currentResponse, result.issues);

        // Se a resposta não mudou desde o início, sai do loop
        if (currentResponse === initialResponse && iterations > 1) {
          return {
            success: false,
            iterations,
            finalResult: currentResponse,
            issuesFixed,
          };
        }

        if (currentResponse !== initialResponse) {
          issuesFixed += previousIssueCount;
        }
      } else {
        // Não pode refinar, sai
        break;
      }
    }

    return {
      success: false,
      iterations,
      finalResult: currentResponse,
      issuesFixed,
    };
  }

  /**
   * Formata resultado para exibição
   */
  formatEvaluation(task: string, result: EvaluationResult): string {
    const lines = [
      `📋 **Avaliação: ${task}**`,
      "",
      `**Score:** ${result.score}/100`,
      `**Qualidade:** ${result.quality === "good" ? "✅ Boa" : result.quality === "needs_work" ? "⚠️ Precisa melhorar" : "❌ Falhou"}`,
      "",
    ];

    if (result.issues.length > 0) {
      lines.push("**Problemas encontrados:**");
      for (const issue of result.issues) {
        const icon =
          issue.severity === "critical" ? "🔴" : issue.severity === "major" ? "🟡" : "🟢";
        lines.push(`${icon} [${issue.severity}] ${issue.type}: ${issue.description}`);
        if (issue.suggestion) {
          lines.push(`   💡 ${issue.suggestion}`);
        }
      }
    } else {
      lines.push("✅ Nenhum problema encontrado");
    }

    return lines.join("\n");
  }
}

/**
 * Factory function para criar um EvaluatorAgent com config padrão
 */
export function createEvaluator(config?: Partial<EvaluationConfig>): EvaluatorAgent {
  return new EvaluatorAgent(config);
}

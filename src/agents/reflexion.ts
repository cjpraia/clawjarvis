/**
 * Reflexion Agent Module
 *
 * Módulo de aprendizado com erros que persiste conhecimento
 * em arquivo JSON para uso em tarefas futuras.
 *
 * Este módulo permite que o agente não repita os mesmos erros.
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

const DEFAULT_REFLEXIONS_PATH = path.join(homedir(), ".openclaw", "reflexions.json");

export interface ReflexionEntry {
  id: string;
  data: string;
  erro: string;
  causa: string;
  solucao: string;
  tags: string[];
  ocorrencias: number;
  contexto: string;
}

export interface ReflexionsFile {
  versao: number;
  atualizado: string;
  aprendizados: ReflexionEntry[];
}

export interface ReflexionConfig {
  maxEntries: number;
  olderThanDays: number;
  minConfidence: number;
  autoSave: boolean;
  filePath: string;
}

export interface AnalyzeErrorResult {
  erro: string;
  causa: string;
  solucao: string;
  tags: string[];
}

export interface SearchResult {
  entries: ReflexionEntry[];
  total: number;
}

/**
 * ReflexionAgent - Classe principal para aprendizado com erros
 *
 * Funcionalidades:
 * - Salva erros e aprendizados em arquivo JSON
 * - Busca por tags ou texto
 * - Limpa entradas antigas automaticamente
 * - Integra com Evaluator para captura automática de erros
 */
export class ReflexionAgent {
  private config: ReflexionConfig;
  private entries: ReflexionEntry[] = [];
  private loaded: boolean = false;

  constructor(config: Partial<ReflexionConfig> = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? 100,
      olderThanDays: config.olderThanDays ?? 90,
      minConfidence: config.minConfidence ?? 0.7,
      autoSave: config.autoSave ?? true,
      filePath: config.filePath ?? DEFAULT_REFLEXIONS_PATH,
    };
  }

  /**
   * Garante que o diretório existe
   */
  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.config.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Carrega reflexions do arquivo
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.config.filePath, "utf-8");
      const data: ReflexionsFile = JSON.parse(content);
      this.entries = data.aprendizados || [];
      this.loaded = true;
    } catch {
      this.entries = [];
      this.loaded = true;
    }
  }

  /**
   * Salva reflexions no arquivo
   */
  async save(): Promise<void> {
    await this.ensureDir();
    const data: ReflexionsFile = {
      versao: 1,
      atualizado: new Date().toISOString(),
      aprendizados: this.entries,
    };
    await fs.writeFile(this.config.filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Gera ID único
   */
  private generateId(): string {
    return `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Adiciona um novo aprendizado
   */
  async addReflexion(
    erro: string,
    causa: string,
    solucao: string,
    tags: string[],
    contexto?: string,
  ): Promise<ReflexionEntry> {
    if (!this.loaded) {
      await this.load();
    }

    // Normaliza tags
    const normalizedTags = tags.map((t) => t.toLowerCase().trim());

    // Verifica se já existe aprendizado similar
    const existing = this.entries.find((e) => e.erro.toLowerCase() === erro.toLowerCase());

    if (existing) {
      // Incrementa ocorrências
      existing.ocorrencias++;
      existing.data = new Date().toISOString();

      // Atualiza tags se necessário
      for (const tag of normalizedTags) {
        if (!existing.tags.includes(tag)) {
          existing.tags.push(tag);
        }
      }

      if (this.config.autoSave) {
        await this.save();
      }

      return existing;
    }

    // Cria nova entrada
    const entry: ReflexionEntry = {
      id: this.generateId(),
      data: new Date().toISOString(),
      erro,
      causa,
      solucao,
      tags: normalizedTags,
      ocorrencias: 1,
      contexto: contexto || solucao,
    };

    // Adiciona ao início da lista
    this.entries.unshift(entry);

    // Limita número de entradas
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(0, this.config.maxEntries);
    }

    if (this.config.autoSave) {
      await this.save();
    }

    return entry;
  }

  /**
   * Busca reflexions por tags
   */
  async searchByTags(tags: string[]): Promise<SearchResult> {
    if (!this.loaded) {
      await this.load();
    }

    const normalizedTags = tags.map((t) => t.toLowerCase());
    const entries = this.entries.filter((entry) =>
      normalizedTags.some((tag) => entry.tags.includes(tag)),
    );

    return { entries, total: entries.length };
  }

  /**
   * Busca reflexions por texto
   */
  async search(query: string): Promise<SearchResult> {
    if (!this.loaded) {
      await this.load();
    }

    const lowerQuery = query.toLowerCase();
    const entries = this.entries.filter(
      (entry) =>
        entry.erro.toLowerCase().includes(lowerQuery) ||
        entry.causa.toLowerCase().includes(lowerQuery) ||
        entry.solucao.toLowerCase().includes(lowerQuery) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );

    return { entries, total: entries.length };
  }

  /**
   * Busca reflexions relacionados à tarefa
   */
  async findRelated(task: string): Promise<ReflexionEntry[]> {
    if (!this.loaded) {
      await this.load();
    }

    const lowerTask = task.toLowerCase();
    const keywords = lowerTask
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Prioriza por relevância
    const scored = this.entries.map((entry) => {
      let score = 0;

      // Matches em tags
      for (const keyword of keywords) {
        if (entry.tags.some((t) => t.includes(keyword))) {
          score += 10;
        }
      }

      // Matches em erro
      for (const keyword of keywords) {
        if (entry.erro.toLowerCase().includes(keyword)) {
          score += 5;
        }
      }

      // Matches em solução
      for (const keyword of keywords) {
        if (entry.solucao.toLowerCase().includes(keyword)) {
          score += 3;
        }
      }

      // Boost por ocorrências
      score += Math.min(entry.ocorrencias, 5);

      return { entry, score };
    });

    // Ordena por score e retorna os relevantes
    return scored
      .filter((s) => s.score > 0)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.entry);
  }

  /**
   * Limpa reflexions antigos
   */
  async cleanup(): Promise<number> {
    if (!this.loaded) {
      await this.load();
    }

    const cutoff = Date.now() - this.config.olderThanDays * 24 * 60 * 60 * 1000;
    const before = this.entries.length;

    this.entries = this.entries.filter((entry) => new Date(entry.data).getTime() > cutoff);

    const removed = before - this.entries.length;

    if (removed > 0 && this.config.autoSave) {
      await this.save();
    }

    return removed;
  }

  /**
   * Limpa entradas duplicadas
   */
  async deduplicate(): Promise<number> {
    if (!this.loaded) {
      await this.load();
    }

    const seen = new Set<string>();
    const before = this.entries.length;

    this.entries = this.entries.filter((entry) => {
      const key = entry.erro.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const removed = before - this.entries.length;

    if (removed > 0 && this.config.autoSave) {
      await this.save();
    }

    return removed;
  }

  /**
   * Analisa erro e gera aprendizado usando LLM
   */
  async analyzeError(task: string, error: string, llmClient: unknown): Promise<AnalyzeErrorResult> {
    if (!llmClient) {
      // Fallback sem LLM
      return {
        erro: error,
        causa: "Erro não analisado",
        solucao: "Revisar manualmente",
        tags: ["general"],
      };
    }

    const prompt = `
Analise o seguinte erro e gere um aprendizado:

Tarefa: ${task}
Erro: ${error}

Responda APENAS com JSON válido (sem markdown):
{"erro": "descrição curta do erro", "causa": "por que aconteceu", "solucao": "como evitar no futuro", "tags": ["tag1", "tag2"]}
`.trim();

    try {
      const llm = llmClient as {
        chat(messages: Array<{ role: string; content: string }>): Promise<{ content?: string }>;
      };
      const response = await llm.chat([
        {
          role: "system",
          content:
            "You are an error analysis assistant. Always respond with valid JSON only, no markdown.",
        },
        { role: "user", content: prompt },
      ]);

      const parsed = JSON.parse(response.content || "{}");
      return {
        erro: parsed.erro || error,
        causa: parsed.causa || "Não identificado",
        solucao: parsed.solucao || "Revisar manualmente",
        tags: parsed.tags || ["general"],
      };
    } catch {
      return {
        erro: error,
        causa: "Análise falhou",
        solucao: "Revisar manualmente",
        tags: ["general"],
      };
    }
  }

  /**
   * Processa falha do Evaluator e salva aprendizado
   */
  async processFailure(
    task: string,
    error: string,
    evaluationResult: unknown,
    llmClient: unknown,
  ): Promise<ReflexionEntry | null> {
    // Analisa o erro
    const analysis = await this.analyzeError(task, error, llmClient);

    // Salva o aprendizado
    const entry = await this.addReflexion(
      analysis.erro,
      analysis.causa,
      analysis.solucao,
      analysis.tags,
      `Tarefa: ${task}`,
    );

    return entry;
  }

  /**
   * Formata entrada para exibição
   */
  formatEntry(entry: ReflexionEntry): string {
    return [
      `**Erro:** ${entry.erro}`,
      `**Causa:** ${entry.causa}`,
      `**Solução:** ${entry.solucao}`,
      `**Tags:** ${entry.tags.join(", ")}`,
      `**Ocorrências:** ${entry.ocorrencias}`,
    ].join("\n");
  }

  /**
   * Formata resultados para exibição
   */
  formatForDisplay(entries: ReflexionEntry[]): string {
    if (entries.length === 0) {
      return "Nenhum aprendizado encontrado";
    }

    const lines = ["**⚠️ Aprendizados Relacionados:**", ""];

    for (const entry of entries) {
      lines.push(this.formatEntry(entry));
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Retorna estatísticas
   */
  async getStats(): Promise<{
    total: number;
    byTag: Record<string, number>;
    oldest: string | null;
    newest: string | null;
  }> {
    if (!this.loaded) {
      await this.load();
    }

    const byTag: Record<string, number> = {};
    let oldest: string | null = null;
    let newest: string | null = null;

    for (const entry of this.entries) {
      for (const tag of entry.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }

      if (!oldest || entry.data < oldest) {
        oldest = entry.data;
      }
      if (!newest || entry.data > newest) {
        newest = entry.data;
      }
    }

    return {
      total: this.entries.length,
      byTag,
      oldest,
      newest,
    };
  }

  /**
   * Reseta todas as reflexions
   */
  async reset(): Promise<void> {
    this.entries = [];
    if (this.config.autoSave) {
      await this.save();
    }
  }

  /**
   * Getter para entries
   */
  getEntries(): ReflexionEntry[] {
    return this.entries;
  }
}

/**
 * Factory function para criar um ReflexionAgent
 */
export function createReflexionAgent(config?: Partial<ReflexionConfig>): ReflexionAgent {
  return new ReflexionAgent(config);
}

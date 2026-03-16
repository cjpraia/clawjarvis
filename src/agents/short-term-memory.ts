/**
 * Short-Term Memory Module
 *
 * Sistema nativo de memória per-turn que registra automaticamente
 * cada turno de conversa e injeta no contexto.
 *
 * Diferente de hooks/plugins, este módulo é uma etapa obrigatória
 * do pipeline — não depende da LLM lembrar de chamar.
 */

import fs from "node:fs";
import path from "node:path";

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface ShortTermMemoryEntry {
  ts: string;
  sessionId: string;
  turn: number;
  task: string;
  input: string;
  output: string;
  tags: string[];
}

export interface ShortTermMemoryConfig {
  /** Enable/disable short-term memory. Default: true. */
  enabled?: boolean;
  /** Max entries before file rotation. Default: 10000. */
  maxEntries?: number;
  /** How many recent entries to inject into context. Default: 20. */
  maxInjectEntries?: number;
  /** Max chars for user input field. Default: 200. */
  maxInputChars?: number;
  /** Max chars for agent output field. Default: 300. */
  maxOutputChars?: number;
  /** Max chars for task summary field. Default: 100. */
  maxTaskChars?: number;
  /** Max tags per entry. Default: 5. */
  maxTags?: number;
}

type ResolvedConfig = Required<ShortTermMemoryConfig>;

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  maxEntries: 10_000,
  maxInjectEntries: 20,
  maxInputChars: 200,
  maxOutputChars: 300,
  maxTaskChars: 100,
  maxTags: 5,
};

const SHORT_TERM_FILENAME = "short-term.jsonl";
const TAIL_CHUNK_SIZE = 16 * 1024; // 16KB chunks for tail-reading

// ═══════════════════════════════════════════
// CONFIG RESOLUTION
// ═══════════════════════════════════════════

export function resolveShortTermMemoryConfig(raw?: ShortTermMemoryConfig): ResolvedConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_CONFIG.enabled,
    maxEntries: resolvePositiveInt(raw?.maxEntries, DEFAULT_CONFIG.maxEntries),
    maxInjectEntries: resolvePositiveInt(raw?.maxInjectEntries, DEFAULT_CONFIG.maxInjectEntries),
    maxInputChars: resolvePositiveInt(raw?.maxInputChars, DEFAULT_CONFIG.maxInputChars),
    maxOutputChars: resolvePositiveInt(raw?.maxOutputChars, DEFAULT_CONFIG.maxOutputChars),
    maxTaskChars: resolvePositiveInt(raw?.maxTaskChars, DEFAULT_CONFIG.maxTaskChars),
    maxTags: resolvePositiveInt(raw?.maxTags, DEFAULT_CONFIG.maxTags),
  };
}

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

// ═══════════════════════════════════════════
// FILE PATH RESOLUTION
// ═══════════════════════════════════════════

export function resolveShortTermFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", SHORT_TERM_FILENAME);
}

// ═══════════════════════════════════════════
// RECORD — Register a turn (after response)
// ═══════════════════════════════════════════

export async function recordTurn(params: {
  workspaceDir: string;
  sessionId: string;
  turn: number;
  userInput: string;
  agentOutput: string;
  config: ResolvedConfig;
}): Promise<void> {
  if (!params.config.enabled) {
    return;
  }

  const filePath = resolveShortTermFilePath(params.workspaceDir);
  const memoryDir = path.dirname(filePath);

  // Ensure memory directory exists
  await fs.promises.mkdir(memoryDir, { recursive: true });

  // Rotate if needed
  await rotateIfNeeded(filePath, params.config.maxEntries);

  // Build entry
  const cleanOutput = stripMarkdownNoise(params.agentOutput);
  const entry: ShortTermMemoryEntry = {
    ts: new Date().toISOString(),
    sessionId: params.sessionId,
    turn: params.turn,
    task: truncateField(params.userInput, params.config.maxTaskChars),
    input: truncateField(params.userInput, params.config.maxInputChars),
    output: truncateField(cleanOutput, params.config.maxOutputChars),
    tags: extractTags(params.userInput, params.agentOutput, params.config.maxTags),
  };

  // Append to file (one JSON line)
  const line = JSON.stringify(entry) + "\n";
  await fs.promises.appendFile(filePath, line, "utf-8");
}

// ═══════════════════════════════════════════
// INJECT — Read and format for context
// ═══════════════════════════════════════════

export async function injectShortTermMemory(params: {
  workspaceDir: string;
  config: ResolvedConfig;
}): Promise<string | null> {
  if (!params.config.enabled) {
    return null;
  }

  const filePath = resolveShortTermFilePath(params.workspaceDir);

  try {
    await fs.promises.access(filePath);
  } catch {
    return null; // File doesn't exist yet
  }

  const entries = await readLastNLines(filePath, params.config.maxInjectEntries);

  if (entries.length === 0) {
    return null;
  }

  return formatEntriesForContext(entries);
}

// ═══════════════════════════════════════════
// TAG EXTRACTION (heuristic — no LLM)
// ═══════════════════════════════════════════

export function extractTags(input: string, output: string, maxTags: number): string[] {
  const tags: string[] = [];
  const combined = `${input} ${output}`.toLowerCase();

  // Detect file names mentioned
  const filePattern = /[\w-]+\.(ts|js|md|json|py|sh|yml|yaml|css|html|tsx|jsx|vue|go|rs)/gi;
  const fileMatches = `${input} ${output}`.match(filePattern);
  if (fileMatches) {
    for (const m of fileMatches.slice(0, 2)) {
      const normalized = m.toLowerCase();
      if (!tags.includes(normalized)) {
        tags.push(normalized);
      }
    }
  }

  // Detect action keywords
  const actionMap: Record<string, string> = {
    criar: "create",
    crie: "create",
    create: "create",
    build: "create",
    corrigir: "fix",
    fix: "fix",
    bug: "bug",
    erro: "bug",
    error: "bug",
    implementar: "implement",
    implement: "implement",
    implemente: "implement",
    analisar: "analyze",
    analise: "analyze",
    analyze: "analyze",
    testar: "test",
    test: "test",
    teste: "test",
    debug: "debug",
    debugar: "debug",
    deploy: "deploy",
    deploiar: "deploy",
    refator: "refactor",
    refactor: "refactor",
    memória: "memory",
    memoria: "memory",
    memory: "memory",
    config: "config",
    configurar: "config",
    instalar: "install",
    install: "install",
    atualizar: "update",
    update: "update",
    remover: "remove",
    remove: "remove",
    delete: "remove",
  };

  for (const [keyword, tag] of Object.entries(actionMap)) {
    if (combined.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags.slice(0, maxTags);
}

// ═══════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════

function truncateField(text: string, maxChars: number): string {
  const cleaned = text.replace(/\n+/g, " ").trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return cleaned.slice(0, maxChars - 3) + "...";
}

/**
 * Strip heavy markdown formatting to produce a compact summary.
 * Code blocks → [código], tables → [tabela], headers stripped.
 */
export function stripMarkdownNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[código]") // Code blocks → [código]
    .replace(/\|[^\n]+\|/g, "[tabela]") // Table rows → [tabela]
    .replace(/#{1,6}\s/g, "") // Remove header markers
    .replace(/\*\*/g, "") // Remove bold
    .replace(/\*([^*]+)\*/g, "$1") // Remove italic
    .replace(/`([^`]+)`/g, "$1") // Inline code → plain text
    .replace(/\n{3,}/g, "\n\n") // Normalize blank lines
    .trim();
}

/**
 * Read the last N lines from a JSONL file efficiently by reading
 * chunks from the end of the file (tail-read pattern).
 */
async function readLastNLines(filePath: string, n: number): Promise<ShortTermMemoryEntry[]> {
  const entries: ShortTermMemoryEntry[] = [];

  const handle = await fs.promises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size === 0) {
      return entries;
    }

    let position = stat.size;
    let trailing = "";

    while (position > 0 && entries.length < n) {
      const chunkSize = Math.min(TAIL_CHUNK_SIZE, position);
      const start = position - chunkSize;
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, start);

      if (bytesRead <= 0) {
        break;
      }

      const chunk = buffer.toString("utf-8", 0, bytesRead);
      const combined = chunk + trailing;
      const lines = combined.split("\n");
      trailing = lines.shift() ?? "";

      for (let i = lines.length - 1; i >= 0 && entries.length < n; i--) {
        const line = lines[i]?.trim();
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as ShortTermMemoryEntry;
          if (parsed.ts && parsed.input) {
            entries.unshift(parsed);
          }
        } catch {
          // Skip malformed lines
        }
      }
      position = start;
    }

    // Process trailing (first line of file)
    if (trailing.trim() && entries.length < n) {
      try {
        const parsed = JSON.parse(trailing) as ShortTermMemoryEntry;
        if (parsed.ts && parsed.input) {
          entries.unshift(parsed);
        }
      } catch {
        // Skip
      }
    }
  } finally {
    await handle.close();
  }

  return entries.slice(-n);
}

/**
 * Format entries into a readable block for LLM context injection.
 */
function formatEntriesForContext(entries: ShortTermMemoryEntry[]): string {
  const header = "## Memória Recente (últimos turnos)\n";
  const formatted = entries.map((e) => {
    const time = e.ts.split("T")[1]?.split(".")[0] ?? "";
    const tagsLine = e.tags.length > 0 ? `  Tags: ${e.tags.join(", ")}` : "";
    return [
      `[T${e.turn}] ${time} — ${e.task}`,
      `  Input: ${e.input}`,
      `  Output: ${e.output}`,
      tagsLine,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return header + formatted.join("\n\n");
}

/**
 * Rotate the short-term memory file when it exceeds the max entry count.
 * Renames the current file with a date suffix and a fresh file will be
 * created on the next append.
 */
async function rotateIfNeeded(filePath: string, maxEntries: number): Promise<void> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lineCount = content.split("\n").filter((l) => l.trim()).length;

    if (lineCount >= maxEntries) {
      const dateStr = new Date().toISOString().split("T")[0];
      const dir = path.dirname(filePath);
      const timeSlug =
        new Date().toISOString().split("T")[1]?.split(".")[0]?.replace(/:/g, "") ?? "000000";
      const archiveName = `short-term-${dateStr}-${timeSlug}.jsonl`;
      await fs.promises.rename(filePath, path.join(dir, archiveName));
    }
  } catch {
    // File doesn't exist, nothing to rotate
  }
}

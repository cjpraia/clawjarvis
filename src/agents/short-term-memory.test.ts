import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractTags,
  recordTurn,
  injectShortTermMemory,
  resolveShortTermMemoryConfig,
  resolveShortTermFilePath,
  stripMarkdownNoise,
  type ShortTermMemoryEntry,
} from "./short-term-memory.js";

describe("short-term-memory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stm-test-"));
    await fs.promises.mkdir(path.join(tmpDir, "memory"), { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  const defaultConfig = resolveShortTermMemoryConfig(undefined);

  describe("resolveShortTermMemoryConfig", () => {
    it("returns defaults when no config provided", () => {
      const config = resolveShortTermMemoryConfig(undefined);
      expect(config.enabled).toBe(true);
      expect(config.maxEntries).toBe(10_000);
      expect(config.maxInjectEntries).toBe(20);
      expect(config.maxInputChars).toBe(200);
      expect(config.maxOutputChars).toBe(300);
      expect(config.maxTaskChars).toBe(100);
      expect(config.maxTags).toBe(5);
    });

    it("overrides with provided values", () => {
      const config = resolveShortTermMemoryConfig({
        maxEntries: 500,
        maxInjectEntries: 10,
      });
      expect(config.maxEntries).toBe(500);
      expect(config.maxInjectEntries).toBe(10);
      expect(config.maxInputChars).toBe(200); // default
    });

    it("ignores invalid values", () => {
      const config = resolveShortTermMemoryConfig({
        maxEntries: -1,
        maxInjectEntries: 0,
      });
      expect(config.maxEntries).toBe(10_000);
      expect(config.maxInjectEntries).toBe(20);
    });
  });

  describe("extractTags", () => {
    it("extracts file names", () => {
      const tags = extractTags("fix the planner.ts file", "modified planner.ts", 5);
      expect(tags).toContain("planner.ts");
    });

    it("extracts action keywords (pt-br)", () => {
      const tags = extractTags("crie um novo módulo", "criando módulo", 5);
      expect(tags).toContain("create");
    });

    it("extracts action keywords (en)", () => {
      const tags = extractTags("debug the memory system", "found the issue", 5);
      expect(tags).toContain("debug");
      expect(tags).toContain("memory");
    });

    it("limits to maxTags", () => {
      const tags = extractTags(
        "criar implementar analisar testar debug deploy configurar memória",
        "result",
        3,
      );
      expect(tags.length).toBeLessThanOrEqual(3);
    });

    it("deduplicates tags", () => {
      const tags = extractTags("create create create", "create", 5);
      const createCount = tags.filter((t) => t === "create").length;
      expect(createCount).toBe(1);
    });
  });

  describe("stripMarkdownNoise", () => {
    it("replaces code blocks", () => {
      const result = stripMarkdownNoise("before ```js\nconst x = 1;\n``` after");
      expect(result).toContain("[código]");
      expect(result).not.toContain("const x =");
    });

    it("removes bold markers", () => {
      const result = stripMarkdownNoise("this is **bold** text");
      expect(result).toBe("this is bold text");
    });

    it("removes header markers", () => {
      const result = stripMarkdownNoise("## Header\nContent");
      expect(result).toBe("Header\nContent");
    });
  });

  describe("recordTurn", () => {
    it("creates entry in JSONL format", async () => {
      await recordTurn({
        workspaceDir: tmpDir,
        sessionId: "test-session",
        turn: 1,
        userInput: "Hello world",
        agentOutput: "Hi there!",
        config: defaultConfig,
      });

      const filePath = resolveShortTermFilePath(tmpDir);
      const content = await fs.promises.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]) as ShortTermMemoryEntry;
      expect(entry.sessionId).toBe("test-session");
      expect(entry.turn).toBe(1);
      expect(entry.input).toBe("Hello world");
      expect(entry.output).toBe("Hi there!");
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("appends multiple entries", async () => {
      for (let i = 1; i <= 3; i++) {
        await recordTurn({
          workspaceDir: tmpDir,
          sessionId: "session-1",
          turn: i,
          userInput: `message ${i}`,
          agentOutput: `reply ${i}`,
          config: defaultConfig,
        });
      }

      const filePath = resolveShortTermFilePath(tmpDir);
      const content = await fs.promises.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });

    it("truncates long input", async () => {
      const longInput = "a".repeat(500);
      await recordTurn({
        workspaceDir: tmpDir,
        sessionId: "session-1",
        turn: 1,
        userInput: longInput,
        agentOutput: "ok",
        config: defaultConfig,
      });

      const filePath = resolveShortTermFilePath(tmpDir);
      const content = await fs.promises.readFile(filePath, "utf-8");
      const entry = JSON.parse(content.trim()) as ShortTermMemoryEntry;
      expect(entry.input.length).toBeLessThanOrEqual(defaultConfig.maxInputChars);
      expect(entry.input).toMatch(/\.\.\.$/);
    });

    it("does nothing when disabled", async () => {
      const disabledConfig = resolveShortTermMemoryConfig({ enabled: false });
      await recordTurn({
        workspaceDir: tmpDir,
        sessionId: "session-1",
        turn: 1,
        userInput: "hello",
        agentOutput: "world",
        config: disabledConfig,
      });

      const filePath = resolveShortTermFilePath(tmpDir);
      try {
        await fs.promises.access(filePath);
        // File should not exist
        expect.unreachable("File should not have been created");
      } catch {
        // Expected
      }
    });
  });

  describe("injectShortTermMemory", () => {
    it("returns null when no file exists", async () => {
      const result = await injectShortTermMemory({
        workspaceDir: tmpDir,
        config: defaultConfig,
      });
      expect(result).toBeNull();
    });

    it("returns formatted context with entries", async () => {
      // Write a few entries
      for (let i = 1; i <= 3; i++) {
        await recordTurn({
          workspaceDir: tmpDir,
          sessionId: "session-1",
          turn: i,
          userInput: `question ${i}`,
          agentOutput: `answer ${i}`,
          config: defaultConfig,
        });
      }

      const result = await injectShortTermMemory({
        workspaceDir: tmpDir,
        config: defaultConfig,
      });

      expect(result).not.toBeNull();
      expect(result).toContain("Memória Recente");
      expect(result).toContain("question 1");
      expect(result).toContain("answer 3");
      expect(result).toContain("[T1]");
      expect(result).toContain("[T3]");
    });

    it("respects maxInjectEntries limit", async () => {
      const limitedConfig = resolveShortTermMemoryConfig({ maxInjectEntries: 2 });

      for (let i = 1; i <= 5; i++) {
        await recordTurn({
          workspaceDir: tmpDir,
          sessionId: "session-1",
          turn: i,
          userInput: `msg ${i}`,
          agentOutput: `reply ${i}`,
          config: limitedConfig,
        });
      }

      const result = await injectShortTermMemory({
        workspaceDir: tmpDir,
        config: limitedConfig,
      });

      expect(result).not.toBeNull();
      // Should only have the last 2 entries
      expect(result).not.toContain("msg 1");
      expect(result).not.toContain("msg 2");
      expect(result).not.toContain("msg 3");
      expect(result).toContain("msg 4");
      expect(result).toContain("msg 5");
    });

    it("returns null when disabled", async () => {
      const disabledConfig = resolveShortTermMemoryConfig({ enabled: false });
      const result = await injectShortTermMemory({
        workspaceDir: tmpDir,
        config: disabledConfig,
      });
      expect(result).toBeNull();
    });
  });
});

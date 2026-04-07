import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AgentName } from "./types";

export type LlmProvider = "anthropic" | "openai" | "azure-openai" | "gemini";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  endpoint?: string;
  apiVersion?: string;
  deployment?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface LlmConfigFile {
  default?: Partial<LlmConfig>;
  agents?: Record<string, Partial<LlmConfig>>;
}

interface GenerateOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface VisionGenerateOptions extends GenerateOptions {
  imageBase64: string;
  mimeType: string;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  "azure-openai": "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

const DEFAULT_TIMEOUT_MS = 30_000;
const PLACEHOLDER_SECRET_PATTERNS = [
  /your-key-here/i,
  /your-azure-key/i,
  /your-gemini-key/i,
  /sk-ant-your-key-here/i,
  /sk-openai-your-key-here/i,
  /^changeme$/i,
];

function parseNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeSecret(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.toLowerCase();
  if (normalized === "undefined" || normalized === "null") {
    return undefined;
  }

  if (PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return undefined;
  }

  return trimmed;
}

function parseProvider(value?: string): LlmProvider | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "azure-openai" ||
    normalized === "gemini"
  ) {
    return normalized;
  }
  return undefined;
}

function getConfigFilePath(): string | null {
  const explicit = process.env.LLM_CONFIG_FILE?.trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(process.cwd(), explicit);
  }

  const defaultPath = path.resolve(process.cwd(), "config", "llm.config.json");
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function loadConfigFile(): LlmConfigFile | null {
  const filePath = getConfigFilePath();
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as LlmConfigFile;
    return parsed;
  } catch {
    return null;
  }
}

function mergeDefined<T extends object>(base: T, patch?: Partial<T>): T {
  if (!patch) return base;
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }
  return result as T;
}

function normalizeConfig(
  config: Partial<LlmConfig>,
  fallbackModel?: string,
): LlmConfig {
  const provider = config.provider ?? "anthropic";
  const model =
    config.model || fallbackModel || DEFAULT_MODEL_BY_PROVIDER[provider];
  return {
    provider,
    model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function getFileConfig(agentName: AgentName): Partial<LlmConfig> {
  const fileConfig = loadConfigFile();
  if (!fileConfig) return {};
  const scopedAgent = fileConfig.agents?.[agentName] || {};
  return mergeDefined(
    mergeDefined({} as Partial<LlmConfig>, fileConfig.default),
    scopedAgent,
  );
}

function getEnvConfig(agentName: AgentName): Partial<LlmConfig> {
  const prefix = `${agentName}_`;
  const provider =
    parseProvider(process.env[`${prefix}LLM_PROVIDER`]) ??
    parseProvider(process.env.LLM_PROVIDER);

  const model =
    process.env[`${prefix}LLM_MODEL`] ||
    process.env.LLM_MODEL ||
    process.env[`${prefix}CLAUDE_MODEL`] ||
    process.env.CLAUDE_MODEL;

  const baseUrl =
    process.env[`${prefix}OPENAI_BASE_URL`] || process.env.OPENAI_BASE_URL;
  const endpoint =
    process.env[`${prefix}AZURE_OPENAI_ENDPOINT`] ||
    process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion =
    process.env[`${prefix}AZURE_OPENAI_API_VERSION`] ||
    process.env.AZURE_OPENAI_API_VERSION ||
    "2024-10-21";
  const deployment =
    process.env[`${prefix}AZURE_OPENAI_DEPLOYMENT`] ||
    process.env.AZURE_OPENAI_DEPLOYMENT;

  const temperature =
    parseNumber(process.env[`${prefix}LLM_TEMPERATURE`]) ??
    parseNumber(process.env.LLM_TEMPERATURE);
  const maxTokens =
    parseNumber(process.env[`${prefix}LLM_MAX_TOKENS`]) ??
    parseNumber(process.env.LLM_MAX_TOKENS);
  const timeoutMs =
    parseNumber(process.env[`${prefix}LLM_TIMEOUT_MS`]) ??
    parseNumber(process.env.LLM_TIMEOUT_MS);

  let apiKey =
    sanitizeSecret(process.env[`${prefix}LLM_API_KEY`]) ||
    sanitizeSecret(process.env.LLM_API_KEY);

  if (!apiKey) {
    if (provider === "openai") {
      apiKey =
        sanitizeSecret(process.env[`${prefix}OPENAI_API_KEY`]) ||
        sanitizeSecret(process.env.OPENAI_API_KEY);
    } else if (provider === "azure-openai") {
      apiKey =
        sanitizeSecret(process.env[`${prefix}AZURE_OPENAI_API_KEY`]) ||
        sanitizeSecret(process.env.AZURE_OPENAI_API_KEY) ||
        sanitizeSecret(process.env[`${prefix}OPENAI_API_KEY`]) ||
        sanitizeSecret(process.env.OPENAI_API_KEY);
    } else if (provider === "gemini") {
      apiKey =
        sanitizeSecret(process.env[`${prefix}GEMINI_API_KEY`]) ||
        sanitizeSecret(process.env.GEMINI_API_KEY);
    } else {
      apiKey =
        sanitizeSecret(process.env[`${prefix}ANTHROPIC_API_KEY`]) ||
        sanitizeSecret(process.env.ANTHROPIC_API_KEY);
    }
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    endpoint,
    apiVersion,
    deployment,
    temperature,
    maxTokens,
    timeoutMs,
  };
}

function extractTextFromAnthropic(response: any): string {
  const chunks = Array.isArray(response?.content) ? response.content : [];
  return chunks
    .filter(
      (chunk: any) => chunk?.type === "text" && typeof chunk.text === "string",
    )
    .map((chunk: any) => chunk.text)
    .join("\n")
    .trim();
}

function extractTextFromOpenAi(response: any): string {
  if (response?.choices?.[0]?.message?.content) {
    const content = response.choices[0].message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
        .trim();
    }
  }
  return "";
}

function extractTextFromGemini(response: any): string {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}

export function resolveAgentLlmConfig(
  agentName: AgentName,
  fallbackModel?: string,
): LlmConfig {
  const fileConfig = getFileConfig(agentName);
  const envConfig = getEnvConfig(agentName);
  const merged = mergeDefined(
    mergeDefined({} as Partial<LlmConfig>, fileConfig),
    envConfig,
  );
  return normalizeConfig(merged, fallbackModel);
}

export function extractJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export function extractJsonArray(text: string): string | null {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

export class LlmClient {
  private config: LlmConfig;
  private anthropic?: Anthropic;
  private openai?: OpenAI;

  constructor(config: LlmConfig) {
    this.config = config;
    const apiKey =
      sanitizeSecret(config.apiKey) ||
      sanitizeSecret(process.env.LLM_API_KEY) ||
      sanitizeSecret(process.env.ANTHROPIC_API_KEY);

    if (config.provider === "anthropic" && apiKey) {
      this.anthropic = new Anthropic({
        apiKey,
      });
    }

    if (config.provider === "openai") {
      const openAiKey =
        sanitizeSecret(config.apiKey) ||
        sanitizeSecret(process.env.LLM_API_KEY) ||
        sanitizeSecret(process.env.OPENAI_API_KEY);
      if (!openAiKey) {
        return;
      }

      this.openai = new OpenAI({
        apiKey: openAiKey,
        baseURL: config.baseUrl,
      });
    }

    if (config.provider === "azure-openai") {
      const azureApiKey =
        sanitizeSecret(config.apiKey) ||
        sanitizeSecret(process.env.AZURE_OPENAI_API_KEY) ||
        sanitizeSecret(process.env.OPENAI_API_KEY);
      const endpoint = (
        config.endpoint ||
        process.env.AZURE_OPENAI_ENDPOINT ||
        ""
      ).replace(/\/$/, "");
      const deployment = config.deployment || config.model;
      const apiVersion = config.apiVersion || "2024-10-21";
      if (!azureApiKey || !endpoint) {
        return;
      }

      this.openai = new OpenAI({
        apiKey: azureApiKey,
        baseURL: `${endpoint}/openai/deployments/${deployment}`,
        defaultQuery: { "api-version": apiVersion },
        defaultHeaders: {
          "api-key": azureApiKey,
        },
      });
    }
  }

  get activeConfig(): LlmConfig {
    return this.config;
  }

  async generateText(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    const timeoutMs =
      options.timeoutMs || this.config.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.config.provider === "anthropic") {
      if (!this.anthropic) {
        throw new Error("Anthropic API key is not configured");
      }

      const response = await withTimeout(
        this.anthropic!.messages.create({
          model: this.config.model,
          max_tokens: options.maxTokens ?? this.config.maxTokens ?? 1000,
          temperature: options.temperature ?? this.config.temperature,
          messages: [
            {
              role: "user",
              content: options.system
                ? `${options.system}\n\n${prompt}`
                : prompt,
            },
          ],
        }),
        timeoutMs,
        "Anthropic request timed out",
      );
      return extractTextFromAnthropic(response);
    }

    if (
      this.config.provider === "openai" ||
      this.config.provider === "azure-openai"
    ) {
      if (!this.openai) {
        throw new Error("OpenAI API configuration is not available");
      }

      const response = await withTimeout(
        this.openai!.chat.completions.create({
          model: this.config.model,
          temperature: options.temperature ?? this.config.temperature,
          max_tokens: options.maxTokens ?? this.config.maxTokens,
          messages: [
            ...(options.system
              ? [{ role: "system" as const, content: options.system }]
              : []),
            { role: "user" as const, content: prompt },
          ],
        }),
        timeoutMs,
        "OpenAI request timed out",
      );
      return extractTextFromOpenAi(response);
    }

    const geminiApiKey =
      sanitizeSecret(this.config.apiKey) ||
      sanitizeSecret(process.env.GEMINI_API_KEY);
    if (!geminiApiKey) {
      throw new Error("Gemini API key is not configured");
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await withTimeout(
      fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                ...(options.system ? [{ text: options.system }] : []),
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? this.config.temperature,
            maxOutputTokens: options.maxTokens ?? this.config.maxTokens,
          },
        }),
      }),
      timeoutMs,
      "Gemini request timed out",
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      throw new Error(
        `Gemini request failed (${geminiResponse.status}): ${errBody}`,
      );
    }

    const payload = await geminiResponse.json();
    return extractTextFromGemini(payload);
  }

  async generateVisionText(
    prompt: string,
    options: VisionGenerateOptions,
  ): Promise<string> {
    const timeoutMs =
      options.timeoutMs || this.config.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.config.provider === "anthropic") {
      if (!this.anthropic) {
        throw new Error("Anthropic API key is not configured");
      }

      const response = await withTimeout(
        this.anthropic!.messages.create({
          model: this.config.model,
          max_tokens: options.maxTokens ?? this.config.maxTokens ?? 2000,
          temperature: options.temperature ?? this.config.temperature,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: options.mimeType as any,
                    data: options.imageBase64,
                  },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
        timeoutMs,
        "Anthropic vision request timed out",
      );
      return extractTextFromAnthropic(response);
    }

    if (
      this.config.provider === "openai" ||
      this.config.provider === "azure-openai"
    ) {
      if (!this.openai) {
        throw new Error("OpenAI API configuration is not available");
      }

      const response = await withTimeout(
        this.openai!.chat.completions.create({
          model: this.config.model,
          temperature: options.temperature ?? this.config.temperature,
          max_tokens: options.maxTokens ?? this.config.maxTokens,
          messages: [
            ...(options.system
              ? [{ role: "system" as const, content: options.system }]
              : []),
            {
              role: "user" as const,
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${options.mimeType};base64,${options.imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
        timeoutMs,
        "OpenAI vision request timed out",
      );
      return extractTextFromOpenAi(response);
    }

    const geminiApiKey =
      sanitizeSecret(this.config.apiKey) ||
      sanitizeSecret(process.env.GEMINI_API_KEY);
    if (!geminiApiKey) {
      throw new Error("Gemini API key is not configured");
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await withTimeout(
      fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: options.mimeType,
                    data: options.imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? this.config.temperature,
            maxOutputTokens: options.maxTokens ?? this.config.maxTokens,
          },
        }),
      }),
      timeoutMs,
      "Gemini vision request timed out",
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      throw new Error(
        `Gemini vision request failed (${geminiResponse.status}): ${errBody}`,
      );
    }

    const payload = await geminiResponse.json();
    return extractTextFromGemini(payload);
  }
}

import { z } from "zod";
import { AgentCard } from "./types";

const agentCardProviderSchema = z
  .object({
    organization: z.string().min(1),
    url: z.string().url(),
  })
  .strict();

const agentCardCapabilitiesSchema = z
  .object({
    streaming: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    stateTransitionHistory: z.boolean().optional(),
  })
  .strict();

const agentCardAuthenticationSchema = z
  .object({
    schemes: z.array(z.string().min(1)),
    credentials: z.string().min(1).optional(),
  })
  .strict();

const agentCardSkillSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string().min(1)),
    examples: z.array(z.string().min(1)).optional(),
    inputModes: z.array(z.string().min(1)).optional(),
    outputModes: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const agentCardSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    url: z.string().url(),
    provider: agentCardProviderSchema.optional(),
    version: z.string().min(1),
    documentationUrl: z.string().url().optional(),
    capabilities: agentCardCapabilitiesSchema,
    authentication: agentCardAuthenticationSchema,
    defaultInputModes: z.array(z.string().min(1)).min(1),
    defaultOutputModes: z.array(z.string().min(1)).min(1),
    skills: z.array(agentCardSkillSchema).min(1),
  })
  .strict();

export type AgentCardValidationResult =
  | { success: true; data: AgentCard }
  | { success: false; errors: string[] };

export function validateAgentCard(
  candidate: unknown,
): AgentCardValidationResult {
  const parsed = agentCardSchema.safeParse(candidate);
  if (parsed.success) {
    return { success: true, data: parsed.data as AgentCard };
  }

  return {
    success: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    }),
  };
}

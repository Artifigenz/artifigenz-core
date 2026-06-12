export type ChatProvider = "anthropic" | "openai";

export type Plan = "basic" | "pro";

export type Intelligence = "instant" | "medium" | "high";

export interface ChatModel {
  /** API model identifier sent on each request. */
  id: string;
  /** Short label shown in the picker (e.g. "Sonnet 4.6"). */
  label: string;
  /** Provider-name shown alongside, e.g. "Claude" or "OpenAI". */
  family: string;
  provider: ChatProvider;
  /** Plan tier required to use this model. */
  tier: Plan;
  /** One-liner shown in the picker's expanded view. */
  description?: string;
  /** True when the model supports image attachments. */
  vision?: boolean;
  /** False for models that reject the `temperature` parameter (Opus 4.7, o-series). */
  supportsTemperature?: boolean;
  /** True when the model supports Anthropic extended-thinking (Claude only). */
  supportsThinking?: boolean;
}

export const MODELS: ChatModel[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    family: "Claude",
    provider: "anthropic",
    tier: "basic",
    description: "Smart + fast. Default for chat.",
    vision: true,
    supportsThinking: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    family: "Claude",
    provider: "anthropic",
    tier: "basic",
    description: "Fastest, cheapest Claude.",
    vision: true,
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    family: "OpenAI",
    provider: "openai",
    tier: "basic",
    description: "Fast OpenAI option.",
    vision: true,
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    family: "Claude",
    provider: "anthropic",
    tier: "pro",
    description: "Most capable Claude. Slower, deeper.",
    vision: true,
    supportsTemperature: false,
    supportsThinking: true,
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    family: "OpenAI",
    provider: "openai",
    tier: "pro",
    description: "OpenAI's current flagship.",
    vision: true,
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    family: "OpenAI",
    provider: "openai",
    tier: "pro",
    description: "Dedicated reasoning model.",
    vision: true,
    supportsTemperature: false,
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
export const DEFAULT_INTELLIGENCE: Intelligence = "medium";

export function findModel(id: string | null | undefined): ChatModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

/** Models the user can pick given their plan. */
export function modelsAvailableForPlan(plan: Plan): ChatModel[] {
  return MODELS.filter((m) => plan === "pro" || m.tier === "basic");
}

/** Intelligence levels the user can pick given their plan. */
export function intelligenceAvailableForPlan(
  plan: Plan,
): Record<Intelligence, boolean> {
  return {
    instant: true,
    medium: true,
    // High = extended thinking. Gated to Pro to make the upgrade meaningful;
    // when we add real billing, this is the most visible Pro perk.
    high: plan === "pro",
  };
}

export interface ResolvedModelConfig {
  /** The model id we should actually call (may differ from the user's pick). */
  actualModelId: string;
  /**
   * Anthropic extended-thinking budget in tokens, or null if disabled.
   * Only meaningful on Claude models with `supportsThinking`.
   */
  thinkingBudget: number | null;
  /** Whether the call should request reasoning effort (OpenAI o-series). */
  reasoningEffort: "low" | "medium" | "high" | null;
}

/**
 * Resolve the user's (intelligence + modelId) selection into the actual model
 * id + thinking budget the server should pass to the provider.
 *
 * Rules:
 *  - Instant always routes to Haiku, ignoring the picked model. Fastest path.
 *  - Medium = picked model, no extended thinking.
 *  - High = picked model + extended thinking (when supported). Haiku gets
 *    auto-promoted to Sonnet because Haiku doesn't support thinking. OpenAI
 *    reasoning models surface High via reasoning_effort.
 */
export function resolveModelConfig(
  intelligence: Intelligence,
  modelId: string,
): ResolvedModelConfig {
  if (intelligence === "instant") {
    return {
      actualModelId: "claude-haiku-4-5",
      thinkingBudget: null,
      reasoningEffort: null,
    };
  }

  const model = findModel(modelId);

  if (intelligence === "medium") {
    return {
      actualModelId: model.id,
      thinkingBudget: null,
      reasoningEffort: null,
    };
  }

  // High — extended thinking on Claude, reasoning_effort on OpenAI.
  if (model.provider === "anthropic") {
    if (model.supportsThinking) {
      const budget = model.id === "claude-opus-4-7" ? 16000 : 8000;
      return {
        actualModelId: model.id,
        thinkingBudget: budget,
        reasoningEffort: null,
      };
    }
    // Haiku doesn't think — promote to Sonnet + thinking instead.
    return {
      actualModelId: "claude-sonnet-4-6",
      thinkingBudget: 8000,
      reasoningEffort: null,
    };
  }

  // OpenAI: o-series already reasons; non-o-series gets reasoning_effort hint.
  return {
    actualModelId: model.id,
    thinkingBudget: null,
    reasoningEffort: "high",
  };
}

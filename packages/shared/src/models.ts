export type ChatProvider = "anthropic" | "openai";

export interface ChatModel {
  /** API model identifier sent on each request. */
  id: string;
  /** Short label shown in the picker (e.g. "Sonnet 4.6"). */
  label: string;
  /** Provider-name shown alongside, e.g. "Claude" or "OpenAI". */
  family: string;
  provider: ChatProvider;
  /** One-liner shown in the picker's expanded view. */
  description?: string;
  /** True when the model supports image attachments. */
  vision?: boolean;
  /** False for models that reject the `temperature` parameter (Opus 4.7, o-series). */
  supportsTemperature?: boolean;
}

export const MODELS: ChatModel[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    family: "Claude",
    provider: "anthropic",
    description: "Smart + fast. Default for chat.",
    vision: true,
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    family: "Claude",
    provider: "anthropic",
    description: "Most capable Claude. Slower, deeper.",
    vision: true,
    supportsTemperature: false,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    family: "Claude",
    provider: "anthropic",
    description: "Fastest, cheapest Claude.",
    vision: true,
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    family: "OpenAI",
    provider: "openai",
    description: "OpenAI's current flagship.",
    vision: true,
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    family: "OpenAI",
    provider: "openai",
    description: "Fast + cheap GPT-5 variant.",
    vision: true,
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    family: "OpenAI",
    provider: "openai",
    description: "Reasoning model — slower, deeper thinking.",
    vision: true,
    supportsTemperature: false,
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export function findModel(id: string | null | undefined): ChatModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { AiProviderName, TokenUsage } from './ai.types';

/**
 * Token counting and cost accounting.
 *
 * Provider-reported usage is always preferred. When a provider does not return
 * usage (or when running the deterministic local engine) tokens are counted
 * locally with the o200k_base tokenizer and the result is flagged `estimated`.
 */

/**
 * Rate card in US dollars per one million tokens.
 *
 * These are configured defaults, not a live price feed. Verify them against the
 * provider's current pricing page before relying on the cost figure, and
 * override with OPSPILOT_PRICE_<KEY> environment variables where they differ.
 */
const DEFAULT_RATES: Readonly<
  Record<string, { input: number; output: number }>
> = {
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5': { input: 1.25, output: 10.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
  'amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
  'amazon.nova-pro-v1:0': { input: 0.8, output: 3.2 },
  'amazon.titan-embed-text-v2:0': { input: 0.02, output: 0 },
};

let encoder: Tiktoken | undefined;

/** Lazily built: the rank table is large and local-only runs rarely need it. */
function getEncoder(): Tiktoken {
  encoder ??= getEncoding('o200k_base');
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Never let tokenizer trouble break a request; approximate instead.
    return Math.ceil(text.length / 4);
  }
}

function normalizeModelKey(model: string): string {
  const trimmed = model.trim().toLowerCase();
  // Bedrock model IDs may carry a regional prefix such as `us.` or `eu.`.
  return trimmed.replace(/^(?:us|eu|apac)\./, '');
}

export function rateFor(model: string): { input: number; output: number } {
  const key = normalizeModelKey(model);
  const envKey = `OPSPILOT_PRICE_${key.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`;
  const override = process.env[envKey];
  if (override) {
    const [input, output] = override.split(',').map(Number);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      return { input: input as number, output: output as number };
    }
  }
  return DEFAULT_RATES[key] ?? { input: 0, output: 0 };
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = rateFor(model);
  const cost =
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output;
  // Sub-cent precision matters here: a single request often costs < $0.0001.
  return Number(cost.toFixed(8));
}

export function buildUsage(input: {
  provider: AiProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}): TokenUsage {
  const { provider, model, inputTokens, outputTokens, estimated } = input;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // The local engine calls no hosted model, so it can never accrue cost.
    costUsd:
      provider === 'local' ? 0 : computeCostUsd(model, inputTokens, outputTokens),
    estimated,
  };
}

export function estimateUsage(input: {
  provider: AiProviderName;
  model: string;
  inputText: string;
  outputText: string;
}): TokenUsage {
  return buildUsage({
    provider: input.provider,
    model: input.model,
    inputTokens: countTokens(input.inputText),
    outputTokens: countTokens(input.outputText),
    estimated: true,
  });
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  estimated: true,
};

export function sumUsage(parts: readonly TokenUsage[]): TokenUsage {
  return parts.reduce<TokenUsage>(
    (total, part) => ({
      inputTokens: total.inputTokens + part.inputTokens,
      outputTokens: total.outputTokens + part.outputTokens,
      totalTokens: total.totalTokens + part.totalTokens,
      costUsd: Number((total.costUsd + part.costUsd).toFixed(8)),
      estimated: total.estimated || part.estimated,
    }),
    { ...EMPTY_USAGE, estimated: false },
  );
}

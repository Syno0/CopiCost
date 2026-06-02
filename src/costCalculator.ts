import { LlmRequestEntry, ModelPricing, SessionInfo } from "./logParser";
import { FALLBACK_PRICING, UNKNOWN_MODEL_PRICING } from "./config";

export interface RequestCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  inputCost: number; // USD
  outputCost: number; // USD
  cacheCost: number; // USD
  totalCost: number; // USD
  timestamp: number;
  duration: number;
  ttft?: number;
  debugName?: string;
}

export interface SessionCost {
  sessionId: string;
  startTime?: number;
  userMessage?: string;
  requests: RequestCost[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCost: number; // USD
  totalDuration: number; // ms
}

function computeRequestCost(
  entry: LlmRequestEntry,
  pricing: Map<string, ModelPricing>,
): RequestCost {
  const model = entry.attrs.model;
  const inputTokens = entry.attrs.inputTokens ?? 0;
  const outputTokens = entry.attrs.outputTokens ?? 0;
  const cachedTokens = entry.attrs.cachedTokens ?? 0;

  // Non-cached input tokens = total input - cached
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

  let inputPricePer1M: number;
  let outputPricePer1M: number;
  let cachePricePer1M: number;

  const modelPricing = pricing.get(model);
  if (modelPricing) {
    inputPricePer1M = modelPricing.inputPrice;
    outputPricePer1M = modelPricing.outputPrice;
    cachePricePer1M = modelPricing.cachePrice;
  } else {
    // Try fallback by checking if model name starts with a known prefix
    const fallback =
      FALLBACK_PRICING[model] ??
      Object.entries(FALLBACK_PRICING).find(([key]) =>
        model.startsWith(key),
      )?.[1];
    if (fallback) {
      inputPricePer1M = fallback.input;
      outputPricePer1M = fallback.output;
      cachePricePer1M = fallback.cache;
    } else {
      // Unknown model, use conservative estimate
      inputPricePer1M = UNKNOWN_MODEL_PRICING.input;
      outputPricePer1M = UNKNOWN_MODEL_PRICING.output;
      cachePricePer1M = UNKNOWN_MODEL_PRICING.cache;
    }
  }

  // Prices are in cents per million tokens → convert to USD
  const inputCost = (nonCachedInput / 1_000_000) * (inputPricePer1M / 100);
  const outputCost = (outputTokens / 1_000_000) * (outputPricePer1M / 100);
  const cacheCost = (cachedTokens / 1_000_000) * (cachePricePer1M / 100);

  return {
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    inputCost,
    outputCost,
    cacheCost,
    totalCost: inputCost + outputCost + cacheCost,
    timestamp: entry.ts,
    duration: entry.dur,
    ttft: entry.attrs.ttft,
    debugName: entry.attrs.debugName,
  };
}

export function computeSessionCost(
  session: SessionInfo,
  pricing: Map<string, ModelPricing>,
): SessionCost {
  const requests = session.llmRequests.map((r) =>
    computeRequestCost(r, pricing),
  );

  return {
    sessionId: session.sessionId,
    startTime: session.startTime,
    userMessage: session.userMessage,
    requests,
    totalInputTokens: requests.reduce((sum, r) => sum + r.inputTokens, 0),
    totalOutputTokens: requests.reduce((sum, r) => sum + r.outputTokens, 0),
    totalCachedTokens: requests.reduce((sum, r) => sum + r.cachedTokens, 0),
    totalCost: requests.reduce((sum, r) => sum + r.totalCost, 0),
    totalDuration: requests.reduce((sum, r) => sum + r.duration, 0),
  };
}

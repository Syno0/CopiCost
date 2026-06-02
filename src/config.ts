/**
 * CopiCost configuration — all tuneable values in one place.
 */
import * as vscode from "vscode";

// --- Currency ---

export type Currency = "USD" | "EUR";

export function getCurrencyConfig(): { currency: Currency; rate: number } {
  const cfg = vscode.workspace.getConfiguration("copicost");
  return {
    currency: cfg.get<Currency>("currency", "USD"),
    rate: cfg.get<number>("eurUsdRate", 0.92),
  };
}

export function formatCurrency(usd: number): string {
  const { currency, rate } = getCurrencyConfig();
  const amount = currency === "EUR" ? usd * rate : usd;
  const sym = currency === "EUR" ? "€" : "$";

  if (amount === 0) {
    return `${sym}0`;
  }
  if (amount < 0.001) {
    return `<${sym}0.001`;
  }
  if (amount < 0.01) {
    return `${sym}${amount.toFixed(4)}`;
  }
  if (amount < 1) {
    return `${sym}${amount.toFixed(3)}`;
  }
  return `${sym}${amount.toFixed(2)}`;
}

// --- Budget ---

/** Monthly budget in USD (Copilot Pro plan) */
export const MONTHLY_BUDGET_USD = 20;

// --- Status bar thresholds (percentage of monthly budget) ---

/** % threshold to show warning icon */
export const STATUS_BAR_WARNING_PCT = 50;
/** % threshold to show flame icon + warning background */
export const STATUS_BAR_CRITICAL_PCT = 80;

// --- Cost color/icon thresholds (USD per single request or session) ---

/** Cost >= this shows red flame icon */
export const COST_THRESHOLD_HIGH = 0.05;
/** Cost >= this shows orange warning icon */
export const COST_THRESHOLD_MEDIUM = 0.01;
/** Cost >= this shows yellow filled circle */
export const COST_THRESHOLD_LOW = 0.005;

// --- Fallback pricing (cents per million tokens) ---
// Used when models.json is unavailable for a given model.

export const FALLBACK_PRICING: Record<
  string,
  { input: number; output: number; cache: number }
> = {
  "claude-opus-4.6": { input: 500, output: 2500, cache: 50 },
  "claude-sonnet-4.6": { input: 300, output: 1500, cache: 30 },
  "claude-sonnet-4": { input: 300, output: 1500, cache: 30 },
  "gpt-4o": { input: 250, output: 1000, cache: 125 },
  "gpt-4o-mini": { input: 15, output: 60, cache: 8 },
  "gpt-4.1": { input: 200, output: 800, cache: 50 },
  "gpt-4.1-mini": { input: 40, output: 160, cache: 10 },
  "gpt-4.1-nano": { input: 10, output: 40, cache: 3 },
  o3: { input: 200, output: 800, cache: 50 },
  "o3-mini": { input: 110, output: 440, cache: 28 },
  "o4-mini": { input: 110, output: 440, cache: 28 },
  "gemini-2.5-pro": { input: 125, output: 1000, cache: 32 },
  "gemini-2.5-flash": { input: 15, output: 60, cache: 4 },
  "gemini-3.1-pro-preview": { input: 200, output: 1200, cache: 20 },
};

/** Default pricing for completely unknown models (cents per million tokens) */
export const UNKNOWN_MODEL_PRICING = { input: 300, output: 1500, cache: 30 };

// --- Detail panel: approximate input price for "no-cache" cost estimate (USD per million tokens) ---

export const APPROX_INPUT_PRICE_USD_PER_M: Record<string, number> = {
  "claude-opus-4.6": 5.0,
  "claude-sonnet-4.6": 3.0,
  "gpt-4o": 2.5,
  "gpt-4.1": 2.0,
  "gpt-4.1-mini": 0.4,
  "gemini-3.1-pro-preview": 2.0,
};

/** Fallback input price if model not in the map above */
export const APPROX_INPUT_PRICE_DEFAULT = 3.0;

// --- Report panel ---

/** Rough estimate for cache savings calculation (USD per million cached tokens) */
export const CACHE_SAVINGS_ESTIMATE_PER_M = 3;

/** Max sessions shown in the report */
export const REPORT_MAX_SESSIONS = 30;
/** Max days shown in the report */
export const REPORT_MAX_DAYS = 30;
/** Max top expensive requests in the report */
export const REPORT_TOP_EXPENSIVE = 10;

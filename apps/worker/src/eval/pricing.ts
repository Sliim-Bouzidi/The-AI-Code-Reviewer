/**
 * Model pricing configuration and cost calculation for Étape 6 benchmarks.
 * 
 * Supports configurable pricing per provider/model with currency, effective dates,
 * and authoritative source references. Returns null for unknown/unconfigured models
 * to ensure missing data is never misreported as zero cost.
 */

export interface ModelPricing {
  provider: string;
  model: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  currency: 'USD';
  effectiveDate: string;
  source: string;
}

export interface CostCalculationResult {
  costUsd: number | null;
  isConfigured: boolean;
  inputTokens: number;
  outputTokens: number;
  pricing?: ModelPricing;
}

/** Default price registry for standard supported LLM providers and models. */
export const MODEL_PRICING_REGISTRY: Record<string, ModelPricing> = {
  // OpenAI API
  'openai-api:gpt-4o': {
    provider: 'openai-api',
    model: 'gpt-4o',
    inputUsdPer1M: 2.50,
    outputUsdPer1M: 10.00,
    currency: 'USD',
    effectiveDate: '2024-10-01',
    source: 'https://openai.com/api/pricing/',
  },
  'openai-api:gpt-4o-mini': {
    provider: 'openai-api',
    model: 'gpt-4o-mini',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    currency: 'USD',
    effectiveDate: '2024-07-18',
    source: 'https://openai.com/api/pricing/',
  },
  'openai:gpt-4o-mini': {
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    currency: 'USD',
    effectiveDate: '2024-07-18',
    source: 'https://openai.com/api/pricing/',
  },

  // Anthropic API
  'anthropic:claude-3-5-sonnet-20241022': {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    inputUsdPer1M: 3.00,
    outputUsdPer1M: 15.00,
    currency: 'USD',
    effectiveDate: '2024-10-22',
    source: 'https://www.anthropic.com/pricing',
  },
  'anthropic:claude-3-haiku-20240307': {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 1.25,
    currency: 'USD',
    effectiveDate: '2024-03-07',
    source: 'https://www.anthropic.com/pricing',
  },

  // Google Gemini API
  'gemini:gemini-1.5-flash': {
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    inputUsdPer1M: 0.075,
    outputUsdPer1M: 0.30,
    currency: 'USD',
    effectiveDate: '2024-05-14',
    source: 'https://ai.google.dev/pricing',
  },
  'gemini:gemini-1.5-pro': {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 5.00,
    currency: 'USD',
    effectiveDate: '2024-05-14',
    source: 'https://ai.google.dev/pricing',
  },

  // Mock Provider for testing (zero paid API calls in tests)
  'mock:mock-model': {
    provider: 'mock',
    model: 'mock-model',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    currency: 'USD',
    effectiveDate: '2024-01-01',
    source: 'mock://test-pricing',
  },
  'mock:mock-economic': {
    provider: 'mock',
    model: 'mock-economic',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    currency: 'USD',
    effectiveDate: '2024-01-01',
    source: 'mock://test-pricing',
  },
  'mock:mock-powerful': {
    provider: 'mock',
    model: 'mock-powerful',
    inputUsdPer1M: 3.00,
    outputUsdPer1M: 15.00,
    currency: 'USD',
    effectiveDate: '2024-01-01',
    source: 'mock://test-pricing',
  },
};

/**
 * Retrieves pricing configuration for a given provider and model.
 * Returns null if provider:model is unconfigured.
 */
export function getPricingConfig(provider: string, model: string): ModelPricing | null {
  const key = `${provider.toLowerCase().trim()}:${model.toLowerCase().trim()}`;
  if (MODEL_PRICING_REGISTRY[key]) {
    return MODEL_PRICING_REGISTRY[key];
  }

  // Soft fallback matching by model prefix if exact provider key is missing
  const modelKey = model.toLowerCase().trim();
  for (const entry of Object.values(MODEL_PRICING_REGISTRY)) {
    if (entry.model.toLowerCase() === modelKey) {
      return entry;
    }
  }

  return null;
}

/**
 * Calculates the cost in USD for a single LLM call.
 * Returns costUsd = null if provider or model pricing is unconfigured.
 */
export function calculateCallCostUsd(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number
): CostCalculationResult {
  const pricing = getPricingConfig(provider, model);
  if (!pricing) {
    return {
      costUsd: null,
      isConfigured: false,
      inputTokens: tokensIn,
      outputTokens: tokensOut,
    };
  }

  const inputCost = (tokensIn / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = (tokensOut / 1_000_000) * pricing.outputUsdPer1M;
  const totalCostUsd = Number((inputCost + outputCost).toFixed(6));

  return {
    costUsd: totalCostUsd,
    isConfigured: true,
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    pricing,
  };
}

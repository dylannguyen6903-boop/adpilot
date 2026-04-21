/**
 * AI Provider Abstraction for AdPilot
 *
 * Supports OpenAI (GPT-4o-mini, GPT-4o) with structured JSON output.
 * Factory pattern: createAIClient(provider, apiKey, model) → standardized interface.
 */

export interface AIResponse {
  content: string;
  parsed: unknown;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  durationMs: number;
}

export interface AIClient {
  generateInsight(prompt: string, systemPrompt?: string): Promise<AIResponse>;
}

/**
 * Create an AI client for the given provider.
 */
export function createAIClient(
  provider: string,
  apiKey: string,
  model?: string
): AIClient {
  switch (provider.toLowerCase()) {
    case 'openai':
      return new OpenAIClient(apiKey, model || 'gpt-4o-mini');
    default:
      throw new Error(`Unsupported AI provider: ${provider}. Supported: openai`);
  }
}

// ─────────────────────────────────────────────
// OpenAI Implementation
// ─────────────────────────────────────────────

class OpenAIClient implements AIClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateInsight(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    const startTime = Date.now();

    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    } else {
      // OpenAI requires 'json' keyword in messages when using json_object response_format
      messages.push({ role: 'system', content: 'You are an expert analyst. Always respond in valid JSON format.' });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,   // Lower temp for structured, consistent analysis
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error (${response.status}): ${err?.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content || '{}';

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { raw: content, parseError: true };
    }

    return {
      content,
      parsed,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || this.model,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Validate an AI API key by making a minimal request.
 */
export async function validateAIKey(
  provider: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = createAIClient(provider, apiKey);
    await client.generateInsight('Respond with: {"status":"ok"}');
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

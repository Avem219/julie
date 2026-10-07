export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export interface AIProvider {
  readonly name: string;
  complete(input: { system: string; messages: ChatMessage[] }): Promise<{ text: string; tokensIn: number | null; tokensOut: number | null; model: string }>;
}

/** Anthropic Messages API adapter. NOT exercised against the live API in the authoring sandbox (no network). */
export function anthropicProvider(apiKey: string, model: string): AIProvider {
  return {
    name: 'anthropic',
    async complete({ system, messages }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 800, system, messages }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
      const data: any = await res.json();
      const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      if (!text) throw new Error('AI provider returned no text');
      return { text, tokensIn: data.usage?.input_tokens ?? null, tokensOut: data.usage?.output_tokens ?? null, model };
    },
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv): AIProvider | null {
  if (env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY && env.AI_MODEL) return anthropicProvider(env.AI_API_KEY, env.AI_MODEL);
  return null; // unconfigured: the API reports "unavailable" instead of pretending
}

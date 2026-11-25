import { Agent } from '@mastra/core/agent';
import { docsExpert } from '../src/mastra/agents/docs-expert';
import { disconnectWebRouter, getDocsWebTools } from '../src/mastra/tools/docs-web';

if (!process.env.MASTRA_GATEWAY_API_KEY) throw new Error('Set MASTRA_GATEWAY_API_KEY in .env before comparing.');

const questions = [
  'In Mastra MCPClient, how do I launch a local stdio server and pass its credentials? Cite the reference.',
  'How does Node.js AbortSignal.timeout differ from AbortSignal.any? Cite the Node.js documentation.',
  'How do PostgreSQL HNSW and IVFFlat indexes differ in pgvector? Cite the maintainer documentation.',
];
const model = process.env.AGENT_MODEL?.trim() || 'mastra/openai/gpt-6.1-terra';
const instructions = await docsExpert.getInstructions();
const originalFetch = globalThis.fetch;
let gatewaySearchCalls: unknown[] = [];

// The baseline search tool makes additional inference calls outside agent.totalUsage.
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  if (typeof init?.body === 'string' && init.body.includes('openrouter:web_search')) {
    const body = await response.clone().json().catch(() => ({}));
    gatewaySearchCalls.push({ status: response.status, usage: body.usage ?? null, model: body.model ?? null });
  }
  return response;
};

function diagnostic(error: unknown) {
  let message = error instanceof Error ? error.message : 'Unknown comparison error';
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value && value.length >= 6) {
      message = message.split(value).join('[redacted]');
    }
  }
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
}

try {
  for (const [index, question] of questions.entries()) {
    // Alternate order; each answer gets an agent without conversation memory.
    const providers = index % 2 ? ['webrouter', 'gateway'] : ['gateway', 'webrouter'];
    for (const provider of providers) {
      gatewaySearchCalls = [];
      const start = performance.now();
      const metadata = { provider, model, question, timestamp: new Date().toISOString(), memory: false };
      let stage = 'setup';
      try {
        const tools = await getDocsWebTools({ ...process.env, DOCS_WEB_PROVIDER: provider });
        const agent = new Agent({ id: `compare-${provider}`, name: 'Docs Expert', instructions, model, tools });
        stage = 'inference';
        const result = await agent.generate(question, { maxSteps: 100 });
        console.log(JSON.stringify({
          ...metadata, latencyMs: Math.round(performance.now() - start), answer: result.text,
          agentUsage: result.totalUsage, gatewaySearchCalls,
          toolCalls: result.toolCalls, toolResults: result.toolResults,
          finishReason: result.finishReason,
          totalCostUsd: null, costStatus: 'Unavailable: reconcile model and web-provider billing separately.',
        }));
      } catch (error) {
        process.exitCode = 1;
        console.log(JSON.stringify({ ...metadata, latencyMs: Math.round(performance.now() - start),
          stage, error: diagnostic(error), gatewaySearchCalls, totalCostUsd: null }));
      } finally {
        await disconnectWebRouter();
      }
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  await disconnectWebRouter();
}

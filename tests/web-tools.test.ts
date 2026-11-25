import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { MCPClient } from '@mastra/mcp';
import { discoverWebRouterTools, disconnectWebRouter, getDocsWebTools } from '../src/mastra/tools/docs-web';

const fixtureUrl = new URL('./fixtures/mcp-server.mjs', import.meta.url);
const client = (args: string[] = []) => new MCPClient({
  registerProcessHooks: false,
  servers: { webrouter: { command: process.execPath, args: [fileURLToPath(fixtureUrl), ...args] } },
});

test('baseline works without Python setup and invalid provider fails visibly', async () => {
  assert.deepEqual(Object.keys(await getDocsWebTools({})), ['web_search']);
  await assert.rejects(getDocsWebTools({ DOCS_WEB_PROVIDER: 'typo' }), /DOCS_WEB_PROVIDER/);
});

test('production launcher supports an agent search, extraction and cited response', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'docs-web-test-'));
  const previousPath = process.env.PATH;
  const launcher = join(bin, 'uvx');
  const script = `#!${process.execPath}
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--from', 'webrouter[mcp]==0.15.0', 'web-router-mcp']);
assert.equal(process.env.WEB_ROUTER_MCP_TOOLS, 'search,extract');
assert.equal(process.env.WEB_ROUTER_ENV_FILE, '/example/provider.env');
await import(${JSON.stringify(fixtureUrl.href)});
`;
  await writeFile(launcher, script, { mode: 0o755 });
  if (process.platform === 'win32') {
    await writeFile(`${launcher}.cmd`, `@"${process.execPath}" "${launcher}" %*\r\n`);
  }
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`;
  let step = 0;
  const model = new MastraLanguageModelV2Mock({ doGenerate: async options => {
    assert.deepEqual(options.tools?.map(tool => tool.name).sort(), ['web_extract', 'web_search']);
    const content = step < 2
      ? [{ type: 'tool-call' as const, toolCallId: String(step), toolName: step === 0 ? 'web_search' : 'web_extract',
          input: JSON.stringify(step === 0 ? { query: 'Example API' } : { urls: ['https://example.com/docs'] }) }]
      : [{ type: 'text' as const, text: 'Use the documented API. [Example docs](https://example.com/docs)' }];
    return { content, finishReason: step++ < 2 ? 'tool-calls' : 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, warnings: [] };
  } });
  try {
    const tools = await getDocsWebTools({ DOCS_WEB_PROVIDER: 'webrouter', WEB_ROUTER_ENV_FILE: '/example/provider.env' });
    const agent = new Agent({ id: 'test-docs', name: 'Test Docs', model, tools: () => tools,
      instructions: 'Search, read the source, then cite it.' });
    const result = await agent.generate('Example API?', { maxSteps: 5 });
    assert.equal(result.toolResults.length, 2);
    assert.match(JSON.stringify(result.toolResults), /Use the documented API/);
    assert.match(result.text, /\[Example docs\]\(https:\/\/example.com\/docs\)/);
    await assert.rejects(tools.web_search.execute!({ query: 'fail' }), /Provider unavailable/);
  } finally {
    await disconnectWebRouter();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(bin, { recursive: true, force: true });
  }
});

test('incomplete discovery cannot silently fall back to Gateway', async () => {
  const mcp = client(['--missing-extract']);
  try {
    await assert.rejects(discoverWebRouterTools(mcp), /search and extract/);
  } finally {
    await mcp.disconnect();
  }
});

test('startup failures retain the executable error', async () => {
  const mcp = new MCPClient({ registerProcessHooks: false,
    servers: { webrouter: { command: '/nonexistent/docs-web-test', timeout: 1_000 } } });
  try {
    await assert.rejects(discoverWebRouterTools(mcp), /ENOENT/);
  } finally {
    await mcp.disconnect();
  }
});

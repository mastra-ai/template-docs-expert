import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { disconnectWebRouter, getDocsWebTools } from '../src/mastra/tools/docs-web';

// A real subprocess peer makes startup failures and premature disconnects observable.
test('concurrent startup shares discovery, failed startup retries, and cached tools survive concurrent requests', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'docs-cache-test-'));
  const previousPath = process.env.PATH;
  const trace = join(bin, 'catalog.txt');
  const launcher = join(bin, 'uvx');
  const fixture = new URL('./fixtures/mcp-server.mjs', import.meta.url).href;
  await writeFile(launcher, `#!${process.execPath}
process.argv.push('--trace-file', ${JSON.stringify(trace)});
await import(${JSON.stringify(fixture)});
`, { mode: 0o755 });
  if (process.platform === 'win32') {
    await writeFile(`${launcher}.cmd`, `@"${process.execPath}" "${launcher}" %*\r\n`);
  }
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`;
  const env = { DOCS_WEB_PROVIDER: 'webrouter' };
  try {
    const failed = await Promise.allSettled([getDocsWebTools(env), getDocsWebTools(env)]);
    assert.ok(failed.every(result => result.status === 'rejected'));
    assert.equal((await readFile(trace, 'utf8')).trim(), 'list');

    const [first, second] = await Promise.all([getDocsWebTools(env), getDocsWebTools(env)]);
    assert.equal(first, second);
    const reading = first.web_search.execute!({ query: 'slow' });
    assert.equal(await getDocsWebTools(env), first);
    assert.equal((await reading).results[0].url, 'https://example.com/docs');
    assert.equal((await readFile(trace, 'utf8')).trim(), 'list\nlist');
  } finally {
    await disconnectWebRouter();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(bin, { recursive: true, force: true });
  }
});

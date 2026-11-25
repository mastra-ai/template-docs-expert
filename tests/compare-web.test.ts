import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('failed comparison retains partial JSONL, diagnoses each arm, redacts credentials and exits nonzero', () => {
  const script = fileURLToPath(new URL('../scripts/compare-web.ts', import.meta.url));
  const preload = fileURLToPath(new URL('./fixtures/compare-failure.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, script],
    { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1, result.stderr);
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 6);
  assert.equal(rows.filter(row => row.stage === 'setup' && /ENOENT/.test(row.error)).length, 3);
  assert.equal(rows.filter(row => row.stage === 'inference' && /invalid request/.test(row.error)).length, 3);
  assert.doesNotMatch(result.stdout, /fixture-credential/);
  assert.ok(rows.every(row => row.totalCostUsd === null));
});

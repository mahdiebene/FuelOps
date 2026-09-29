import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('live judging scripts refuse to start without explicit mutation opt-in', () => {
  for (const [file, flag, message] of [
    ['prepare-judging.mjs', 'ALLOW_JUDGING_RESET', 'Isolated judging reset opt-in required'],
    ['judge-live-check.mjs', 'ALLOW_JUDGING_ACTIONS', 'Explicit isolated-judging action opt-in required']
  ]) {
    const env = { ...process.env }; delete env[flag];
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${file}`, import.meta.url))], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.ok(result.stderr.includes(message), result.stderr);
  }
});
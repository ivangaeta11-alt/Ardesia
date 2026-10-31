import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('server serves all installable assets and rejects private files and traversal', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const [output] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(([code]) => { throw new Error(`Server exited: ${code}`); })]);
  const port = output.toString().match(/localhost:(\d+)/)?.[1]; assert.ok(port);
  const base = `http://127.0.0.1:${port}`;
  const html = await fetch(base); assert.equal(html.status, 200); assert.match(await html.text(), /id="drawing"/);
  const response = await fetch(base + '/manifest.webmanifest'); assert.equal(response.status, 200); const manifest = await response.json();
  for (const item of manifest.icons) { const asset = await fetch(base + item.src); assert.equal(asset.status, 200); assert.ok((await asset.arrayBuffer()).byteLength > 100); }
  assert.equal((await fetch(base + '/src/app.js')).status, 200);
  const worker = await fetch(base + '/sw.js'); assert.equal(worker.status, 200);
  const shell = JSON.parse((await worker.text()).match(/const FILES = (\[[^;]+\])/)[1].replaceAll("'", '"'));
  for (const file of shell) {
    const asset = await fetch(base + file); assert.equal(asset.status, 200, `Offline asset: ${file}`);
    if (file.endsWith('.js')) {
      for (const match of (await asset.text()).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const dependency = new URL(match[1], base + file).pathname;
        assert.ok(shell.includes(dependency), `Missing offline dependency: ${dependency}`);
      }
    }
  }
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/tests/core.test.mjs')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%2fpackage.json')).status, 404);
});

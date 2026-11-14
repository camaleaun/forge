import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const demo = new URL('../../scripts/demo-download-progress.sh', import.meta.url).pathname;
const server = new URL('../../scripts/slow-pack-server.py', import.meta.url).pathname;
const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('given the download progress demo script', () => {
  it('when run without arguments, then it prints usage on stderr and exits 2', () => {
    const result = spawnSync('bash', [demo], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: demo-download-progress\.sh <app-project-dir>/);
  });

  it('when read, then bash accepts it and it never touches the real language cache (it uses its own FORGE_I18N_CACHE_DIR)', () => {
    assert.equal(spawnSync('bash', ['-n', demo]).status, 0);
    const text = readFileSync(demo, 'utf8');
    assert.match(text, /FORGE_I18N_CACHE_DIR=/);
    assert.match(text, /FORGE_I18N_BASE_URL=/);
    assert.match(text, /FORGE_I18N_TIMEOUT_MS=/);
    assert.ok(!/rm -rf[^\n]*Application Support/.test(text), 'the demo must not delete the real cache');
  });

  it('when the project folder does not exist, then it fails with a clear message and exit 1', () => {
    const result = spawnSync('bash', [demo, '/nonexistent-forge-app'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an app folder|not found/i);
  });
});

describe('given the slow pack server', { skip: !hasPython && 'needs python3' }, () => {
  it('when a client fetches the pack, then it arrives in many small pieces spread over the pause, with the real Content-Length', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-slow-'));
    const pack = join(dir, 'pack.lang');
    const portFile = join(dir, 'port');
    writeFileSync(pack, 'x'.repeat(4000));
    const child = spawn('python3', ['-I', server, pack, portFile, '1', '20'], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !(() => { try { return readFileSync(portFile, 'utf8') !== ''; } catch { return false; } })(); i++) await new Promise((r) => setTimeout(r, 50));
      const port = readFileSync(portFile, 'utf8');
      const arrivals: { at: number; bytes: number }[] = [];
      const started = Date.now();
      const length = await new Promise<string | undefined>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, { agent: false }, (res) => {
          res.on('data', (d: Buffer) => arrivals.push({ at: Date.now() - started, bytes: d.length }));
          res.on('end', () => resolve(res.headers['content-length']));
        }).on('error', reject);
      });
      assert.equal(length, '4000');
      assert.equal(arrivals.reduce((sum, a) => sum + a.bytes, 0), 4000);
      assert.ok(arrivals.length >= 10, `only ${arrivals.length} pieces`);
      assert.ok(arrivals[arrivals.length - 1].at >= 800, 'the last piece must come near the end of the pause');
      assert.ok(arrivals[0].at < 400, 'the first piece must come early');
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

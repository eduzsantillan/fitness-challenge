import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
describe('PWA cache boundaries', () => {
  function worker() {
    const handlers: Record<string, (event: unknown) => void> = {};
    const fetch = vi.fn().mockResolvedValue(new Response('static shell'));
    runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
      self: { location: { origin: 'https://ritmo.example' }, addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; } },
      URL, Response, caches: { match: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue({ put: vi.fn() }) }, fetch
    });
    return { handlers, fetch };
  }
  it('never intercepts APIs, auth callbacks, authorization headers or invite/token query strings', () => {
    const { handlers } = worker();
    for (const [path, method, headers] of [
      ['/api/challenges/abc/leaderboard', 'GET', {}], ['/api/shortcuts', 'POST', {}], ['/api/session', 'GET', {}], ['/api/auth/get-session', 'GET', {}], ['/auth/callback?code=secret', 'GET', {}],
      ['/?invite=private', 'GET', {}], ['/assets/private.js', 'GET', { Authorization: 'Bearer secret' }], ['https://api.example/anything', 'GET', {}]
    ] as const) {
      const respondWith = vi.fn();
      handlers.fetch!({ request: new Request(path.startsWith('https') ? path : `https://ritmo.example${path}`, { method, headers }), respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it('allows caching only static shell resources', async () => {
    const { handlers, fetch } = worker();
    let response: Promise<Response> | undefined;
    handlers.fetch!({ request: new Request('https://ritmo.example/assets/app-hash.js'), respondWith: (value: Promise<Response>) => { response = value; } });
    expect(response).toBeDefined(); await response; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('invalidates the shell when only the downloadable guide changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ritmo-shell-test-'));
    try {
      mkdirSync(join(directory, 'assets')); mkdirSync(join(directory, 'icons'));
      writeFileSync(join(directory, 'index.html'), '<script src="/assets/app.js"></script><link href="/assets/app.css">');
      for (const file of ['assets/app.js', 'assets/app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) writeFileSync(join(directory, file), 'static');
      writeFileSync(join(directory, 'sw.js'), "const CACHE = 'old'; const SHELL = [];\n");
      writeFileSync(join(directory, 'guia-atajos.md'), 'before');
      const build = () => { execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/finalize-pwa.mjs', import.meta.url)), directory]); return /const CACHE = ([^;]+)/.exec(readFileSync(join(directory, 'sw.js'), 'utf8'))?.[1]; };
      const before = build(); expect(build()).toBe(before);
      writeFileSync(join(directory, 'guia-atajos.md'), 'after'); expect(build()).not.toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

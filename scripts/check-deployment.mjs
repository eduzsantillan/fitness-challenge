import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
const config = JSON.parse(readFileSync('vercel.json', 'utf8')), pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(config.framework, 'vite'); assert.equal(config.outputDirectory, 'dist');
assert.ok(config.rewrites.every(r => !new RegExp(`^${r.source}$`).test('/api/shortcuts')), 'SPA must not swallow API routes');
assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(k => /aws|cdk|constructs/.test(k)));
const csp = config.headers.flatMap(g => g.headers).find(h => h.key === 'Content-Security-Policy').value;
assert.ok(csp.includes("connect-src 'self';")); assert.ok(!csp.includes('amazon'));
const sw = readFileSync('dist/sw.js', 'utf8'); assert.ok(sw.includes("url.pathname.startsWith('/api/')"));
assert.ok(!readFileSync('web/src/auth.ts', 'utf8').includes('VITE_')); // Server credentials must not become Vite public values.
const ignored = readFileSync('.vercelignore', 'utf8'); assert.ok(ignored.includes('.env\n') && ignored.includes('.env.*'));
if (existsSync('.env')) {
  const privateEnv = parseEnv(readFileSync('.env', 'utf8'));
  const publicBundle = readdirSync('dist/assets').filter(f => /\.(?:js|css)$/.test(f)).map(f => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BETTER_AUTH_SECRET']) {
    const value = privateEnv[key];
    assert.ok(!value || !publicBundle.includes(value), 'A server-only credential was found in public build assets.');
    if (value && key.endsWith('DATABASE_URL')) {
      const password = decodeURIComponent(new URL(value).password);
      assert.ok(!password || !publicBundle.includes(password), 'A database credential was found in public build assets.');
    }
  }
}
await build({ entryPoints: ['api/[...path].ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external', outfile: '.build/api.mjs' });
const entry = await import('../.build/api.mjs');
assert.equal(typeof entry.default.fetch, 'function');
console.log('Deployment checks passed: Vercel API entry bundles, SPA excludes /api, same-origin CSP, private PWA cache and no AWS dependencies.');

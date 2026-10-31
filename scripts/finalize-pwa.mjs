import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
const dist = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + sep) : new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
if (!assets.some(asset => asset.endsWith('.js')) || !assets.some(asset => asset.endsWith('.css'))) throw new Error('Missing shell build assets.');
const shell = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/guia-atajos.md', ...assets];
const fingerprint = createHash('sha256');
for (const asset of shell) {
  fingerprint.update(asset + '\0');
  fingerprint.update(readFileSync(new URL(asset === '/' ? 'index.html' : asset.slice(1), dist)));
}
const version = fingerprint.digest('hex').slice(0, 12);
let sw = readFileSync(new URL('sw.js', dist), 'utf8');
sw = sw.replace(/const CACHE = .*?;/, `const CACHE = 'ritmo-shell-${version}';`).replace(/const SHELL = .*?;/, `const SHELL = ${JSON.stringify(shell)};`);
writeFileSync(new URL('sw.js', dist), sw);
console.log(`PWA shell ready: ${assets.length} hashed assets, no user data cached.`);

// Static, read-only release checks. No network, credentials or user records are accessed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const version = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
assert.equal(lock.version, version, 'Lockfile version must match package');
assert.equal(lock.packages[''].version, version, 'Root lockfile package must match');
const worker = read('service-worker.js');
const shell = new Set([...worker.match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
function asset(ref, importer = 'index.html') {
  assert.ok(ref.startsWith('./') || ref.startsWith('../'), `Unexpected external resource in ${importer}: ${ref}`);
  const [path, query] = ref.split('?'), absolute = resolve(root, dirname(importer), path);
  const local = relative(root, absolute).split(sep).join('/');
  assert.ok(!local.startsWith('../'), `Resource escapes site root: ${ref}`);
  assert.ok(existsSync(absolute), `Missing resource: ${ref}`);
  if (/\.(?:js|css)$/.test(path)) assert.equal(query, `v=${version}`, `Stale version: ${importer} -> ${ref}`);
  const cachePath = './' + (local || '') + (query ? '?' + query : '');
  assert.ok(shell.has(cachePath) || local === '', `Not available offline: ${cachePath}`);
}
for (const entry of shell) asset(entry);
const source = ['app.js', ...readdirSync(resolve(root, 'lib')).filter(name => name.endsWith('.js')).map(name => `lib/${name}`)];
for (const file of source) {
  asset('./' + file + `?v=${version}`);
  for (const match of read(file).matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) asset(match[1], file);
}
const html = read('index.html');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) asset(match[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
const idsSet = new Set(ids);
for (const match of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(idsSet.has(match[1]), `Label target missing: ${match[1]}`);
assert.ok(!/user-scalable\s*=\s*no|maximum-scale/i.test(html), 'Do not disable user zoom');
console.log(`PASS release ${version}: ${source.length} frontend modules, ${shell.size} offline assets, imports, unique IDs, label targets and zoom`);

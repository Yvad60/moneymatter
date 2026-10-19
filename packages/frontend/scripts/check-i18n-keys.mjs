#!/usr/bin/env node
/**
 * Fails when frontend source references an i18n key missing from the en chunks.
 * Dynamic keys (`a.b.${x}`) are only checked up to their static prefix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const EN = path.join(SRC, 'i18n/locales/chunks/en');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const keys = new Set();
const parents = new Set();
const flatten = (obj, prefix) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      parents.add(key);
      flatten(v, key);
    } else keys.add(key);
  }
};
for (const f of walk(EN)) flatten(JSON.parse(fs.readFileSync(f, 'utf8')), '');
const namespaces = new Set([...parents].filter((p) => !p.includes('.')));

const KEY_LIKE = /^[a-zA-Z][\w-]*(\.[\w-]+)+$/;
// Dotted strings that share a namespace with i18n keys but aren't keys.
const NOT_KEYS = new Set(['planned.subscriptions.sortBy']);
const MESSAGE_FNS = new Set(['t', '$t', 'te', '$te', 'tc', '$tc', 'i18n.global.t']);

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const errors = [];

const files = walk(SRC).filter(
  (f) => /\.(vue|ts|tsx)$/.test(f) && !/\.(spec|test)\.ts$/.test(f) && !f.includes(`${path.sep}locales${path.sep}`),
);

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const rel = path.relative(ROOT, file);

  for (const m of code.matchAll(/(?:(\bkeypath=)|([\w$.]+)\(\s*|(=\s*))?(['"`])([^'"`\s]+?)\4/g)) {
    const [, keypathAttr, callee, attr, quote, key] = m;
    if (!KEY_LIKE.test(key) || !namespaces.has(key.split('.')[0]) || NOT_KEYS.has(key)) continue;
    const isMessageArg = Boolean(keypathAttr) || MESSAGE_FNS.has(callee);
    // Vue attribute values are expressions (`:error="errors.name"`), not strings.
    if (attr && quote === '"') continue;
    if (keys.has(key) || (!isMessageArg && parents.has(key))) continue;
    errors.push(`${rel}:${lineOf(code, m.index)}  missing key "${key}"`);
  }

  for (const m of code.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)+)\.\$\{/g)) {
    const prefix = m[1];
    if (!namespaces.has(prefix.split('.')[0]) || parents.has(prefix)) continue;
    errors.push(`${rel}:${lineOf(code, m.index)}  missing key group "${prefix}"`);
  }
}

const unique = [...new Set(errors)];
if (unique.length) {
  console.error(unique.join('\n'));
  console.error(`\n${unique.length} i18n key problem(s). Add the key to the en locale chunks or fix the reference.`);
  process.exit(1);
}
console.log('i18n keys OK');

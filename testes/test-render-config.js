const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const yaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
assert.match(yaml, /type:\s+web/);
assert.match(yaml, /name:\s+quintal-3d/);
assert.match(yaml, /key:\s+DATABASE_URL[\s\S]*?fromDatabase:/);
assert.match(yaml, /name:\s+quintal-3d-postgres[\s\S]*?property:\s+connectionString/);
assert.match(yaml, /databases:\s*[\s\S]*?- name:\s+quintal-3d-postgres/);
assert.match(yaml, /plan:\s+free/);

console.log('RENDER_CONFIG_OK');

const fs = require('node:fs');
const clientPath = fs.existsSync('quintal-cidade.html') ? 'quintal-cidade.html' : 'index.html';
if (!fs.existsSync(clientPath)) throw new Error('client HTML not found: expected quintal-cidade.html or index.html');
const html = fs.readFileSync(clientPath, 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(code => code.trim());
if (!scripts.length) throw new Error('no inline scripts found');
fs.writeFileSync('/tmp/quintal-client-inline.js', scripts.join('\n\n'));
console.log(`extracted ${scripts.length} inline script(s) from ${clientPath}`);

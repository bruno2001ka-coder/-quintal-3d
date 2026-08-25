const fs = require('node:fs');
const html = fs.readFileSync('quintal-cidade.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(code => code.trim());
if (!scripts.length) throw new Error('no inline scripts found');
fs.writeFileSync('/tmp/quintal-client-inline.js', scripts.join('\n\n'));
console.log(`extracted ${scripts.length} inline script(s)`);

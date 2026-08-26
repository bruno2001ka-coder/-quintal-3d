'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');

const base = new URL(process.env.TEST_HTTP || 'http://127.0.0.1:8080');

function request(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port,
      path: pathname,
      method,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const root = await request('/');
  assert.equal(root.status, 200, 'a raiz deve entregar o cliente');
  assert.match(root.headers['content-type'] || '', /^text\/html;\s*charset=utf-8/i);
  assert.match(root.body, /<title>Quintal 3D/);
  assert.match(root.body, /const MP_URL/);

  const head = await request('/', 'HEAD');
  assert.equal(head.status, 200, 'HEAD da raiz deve funcionar');
  assert.equal(head.body, '', 'HEAD não deve devolver corpo');
  assert.ok(Number(head.headers['content-length']) > 1000, 'HEAD deve informar o tamanho do HTML');

  const health = await request('/healthz');
  assert.equal(health.status, 200, 'health check deve responder 200');
  assert.equal(JSON.parse(health.body).ok, true, 'health check deve informar ok=true');

  const metrics = await request('/metrics?probe=1');
  assert.equal(metrics.status, 200, 'métricas devem continuar disponíveis com query string');
  assert.equal(typeof JSON.parse(metrics.body).tickHz, 'number');

  const missing = await request('/arquivo-que-nao-existe.js');
  assert.equal(missing.status, 404, 'arquivo ausente deve responder 404');

  const traversal = await request('/%2e%2e%2fservidor-1.js');
  assert.notEqual(traversal.status, 200, 'path traversal não pode entregar arquivo fora de public');

  const internal = await request('/public/index.html');
  assert.notEqual(internal.status, 200, 'public não deve aparecer como prefixo público');

  console.log('HTTP_STATIC_OK', JSON.stringify({
    base: base.origin,
    root: root.status,
    health: health.status,
    metrics: metrics.status,
    missing: missing.status,
    traversal: traversal.status,
  }));
})().catch(error => {
  console.error('HTTP_STATIC_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});

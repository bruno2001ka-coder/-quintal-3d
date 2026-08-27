'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
const loteInicio = html.indexOf("msg.t==='lote_atribuido'");
const loteFim = html.indexOf("msg.t==='lote_update'", loteInicio);
assert(loteInicio >= 0 && loteFim > loteInicio, 'handler lote_atribuido não encontrado');
const handler = html.slice(loteInicio, loteFim);

assert.match(html, /function mpAplicarSpawnAuthoritative\(pos\)/,
  'helper de spawn authoritative ausente');
assert.match(html, /G\._nasceuNoLote=true;G\._esperandoLote=false/,
  'spawn authoritative não libera o início do mundo');
assert.match(handler, /if\(!G\._nasceuNoLote\)mpAplicarSpawnAuthoritative\(msg\.posicao\)/,
  'spawn público ainda não é aplicado antes do clique');
assert.match(handler, /if\(msg\.posicao&&\(\s*msg\.retomada\|\|mpReentrada\|\|!G\._nasceuNoLote\|\|G\._esperandoLote\)\)\s*mpAplicarSpawnAuthoritative\(msg\.posicao\)/,
  'spawn do lote próprio não é aplicado na fase de handshake/reconexão');
assert(!/G\.running&&msg\.posicao/.test(handler),
  'spawn authoritative voltou a estar bloqueado por G.running');
assert.match(html, /if\(!offlineAtivo\(\)&&!G\._nasceuNoLote\)\{toast\('aguarde sua posição authoritative'/,
  'start deixou de exigir a posição authoritative confirmada no online');
assert.match(html, /_nasceuNoLote:false,_esperandoLote:true/,
  'o cliente deve começar aguardando o primeiro spawn do servidor');
assert.match(server, /function posicaoNaCasaAntiga\(p\)/,
  'migração da posição antiga não foi implementada no servidor');
assert.match(server, /const retomadaLegada = loteInicial && posicaoNaCasaAntiga\(retomadaBruta\)/,
  'posição antiga ainda pode vencer o spawn do lote novo');
assert.match(server, /const retomada = retomadaLegada \? null : retomadaBruta/,
  'retomada válida fora da casa antiga deixou de ser preservada');

console.log('PASS: spawn authoritative é aplicado no handshake, start mantém o guard de segurança e posição legada é migrada');

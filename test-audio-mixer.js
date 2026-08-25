const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
}
class FakeNode {
  constructor(ctx) { this.context = ctx; this.gain = new FakeParam(); this.frequency = new FakeParam(); this._listeners = {}; }
  connect() { return this; }
  addEventListener(name, fn) { (this._listeners[name] ||= []).push(fn); }
  _end() { for (const fn of this._listeners.ended || []) fn(); if (this.onended) this.onended(); }
  start() { setTimeout(() => this._end(), 2); }
  stop() { setTimeout(() => this._end(), 1); }
}
class FakeBuffer { constructor(rate) { this.sampleRate = rate; } getChannelData() { return new Float32Array(8); } }
class FakeContext {
  constructor() { this.state = 'running'; this.currentTime = 1; this.sampleRate = 48000; this.destination = {}; }
  createGain() { return new FakeNode(this); }
  createOscillator() { return new FakeNode(this); }
  createBufferSource() { return new FakeNode(this); }
  createBiquadFilter() { return new FakeNode(this); }
  createBuffer() { return new FakeBuffer(this.sampleRate); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const audio = html.match(/let actx=null,sfxMaster=null,noiseBuffer=null;[\s\S]*?(?=\/\* ═════════ ARMAS)/)?.[0];
assert.ok(audio, 'bloco de áudio deve existir');
const context = {
  window: { AudioContext: FakeContext, webkitAudioContext: FakeContext },
  document: { hidden: false, addEventListener() {} },
  somAtivo: true,
  setTimeout,
  Math,
  console,
};
vm.createContext(context);
vm.runInContext(audio + '\nthis.__sfxState=sfxState;', context);
context.ativarAudio();
context.blip(400, .04, 'sine', .05);
context.shotSfx(.1);
context.sirene();
context.slashSfx();
assert.equal(context.__sfxState.ativos.size, 4, 'efeitos ativos devem ser contabilizados');
context.pararSfxAtivos();
assert.equal(context.__sfxState.ativos.size, 0, 'fontes devem ser liberadas ao parar');
context.somAtivo = false;
context.blip(500, .1, 'sine', .05);
assert.equal(context.__sfxState.ativos.size, 0, 'som mudo não deve criar voz');
context.somAtivo = true;
vm.runInContext("actx.state='closed'", context);
context.blip(600, .04, 'sine', .05);
assert.equal(vm.runInContext('actx.state', context), 'running', 'contexto fechado deve ser recriado');
setTimeout(() => {
  assert.equal(context.__sfxState.ativos.size, 0, 'fontes encerradas devem sair do mixer');
  console.log('AUDIO_MIXER_OK');
}, 20);

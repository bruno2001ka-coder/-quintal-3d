// server.js — servidor autoritativo de multiplayer em tempo real pro Quintal 3D.
// WebSocket puro (biblioteca "ws"), sem Firebase, sem banco de dados no meio —
// é o caminho de menor delay que existe pra esse tipo de jogo.
//
// Roda em qualquer hospedagem Node.js (Render, Railway, Fly.io...).
// Não precisa mexer em nada aqui pra funcionar — só subir e apontar o jogo
// pro endereço que a hospedagem te der.

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// servidor HTTP simples só pra responder "tô vivo" — a hospedagem usa isso
// pra saber que o serviço subiu certo (healthcheck)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Quintal 3D — servidor multiplayer no ar. Jogadores agora: ' + players.size + '\n');
});

const wss = new WebSocketServer({ server });

// players: id -> {ws, nome, x, y, z, ry, ts}
const players = new Map();
let nextId = 1;

function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = String(nextId++);
  players.set(id, { ws, nome: 'Jogador' + id, x: 0, y: 0, z: 0, ry: 0, ts: Date.now() });

  // manda pro recém-chegado quem já tá na sala
  ws.send(JSON.stringify({
    t: 'welcome',
    id,
    players: [...players.entries()]
      .filter(([pid]) => pid !== id)
      .map(([pid, p]) => ({ id: pid, nome: p.nome, x: p.x, y: p.y, z: p.z, ry: p.ry }))
  }));

  // avisa todo mundo que alguém entrou
  broadcast({ t: 'join', id, nome: players.get(id).nome }, id);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const p = players.get(id);
    if (!p) return;

    if (msg.t === 'pos') {
      // posição/rotação do jogador, ~10x por segundo vindo do cliente
      p.x = +msg.x || 0; p.y = +msg.y || 0; p.z = +msg.z || 0; p.ry = +msg.ry || 0;
      p.ts = Date.now();
      broadcast({ t: 'pos', id, x: p.x, y: p.y, z: p.z, ry: p.ry, anim: msg.anim || '' }, id);

    } else if (msg.t === 'nome') {
      p.nome = String(msg.nome || '').trim().slice(0, 18) || p.nome;
      broadcast({ t: 'nome', id, nome: p.nome }, id);

    } else if (msg.t === 'evento') {
      // eventos genéricos: tiro, colheita, venda, território tomado — repassa
      // pra todo mundo ver acontecer na hora, sem guardar nada no servidor
      broadcast({ t: 'evento', id, kind: msg.kind, data: msg.data }, id);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ t: 'leave', id });
  });

  ws.on('error', () => {});
});

// limpa jogador que travou sem avisar (conexão morta sem fechar direito)
setInterval(() => {
  const agora = Date.now();
  for (const [id, p] of players) {
    if (agora - p.ts > 30000 && p.ws.readyState !== p.ws.OPEN) {
      players.delete(id);
      broadcast({ t: 'leave', id });
    }
  }
}, 15000);

server.listen(PORT, () => console.log('Quintal 3D multiplayer no ar na porta ' + PORT));

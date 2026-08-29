import fs from 'node:fs';

const indexPath = 'public/index.html';
const serverPath = 'servidor-1.js';
const index = fs.readFileSync(indexPath, 'utf8');
const server = fs.readFileSync(serverPath, 'utf8');

let nextIndex = index;
let nextServer = server;

// CLIENT: make every online lot use the same front-door width as the server.
const oldClient = `const vao=2.2,lado=(W-vao)/2;\n  [-1,1].forEach(sign=>{\n    const mu=new THREE.Mesh(new THREE.BoxGeometry(lado,.95,.20),muroM);\n    mu.position.set(sign*(vao/2+lado/2),.48,D/2); g.add(mu);\n  });`;
const newClient = `const vao=2.8,lado=(W-vao)/2;\n  [-1,1].forEach(sign=>{\n    const mu=new THREE.Mesh(new THREE.BoxGeometry(lado,.95,.20),muroM);\n    mu.position.set(sign*(vao/2+lado/2),.48,D/2); g.add(mu);\n  });\n\n  // Entrada frontal única: a abertura do muro, o portão e o caminho\n  // usam exatamente o mesmo eixo. O caminho não recebe colisor.\n  const caminho=new THREE.Mesh(new THREE.BoxGeometry(vao-.25,.035,D-1.0),\n    new THREE.MeshStandardMaterial({color:0x8b8375,roughness:1}));\n  caminho.position.set(0,.025,.20); caminho.receiveShadow=true; g.add(caminho);\n  const postes=new THREE.MeshStandardMaterial({color:0x66584b,roughness:.9});\n  [-1,1].forEach(sign=>{\n    const p=new THREE.Mesh(new THREE.BoxGeometry(.12,1.18,.12),postes);\n    p.position.set(sign*(vao/2+.06),.59,D/2); p.castShadow=true; g.add(p);\n  });\n  const placaEntrada=new THREE.Mesh(new THREE.BoxGeometry(1.35,.28,.05),\n    new THREE.MeshStandardMaterial({color:0x23311d,roughness:.8,emissive:0x081008}));\n  placaEntrada.position.set(0,1.55,D/2+.03); g.add(placaEntrada);`;

if (!nextIndex.includes(oldClient)) throw new Error('client front-entry block not found');
nextIndex = nextIndex.replace(oldClient, newClient);

// SERVER: widen the front opening and keep wall segments outside the opening.
const oldServer = `const COL_LOTE_REL = [\n  [-4.0,4.0,-3.58,-3.38],\n  [-4.0,-3.8,-3.5,3.5],\n  [3.8,4.0,-3.5,3.5],\n  [-4.0,-1.1,3.38,3.58],\n  [1.1,4.0,3.38,3.58],\n  [-1.1,1.1,3.38,3.58]\n];`;
const newServer = `const COL_LOTE_REL = [\n  [-4.0,4.0,-3.58,-3.38],\n  [-4.0,-3.8,-3.5,3.5],\n  [3.8,4.0,-3.5,3.5],\n  [-4.0,-1.4,3.38,3.58],\n  [1.4,4.0,3.38,3.58],\n  [-1.4,1.4,3.38,3.58]\n];`;
if (!nextServer.includes(oldServer)) throw new Error('server lot collider block not found');
nextServer = nextServer.replace(oldServer, newServer);

// Static safety validator: client/server must agree on lot dimensions, spots,
// and entry width; no two lot centers may overlap.
const clientDims = nextIndex.match(/const NUM_LOTES_ONLINE=10/);
const serverDims = nextServer.match(/const LOTE_W = 8, LOTE_D = 7/);
const spots = nextServer.match(/const LOTE_SPOTS = (\[[^;]+\]);/);
if (!clientDims || !serverDims || !spots) throw new Error('lot constants missing after patch');
const parsedSpots = JSON.parse(spots[1]);
if (parsedSpots.length !== 10) throw new Error(`expected 10 lots, got ${parsedSpots.length}`);
for (let i = 0; i < parsedSpots.length; i++) {
  for (let j = i + 1; j < parsedSpots.length; j++) {
    const dx = parsedSpots[i][0] - parsedSpots[j][0];
    const dz = parsedSpots[i][1] - parsedSpots[j][1];
    if (Math.hypot(dx, dz) < 8) throw new Error(`overlapping lot centers ${i}/${j}`);
  }
}

fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(serverPath, nextServer);
console.log('MAP_ENTRIES_PATCH_OK');
console.log('client/server front opening: 2.8m');
console.log('10 unique lot centers validated');

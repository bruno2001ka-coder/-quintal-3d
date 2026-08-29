from pathlib import Path
import re

ROOT = Path('.')
CLIENT = ROOT / 'public' / 'index.html'
SERVER = ROOT / 'servidor-1.js'

client = CLIENT.read_text(encoding='utf-8')
server = SERVER.read_text(encoding='utf-8')

# ===== Client: compact world coordinates =====
client = client.replace('const LOTE_W=20, LOTE_D=16;', 'const LOTE_W=8, LOTE_D=7;', 1)
client = re.sub(
    r"const LOTE_SPOTS=\[.*?\];",
    "const LOTE_SPOTS=[[-44,27],[-34,27],[-24,27],[-14,27],[-4,27],[6,27],[16,27],[26,27],[36,27],[46,27]];",
    client, count=1, flags=re.S
)

# Keep 10 online properties; use sixteen compact planting positions for persistence compatibility.
client = re.sub(
    r"const off=\[.*?\];\n   off\.forEach",
    """const off=[\n   [-2.4,-1.7],[-0.8,-1.7],[0.8,-1.7],[2.4,-1.7],\n   [-2.4,-0.4],[-0.8,-0.4],[0.8,-0.4],[2.4,-0.4],\n   [-2.4,0.9],[-0.8,0.9],[0.8,0.9],[2.4,0.9],\n   [-2.4,2.2],[-0.8,2.2],[0.8,2.2],[2.4,2.2]\n   ];\n   off.forEach""",
    client, count=1, flags=re.S
)

# Compact lot renderer. Everything stays inside the 8x7 lot envelope.
new_montar = r'''function montarLote(lote){
  const W=LOTE_W,D=LOTE_D,alt=2.45;
  const g=new THREE.Group(); g.position.set(lote.x,0,lote.z);
  const muroM=new THREE.MeshStandardMaterial({color:corMuro,roughness:.94});
  const pisoM=new THREE.MeshStandardMaterial({color:0x706b5f,roughness:.98});
  const madeira=new THREE.MeshStandardMaterial({color:0x6c4833,roughness:.88});

  // Piso e três lados da construção-base. A frente fica livre no portão.
  const piso=new THREE.Mesh(new THREE.BoxGeometry(W,.08,D),pisoM);
  piso.position.y=.04; g.add(piso);
  [[0,-D/2,W,.20],[-W/2,0,.20,D],[W/2,0,.20,D]].forEach(m=>{
    const mu=new THREE.Mesh(new THREE.BoxGeometry(m[2],alt,m[3]),muroM);
    mu.position.set(m[0],alt/2,m[1]); mu.castShadow=true; mu.receiveShadow=true; g.add(mu);
  });

  // Frente dividida em dois trechos, com vão central de 2.2m.
  const vao=2.2,lado=(W-vao)/2;
  [-1,1].forEach(sign=>{
    const mu=new THREE.Mesh(new THREE.BoxGeometry(lado,.95,.20),muroM);
    mu.position.set(sign*(vao/2+lado/2),.48,D/2); g.add(mu);
  });

  // Pequeno abrigo, completamente dentro do lote e separado dos canteiros.
  const shed=new THREE.Mesh(new THREE.BoxGeometry(2.0,1.7,1.5),madeira);
  shed.position.set(-2.45,.85,-2.15); shed.castShadow=true; shed.receiveShadow=true; g.add(shed);

  // Três bancadas compactas na faixa traseira.
  const estacoes={
    embalagem:{x:-2.3,z:-2.45},
    cura:{x:0,z:-2.45},
    secagem:{x:2.3,z:-2.45}
  };
  lote.estacoes={};
  Object.keys(estacoes).forEach(nome=>{
    const e=estacoes[nome]; lote.estacoes[nome]={x:lote.x+e.x,z:lote.z+e.z};
    const b=new THREE.Mesh(new THREE.BoxGeometry(1.25,.75,.55),madeira);
    b.position.set(e.x,.40,e.z); b.castShadow=true; g.add(b);
  });
  lote.bancadaPos=lote.estacoes.secagem;
  lote.portaoPos={x:lote.x,z:lote.z+D/2};
  lote.group=g;
  return g;
}'''
client, n = re.subn(r"function montarLote\(lote\)\{.*?\n\}", new_montar, client, count=1, flags=re.S)
if n != 1:
    raise SystemExit('montarLote não encontrado')

# Compact proxy used before the full lot is mounted.
client, n = re.subn(
    r"function montarLoteProxy\(lote\)\{.*?\n\}",
    r'''function montarLoteProxy(lote){
  const g=new THREE.Group(); g.position.set(lote.x,0,lote.z);
  const muro=new THREE.MeshStandardMaterial({color:0x6c5c4a,roughness:.96});
  const piso=new THREE.MeshStandardMaterial({color:0x625b50,roughness:1});
  const p=new THREE.Mesh(new THREE.BoxGeometry(8,.08,7),piso); p.position.y=.04; g.add(p);
  [[0,-3.5,8,.16],[-4,0,.16,7],[4,0,.16,7]].forEach(m=>{
    const o=new THREE.Mesh(new THREE.BoxGeometry(m[2],1.2,m[3]),muro); o.position.set(m[0],.6,m[1]); g.add(o);
  });
  return g;
}''',
    client, count=1, flags=re.S
)
if n != 1:
    raise SystemExit('montarLoteProxy não encontrado')

# Update fallback station coordinates used when server state has not arrived yet.
client = client.replace("{secagem:{x:6.8,z:3.6},cura:{x:3.8,z:3.6},embalagem:{x:.8,z:3.6}}", "{secagem:{x:2.3,z:-2.45},cura:{x:0,z:-2.45},embalagem:{x:-2.3,z:-2.45}}", 1)

# ===== Server: same compact map contract =====
server = server.replace('const LOTE_W = 20, LOTE_D = 16;', 'const LOTE_W = 8, LOTE_D = 7;', 1)
server = re.sub(
    r"const LOTE_SPOTS = \[.*?\];",
    "const LOTE_SPOTS = [[-44,27],[-34,27],[-24,27],[-14,27],[-4,27],[6,27],[16,27],[26,27],[36,27],[46,27]];",
    server, count=1, flags=re.S
)
server = re.sub(
    r"const ESTACOES_CASA_REL = Object\.freeze\(\{.*?\}\);",
    "const ESTACOES_CASA_REL = Object.freeze({ secagem:{x:2.3,z:-2.45,raio:1.25}, cura:{x:0,z:-2.45,raio:1.25}, embalagem:{x:-2.3,z:-2.45,raio:1.25} });",
    server, count=1, flags=re.S
)
server = re.sub(
    r"function spawnNaPortaDoLote\(lote\) \{.*?\n\}",
    """function spawnNaPortaDoLote(lote) {\n  return { x:lote.x, y:12, z:lote.z + LOTE_D / 2 + 1.25, ry:0 };\n}""",
    server, count=1, flags=re.S
)

# Compact authoritative lot wall relative colliders. Keep a central gate opening.
if 'const COL_LOTE_REL' in server:
    server = re.sub(
        r"const COL_LOTE_REL = \[.*?\n\];\nconst IDX_PORTAO = 5;",
        """const COL_LOTE_REL = [\n  [-4.0,4.0,-3.58,-3.38],\n  [-4.0,-3.8,-3.5,3.5],\n  [3.8,4.0,-3.5,3.5],\n  [-4.0,-1.1,3.38,3.58],\n  [1.1,4.0,3.38,3.58],\n  [-1.1,1.1,3.38,3.58]\n];\nconst IDX_PORTAO = 5;""",
        server, count=1, flags=re.S
    )

# Preserve 16 authoritative plot slots while making them fit the compact lot.
server = re.sub(
    r"const PLOT_OFFSETS = \[.*?\];",
    """const PLOT_OFFSETS = [\n  [-2.4,-1.7],[-0.8,-1.7],[0.8,-1.7],[2.4,-1.7],\n  [-2.4,-0.4],[-0.8,-0.4],[0.8,-0.4],[2.4,-0.4],\n  [-2.4,0.9],[-0.8,0.9],[0.8,0.9],[2.4,0.9],\n  [-2.4,2.2],[-0.8,2.2],[0.8,2.2],[2.4,2.2]\n];""",
    server, count=1, flags=re.S
)

CLIENT.write_text(client, encoding='utf-8')
SERVER.write_text(server, encoding='utf-8')
print('MAP_V2_APPLIED')

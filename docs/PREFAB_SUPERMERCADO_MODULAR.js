/*
 * Prefab modular: supermercado low-poly urbano.
 * Compatível com Three.js r128 e com o padrão de primitivas do Quintal 3D.
 *
 * Não altera física, controles, câmera, HUD ou WebSocket.
 * Os colisores são devolvidos em grupo.userData.coliders como caixas locais.
 * Para integrar no sistema atual, converta cada caixa para o formato do seu
 * resolvedor de colisão depois de aplicar group.rotation.y e group.position.
 */
function criarSupermercado(x, y, z, rotacaoY = 0) {
  const grupo = new THREE.Group();
  grupo.name = 'prefab-supermercado';
  grupo.position.set(x, y, z);
  grupo.rotation.y = rotacaoY;

  const materiais = {
    parede: new THREE.MeshStandardMaterial({ color: 0x68756c, roughness: 0.88 }),
    paredeEscura: new THREE.MeshStandardMaterial({ color: 0x3e5147, roughness: 0.82 }),
    cobertura: new THREE.MeshStandardMaterial({ color: 0x2e4038, roughness: 0.72 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x315d46, roughness: 0.5, metalness: 0.18 }),
    vidro: new THREE.MeshStandardMaterial({ color: 0x9bd9c4, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.72 }),
    madeira: new THREE.MeshStandardMaterial({ color: 0x805b36, roughness: 0.9 }),
    destaque: new THREE.MeshStandardMaterial({ color: 0xe8d264, roughness: 0.68 }),
    alimento: new THREE.MeshStandardMaterial({ color: 0xd66b45, roughness: 0.8 })
  };

  const colisores = [];

  function bloco(nome, largura, altura, profundidade, px, py, pz, material, colisor = null) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(largura, altura, profundidade),
      material
    );
    mesh.name = nome;
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grupo.add(mesh);

    if (colisor) {
      // Caixa local: minX/maxX/minZ/maxZ são relativos à origem do prefab.
      // Plugue no seu sistema atual transformando esta caixa para coordenadas
      // do mundo após aplicar posição e rotação do grupo.
      colisores.push({
        nome,
        minX: px - colisor.largura / 2,
        maxX: px + colisor.largura / 2,
        minZ: pz - colisor.profundidade / 2,
        maxZ: pz + colisor.profundidade / 2,
        ativo: true
      });
    }
    return mesh;
  }

  // Dimensões: 18m de largura x 19m de profundidade. A frente fica em +Z.
  const largura = 18;
  const profundidade = 19;
  const frente = profundidade / 2;
  const fundo = -profundidade / 2;
  const porta = 3.2;
  const espessura = 0.35;
  const altura = 5;

  // Piso e cobertura únicos, reduzindo draw calls e mantendo leitura low-poly.
  bloco('piso', largura, 0.12, profundidade, 0, 0.06, 0, materiais.paredeEscura);
  bloco('cobertura', largura + 0.5, 0.3, profundidade + 0.5, 0, altura + 0.15, 0, materiais.cobertura);

  // Paredes laterais e fundo: a frente não fecha a passagem central.
  bloco('parede-esquerda', espessura, altura, profundidade, -largura / 2, altura / 2, 0, materiais.parede, {
    largura: espessura + 0.25, profundidade
  });
  bloco('parede-direita', espessura, altura, profundidade, largura / 2, altura / 2, 0, materiais.parede, {
    largura: espessura + 0.25, profundidade
  });
  bloco('parede-fundo', largura, altura, espessura, 0, altura / 2, fundo, materiais.parede, {
    largura, profundidade: espessura + 0.25
  });

  const larguraLateral = (largura - porta) / 2;
  bloco('fachada-esquerda', larguraLateral, altura, espessura, -(porta / 2 + larguraLateral / 2 + porta / 2), altura / 2, frente, materiais.parede, {
    largura: larguraLateral + 0.25, profundidade: espessura + 0.25
  });
  bloco('fachada-direita', larguraLateral, altura, espessura, porta / 2 + larguraLateral / 2 + porta / 2, altura / 2, frente, materiais.parede, {
    largura: larguraLateral + 0.25, profundidade: espessura + 0.25
  });

  // Vitrines e porta visual. A porta não recebe colisor: a passagem é livre.
  bloco('vitrine-esquerda', larguraLateral - 1.2, 2.5, 0.08, -5.2, 1.45, frente + 0.2, materiais.vidro);
  bloco('vitrine-direita', larguraLateral - 1.2, 2.5, 0.08, 5.2, 1.45, frente + 0.2, materiais.vidro);
  bloco('porta-de-vidro', 2.8, 3.1, 0.08, 0, 1.55, frente + 0.24, materiais.vidro);
  bloco('marco-esquerdo', 0.12, 3.2, 0.16, -1.6, 1.6, frente + 0.05, materiais.metal);
  bloco('marco-direito', 0.12, 3.2, 0.16, 1.6, 1.6, frente + 0.05, materiais.metal);
  bloco('puxador', 0.08, 0.75, 0.08, 0.85, 1.45, frente + 0.1, materiais.destaque);

  // Marquise única e faixa frontal para a loja ser identificada de longe.
  bloco('marquise', 15, 0.24, 2.3, 0, 3.2, frente + 0.7, materiais.metal);
  bloco('faixa-supermercado', 12, 0.65, 0.18, 0, 4.15, frente + 0.22, materiais.destaque);
  bloco('placa-entrada', 3.8, 0.42, 0.12, 0, 3.45, frente + 0.28, materiais.alimento);

  // Balcão de atendimento interno, com caixa de colisão própria.
  bloco('balcao-caixa', 7, 0.9, 1.1, 0, 1.0, fundo + 3.4, materiais.madeira, {
    largura: 7.2, profundidade: 1.3
  });
  bloco('painel-caixa', 6.7, 0.8, 0.12, 0, 1.75, fundo + 2.82, materiais.metal);

  // Quatro gôndolas grandes, cada uma com colisor único.
  [-6, -2, 2, 6].forEach((px, indice) => {
    bloco(`gondola-${indice + 1}`, 1.7, 2.4, 0.55, px, 1.2, -2.2, materiais.metal, {
      largura: 1.9, profundidade: 0.8
    });
    bloco(`prateleira-${indice + 1}`, 1.45, 0.08, 0.72, px, 2.3, -2.2, materiais.madeira);
    bloco(`produto-${indice + 1}`, 0.65, 0.32, 0.3, px, 2.52, -2.2, indice === 1 ? materiais.destaque : materiais.alimento);
  });

  // Metadados para o foco de interação, sem acoplar ao sistema de input.
  grupo.userData.tipo = 'supermercado';
  grupo.userData.pontoEntrada = { x: 0, y: 0, z: frente + 2.2, raio: 4.2 };
  grupo.userData.pontoCaixa = { x: 0, y: 0, z: fundo + 3.4, raio: 2.4 };
  grupo.userData.colisores = colisores;
  grupo.userData.versaoPrefab = 1;

  return grupo;
}

// Exemplo de uso no mapa:
// const mercado = criarSupermercado(38, 0, 140, 0);
// scene.add(mercado);
// mercado.userData.colisores.forEach(caixa => {
//   // Registrar aqui no resolvedor de colisão atual, convertendo a caixa local
//   // para o mundo conforme mercado.position e mercado.rotation.y.
// });

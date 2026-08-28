/* Fonte compartilhada de layout — quebrada densa.
 * O cliente carrega este arquivo como script; o servidor pode usar o mesmo
 * módulo. Toda mudança espacial futura deve começar aqui, nunca em um único
 * lado do multiplayer.
 */
(function(root){
  const layout=Object.freeze({
    version:1,
    escalaHumana:Object.freeze({rua:6,vielaMin:3.2,vielaMax:4}),
    farm:Object.freeze({shiftZ:-15})
  });
  if(root)root.QUINTAL_LAYOUT=layout;
  if(typeof module!=='undefined'&&module.exports)module.exports=layout;
})(typeof globalThis!=='undefined'?globalThis:this);

'use strict';
// Conteúdo de reenvio guardado em disco, por sessão.
//
// Por que existe: quando o celular do cliente não consegue abrir uma mensagem, ele pede ao remetente que a
// reenvie. O Baileys pergunta o conteúdo original (getMessage). Antes ele só ficava em memória: depois de
// reiniciar, atualizar ou reconectar a sessão, o pedido ficava sem resposta e a mensagem travava em
// "Aguardando mensagem" no celular do cliente.
//
// Guarda os BYTES do proto de cada envio confirmado (texto ou anexo, com as chaves de mídia originais) em
// sessoes/<sessao>/reenvio/AAAA-MM-DD.jsonl, por 7 dias. Em memória fica um índice limitado.
const fs = require('node:fs'), path = require('node:path');
const DIAS = 7, LIMITE = 20000;

module.exports = function criarReenvio(pasta, { now = Date.now } = {}) {
  const raiz = path.join(pasta, 'reenvio');
  fs.mkdirSync(raiz, { recursive: true, mode: 0o700 });
  const mapa = new Map(); // id da mensagem -> bytes
  const dia = (t) => new Date(t).toISOString().slice(0, 10);
  function limpar() {
    const corte = dia(now() - DIAS * 86400000);
    for (const nome of fs.readdirSync(raiz)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(nome) && nome.slice(0, 10) < corte) fs.rmSync(path.join(raiz, nome), { force: true });
  }
  function carregar() {
    limpar();
    for (const nome of fs.readdirSync(raiz).filter((n) => n.endsWith('.jsonl')).sort()) {
      for (const linha of fs.readFileSync(path.join(raiz, nome), 'utf8').split('\n')) {
        if (!linha) continue;
        try { const r = JSON.parse(linha); if (r.id && r.b64) lembrar(r.id, Buffer.from(r.b64, 'base64')); } catch { /* linha cortada por queda: ignora */ }
      }
    }
  }
  function lembrar(id, bytes) {
    mapa.delete(id); mapa.set(id, bytes);
    while (mapa.size > LIMITE) mapa.delete(mapa.keys().next().value);
  }
  carregar();
  let ultimaLimpeza = now();
  return {
    // Chamado pelo motor a cada envio confirmado.
    guardar(key, bytes) {
      const id = String(key?.id || '');
      if (!id || !bytes?.length) return;
      const b = Buffer.from(bytes);
      lembrar(id, b);
      fs.appendFileSync(path.join(raiz, dia(now()) + '.jsonl'), JSON.stringify({ id, jid: String(key.remoteJid || ''), b64: b.toString('base64') }) + '\n', { mode: 0o600 });
      if (now() - ultimaLimpeza > 3600000) { ultimaLimpeza = now(); try { limpar(); } catch {} }
    },
    // Chamado pelo motor quando o WhatsApp pede reenvio. Só mensagens enviadas por este número.
    buscar(key) { return key?.fromMe === false ? undefined : mapa.get(String(key?.id || '')); },
    total: () => mapa.size,
  };
};

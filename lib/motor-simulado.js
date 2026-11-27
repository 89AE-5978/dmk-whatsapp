'use strict';
// Motor simulado: mesmo contrato do motor Baileys, sem falar com o WhatsApp.
// Serve para os testes automáticos e para ligar um sistema novo ao conector sem usar um número real
// (DMK_WA_SIMULADO=1). Nunca é usado em produção: o serviço avisa no início e no /health quando está ligado.
const crypto = require('node:crypto'), fs = require('node:fs');
module.exports = function criarMotorSimulado({ runtimeMap, onMessage, onMessageStatus, onReaction, onDelete }) {
  const enviados = [], acoes = [];
  // Só nos testes: números "sem WhatsApp" (erro definitivo, igual ao motor real) — o envio é recusado sem incerteza.
  const semWhatsapp = new Set();
  const conferir = (to) => { if (semWhatsapp.has(String(to).replace(/\D/g, ''))) throw Object.assign(Error('Este número não tem WhatsApp. Confira o DDD e o número.'), { statusCode: 400, operational: true }); };
  const id = () => 'SIM' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const vivo = (conta) => { const r = runtimeMap.get(Number(conta.id)); if (!r || r.status !== 'CONECTADO') throw Error(`WhatsApp "${conta.label}" não está conectado.`); return r; };
  const jid = (n) => (String(n).includes('@') ? String(n) : String(n).replace(/\D/g, '') + '@s.whatsapp.net');
  return {
    simulado: true, enviados, acoes, semWhatsapp,
    async start(conta) {
      const r = { accountId: Number(conta.id), status: 'AGUARDANDO_QR', qrDataUrl: 'data:image/png;base64,SIMULADO', qrText: 'QR-SIMULADO-' + conta.id, phone: '', startedAt: Date.now() };
      runtimeMap.set(r.accountId, r);
      return r;
    },
    // Só no simulado: faz o papel de quem leu o QR no celular.
    lerQr(contaId, telefone = '5587990000000') { const r = runtimeMap.get(Number(contaId)); if (!r) throw Error('Sessão não iniciada.'); Object.assign(r, { status: 'CONECTADO', qrDataUrl: null, qrText: null, phone: telefone, connectedAt: Date.now(), receiving: true }); return r; },
    async stop(conta) { runtimeMap.delete(Number(conta?.id || conta)); },
    async sendText(conta, to, text, opcoes = {}) { vivo(conta); conferir(to);
      // Igual ao motor real: enquete/localização/contato passam pela mesma conferência antes de "sair".
      if (opcoes.native && !require('./vendor/whatsapp-formatos').limparNativo(opcoes.native)) throw Object.assign(Error('Formato native inválido.'), { statusCode: 400, operational: true }); const m = { conta: Number(conta.id), to: jid(to), text, opcoes, externalId: id() }; enviados.push(m); return { externalId: m.externalId, ...(opcoes.interactive ? { native: true } : {}) }; }, // como o motor real com a biblioteca atual
    async sendMedia(conta, to, arquivo, mimetype, filename, text = '', opcoes = {}) { vivo(conta); conferir(to); const m = { conta: Number(conta.id), to: jid(to), text, mimetype, filename, bytes: fs.readFileSync(arquivo).length, opcoes, externalId: id() }; enviados.push(m); return { externalId: m.externalId }; },
    async react(conta, to, mid, emoji) { vivo(conta); acoes.push({ tipo: 'react', conta: Number(conta.id), to, mid, emoji }); return { ok: true }; },
    async deleteMessage(conta, to, mid) { vivo(conta); acoes.push({ tipo: 'delete', conta: Number(conta.id), to, mid }); return { ok: true }; },
    async editMessage(conta, to, mid, text) { vivo(conta); acoes.push({ tipo: 'edit', conta: Number(conta.id), to, mid, text }); return { ok: true }; },
    async markRead(conta, to, ids) { vivo(conta); acoes.push({ tipo: 'read', conta: Number(conta.id), to, ids }); return { ok: true }; },
    async setPresence(conta, to, state) { vivo(conta); acoes.push({ tipo: 'presence', conta: Number(conta.id), to, state }); return { ok: true }; },
    async getPresence() { return { state: '', at: 0 }; },
    async profilePhoto() { return { supported: false, url: '' }; },
    async checkNumber() { return { supported: false, exists: null, jid: '', lid: '' }; },
    health: () => [...runtimeMap.values()].map((r) => ({ id: r.accountId, status: r.status, reconnect_attempts: 0 })),
    // Só no simulado: faz o papel do WhatsApp entregando uma mensagem, um recibo, uma reação ou uma exclusão.
    async receber(contaId, m) { await onMessage({ id: Number(contaId) }, { remoteJid: jid(m.de), sourceJid: '', phone: String(m.de).replace(/\D/g, ''), name: m.nome || '', fromMe: m.minha === true, messageId: m.id || id(), text: m.texto || '', media: m.midia || null, timestamp: Math.floor(Date.now() / 1000) }); },
    async recibo(contaId, messageId, status) { await onMessageStatus({ id: Number(contaId) }, { messageId, status }); },
    async reacao(contaId, m) { await onReaction({ id: Number(contaId) }, { messageId: m.id, emoji: m.emoji, targetKey: { remoteJid: jid(m.de) }, fromMe: false }); },
    async apagada(contaId, m) { await onDelete({ id: Number(contaId) }, { messageId: m.id, key: { remoteJid: jid(m.de) } }); },
  };
};

'use strict';
// DMK WhatsApp - confere a biblioteca do WhatsApp (Baileys) instalada, sem mexer em nenhuma sessão.
//
//   node ferramentas/conferir-baileys.js            confere as funções que o motor usa
//   node ferramentas/conferir-baileys.js --qr       também abre uma conexão de teste até o WhatsApp entregar
//                                                   um QR (prova que a versão conversa com o WhatsApp de hoje).
//                                                   Usa uma pasta temporária: não lê nem altera dados/.
// Roda no CI a cada publicação e serve para diagnóstico na VPS (sai com código 1 se algo faltar).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const silencioso = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };

(async () => {
  const mod = await import('@whiskeysockets/baileys');
  const pegar = (nome) => mod[nome] ?? mod.default?.[nome];
  const versao = JSON.parse(fs.readFileSync(require.resolve('@whiskeysockets/baileys/package.json'), 'utf8')).version;
  const faltando = ['makeWASocket', 'useMultiFileAuthState', 'makeCacheableSignalKeyStore', 'downloadMediaMessage', 'Browsers', 'DisconnectReason', 'proto']
    .filter((n) => !(n === 'makeWASocket' ? typeof (pegar(n) || mod.default) === 'function' : pegar(n)));
  if (!pegar('proto')?.Message?.encode) faltando.push('proto.Message.encode');
  console.log(`Baileys ${versao}: ${faltando.length ? 'FALTANDO ' + faltando.join(', ') : 'todas as funções usadas pelo motor existem'}.`);
  if (faltando.length) process.exit(1);
  if (!process.argv.includes('--qr')) return;

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-conferir-'));
  const { state } = await pegar('useMultiFileAuthState')(pasta);
  const sock = (pegar('makeWASocket') || mod.default)({ auth: { ...state, keys: pegar('makeCacheableSignalKeyStore')(state.keys, silencioso) }, logger: silencioso, browser: pegar('Browsers').ubuntu('Chrome'), markOnlineOnConnect: false });
  const fim = (codigo, texto) => { console.log(texto); try { sock.end(undefined); } catch {} fs.rmSync(pasta, { recursive: true, force: true }); process.exit(codigo); };
  const prazo = setTimeout(() => fim(1, 'O WhatsApp não entregou o QR em 45 s (rede da máquina ou versão da biblioteca).'), 45000);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { clearTimeout(prazo); fim(0, 'Conexão de teste OK: o WhatsApp entregou o QR (nada foi pareado).'); }
    if (u.connection === 'close') { clearTimeout(prazo); fim(1, 'O WhatsApp fechou a conexão de teste: ' + String(u.lastDisconnect?.error?.message || 'sem detalhe')); }
  });
})().catch((e) => { console.error('Falhou:', e.message); process.exit(1); });

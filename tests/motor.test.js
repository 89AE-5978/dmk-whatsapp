'use strict';
// Motor Baileys (lib/vendor/whatsapp-baileys.js) com uma biblioteca falsa no lugar do Baileys:
// confere as correções da 1.3.0 contra travamento e "Aguardando mensagem", sem falar com o WhatsApp.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), { EventEmitter } = require('node:events');

// O motor carrega "qrcode" no topo; nos testes não precisa do pacote de verdade.
const carregar = Module._load;
Module._load = function (pedido, ...resto) { return pedido === 'qrcode' ? { toDataURL: async () => 'data:image/png;base64,QR' } : carregar.call(this, pedido, ...resto); };
const { createBaileysManager } = require('../lib/vendor/whatsapp-baileys');
Module._load = carregar;
// O motor consulta a versão do WhatsApp Web na internet; aqui responde "sem rede" na hora.
const fetchOriginal = global.fetch;
test.before(() => { global.fetch = async () => { throw Error('sem rede no teste'); }; });
test.after(() => { global.fetch = fetchOriginal; });
console.log = () => {}; console.warn = () => {}; console.error = () => {};

function bibliotecaFalsa({ enviar } = {}) {
  const sockets = [];
  return {
    sockets,
    modulo: {
      makeWASocket(opcoes) {
        const sock = { ev: new EventEmitter(), opcoes, user: { id: '5581911110000:1@s.whatsapp.net' }, encerrado: null,
          onWhatsApp: async (n) => [{ exists: true, jid: n + '@s.whatsapp.net' }],
          sendMessage: enviar || (async (jid, conteudo) => ({ key: { id: 'ID' + Math.random().toString(16).slice(2), remoteJid: jid, fromMe: true }, message: { conversation: conteudo.text } })),
          end(e) { this.encerrado = e; } };
        sockets.push(sock);
        setImmediate(() => sock.ev.emit('connection.update', { connection: 'open' }));
        return sock;
      },
      useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => {} }),
      DisconnectReason: { loggedOut: 401, connectionReplaced: 440 },
      proto: { Message: { encode: (m) => ({ finish: () => Buffer.from(JSON.stringify(m)) }), decode: (b) => JSON.parse(Buffer.from(b).toString()) } },
    },
  };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function conectado(runtimes, id = 1) { for (let i = 0; i < 100 && runtimes.get(id)?.status !== 'CONECTADO'; i++) await esperar(10); assert.equal(runtimes.get(id)?.status, 'CONECTADO'); }
const conta = { id: 1, client_key: 'sessao-1', label: 'Teste', enabled: 1 };
const raiz = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-motor-'));

test('código 440 (mesma credencial aberta em outro lugar) para a sessão em vez de reconectar em loop', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map();
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo });
  await motor.start(conta); await conectado(runtimes);
  lib.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } } });
  await esperar(2500); // a reconexão normal acontece em 2 s
  assert.equal(lib.sockets.length, 1, 'não abriu outro socket');
  assert.equal(runtimes.get(1).status, 'SUBSTITUIDA');
  assert.match(runtimes.get(1).lastError, /outro lugar/);
  await motor.stop(conta);
});

test('envios da mesma sessão saem um por vez, com intervalo mínimo', async () => {
  const inicios = [];
  const lib = bibliotecaFalsa({ enviar: async (jid, c) => { inicios.push(Date.now()); await esperar(20); return { key: { id: 'X' + inicios.length, remoteJid: jid, fromMe: true }, message: { conversation: c.text } }; } });
  const runtimes = new Map(), motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, minSendIntervalMs: 200 });
  await motor.start(conta); await conectado(runtimes);
  await Promise.all([motor.sendText(conta, '5581999990001', 'um'), motor.sendText(conta, '5581999990001', 'dois'), motor.sendText(conta, '5581999990001', 'três')]);
  assert.equal(inicios.length, 3);
  assert.ok(inicios[1] - inicios[0] >= 195 && inicios[2] - inicios[1] >= 195, 'intervalo respeitado: ' + [inicios[1] - inicios[0], inicios[2] - inicios[1]]);
  await motor.stop(conta);
});

test('conexão que não responde: dois envios sem resposta reabrem só o socket (sem QR)', async () => {
  const lib = bibliotecaFalsa({ enviar: () => new Promise(() => {}) });
  const runtimes = new Map(), motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, sendTimeoutMs: 50 });
  await motor.start(conta); await conectado(runtimes);
  for (let i = 0; i < 2; i++) await assert.rejects(motor.sendText(conta, '5581999990001', 'oi'), (e) => e.uncertain === true);
  assert.match(String(lib.sockets[0].encerrado?.message), /sem resposta/);
  await motor.stop(conta);
});

test('reenvio: conteúdo guardado em disco volta como a mensagem original e pausar não apaga a memória', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map(), guardados = new Map();
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo,
    saveMessage: async (c, { key, bytes }) => guardados.set(key.id, bytes), loadMessage: async (c, key) => guardados.get(key.id) });
  await motor.start(conta); await conectado(runtimes);
  const { externalId } = await motor.sendText(conta, '5581999990001', 'mensagem importante');
  assert.ok(guardados.has(externalId), 'envio confirmado guardado para reenvio');
  const chave = { id: externalId, remoteJid: '5581999990001@s.whatsapp.net', fromMe: true };
  await motor.stop(conta); // pausar/reiniciar
  await motor.start(conta); await conectado(runtimes);
  assert.deepEqual(await lib.sockets[1].opcoes.getMessage(chave), { conversation: 'mensagem importante' }, 'memória mantida depois de pausar');
  guardados.set('DISCO1', Buffer.from(JSON.stringify({ conversation: 'do disco' })));
  assert.deepEqual(await lib.sockets[1].opcoes.getMessage({ id: 'DISCO1', remoteJid: chave.remoteJid, fromMe: true }), { conversation: 'do disco' }, 'bytes do disco decodificados');
  await motor.stop(conta, { logout: true });
});

test('mensagem que não pôde ser decifrada é contada e avisada (antes sumia em silêncio)', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map(), recebidas = [];
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, onMessage: async (c, m) => recebidas.push(m.text) });
  await motor.start(conta); await conectado(runtimes);
  const ev = lib.sockets[0].ev;
  ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '123456@lid', id: 'C1', fromMe: false }, messageStubType: 2, messageStubParameters: ['No session'] }] });
  ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '123456@lid', remoteJidAlt: '5581999990001@s.whatsapp.net', id: 'C2', fromMe: false }, message: { conversation: 'abriu' } }] });
  await esperar(50);
  assert.equal(runtimes.get(1).decryptFailures, 1);
  assert.deepEqual(recebidas, ['abriu']);
  assert.equal(typeof lib.sockets[0].opcoes.logger.error, 'function');
  await motor.stop(conta);
});

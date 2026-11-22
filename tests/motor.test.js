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
        const sock = { ev: new EventEmitter(), ws: new EventEmitter(), nos: [], sendNode: async function (n) { this.nos.push(n); }, opcoes, user: { id: '5581911110000:1@s.whatsapp.net' }, encerrado: null,
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

test('lista/botões nativos (1.3.4): monta a mensagem e entrega pelo relayMessage; sem suporte, segue em texto', async () => {
  const relays = [], textos = [];
  const lib = bibliotecaFalsa({ enviar: async (jid, c) => { textos.push(c.text); return { key: { id: 'T' + textos.length, remoteJid: jid, fromMe: true }, message: { conversation: c.text } }; } });
  lib.modulo.generateWAMessageFromContent = (jid, conteudo, opcoes) => ({ key: { id: 'NATIVA1', remoteJid: jid, fromMe: true }, message: conteudo, userJid: opcoes.userJid });
  const runtimes = new Map(), guardados = [];
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, minSendIntervalMs: 0, saveMessage: async (_, m) => { guardados.push(m.key.id); } });
  await motor.start(conta); await conectado(runtimes);
  lib.sockets[0].relayMessage = async (jid, message, opcoes) => { relays.push({ jid, message, opcoes }); };
  const pedido = { style: 'list', body: 'Como ajudar?', items: [{ id: 'o1', label: '2ª via' }, { id: 'o2', label: 'Atendente' }] };
  const out = await motor.sendText(conta, '5581999990001', 'Como ajudar?\n1. 2ª via\n2. Atendente', { interactive: pedido });
  assert.equal(out.externalId, 'NATIVA1'); assert.equal(out.native, true); assert.equal(textos.length, 0, 'não mandou o texto junto');
  assert.equal(relays.length, 1); assert.equal(relays[0].opcoes.messageId, 'NATIVA1'); assert.equal(relays[0].opcoes.additionalNodes[0].tag, 'biz');
  const linhas = JSON.parse(relays[0].message.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson).sections[0].rows;
  assert.deepEqual(linhas.map((r) => [r.id, r.title]), [['o1', '2ª via'], ['o2', 'Atendente']]);
  assert.deepEqual(guardados, ['NATIVA1'], 'o conteúdo fica guardado para pedidos de reenvio');
  // pedido inválido: ignora o nativo e manda o texto
  await motor.sendText(conta, '5581999990001', 'só texto', { interactive: { body: '', items: [] } });
  assert.deepEqual(textos, ['só texto']); assert.equal(relays.length, 1);
  // biblioteca sem a função: segue em texto, sem erro
  delete runtimes.get(1).mod.generateWAMessageFromContent;
  const semSuporte = await motor.sendText(conta, '5581999990001', 'Como ajudar?\n1. 2ª via', { interactive: pedido });
  assert.equal(semSuporte.native, undefined); assert.equal(textos.at(-1), 'Como ajudar?\n1. 2ª via'); assert.equal(relays.length, 1);
  await motor.stop(conta);
});

test('mensagem de empresa recebida (1.3.4): chega como texto legível e com a estrutura', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map(), recebidas = [];
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, onMessage: async (_, m) => { recebidas.push(m); } });
  await motor.start(conta); await conectado(runtimes);
  lib.sockets[0].ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'EMP1', remoteJid: '558132176990@s.whatsapp.net', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Neoenergia',
    message: { interactiveMessage: { body: { text: 'Sua fatura está disponível.' }, nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: '{"display_text":"Ver fatura","url":"https://exemplo.test/f"}' }] } } } }] });
  for (let i = 0; i < 100 && !recebidas.length; i++) await esperar(10);
  assert.equal(recebidas.length, 1); assert.equal(recebidas[0].text, 'Sua fatura está disponível.\nOpções: Ver fatura (https://exemplo.test/f)');
  assert.deepEqual(recebidas[0].rich, { tipo: 'interativa', corpo: 'Sua fatura está disponível.', opcoes: [{ rotulo: 'Ver fatura', tipo: 'link', valor: 'https://exemplo.test/f' }] });
  assert.equal(recebidas[0].botEligible, false);
  await motor.stop(conta);
});

test('parar/atualizar (1.3.5): credencial na fila e chaves em gravação chegam ao disco antes de soltar a sessão', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map();
  let credsSalvas = 0, chavesGravadas = 0, chavesIniciadas = 0;
  const modulo = { ...lib.modulo, useMultiFileAuthState: async () => ({
    state: { creds: {}, keys: { get: async () => ({}), set: async () => { chavesIniciadas++; await esperar(300); chavesGravadas++; } } },
    saveCreds: async () => { await esperar(50); credsSalvas++; } }) };
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => modulo });
  await motor.start(conta); await conectado(runtimes);
  const sock = lib.sockets[0];
  // Uma mensagem acabou de chegar: a biblioteca grava chaves (lento) e avisa que a credencial mudou — e o serviço para.
  sock.opcoes.auth.keys.set({ session: { a: 1 } });
  sock.ev.emit('creds.update', {}); sock.ev.emit('creds.update', {});
  await esperar(5); // a gravação da chave já começou, mas não terminou
  assert.equal(chavesIniciadas, 1); assert.equal(chavesGravadas, 0);
  await motor.stop(conta);
  assert.equal(chavesGravadas, 1, 'a parada esperou a gravação da chave terminar');
  assert.ok(credsSalvas >= 2, 'as gravações da credencial que estavam na fila não foram puladas (antes: 0)');
  // Depois de solto, o socket antigo não grava mais nada por cima.
  const antes = credsSalvas; sock.ev.emit('creds.update', {}); await esperar(120);
  assert.equal(credsSalvas, antes);
});

test('trocar número/excluir (1.3.5): credencial que vai ser apagada não é regravada', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map();
  let credsSalvas = 0;
  const modulo = { ...lib.modulo, useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => { credsSalvas++; } }) };
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => modulo });
  await motor.start(conta); await conectado(runtimes);
  lib.sockets[0].ev.emit('creds.update', {}); await esperar(20);
  const antes = credsSalvas;
  await motor.stop(conta, { deleteAuth: true });
  assert.equal(credsSalvas, antes);
});

test('nó <status> (story de contato) é confirmado na hora — sem isso o WhatsApp segura as mensagens e derruba em ~50 min', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map();
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo });
  await motor.start(conta); await conectado(runtimes);
  const sock = lib.sockets[0];
  sock.ws.emit('CB:status', { tag: 'status', attrs: { id: '3A20ABC', from: '5581999990001@s.whatsapp.net', type: 'media', participant: '5581999990001:3@s.whatsapp.net', t: '1' } });
  await esperar(20);
  assert.deepEqual(sock.nos, [{ tag: 'ack', attrs: { id: '3A20ABC', to: '5581999990001@s.whatsapp.net', class: 'status', participant: '5581999990001:3@s.whatsapp.net', type: 'media' } }]);
  sock.ws.emit('CB:status', { tag: 'status', attrs: {} }); await esperar(10);
  assert.equal(sock.nos.length, 1, 'nó sem id não gera confirmação');
  await motor.stop(conta);
});

test('sinal de recebimento: só fica "recebendo" quando o WhatsApp confirma as pendências ou entrega mensagem', async () => {
  const lib = bibliotecaFalsa(), runtimes = new Map();
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo });
  await motor.start(conta); await conectado(runtimes);
  assert.ok(!runtimes.get(1).receiving, 'conectado ainda não é recebendo');
  lib.sockets[0].ev.emit('connection.update', { receivedPendingNotifications: true });
  await esperar(10);
  assert.equal(runtimes.get(1).receiving, true);
  await motor.stop(conta);
});

test('resposta citada: a citação usa o endereço do envio (mensagem guardada pelo LID não vira "de outra conversa")', async () => {
  const enviados = [];
  const lib = bibliotecaFalsa({ enviar: async (jid, c, o) => { enviados.push({ jid, o }); return { key: { id: 'R' + enviados.length, remoteJid: jid, fromMe: true }, message: { conversation: c.text } }; } });
  const runtimes = new Map(), motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo, onMessage: async () => {} });
  await motor.start(conta); await conectado(runtimes);
  lib.sockets[0].ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '123456@lid', remoteJidAlt: '5581999990001@s.whatsapp.net', id: 'ORIG1', fromMe: false }, message: { conversation: 'pergunta' } }] });
  await esperar(50);
  await motor.sendText(conta, '5581999990001', 'resposta', { replyToExternalId: 'ORIG1', replyQuote: { fromMe: false, body: 'pergunta' } });
  const { jid, o } = enviados[0];
  assert.equal(o.quoted.key.remoteJid, jid, 'mesmo endereço do envio');
  assert.deepEqual([o.quoted.key.id, o.quoted.key.fromMe, o.quoted.message.conversation], ['ORIG1', false, 'pergunta']);
  await motor.stop(conta);
});

test('áudio: arquivo por padrão, mensagem de voz (ptt) com voz:true; recebido marca voz/duração', async () => {
  const enviados = [];
  const lib = bibliotecaFalsa({ enviar: async (jid, conteudo) => { enviados.push(conteudo); return { key: { id: 'ID' + enviados.length, remoteJid: jid, fromMe: true }, message: {} }; } });
  const runtimes = new Map();
  const motor = createBaileysManager({ runtimeMap: runtimes, authRoot: raiz(), loadModule: () => lib.modulo });
  await motor.start(conta); await conectado(runtimes);
  const arquivo = path.join(raiz(), 'a.ogg'); fs.writeFileSync(arquivo, Buffer.from('audio'));
  await motor.sendMedia(conta, '5581911112222', arquivo, 'audio/ogg; codecs=opus', 'a.ogg', '');
  await motor.sendMedia(conta, '5581911112222', arquivo, 'audio/ogg; codecs=opus', 'a.ogg', '', { voz: true });
  assert.equal(enviados[0].ptt, false, 'sem voz:true vai como arquivo de áudio');
  assert.equal(enviados[1].ptt, true, 'com voz:true vai como mensagem de voz');
  // recebido: o chat precisa saber que é voz (bolha do play) e quanto tempo tem
  const recebidas = [];
  const motor2 = createBaileysManager({ runtimeMap: new Map(), authRoot: raiz(), loadModule: () => lib.modulo, onMessage: async (c, m) => recebidas.push(m) });
  const r2 = await motor2.start({ ...conta, id: 2, client_key: 'sessao-2' });
  for (let i = 0; i < 100 && r2.status !== 'CONECTADO'; i++) await esperar(10);
  lib.sockets[1].ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'V1', remoteJid: '5581911112222@s.whatsapp.net', fromMe: false }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 7 } }, messageTimestamp: 1 }] });
  for (let i = 0; i < 100 && !recebidas.length; i++) await esperar(10);
  assert.equal(recebidas[0]?.media?.voz, true); assert.equal(recebidas[0]?.media?.segundos, 7);
});

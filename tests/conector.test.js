'use strict';
// Testes do conector com o motor simulado (não fala com o WhatsApp).
// Conferem o protocolo Conector DMK por sessão, o isolamento entre sessões, a fila com confirmação,
// a administração e o que acontece ao reiniciar.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');
const CHAVE = crypto.randomBytes(32).toString('hex'), BASE = '/api/public/dmk-connector/v1';

async function subir(dataDir) {
  const app = criarServidor({ dataDir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true, log: { error() {} } });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + app.servidor.address().port;
  const pedir = async (metodo, caminho, corpo, token, extra = {}) => {
    const r = await fetch(url + caminho, { method: metodo, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: corpo ? JSON.stringify(corpo) : undefined });
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { app, url, pedir, admin: (m, c, b) => pedir(m, '/admin/v1' + c, b, CHAVE), pub: (m, c, b, t, x) => pedir(m, BASE + c, b, t, x) };
}
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-'));
const rid = () => 'req_' + crypto.randomBytes(12).toString('hex');
// Cria uma sessão conectada e devolve uma credencial de sistema para ela.
async function sessaoPronta(s, nome, dono, telefone) {
  const criada = (await s.admin('POST', '/sessoes', { nome, dono })).corpo;
  const qr = (await s.admin('POST', `/sessoes/${criada.id}/conectar`)).corpo;
  assert.equal(qr.status, 'AGUARDANDO_QR'); assert.ok(qr.qr_texto, 'QR em texto para mostrar no terminal');
  assert.equal((await s.admin('POST', `/sessoes/${criada.id}/simular-leitura-qr`, { telefone })).corpo.status, 'CONECTADO');
  const aut = (await s.admin('POST', `/sessoes/${criada.id}/autorizacoes`, { nome: 'Sistema ' + dono, sistema: dono, confirmado: true })).corpo;
  const troca = await s.pub('POST', '/exchange', { code: aut.code, protocol: 2 });
  assert.equal(troca.status, 200);
  return { id: criada.id, token: troca.corpo.token, codigo: aut.code, autorizacao: aut.id };
}

test('administração exige a chave e o /health não entrega nada sensível', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const h = await s.pedir('GET', '/health');
  assert.deepEqual(Object.keys(h.corpo).sort(), ['ativas', 'conectadas', 'node', 'ok', 'servico', 'sessoes', 'simulado', 'versao']);
  assert.equal((await s.pedir('GET', '/admin/v1/sessoes')).status, 401);
  assert.equal((await s.pedir('GET', '/admin/v1/sessoes', null, 'a'.repeat(64))).status, 401);
  assert.equal((await s.admin('GET', '/sessoes')).status, 200);
  assert.equal((await s.admin('POST', '/sessoes', { nome: 'X', dono: 'Dono Inválido' })).status, 400);
  assert.equal((await s.pedir('GET', '/qualquer')).status, 404);
  for (let i = 0; i < 10; i++) await s.pedir('GET', '/admin/v1/sessoes', null, 'b'.repeat(64));
  assert.equal((await s.admin('GET', '/sessoes')).status, 429, 'muitas chaves erradas seguidas bloqueiam por um minuto, até a certa');
});

test('cada sessão é um número: a credencial de uma não lê nem envia pela outra', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const gestao = await sessaoPronta(s, 'Atendimento', 'gestao', '5581911110000'), iot = await sessaoPronta(s, 'Avisos das centrais', 'smartcore', '5581922220000');
  await s.admin('POST', `/sessoes/${gestao.id}/simular-mensagem`, { de: '5581999990001', nome: 'Cliente A', texto: 'oi gestão', id: 'MSGA0001' });
  await s.admin('POST', `/sessoes/${iot.id}/simular-mensagem`, { de: '5581999990002', nome: 'Cliente B', texto: 'oi iot', id: 'MSGB0001' });
  const eg = (await s.pub('GET', '/events', null, gestao.token)).corpo, ei = (await s.pub('GET', '/events', null, iot.token)).corpo;
  assert.deepEqual(eg.events.map((e) => e.data.text), ['oi gestão']); assert.deepEqual(ei.events.map((e) => e.data.text), ['oi iot']);
  assert.deepEqual([eg.status.phone, ei.status.phone], ['5581911110000', '5581922220000']);
  assert.equal(eg.events[0].data.peer, '5581999990001@s.whatsapp.net'); assert.equal(eg.events[0].data.outgoing, false);
  const envio = await s.pub('POST', '/send', { to: '5581999990001', text: 'resposta', request_id: rid() }, gestao.token);
  assert.equal(envio.status, 200); assert.ok(envio.corpo.externalId);
  assert.deepEqual(s.app.sessoes.motor.enviados.map((m) => [m.conta, m.to, m.text]), [[gestao.id, '5581999990001@s.whatsapp.net', 'resposta']]);
  const depois = (await s.pub('GET', '/events', null, iot.token)).corpo.events;
  assert.equal(depois.length, 1, 'o envio da gestão não aparece na sessão do Smart Core');
  const lista = (await s.admin('GET', '/sessoes')).corpo.sessoes;
  assert.deepEqual(lista.map((x) => [x.dono, x.status, x.autorizacoes]), [['gestao', 'CONECTADO', 1], ['smartcore', 'CONECTADO', 1]]);
  assert.ok(!JSON.stringify(lista).includes(gestao.token) && !JSON.stringify(lista).includes('token_hash'), 'a listagem não entrega credenciais');
});

test('protocolo: código de uso único, fila só esvazia com confirmação, envio sem repetição', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const a = await sessaoPronta(s, 'Atendimento', 'gestao', '5581911110000');
  assert.equal((await s.pub('POST', '/exchange', { code: a.codigo, protocol: 2 })).status, 401, 'o código só vale uma vez');
  const outra = (await s.admin('POST', `/sessoes/${a.id}/autorizacoes`, { nome: 'Antigo', sistema: 'antigo', confirmado: true })).corpo;
  assert.equal((await s.pub('POST', '/exchange', { code: outra.code })).status, 409, 'sistema que não declara o protocolo 2 é recusado sem gastar o código');
  assert.equal((await s.admin('POST', `/sessoes/${a.id}/autorizacoes`, { nome: 'Sem confirmar', sistema: 'x' })).status, 409);
  assert.equal((await s.pub('GET', '/events', null, 'c'.repeat(64))).status, 401);
  assert.equal((await s.pub('GET', '/events')).status, 401);
  await s.admin('POST', `/sessoes/${a.id}/simular-mensagem`, { de: '5581999990001', texto: 'um', id: 'MSG00001' });
  await s.admin('POST', `/sessoes/${a.id}/simular-mensagem`, { de: '5581999990001', texto: 'um', id: 'MSG00001' });
  await s.admin('POST', `/sessoes/${a.id}/simular-mensagem`, { de: '5581999990001', texto: 'foto', id: 'MSG00002', midia: { buffer: { type: 'Buffer', data: [1, 2, 3, 4] }, mimetype: 'image/png', filename: 'a.png' } });
  let ev = (await s.pub('GET', '/events', null, a.token)).corpo.events;
  assert.deepEqual(ev.map((e) => e.data.text), ['um', 'foto'], 'mensagem repetida pelo WhatsApp entra uma vez só');
  assert.equal((await s.pub('GET', '/events', null, a.token)).corpo.events.length, 2, 'sem confirmação o evento continua na fila');
  assert.equal((await s.pub('POST', '/ack', { ids: [999] }, a.token)).status, 400);
  assert.equal((await s.pub('POST', '/ack', { ids: [ev[0].id] }, a.token)).status, 200);
  ev = (await s.pub('GET', '/events', null, a.token)).corpo.events; assert.deepEqual(ev.map((e) => e.data.text), ['foto']);
  const r = rid(), e1 = await s.pub('POST', '/send', { to: '5581999990001', text: 'olá', request_id: r }, a.token), e2 = await s.pub('POST', '/send', { to: '5581999990001', text: 'olá', request_id: r }, a.token);
  assert.equal(e1.corpo.externalId, e2.corpo.externalId); assert.equal(s.app.sessoes.motor.enviados.length, 1, 'repetir o mesmo pedido não envia duas vezes');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'outro', request_id: r }, a.token)).status, 409);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'sem id' }, a.token)).status, 400);
  assert.equal((await s.pub('POST', '/send', { to: '123', text: 'x', request_id: rid() }, a.token)).status, 400);
  // 1.3.4: lista/botões nativos chegam ao motor conferidos; pedido torto é recusado sem enviar nada
  const antes = s.app.sessoes.motor.enviados.length;
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'Escolha\n1. Sim\n2. Não', request_id: rid(), interactive: { style: 'buttons', body: 'Escolha', items: [{ id: 'o1', label: 'Sim' }, { id: 'o2', label: 'Não' }], lixo: '<b>' } }, a.token)).status, 200);
  assert.deepEqual(s.app.sessoes.motor.enviados.at(-1).opcoes.interactive, { style: 'buttons', body: 'Escolha', footer: '', button: 'Ver opções', items: [{ id: 'o1', label: 'Sim' }, { id: 'o2', label: 'Não' }] });
  assert.equal(s.app.sessoes.motor.enviados.at(-1).text, 'Escolha\n1. Sim\n2. Não', 'o texto numerado segue junto, como reserva');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'x', request_id: rid(), interactive: { body: 'x', items: [] } }, a.token)).status, 400);
  assert.equal(s.app.sessoes.motor.enviados.length, antes + 1);
  assert.equal((await s.pub('POST', '/react', { to: '5581999990001', messageId: 'MSG00002', emoji: '👍' }, a.token)).status, 200);
  assert.equal((await s.pub('POST', '/read', { to: '5581999990001', messageIds: ['MSG00002'] }, a.token)).status, 200);
  assert.deepEqual(s.app.sessoes.motor.acoes.map((x) => x.tipo), ['react', 'read']);
  assert.equal((await s.pub('GET', '/photo?to=5581999990001', null, a.token)).status, 204);
  await s.admin('POST', `/sessoes/${a.id}/pausar`);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'pausada', request_id: rid() }, a.token)).status, 503, 'sessão pausada não envia');
});

test('anexo recebido fica disponível até a confirmação e some depois', async (t) => {
  const dir = pasta(), s = await subir(dir); t.after(() => s.app.encerrar());
  const a = await sessaoPronta(s, 'Atendimento', 'gestao', '5581911110000');
  await s.app.sessoes.motor.receber(a.id, { de: '5581999990001', texto: 'foto', id: 'MSGFOTO1', midia: { buffer: Buffer.from('conteudo-da-foto'), mimetype: 'image/png', filename: 'a.png' } });
  const ev = (await s.pub('GET', '/events', null, a.token)).corpo.events[0];
  assert.deepEqual(ev.data.media, { mimetype: 'image/png', filename: 'a.png', size: 16 });
  const m = await s.pub('GET', '/media/' + ev.id, null, a.token); assert.equal(m.status, 200); assert.equal(m.corpo.toString(), 'conteudo-da-foto');
  const guardados = () => fs.readdirSync(path.join(dir, 'sessoes', 'sessao-' + a.id, 'dmk-connector-media')).length;
  assert.equal(guardados(), 1); await s.pub('POST', '/ack', { ids: [ev.id] }, a.token); assert.equal(guardados(), 0, 'confirmado: o conector não guarda o anexo');
  assert.equal((await s.pub('GET', '/media/' + ev.id, null, a.token)).status, 404);
  const envio = await s.pub('POST', '/send', { to: '5581999990001', text: 'segue', request_id: rid(), media: { base64: Buffer.from('pdf').toString('base64'), mimetype: 'application/pdf', filename: 'nota.pdf' } }, a.token);
  assert.equal(envio.status, 200); assert.deepEqual([s.app.sessoes.motor.enviados[0].filename, s.app.sessoes.motor.enviados[0].bytes], ['nota.pdf', 3]);
});

test('revogar, excluir e reiniciar', async (t) => {
  const dir = pasta(); let s = await subir(dir);
  const a = await sessaoPronta(s, 'Atendimento', 'gestao', '5581911110000'), b = await sessaoPronta(s, 'Avisos', 'smartcore', '5581922220000');
  await s.app.sessoes.motor.receber(a.id, { de: '5581999990001', texto: 'antes de reiniciar', id: 'MSGREIN1' });
  await s.app.encerrar();
  const salvo = fs.readFileSync(path.join(dir, 'conector.json'), 'utf8');
  assert.ok(!salvo.includes(a.token) && !salvo.includes(a.codigo), 'credencial e código ficam gravados só como resumo (hash)');
  assert.equal(fs.statSync(path.join(dir, 'conector.json')).mode & 0o777, 0o600); assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  s = await subir(dir); t.after(() => s.app.encerrar());
  await s.app.sessoes.iniciar(); await new Promise((ok) => setTimeout(ok, 50));
  assert.deepEqual((await s.admin('GET', '/sessoes')).corpo.sessoes.map((x) => [x.id, x.ativa, x.status]), [[a.id, true, 'AGUARDANDO_QR'], [b.id, true, 'AGUARDANDO_QR']], 'no simulado a reconexão para no QR; no real o Baileys reconecta com a sessão salva');
  assert.deepEqual((await s.pub('GET', '/events', null, a.token)).corpo.events.map((e) => e.data.text), ['antes de reiniciar'], 'a credencial e a fila sobrevivem ao reinício');
  assert.equal((await s.admin('POST', `/sessoes/${a.id}/autorizacoes/${a.autorizacao}/revogar`)).status, 200);
  assert.equal((await s.pub('GET', '/events', null, a.token)).status, 401, 'revogado: para na próxima consulta');
  assert.equal((await s.pub('GET', '/events', null, b.token)).status, 200, 'revogar numa sessão não afeta a outra');
  assert.equal((await s.admin('POST', `/sessoes/${b.id}/excluir`, {})).status, 409);
  assert.equal((await s.admin('POST', `/sessoes/${b.id}/excluir`, { confirmado: true })).status, 200);
  assert.equal((await s.pub('GET', '/events', null, b.token)).status, 401);
  assert.equal(fs.existsSync(path.join(dir, 'sessoes', 'sessao-' + b.id)), false);
  const nova = (await s.admin('POST', '/sessoes', { nome: 'Outra', dono: 'gestao' })).corpo;
  assert.notEqual(nova.id, b.id, 'número de sessão excluída não é reaproveitado');
  assert.equal((await s.admin('GET', '/sessoes/999')).status, 404);
});

test('arquivo de estado vazio impede a partida em vez de apagar as sessões', () => {
  const dir = pasta(); fs.writeFileSync(path.join(dir, 'conector.json'), '');
  assert.throws(() => criarServidor({ dataDir: dir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true }), /está vazio/);
  assert.equal(fs.readFileSync(path.join(dir, 'conector.json'), 'utf8'), '', 'nada é sobrescrito');
  assert.throws(() => criarServidor({ dataDir: pasta(), chaveAdmin: 'curta', fabricaMotor: motorSimulado }), /Chave de administrador/);
});

'use strict';
// Distribuição de atendimento (1.3.0): uma sessão, várias conexões (sistemas/chats).
// Lead novo vai para todas; quem assume (ou responde) fica com ele; finalizar devolve para todas.
// Também confere as pastas separadas por conexão e o envio que falha de vez sem travar o request_id.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');
const CHAVE = crypto.randomBytes(32).toString('hex'), BASE = '/api/public/dmk-connector/v1';
const ROTEAMENTO = { 'X-DMK-Features': 'actions,routing' };

async function subir(dataDir) {
  const app = criarServidor({ dataDir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true, log: { error() {} } });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + app.servidor.address().port;
  const pedir = async (metodo, caminho, corpo, token, extra = {}) => {
    const r = await fetch(url + caminho, { method: metodo, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: corpo ? JSON.stringify(corpo) : undefined });
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { app, dataDir, pedir, admin: (m, c, b) => pedir(m, '/admin/v1' + c, b, CHAVE), pub: (m, c, b, t, x = ROTEAMENTO) => pedir(m, BASE + c, b, t, x) };
}
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-at-'));
const rid = () => 'req_' + crypto.randomBytes(12).toString('hex');
async function sessao(s, telefone = '5581911110000') {
  const criada = (await s.admin('POST', '/sessoes', { nome: 'Atendimento', dono: 'gestao' })).corpo;
  await s.admin('POST', `/sessoes/${criada.id}/conectar`);
  await s.admin('POST', `/sessoes/${criada.id}/simular-leitura-qr`, { telefone });
  return criada.id;
}
async function conexao(s, id, nome, tipo) {
  const aut = (await s.admin('POST', `/sessoes/${id}/autorizacoes`, { nome, sistema: nome.toLowerCase(), confirmado: true, tipo })).corpo;
  const troca = await s.pub('POST', '/exchange', { code: aut.code, protocol: 2 });
  assert.equal(troca.status, 200);
  return { id: aut.id, token: troca.corpo.token };
}
// Busca os eventos e confirma (como um sistema faz), devolvendo [tipo, texto/peer].
async function eventos(s, c) {
  const r = (await s.pub('GET', '/events', null, c.token)).corpo;
  if (r.events.length) assert.equal((await s.pub('POST', '/ack', { ids: r.events.map((e) => e.id) }, c.token)).status, 200);
  return r.events.map((e) => [e.type, e.type === 'message' ? e.data.text : e.type === 'delivery' ? e.data.status : e.data.mine ?? e.data.peer]);
}
const msg = (s, id, de, texto, extra = {}) => s.admin('POST', `/sessoes/${id}/simular-mensagem`, { de, nome: 'Cliente', texto, id: 'M' + crypto.randomBytes(6).toString('hex').toUpperCase(), ...extra });

test('lead vai para todas as conexões; quem responde assume e as outras deixam de ver', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const id = await sessao(s), loja = await conexao(s, id, 'Loja'), oficina = await conexao(s, id, 'Oficina');
  await eventos(s, loja); await eventos(s, oficina); // declara X-DMK-Features: routing
  await msg(s, id, '5581999990001', 'quero um orçamento');
  assert.deepEqual(await eventos(s, loja), [['message', 'quero um orçamento']]);
  assert.deepEqual(await eventos(s, oficina), [['message', 'quero um orçamento']]);

  // A loja responde: assume o lead. A oficina recebe o aviso para tirar da tela.
  assert.equal((await s.pub('POST', '/send', { to: '5581999990001', text: 'Olá! Sou da loja.', request_id: rid() }, loja.token)).status, 200);
  assert.deepEqual(await eventos(s, oficina), [['assigned', false]]);
  assert.deepEqual((await eventos(s, loja)).filter(([t]) => t !== 'message'), [['assigned', true]]);

  // Próxima mensagem do cliente: só a loja recebe.
  await msg(s, id, '5581999990001', 'pode ser amanhã?');
  assert.deepEqual(await eventos(s, loja), [['message', 'pode ser amanhã?']]);
  assert.deepEqual(await eventos(s, oficina), []);

  // A oficina não consegue responder nem agir nessa conversa.
  const tentativa = await s.pub('POST', '/send', { to: '5581999990001', text: 'oi', request_id: rid() }, oficina.token);
  assert.equal(tentativa.status, 409); assert.match(tentativa.corpo.error, /em atendimento por "Loja"/);
  assert.equal((await s.pub('POST', '/presence', { to: '5581999990001', state: 'composing' }, oficina.token)).status, 409);
  assert.equal((await s.pub('POST', '/release', { to: '5581999990001' }, oficina.token)).status, 409, 'só quem atende finaliza');

  // Lista de conversas: a oficina não vê a conversa da loja nem o histórico dela.
  assert.deepEqual((await s.pub('GET', '/conversations', null, oficina.token)).corpo.conversations, []);
  assert.equal((await s.pub('GET', '/messages?to=5581999990001', null, oficina.token)).status, 409);
  const daLoja = (await s.pub('GET', '/conversations', null, loja.token)).corpo.conversations;
  assert.deepEqual(daLoja.map((c) => [c.phone, c.state, c.mine]), [['5581999990001', 'EM_ATENDIMENTO', true]]);
  const historico = (await s.pub('GET', '/messages?to=5581999990001', null, loja.token)).corpo.messages;
  assert.deepEqual(historico.map((m) => [m.de, m.texto]), [['cliente', 'quero um orçamento'], ['sistema', 'Olá! Sou da loja.'], ['cliente', 'pode ser amanhã?']]);

  // Finalizar devolve a conversa para todas: a próxima mensagem é lead de novo.
  assert.equal((await s.pub('POST', '/release', { to: '5581999990001' }, loja.token)).corpo.state, 'FINALIZADO');
  assert.deepEqual(await eventos(s, oficina), [['released', '5581999990001@s.whatsapp.net']]);
  await eventos(s, loja);
  await msg(s, id, '5581999990001', 'voltei');
  assert.deepEqual(await eventos(s, loja), [['message', 'voltei']]);
  assert.deepEqual(await eventos(s, oficina), [['message', 'voltei']]);
  // A oficina assume pelo botão (claim) e o histórico novo vai para a pasta dela; o antigo da loja não aparece.
  assert.equal((await s.pub('POST', '/claim', { to: '5581999990001' }, oficina.token)).corpo.mine, true);
  const daOficina = (await s.pub('GET', '/messages?to=5581999990001', null, oficina.token)).corpo.messages;
  assert.deepEqual(daOficina.map((m) => m.texto), ['voltei']);
});

test('pastas separadas por conexão, anexos, painel (liberar/transferir) e revogação', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const id = await sessao(s), a = await conexao(s, id, 'Alfa'), b = await conexao(s, id, 'Beta');
  await eventos(s, a); await eventos(s, b);
  await s.app.sessoes.motor.receber(id, { de: '5581999990002', nome: 'Maria', texto: 'segue a foto', id: 'FOTO0001', midia: { buffer: Buffer.from('jpeg-falso'), mimetype: 'image/jpeg', filename: 'foto.jpg' } });
  const raiz = path.join(s.dataDir, 'sessoes', 'sessao-' + id, 'atendimento');
  assert.ok(fs.existsSync(path.join(raiz, 'LEIA-ME.txt')));
  assert.ok(fs.existsSync(path.join(raiz, 'geral', 'conversas', '5581999990002.jsonl')), 'lead fica na pasta geral');
  await s.pub('POST', '/claim', { to: '5581999990002' }, a.token);
  await eventos(s, a); await eventos(s, b);
  assert.ok(!fs.existsSync(path.join(raiz, 'geral', 'conversas', '5581999990002.jsonl')), 'ao assumir, o histórico sai da pasta geral');
  const [foto] = (await s.pub('GET', '/messages?to=5581999990002', null, a.token)).corpo.messages;
  assert.match(foto.arquivo.caminho, new RegExp('^conexoes/' + a.id + '/arquivos/\\d{4}-\\d{2}/'));
  assert.equal(String((await s.pub('GET', '/file?path=' + encodeURIComponent(foto.arquivo.caminho), null, a.token)).corpo), 'jpeg-falso');
  assert.equal((await s.pub('GET', '/file?path=' + encodeURIComponent(foto.arquivo.caminho), null, b.token)).status, 404, 'Beta não lê o anexo da Alfa');
  assert.equal((await s.pub('GET', '/file?path=' + encodeURIComponent('../../conector.json'), null, a.token)).status, 404);

  // Painel: lista com dono, transferir para Beta, liberar.
  const lista = (await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo;
  assert.equal(lista.modo, 'leads'); assert.deepEqual(lista.conversas.map((c) => [c.name, c.owner.label]), [['Maria', 'Alfa']]);
  assert.equal((await s.admin('POST', `/sessoes/${id}/atendimentos/transferir`, { peer: '5581999990002', para: b.id })).corpo.owner.label, 'Beta');
  assert.deepEqual((await eventos(s, a)).filter(([t]) => t !== 'message'), [['released', '5581999990002@s.whatsapp.net'], ['assigned', false]]);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990002', text: 'oi', request_id: rid() }, a.token)).status, 409);
  // Revogar a Beta devolve a conversa para todos.
  await s.admin('POST', `/sessoes/${id}/autorizacoes/${b.id}/revogar`);
  assert.equal((await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo.conversas[0].owner, null);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990002', text: 'oi de novo', request_id: rid() }, a.token)).status, 200);
  // Resumo da sessão traz os números do atendimento.
  assert.deepEqual((await s.admin('GET', `/sessoes/${id}`)).corpo.atendimentos, { total: 1, em_atendimento: 1, leads: 0 });
});

test('modo "todos": todas as conexões recebem tudo e ninguém vira dono', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const id = await sessao(s), a = await conexao(s, id, 'Alfa'), b = await conexao(s, id, 'Beta');
  assert.equal((await s.admin('POST', `/sessoes/${id}/distribuicao`, { modo: 'todos' })).corpo.distribuicao, 'todos');
  assert.equal((await s.admin('POST', `/sessoes/${id}/distribuicao`, { modo: 'x' })).status, 400);
  await msg(s, id, '5581999990003', 'oi');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990003', text: 'resposta A', request_id: rid() }, a.token)).status, 200);
  await msg(s, id, '5581999990003', 'e aí?');
  assert.deepEqual((await eventos(s, b)).map(([, x]) => x), ['oi', 'resposta A', 'e aí?'], 'no modo todos a resposta de uma conexão também aparece nas outras');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990003', text: 'resposta B', request_id: rid() }, b.token)).status, 200);
  assert.equal((await s.pub('POST', '/claim', { to: '5581999990003' }, b.token)).status, 409);
});

test('envio que falha de vez libera o request_id (não trava a fila do sistema)', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const id = await sessao(s), a = await conexao(s, id, 'Alfa');
  s.app.sessoes.motor.semWhatsapp.add('5581999990009');
  const pedido = { to: '5581999990009', text: 'oi', request_id: rid() };
  const r1 = await s.pub('POST', '/send', pedido, a.token);
  assert.equal(r1.status, 400); assert.match(r1.corpo.error, /não tem WhatsApp/); assert.equal(r1.corpo.delivery_uncertain, undefined);
  s.app.sessoes.motor.semWhatsapp.clear();
  assert.equal((await s.pub('POST', '/send', pedido, a.token)).status, 200, 'o mesmo request_id pode ser tentado de novo');
});

test('conteúdo de reenvio sobrevive a reinício (7 dias) e só serve mensagens enviadas', () => {
  const dir = pasta(), criarReenvio = require('../lib/reenvio');
  let agora = Date.parse('2026-11-19T12:00:00Z');
  const r = criarReenvio(dir, { now: () => agora });
  r.guardar({ id: 'ABC123', remoteJid: '5581999990001@s.whatsapp.net', fromMe: true }, Uint8Array.from([1, 2, 3]));
  const depois = criarReenvio(dir, { now: () => agora });
  assert.deepEqual([...depois.buscar({ id: 'ABC123', fromMe: true })], [1, 2, 3]);
  assert.equal(depois.buscar({ id: 'ABC123', fromMe: false }), undefined);
  agora += 9 * 86400000;
  assert.equal(criarReenvio(dir, { now: () => agora }).buscar({ id: 'ABC123' }), undefined, 'some depois de 7 dias');
});

test('conexão de avisos (cobrança, alertas) envia sem assumir e sem ser barrada', async (t) => {
  const s = await subir(pasta()); t.after(() => s.app.encerrar());
  const id = await sessao(s), loja = await conexao(s, id, 'Loja'), avisos = await conexao(s, id, 'SmartCore', 'avisos');
  await msg(s, id, '5581999990005', 'lead que avisos não deve receber');
  assert.deepEqual((await eventos(s, avisos)).filter(([t]) => t === 'message'), [], 'conexão de avisos não recebe leads');
  assert.deepEqual((await eventos(s, loja)).map(([, x]) => x), ['lead que avisos não deve receber']);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990004', text: 'Sua fatura vence amanhã', request_id: rid() }, avisos.token)).status, 200);
  assert.equal((await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo.conversas[0].owner, null, 'aviso não assume');
  await msg(s, id, '5581999990004', 'já paguei');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990004', text: 'Obrigado!', request_id: rid() }, loja.token)).status, 200, 'a loja assume ao responder');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990004', text: 'Pagamento confirmado', request_id: rid() }, avisos.token)).status, 200, 'aviso passa mesmo com dono');
  const autorizacoes = (await s.admin('GET', `/sessoes/${id}/autorizacoes`)).corpo.autorizacoes;
  assert.deepEqual(autorizacoes.map((a) => a.tipo).sort(), ['atendimento', 'avisos']);
  assert.equal((await s.admin('POST', `/sessoes/${id}/autorizacoes/${avisos.id}/tipo`, { tipo: 'atendimento' })).corpo.tipo, 'atendimento');
  assert.equal((await s.pub('POST', '/send', { to: '5581999990004', text: 'oi', request_id: rid() }, avisos.token)).status, 409, 'virou atendimento: agora respeita o dono');
  const daLoja = (await s.pub('GET', '/messages?to=5581999990004', null, loja.token)).corpo.messages.map((m) => m.texto);
  assert.deepEqual(daLoja, ['Sua fatura vence amanhã', 'já paguei', 'Obrigado!', 'Pagamento confirmado']);
});

test('sistema que só envia (1.3.6): ligado como atendimento mas nunca buscou mensagens não prende a conversa', async (t) => {
  const dir = pasta(), s = await subir(dir); t.after(() => s.app.encerrar());
  const id = await sessao(s), loja = await conexao(s, id, 'Loja'), iot = await conexao(s, id, 'SmartCore'); // sem marcar "avisos"
  await eventos(s, loja); // a loja busca mensagens; o SmartCore nunca
  const estado = s.app.sessoes; // envelhece a ligação do SmartCore: ligado há mais de 2 minutos
  const grants = () => JSON.parse(fs.readFileSync(path.join(dir, 'conector.json'), 'utf8')).sessoes[0].store.dmk_connectors;
  estado.gravarAgora();
  assert.ok(grants().find((g) => g.id === loja.id).last_events_at, 'a busca de mensagens fica registrada');
  assert.ok(grants().find((g) => g.id === iot.id).paired_at, 'a data da ligação fica registrada');
  // Recém-ligado ainda conta como atendimento (um sistema novo consulta em segundos): assume ao enviar.
  assert.equal((await s.pub('POST', '/send', { to: '5581999990010', text: 'Teste do conector', request_id: rid() }, iot.token)).status, 200);
  assert.equal((await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo.conversas.find((c) => c.phone === '5581999990010').owner.id, iot.id);
  // Passados 2 minutos sem nunca buscar, é "só envia": a conversa presa volta para todos na próxima mensagem.
  estado.sessaoDaCredencial(iot.token).sessao.store.dmk_connectors.find((g) => g.id === iot.id).paired_at = Date.now() - 5 * 60000;
  await msg(s, id, '5581999990010', 'recebi o teste, obrigado');
  assert.deepEqual((await eventos(s, loja)).filter(([tp]) => tp === 'message').map(([, x]) => x), ['recebi o teste, obrigado'], 'a resposta do cliente chega a quem atende');
  assert.equal((await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo.conversas.find((c) => c.phone === '5581999990010').owner, null, 'conversa presa foi liberada');
  // E os próximos envios dele não assumem nem são barrados.
  assert.equal((await s.pub('POST', '/send', { to: '5581999990010', text: 'Obrigado!', request_id: rid() }, loja.token)).status, 200);
  assert.equal((await s.pub('POST', '/send', { to: '5581999990010', text: 'Alerta: caixa cheia', request_id: rid() }, iot.token)).status, 200, 'aviso passa mesmo com dono');
  assert.equal((await s.admin('GET', `/sessoes/${id}/atendimentos`)).corpo.conversas.find((c) => c.phone === '5581999990010').owner.id, loja.id);
  const teste = (await s.admin('POST', `/sessoes/${id}/teste`, {})).corpo.checks;
  assert.match(teste.find((c) => c.nome === 'Sistemas que só enviam').detalhe, /SmartCore/);
  assert.equal(teste.find((c) => c.nome === 'Sistemas consultando').ok, true, 'quem só envia não é acusado de parado');
});

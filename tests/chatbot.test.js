'use strict';
// Chatbot do conector: motor de regras (puro) e atendimento de ponta a ponta com o motor simulado.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');
const bot = require('../lib/chatbot');
const CHAVE = crypto.randomBytes(32).toString('hex'), BASE = '/api/public/dmk-connector/v1';

// ---------- motor de regras ----------
test('condições: número, sim/não, palavras, contém e formatos', () => {
  const c = (quando, texto, extra = {}) => bot.combina(quando, { texto, ...extra });
  assert.ok(c({ tipo: 'numero', valor: '2' }, ' 2 '));
  assert.ok(!c({ tipo: 'numero', valor: '2' }, '20'));
  assert.ok(c({ tipo: 'sim' }, 'Sim, pode ser'));
  assert.ok(c({ tipo: 'sim' }, 'CLARO'));
  assert.ok(c({ tipo: 'nao' }, 'Não'), 'acento não atrapalha');
  assert.ok(!c({ tipo: 'nao' }, 'nao sei o que é isso') === false);
  assert.ok(c({ tipo: 'palavras', valores: ['boleto', '2 via'] }, 'queria a 2 VIA do boleto'));
  assert.ok(!c({ tipo: 'palavras', valores: ['boleto'] }, 'quero suporte'));
  assert.ok(c({ tipo: 'contem', valor: 'internet' }, 'minha Internet caiu'));
  assert.ok(c({ tipo: 'email' }, ' danilo@dmk.com.br '));
  assert.ok(!c({ tipo: 'email' }, 'danilo arroba dmk'));
  assert.ok(c({ tipo: 'telefone' }, '(87) 99179-7853'));
  assert.ok(c({ tipo: 'anexo' }, '', { anexo: true }));
  assert.ok(c({ tipo: 'qualquer' }, 'qualquer coisa'));
  assert.ok(!c({ tipo: 'inventado' }, 'x'));
});

test('variáveis no texto são trocadas pelo que o fluxo guardou', () => {
  assert.equal(bot.preencher('Olá {{nome}}, confirma o {{ telefone }}?', { nome: 'Marta', telefone: '87999' }), 'Olá Marta, confirma o 87999?');
  assert.equal(bot.preencher('Oi {{nao_existe}}!', {}), 'Oi !');
});

test('conferência do fluxo: recusa o que está errado e explica onde', () => {
  const l = bot.limparFluxoDe;
  assert.throws(() => l({ nos: {} }), /vazio/);
  assert.throws(() => l({ nos: { a: { tipo: 'voar', texto: 'x' } } }), /tipo deve ser/);
  assert.throws(() => l({ nos: { a: { tipo: 'mensagem', texto: 'oi', proximo: 'b' } } }), /"b", que não existe/);
  assert.throws(() => l({ nos: { a: { tipo: 'pergunta', texto: 'oi' } } }), /precisa de regras ou de opções/);
  assert.throws(() => l({ nos: { a: { tipo: 'pergunta', texto: 'oi', regras: [{ quando: { tipo: 'palavras' }, ir: 'a' }] } } }), /precisa da lista de palavras/);
  assert.throws(() => l({ nos: { a: { tipo: 'mensagem', texto: 'oi', digitando: 99999 } } }), /entre 0 e 15000/);
  assert.throws(() => l({ nos: { a: { tipo: 'acao', url: 'http://inseguro.test' } } }), /endereço https/);
  assert.throws(() => l({ inicio: 'x', nos: { a: { tipo: 'encerrar', texto: 'tchau' } } }), /nó inicial "x" não existe/);
  const ok = l({ nome: 'Teste', nos: { a: { tipo: 'encerrar', texto: 'tchau' } } });
  assert.equal(ok.inicio, 'a');
  assert.equal(ok.config.maximo_erros, 2, 'padrões preenchidos');
  // Os modelos prontos passam pela mesma conferência.
  for (const [nome, modelo] of Object.entries(bot.MODELOS || {})) assert.ok(l(modelo), nome);
});

// ---------- ponta a ponta ----------
async function subir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-bot-'));
  const app = criarServidor({ dataDir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true, log: { error() {}, log() {} } });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + app.servidor.address().port;
  const pedir = async (metodo, caminho, corpo, token, recursos = 'actions,routing,bot') => {
    const r = await fetch(url + caminho, { method: metodo, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), 'X-DMK-Features': recursos }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
  };
  const admin = (m, c, b) => pedir(m, '/admin/v1' + c, b, CHAVE);
  const criada = (await admin('POST', '/sessoes', { nome: 'Bot', dono: 'dmk' })).corpo;
  await admin('POST', `/sessoes/${criada.id}/conectar`);
  await admin('POST', `/sessoes/${criada.id}/simular-leitura-qr`, { telefone: '5587911110000' });
  const conectar = async (nome) => {
    const aut = (await admin('POST', `/sessoes/${criada.id}/autorizacoes`, { nome, sistema: nome.toLowerCase(), confirmado: true })).corpo;
    const t = (await pedir('POST', BASE + '/exchange', { code: aut.code, protocol: 2 })).corpo.token;
    return { id: aut.id, token: t };
  };
  return { app, id: criada.id, admin, pub: (m, c, b, t, r) => pedir(m, BASE + c, b, t, r), conectar,
    enviados: () => app.sessoes.motor.enviados, acoes: () => app.sessoes.motor.acoes,
    // O chatbot responde depois da mensagem seguir para os sistemas (e com as pausas de "digitando"),
    // então o teste espera um instante antes de conferir o que saiu.
    cliente: async (texto, de = '5581999990001', extra = {}, espera = 200) => {
      await app.sessoes.motor.receber(criada.id, { de, nome: 'Marta', texto, id: 'M' + crypto.randomBytes(5).toString('hex'), ...extra });
      await new Promise((r) => setTimeout(r, espera));
    } };
}
const textos = (s) => s.enviados().map((m) => m.text);

const FLUXO = {
  nome: 'Atendimento DMK', inicio: 'menu',
  config: { inativo_min: 30, maximo_erros: 1, palavra_atendente: ['atendente'], texto_transferencia: 'Chamando um atendente.' },
  nos: {
    menu: { tipo: 'pergunta', texto: 'Olá {{nome}}! 1 - Suporte  2 - Financeiro', lido: true, digitando: 5, estilo: 'botoes',
      opcoes: [{ rotulo: 'Suporte', ir: 'suporte' }, { rotulo: 'Financeiro', ir: 'fin' }], senao: 'nao_entendi' },
    suporte: { tipo: 'pergunta', texto: 'Qual o problema?', guardar: 'problema', regras: [{ quando: { tipo: 'qualquer' }, ir: 'humano' }] },
    fin: { tipo: 'mensagem', texto: 'Setor financeiro, um instante.', proximo: 'fim' },
    nao_entendi: { tipo: 'mensagem', texto: 'Não entendi.', proximo: 'menu' },
    humano: { tipo: 'transferir', texto: 'Anotei: {{problema}}. Chamando um atendente.' },
    fim: { tipo: 'encerrar', texto: 'Obrigado!' },
  },
};

test('o chatbot atende, segue o fluxograma, guarda a resposta e transfere para o humano', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  assert.equal((await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: true, atende_novos: true }, loja.token)).status, 200);

  await s.cliente('oi');
  assert.deepEqual(textos(s), ['Olá Marta! 1 - Suporte  2 - Financeiro'], 'responde o primeiro contato');
  assert.ok(s.acoes().some((a) => a.tipo === 'read'), 'marcou como lida');
  assert.ok(s.acoes().some((a) => a.tipo === 'presence' && a.state === 'composing'), 'mostrou "digitando"');
  assert.equal(s.enviados()[0].opcoes.interactive.style, 'botoes', 'enviou com botões');

  await s.cliente('1');
  assert.equal(textos(s).at(-1), 'Qual o problema?', 'o número da opção leva ao nó certo');
  await s.cliente('minha internet caiu');
  assert.equal(textos(s).at(-1), 'Anotei: minha internet caiu. Chamando um atendente.', 'guardou a resposta e transferiu');
  assert.deepEqual((await s.pub('GET', '/bot/estados', null, loja.token)).corpo.states, [], 'saiu do fluxo ao transferir');

  // A conversa do chatbot entrou no histórico do atendimento.
  const h = (await s.pub('GET', '/messages?to=5581999990001', null, loja.token)).corpo.messages.map((m) => [m.de, m.texto]);
  assert.deepEqual(h.filter((x) => x[0] === 'cliente').map((x) => x[1]), ['oi', '1', 'minha internet caiu']);
  assert.equal(h.filter((x) => x[0] === 'sistema').length, 3);
});

test('não entendeu: usa o "senão" e, passando do limite de erros, chama o atendente', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi');
  await s.cliente('blablabla');
  assert.deepEqual(textos(s).slice(-2), ['Não entendi.', 'Olá Marta! 1 - Suporte  2 - Financeiro'], 'avisa e repete o menu');
  await s.cliente('mais blablabla');
  assert.equal(textos(s).at(-1), 'Chamando um atendente.', 'passou do limite de erros');
});

test('atendente assume ou responde pelo celular: o chatbot para naquela conversa', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja'), oficina = await s.conectar('Oficina');
  await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi');
  assert.equal((await s.pub('GET', '/bot/estados', null, loja.token)).corpo.states.length, 1);
  // Um atendente assume pelo sistema.
  await s.pub('POST', '/claim', { to: '5581999990001' }, oficina.token);
  assert.deepEqual((await s.pub('GET', '/bot/estados', null, loja.token)).corpo.states, []);
  const antes = textos(s).length;
  await s.cliente('e aí?');
  assert.equal(textos(s).length, antes, 'o chatbot não responde mais nessa conversa');
  // Em outra conversa, resposta pelo próprio celular do número também para o fluxo.
  await s.cliente('oi', '5581999990002');
  assert.equal((await s.pub('GET', '/bot/estados', null, loja.token)).corpo.states.length, 1);
  await s.cliente('já te respondo', '5581999990002', { minha: true });
  assert.deepEqual((await s.pub('GET', '/bot/estados', null, loja.token)).corpo.states, []);
});

test('desligado, sem fluxo ou sem "atende novos": ninguém é atendido pelo robô', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.cliente('oi');
  assert.deepEqual(textos(s), [], 'sem fluxo não responde');
  assert.match((await s.pub('POST', '/bot/ativar', { ativo: true }, loja.token)).corpo.error, /Grave um fluxo antes/);
  await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: false, atende_novos: true }, loja.token);
  await s.cliente('oi', '5581999990003');
  assert.deepEqual(textos(s), [], 'fluxo gravado mas desligado');
  await s.pub('POST', '/bot/ativar', { ativo: true }, loja.token);
  await s.cliente('oi', '5581999990004');
  assert.equal(textos(s).length, 1, 'ligado pelo sistema, passa a atender');
});

test('painel: copiar modelo, ligar, ver quem está em cada etapa e só uma conexão atende os novos', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja'), oficina = await s.conectar('Oficina');
  assert.deepEqual((await s.admin('GET', `/sessoes/${s.id}/chatbot`)).corpo.modelos, ['departamentos', 'fora_do_horario']);
  const r = await s.admin('POST', `/sessoes/${s.id}/autorizacoes/${loja.id}/bot`, { modelo: 'departamentos', ativo: true, atende_novos: true });
  assert.equal(r.status, 200); assert.equal(r.corpo.fluxo.nome, 'Menu por departamento');
  // A segunda conexão passa a atender os novos: a primeira é desmarcada sozinha.
  await s.admin('POST', `/sessoes/${s.id}/autorizacoes/${oficina.id}/bot`, { modelo: 'fora_do_horario', ativo: true, atende_novos: true });
  const lista = (await s.admin('GET', `/sessoes/${s.id}/chatbot`)).corpo.conexoes;
  assert.deepEqual(lista.map((c) => [c.label, c.ativo, c.atende_novos]), [['Loja', true, false], ['Oficina', true, true]]);
  await s.cliente('oi', '5581999990001', {}, 1500); // o modelo pronto mostra "digitando…" por 1 segundo
  assert.match(textos(s).at(-1), /fora do horário/);
  const estados = (await s.admin('GET', `/sessoes/${s.id}/chatbot/estados`)).corpo.states;
  assert.equal(estados.length, 1); assert.equal(estados[0].node, 'aviso'); assert.equal(estados[0].conexao, oficina.id);
  assert.equal((await s.admin('POST', `/sessoes/${s.id}/autorizacoes/${loja.id}/bot`, { modelo: 'nao_existe' })).status, 404);
});

test('nó de ação: consulta o sistema da empresa e segue pela resposta dele', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  // Um servidor local faz o papel do sistema da empresa.
  const http = require('node:http');
  let recebido = null;
  const alvo = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (d) => (corpo += d));
    req.on('end', () => { recebido = JSON.parse(corpo); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ texto: 'Sua fatura vence dia 10.', ir: 'fim', dados: { vencimento: '10' } })); });
  });
  await new Promise((ok) => alvo.listen(0, '127.0.0.1', ok));
  t.after(() => alvo.close());
  const url = 'https://127.0.0.1:' + alvo.address().port + '/bot';
  const fluxo = { inicio: 'consulta', nos: {
    consulta: { tipo: 'acao', url, espera_seg: 5, proximo: 'fim', ir_erro: 'erro' },
    fim: { tipo: 'encerrar', texto: 'Posso ajudar em mais algo?' },
    erro: { tipo: 'transferir', texto: 'Não consegui consultar agora, vou chamar um atendente.' },
  } };
  await s.pub('PUT', '/bot', { fluxo, ativo: true, atende_novos: true }, loja.token);
  // O conector chama por https; aqui o servidor de teste é http, então a chamada falha e o fluxo usa "ir_erro".
  await s.cliente('minha fatura');
  assert.equal(textos(s).at(-1), 'Não consegui consultar agora, vou chamar um atendente.', 'falha na ação cai no caminho de erro');
  assert.equal(recebido, null);
});

// ---------- 1.3.15: o robô não responde de novo a cada "oi" ----------
const comEspera = (extra) => ({ ...FLUXO, config: { ...FLUXO.config, ...extra } });

test('mesmo "oi" repetido não faz o robô mandar o menu de novo (anti-repetição)', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.pub('PUT', '/bot', { fluxo: comEspera({ antiflood_seg: 30 }), ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi'); await s.cliente('oi'); await s.cliente('oi');
  assert.deepEqual(textos(s), ['Olá Marta! 1 - Suporte  2 - Financeiro'], 'o menu saiu uma vez só');
  // Com o anti-repetição desligado, volta a repetir (é opção de quem monta o fluxo).
  const outra = await subir(); t.after(() => outra.app.encerrar());
  const l2 = await outra.conectar('Loja');
  await outra.pub('PUT', '/bot', { fluxo: comEspera({ antiflood_seg: 0 }), ativo: true, atende_novos: true }, l2.token);
  await outra.cliente('oi'); await outra.cliente('oi');
  assert.deepEqual(textos(outra), ['Olá Marta! 1 - Suporte  2 - Financeiro', 'Não entendi.', 'Olá Marta! 1 - Suporte  2 - Financeiro'],
    'sem anti-repetição o segundo "oi" vira resposta errada e o menu volta');
});

test('depois de encerrar, o contato fica em carência e o robô só volta quando o tempo vence', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.pub('PUT', '/bot', { fluxo: comEspera({ repetir_apos_min: 60 }), ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi'); await s.cliente('2'); // 2 = financeiro -> mensagem -> encerrar
  assert.deepEqual(textos(s).slice(-2), ['Setor financeiro, um instante.', 'Obrigado!']);
  const estado = (todas) => s.pub('GET', '/bot/estados' + (todas ? '?todas=1' : ''), null, loja.token);
  assert.deepEqual((await estado()).corpo.states, [], 'saiu do fluxograma');
  assert.equal((await estado(true)).corpo.states[0].phase, 'fim', 'mas o conector lembra que já atendeu');
  const antes = textos(s).length;
  await s.cliente('oi de novo');
  assert.equal(textos(s).length, antes, 'dentro da carência o robô fica calado');
  // Com a carência zerada, o mesmo contato é atendido de novo.
  await s.pub('PUT', '/bot', { fluxo: comEspera({ repetir_apos_min: 0 }), ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi');
  assert.equal(textos(s).at(-1), 'Olá Marta! 1 - Suporte  2 - Financeiro', 'passado o tempo, atende de novo');
});

test('esperando atendente: o robô não manda mais nada naquela conversa', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.pub('PUT', '/bot', { fluxo: comEspera({ aguardando_min: 120 }), ativo: true, atende_novos: true }, loja.token);
  await s.cliente('oi'); await s.cliente('atendente');
  assert.equal(textos(s).at(-1), 'Chamando um atendente.');
  const antes = textos(s).length;
  await s.cliente('oi?'); await s.cliente('alguém aí?');
  assert.equal(textos(s).length, antes, 'fica calado esperando o atendente');
  const esperando = (await s.pub('GET', '/bot/estados?todas=1', null, loja.token)).corpo.states[0];
  assert.equal(esperando.phase, 'aguardando');
});

test('contato na lista de nunca atender: o robô ignora, e dá para voltar atrás', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja');
  await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: true, atende_novos: true }, loja.token);
  assert.equal((await s.pub('POST', '/bot/ignorar', { to: '5581999990001' }, loja.token)).corpo.ignorado, true);
  await s.cliente('oi');
  assert.deepEqual(textos(s), [], 'contato ignorado não entra no fluxo');
  assert.equal((await s.pub('GET', '/bot/ignorados', null, loja.token)).corpo.ignored.length, 1);
  // Outro contato continua sendo atendido normalmente.
  await s.cliente('oi', '5581999990055');
  assert.equal(textos(s).length, 1);
  // Pelo painel dá para ignorar e para voltar a atender.
  assert.equal((await s.admin('POST', `/sessoes/${s.id}/chatbot/ignorar`, { peer: '5581999990001', ativo: false })).corpo.ignorado, false);
  await s.cliente('oi');
  assert.equal(textos(s).length, 2, 'voltou a ser atendido');
  assert.equal((await s.admin('GET', `/sessoes/${s.id}/chatbot/estados`)).corpo.ignored.length, 0);
});

// 1.3.20: o evento "bot" vai para quem declara "bot", mesmo sem "routing"; quem só declara "routing" não recebe.
test('evento do robô chega a quem declara bot, sem depender de routing', async (t) => {
  const s = await subir(); t.after(() => s.app.encerrar());
  const loja = await s.conectar('Loja'), gestao = await s.conectar('Gestao');
  const tipos = async (c, recursos) => {
    const r = (await s.pub('GET', '/events', null, c.token, recursos)).corpo;
    if (r.events.length) await s.pub('POST', '/ack', { ids: r.events.map((e) => e.id) }, c.token, recursos);
    return r.events.filter((e) => e.type === 'bot').map((e) => e.data.action);
  };
  // Cada sistema declara seus recursos na busca de eventos, como o Prisma faz.
  await tipos(loja, 'actions,bot'); await tipos(gestao, 'actions,routing');
  await s.pub('PUT', '/bot', { fluxo: FLUXO, ativo: true, atende_novos: true }, loja.token, 'actions,bot');
  await s.cliente('oi'); await s.cliente('1'); await s.cliente('minha internet caiu');
  assert.deepEqual(await tipos(loja, 'actions,bot'), ['transferir'], 'quem declarou bot recebe a transferência');
  assert.deepEqual(await tipos(gestao, 'actions,routing'), [], 'quem não declarou bot não recebe');
});

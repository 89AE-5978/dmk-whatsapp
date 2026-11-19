'use strict';
// Atualização pelo painel: exige a chave, informa as versões, orienta quando o gatilho não existe
// e grava dados/atualizar.pedido quando existe. Tudo com GitHub simulado: nada sai para a rede.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');
const CHAVE = crypto.randomBytes(32).toString('hex');
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-at-'));
async function subir(opcoesAtualizacao) {
  const dataDir = pasta();
  const app = criarServidor({ dataDir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true, log: { error() {} }, opcoesAtualizacao });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + app.servidor.address().port;
  const admin = async (m, c, b, semChave) => {
    const r = await fetch(url + '/admin/v1' + c, { method: m, headers: { ...(semChave ? {} : { Authorization: 'Bearer ' + CHAVE }), ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  return { app, admin, dataDir };
}
const remoto = (v) => async () => ({ ok: true, text: async () => v + '\n' });

test('atualização: exige a chave e informa as versões', async () => {
  const s = await subir({ buscar: remoto('9.9.9'), arquivoGatilho: path.join(pasta(), 'nao-existe.path') });
  try {
    assert.equal((await s.admin('GET', '/atualizacao', null, true)).status, 401);
    const e = await s.admin('GET', '/atualizacao');
    assert.equal(e.status, 200); assert.equal(e.corpo.ha_nova, true);
    assert.equal(e.corpo.versao_nova, '9.9.9'); assert.equal(e.corpo.gatilho_pronto, false);
  } finally { await s.app.encerrar(); }
});

test('atualização: sem gatilho orienta; com gatilho grava o pedido', async () => {
  const g = path.join(pasta(), 'dmk-wa-atualizar.path');
  const s = await subir({ buscar: remoto('9.9.9'), arquivoGatilho: g });
  try {
    const nega = await s.admin('POST', '/atualizacao', {});
    assert.equal(nega.status, 409); assert.match(nega.corpo.error, /gatilho/);
    fs.writeFileSync(g, '');
    const ok = await s.admin('POST', '/atualizacao', {});
    assert.equal(ok.status, 202); assert.equal(ok.corpo.para, '9.9.9');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'atualizar.pedido')), 'pedido gravado em dados/');
  } finally { await s.app.encerrar(); }
});

test('atualização: na mais nova recusa; GitHub inacessível vira erro claro', async () => {
  const VERSAO = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
  const g = path.join(pasta(), 'g.path'); fs.writeFileSync(g, '');
  const s = await subir({ buscar: remoto(VERSAO), arquivoGatilho: g });
  try { assert.equal((await s.admin('POST', '/atualizacao', {})).status, 409); } finally { await s.app.encerrar(); }
  const s2 = await subir({ buscar: async () => { throw Error('fora do ar'); }, arquivoGatilho: g });
  try {
    const e = await s2.admin('GET', '/atualizacao');
    assert.equal(e.corpo.ha_nova, false); assert.match(e.corpo.erro, /GitHub/);
    assert.equal((await s2.admin('POST', '/atualizacao', {})).status, 502);
  } finally { await s2.app.encerrar(); }
});

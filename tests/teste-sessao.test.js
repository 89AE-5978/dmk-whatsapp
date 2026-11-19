'use strict';
// Botão Testar do painel: checagens da sessão e envio de teste real (aqui com o motor simulado).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');
const CHAVE = crypto.randomBytes(32).toString('hex');

test('teste da sessão: checagens e envio opcional', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-teste-'));
  const app = criarServidor({ dataDir, chaveAdmin: CHAVE, fabricaMotor: motorSimulado, simulado: true, log: { error() {} } });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + app.servidor.address().port;
  const admin = async (m, c, b) => { const r = await fetch(url + '/admin/v1' + c, { method: m, headers: { Authorization: 'Bearer ' + CHAVE, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, corpo: await r.json() }; };
  try {
    const s = (await admin('POST', '/sessoes', { nome: 'Teste', dono: 'gestao' })).corpo;
    // pausada: envio deve ser recusado com orientação; checagens aparecem sem envio
    const parado = await admin('POST', `/sessoes/${s.id}/teste`, {});
    assert.equal(parado.status, 200);
    assert.equal(parado.corpo.checks.find((c) => c.nome === 'Sessão ativa').ok, false);
    assert.equal((await admin('POST', `/sessoes/${s.id}/teste`, { telefone: '5587999990000' })).status, 409);
    // conecta (simulado lê o QR) e testa com envio
    await admin('POST', `/sessoes/${s.id}/conectar`);
    await admin('POST', `/sessoes/${s.id}/simular-leitura-qr`, { telefone: '5587988887777' });
    const ok = await admin('POST', `/sessoes/${s.id}/teste`, { telefone: '5587999990000' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.envio.ok, true);
    assert.ok(ok.corpo.envio.externalId, 'envio com identificador');
    assert.equal(ok.corpo.checks.find((c) => c.nome === 'Envio').ok, true);
    // telefone inválido é recusado com mensagem clara
    assert.equal((await admin('POST', `/sessoes/${s.id}/teste`, { telefone: '123' })).status, 400);
  } finally { await app.encerrar(); }
});

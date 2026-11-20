'use strict';
// Testes da rota do painel (/, /painel, /painel/*): serve os arquivos certos, nada além deles,
// bloqueia método errado e não deixa escapar da pasta publico/.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { criarServidor } = require('../conector');
const motorSimulado = require('../lib/motor-simulado');

async function subir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-painel-'));
  const app = criarServidor({ dataDir, chaveAdmin: crypto.randomBytes(32).toString('hex'), fabricaMotor: motorSimulado, simulado: true, log: { error() {} } });
  await new Promise((ok) => app.servidor.listen(0, '127.0.0.1', ok));
  return { app, url: 'http://127.0.0.1:' + app.servidor.address().port };
}

test('painel: serve os arquivos certos e nada além deles', async (t) => {
  const { app, url } = await subir(); t.after(() => app.encerrar());
  const raiz = await fetch(url + '/', { redirect: 'manual' }); assert.equal(raiz.status, 302); assert.equal(raiz.headers.get('location'), '/painel/');
  const curto = await fetch(url + '/painel', { redirect: 'manual' }); assert.equal(curto.status, 302); assert.equal(curto.headers.get('location'), '/painel/');
  const html = await fetch(url + '/painel/'); assert.equal(html.status, 200); assert.match(await html.text(), /DMK WhatsApp/); assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  const js = await fetch(url + '/painel/painel.js'); assert.equal(js.status, 200); assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const css = await fetch(url + '/painel/painel.css'); assert.equal(css.status, 200); assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.ok(html.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal((await fetch(url + '/painel/nao-existe.js')).status, 404);
  assert.equal((await fetch(url + '/painel/conector.js')).status, 404, 'só os três arquivos listados são servidos');
  assert.equal((await fetch(url + '/painel/..%2fconector.js')).status, 404, 'não escapa da pasta publico/');
  assert.equal((await fetch(url + '/painel/', { method: 'POST' })).status, 405);
  // 1.3.5: ícone da aba e manifesto (cor da barra / instalar como aplicativo)
  const icone = await fetch(url + '/painel/icone.svg'); assert.equal(icone.status, 200); assert.equal(icone.headers.get('content-type'), 'image/svg+xml');
  const manifesto = await fetch(url + '/painel/app.webmanifest'); assert.equal(manifesto.status, 200); assert.equal((await manifesto.json()).theme_color, '#0b2447');
  const pagina = await (await fetch(url + '/painel/')).text(); assert.match(pagina, /rel="icon" type="image\/svg\+xml" href="\/painel\/icone\.svg"/); assert.match(pagina, /rel="manifest"/); assert.match(pagina, /name="theme-color" content="#0b2447"/);
  const head = await fetch(url + '/painel/painel.js', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.text()).length, 0);
});

test('painel: /health não exige a chave de administrador', async (t) => {
  const { app, url } = await subir(); t.after(() => app.encerrar());
  const r = await fetch(url + '/health'); assert.equal(r.status, 200);
  const j = await r.json(); assert.deepEqual(Object.keys(j).sort(), ['ativas', 'conectadas', 'node', 'ok', 'servico', 'sessoes', 'simulado', 'versao']);
});

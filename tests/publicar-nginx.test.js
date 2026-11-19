'use strict';
// Testa instalar/publicar-nginx.sh numa caixa de areia: nginx, systemctl, certbot e curl de
// mentira, pastas falsas. Nenhum site, serviço ou certificado de verdade é tocado.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const DOMINIO = 'zap.exemplo.test';

function caixa({ codigos = {}, siteExistente = null, contas = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'publicar-'));
  const nginx = path.join(base, 'etc/nginx');
  const bin = path.join(base, 'bin');
  fs.mkdirSync(path.join(nginx, 'sites-available'), { recursive: true });
  fs.mkdirSync(path.join(nginx, 'sites-enabled'), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const letsencrypt = path.join(base, 'etc/letsencrypt');
  fs.mkdirSync(path.join(letsencrypt, 'renewal'), { recursive: true });
  for (const [conta, dominios] of Object.entries(contas)) {
    fs.mkdirSync(path.join(letsencrypt, 'accounts/acme-v02/directory', conta), { recursive: true });
    for (const d of dominios) fs.writeFileSync(path.join(letsencrypt, 'renewal', `${d}.conf`), `account = ${conta}\n`);
  }
  if (siteExistente) fs.writeFileSync(path.join(nginx, 'sites-available/outro'), siteExistente);

  const registro = path.join(base, 'registro.log');
  // curl devolve o codigo que o teste mandar para cada endereco.
  // Codigo 0 = nao respondeu: o curl de mentira sai com erro, como o de verdade faria.
  const regras = Object.entries(codigos)
    .map(([t, c]) => `  *${t}*) printf %s ${c === 0 ? '000; exit 7' : `${c}; exit 0`};;`).join('\n');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
echo "curl $*" >> ${registro}
alvo="\${@: -1}"
case "$alvo" in
${regras}
esac
printf %s 000
exit 0
`);
  fs.writeFileSync(path.join(bin, 'nginx'), `#!/usr/bin/env bash\necho "nginx $*" >> ${registro}\nexit 0\n`);
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/usr/bin/env bash\necho "systemctl $*" >> ${registro}\nexit 0\n`);
  fs.writeFileSync(path.join(bin, 'certbot'), `#!/usr/bin/env bash\necho "certbot $*" >> ${registro}\nexit 0\n`);
  for (const nome of ['curl', 'nginx', 'systemctl', 'certbot']) fs.chmodSync(path.join(bin, nome), 0o755);
  return { base, nginx, bin, registro, letsencrypt };
}

function rodar(c, args = [DOMINIO, 'dono@exemplo.test'], extra = {}) {
  return spawnSync('bash', [path.join(RAIZ, 'instalar/publicar-nginx.sh'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${c.bin}:${process.env.PATH}`,
      DMK_WA_NGINX_DIR: c.nginx, DMK_WA_NGINX: 'nginx', DMK_WA_SYSTEMCTL: 'systemctl', DMK_WA_CERTBOT: 'certbot',
      DMK_WA_SEM_CERTBOT: '1', DMK_WA_LETSENCRYPT_DIR: c.letsencrypt, ...extra,
    },
  });
}

// Respostas de uma publicacao correta. Os dois /health sao casos diferentes: em 127.0.0.1 o
// conector responde 200 (esta no ar); pelo dominio tem de dar 404 (nao pode estar exposto).
const CERTO = {
  '127.0.0.1:8098/health': 200,
  'dmk-connector/v1/events': 401,
  'admin/v1/sessoes': 404,
  [`${DOMINIO}/health`]: 404,
  'painel/': 404,
};

test('publica so o caminho do protocolo e deixa o resto fora', () => {
  const c = caixa({ codigos: CERTO });
  const r = rodar(c);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PRONTO/);

  const conf = fs.readFileSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`), 'utf8');
  assert.match(conf, /location \/api\/public\/dmk-connector\/v1\//, 'faltou publicar o protocolo');
  assert.match(conf, /location \/ \{ return 404; \}/, 'o resto precisa responder 404');
  assert.ok(!/admin/.test(conf), 'a administracao nao pode aparecer na configuracao publica');
  assert.ok(!/\/painel/.test(conf), 'o painel nao pode aparecer na configuracao publica');
  assert.ok(!/\/health/.test(conf), 'a saude nao pode aparecer na configuracao publica');
  assert.ok(fs.existsSync(path.join(c.nginx, `sites-enabled/dmk-wa-${DOMINIO}`)), 'faltou ligar o site');
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('para e desfaz se a administracao ficar alcancavel de fora', () => {
  // 200 em /admin/v1 significa que a administracao vazou: tem de falhar e limpar.
  const c = caixa({ codigos: { ...CERTO, 'admin/v1/sessoes': 200 } });
  const r = rodar(c);
  assert.notStrictEqual(r.status, 0, 'devia ter falhado');
  assert.match(r.stdout, /PERIGO/);
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`)), 'devia ter removido o arquivo que criou');
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-enabled/dmk-wa-${DOMINIO}`)));
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('para e desfaz se o protocolo nao responder pelo dominio', () => {
  const c = caixa({ codigos: { ...CERTO, 'dmk-connector/v1/events': 502 } });
  const r = rodar(c);
  assert.notStrictEqual(r.status, 0, 'devia ter falhado');
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`)));
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('recusa dominio que ja pertence a outro site, sem escrever nada', () => {
  const c = caixa({ codigos: CERTO, siteExistente: `server {\n  server_name ${DOMINIO};\n}\n` });
  const r = rodar(c);
  assert.notStrictEqual(r.status, 0, 'devia ter recusado');
  assert.match(r.stderr + r.stdout, /já é usado por/);
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`)));
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('recusa entrada invalida antes de qualquer alteracao', () => {
  const c = caixa({ codigos: CERTO });
  for (const args of [[], ['https://zap.exemplo.test', 'a@b.cd'], [DOMINIO], [DOMINIO, 'nao-e-email'],
                      ['zap.exemplo.test/caminho', 'a@b.cd']]) {
    const r = rodar(c, args);
    assert.notStrictEqual(r.status, 0, `devia ter recusado: ${JSON.stringify(args)}`);
  }
  assert.strictEqual(fs.readdirSync(path.join(c.nginx, 'sites-available')).length, 0, 'nao podia ter criado nada');
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('para se o conector nao estiver no ar', () => {
  const c = caixa({ codigos: { ...CERTO, '127.0.0.1:8098/health': 0 } });
  const r = rodar(c, [DOMINIO, 'dono@exemplo.test'], { DMK_WA_SEM_REDE: '' });
  assert.notStrictEqual(r.status, 0, 'devia ter parado');
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`)));
  fs.rmSync(c.base, { recursive: true, force: true });
});

// ---- escolha da conta Let's Encrypt ----
// Numa VPS com mais de uma conta registrada, o certbot para e pergunta qual usar. Sem terminal,
// isso trava a publicação. O script resolve sozinho quando os certificados atuais concordam.

test('usa a mesma conta dos certificados que ja existem na maquina', () => {
  const c = caixa({ codigos: CERTO, contas: { bba2cafe: ['iot.exemplo.test', 'sistema.exemplo.test'] } });
  const r = rodar(c, [DOMINIO, 'dono@exemplo.test'], { DMK_WA_SEM_CERTBOT: '' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const log = fs.readFileSync(c.registro, 'utf8');
  assert.match(log, /--account bba2cafe/, 'devia ter passado a conta em uso para o certbot');
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('para e explica quando ha mais de uma conta e os certificados discordam', () => {
  const c = caixa({
    codigos: CERTO,
    contas: { bba2cafe: ['iot.exemplo.test'], ce82beef: ['sistema.exemplo.test'] },
  });
  const r = rodar(c, [DOMINIO, 'dono@exemplo.test'], { DMK_WA_SEM_CERTBOT: '' });
  assert.notStrictEqual(r.status, 0, 'devia ter parado em vez de escolher sozinho');
  assert.match(r.stdout, /mais de uma conta/);
  assert.match(r.stdout, /bba2/);
  assert.match(r.stdout, /ce82/);
  assert.match(r.stdout, /--conta/, 'devia ensinar como escolher');
  assert.ok(!fs.existsSync(path.join(c.nginx, `sites-available/dmk-wa-${DOMINIO}`)), 'devia ter desfeito');
  fs.rmSync(c.base, { recursive: true, force: true });
});

test('aceita a conta informada na linha de comando', () => {
  const c = caixa({
    codigos: CERTO,
    contas: { bba2cafe: ['iot.exemplo.test'], ce82beef: ['sistema.exemplo.test'] },
  });
  const r = rodar(c, [DOMINIO, 'dono@exemplo.test', '--conta', 'ce82beef'], { DMK_WA_SEM_CERTBOT: '' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(c.registro, 'utf8'), /--account ce82beef/);
  fs.rmSync(c.base, { recursive: true, force: true });
});

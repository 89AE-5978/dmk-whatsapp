'use strict';
// Teste do atualizador de ponta a ponta, sem rede: um "GitHub" local (repositório Git numa pasta), uma
// instalação clonada dele e um systemctl de mentira que liga e desliga o conector de verdade no modo simulado.
// Confere: sem versão nova não toca em nada; versão nova entra com um backup só; versão quebrada volta sozinha.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync, spawnSync } = require('node:child_process');
const RAIZ = path.resolve(__dirname, '..');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=teste@exemplo.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim();

test('atualizador: nada a fazer, atualização boa e volta automática da ruim', { timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dmk-wa-atu-')), origem = path.join(base, 'origem'), inst = path.join(base, 'instalacao'), porta = String(20000 + Math.floor(Math.random() * 20000));
  fs.mkdirSync(origem);
  for (const nome of ['VERSION', 'NODE_VERSION', 'package.json', 'conector.js', '.gitignore', 'lib', 'instalar', 'ferramentas']) fs.cpSync(path.join(RAIZ, nome), path.join(origem, nome), { recursive: true });
  git(origem, 'init', '-q', '-b', 'main'); git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'versao inicial');
  git(base, 'clone', '-q', origem, inst);
  fs.mkdirSync(path.join(inst, 'dados'), { mode: 0o700 }); fs.writeFileSync(path.join(inst, 'dados/admin.key'), 'a'.repeat(64), { mode: 0o600 });
  // systemctl de mentira: "restart" derruba o conector que estiver rodando e sobe o da pasta, simulado.
  const falso = path.join(base, 'systemctl'), pid = path.join(base, 'conector.pid');
  fs.writeFileSync(falso, `#!/usr/bin/env bash\nif [[ "$1" == "restart" ]]; then\n  [[ -f "${pid}" ]] && kill "$(cat "${pid}")" 2>/dev/null; sleep 0.3\n  DMK_WA_SIMULADO=1 DMK_WA_PORTA=${porta} DMK_WA_DADOS="${inst}/dados" nohup "${process.execPath}" "${inst}/conector.js" >> "${base}/servico.log" 2>&1 &\n  echo $! > "${pid}"\nfi\nexit 0\n`, { mode: 0o755 });
  t.after(() => { try { process.kill(Number(fs.readFileSync(pid, 'utf8'))); } catch {} });
  const env = { ...process.env, DMK_WA_SYSTEMCTL: falso, DMK_WA_PORTA: porta, DMK_WA_SEM_REDE: '1', DMK_WA_ESPERA: '5' };
  const atualizar = (...a) => spawnSync('bash', [path.join(inst, 'instalar/atualizar.sh'), ...a], { env, encoding: 'utf8' });
  // Tenta algumas vezes: a conexão guardada com o conector antigo cai quando ele é trocado.
  const versaoNoAr = async () => { for (let i = 0; i < 5; i++) { const v = (await fetch(`http://127.0.0.1:${porta}/health`, { headers: { Connection: 'close' } }).then((r) => r.json()).catch(() => ({}))).versao; if (v) return v; await new Promise((ok) => setTimeout(ok, 200)); } };
  spawnSync(falso, ['restart']); for (let i = 0; i < 50 && !(await versaoNoAr()); i++) await new Promise((ok) => setTimeout(ok, 100));
  const inicial = fs.readFileSync(path.join(RAIZ, 'VERSION'), 'utf8').trim(); assert.equal(await versaoNoAr(), inicial);

  let r = atualizar(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Já está na versão mais nova/); assert.equal(fs.existsSync(path.join(inst, 'backups')), false, 'sem versão nova não cria backup');

  fs.writeFileSync(path.join(origem, 'VERSION'), '9.0.0\n'); git(origem, 'commit', '-qam', 'versao 9.0.0');
  r = atualizar('--verificar'); assert.match(r.stdout, new RegExp(`Há versão nova: ${inicial.replace(/\./g, '\\.')} -> 9\\.0\\.0`)); assert.equal(await versaoNoAr(), inicial, '--verificar não altera nada');
  r = atualizar(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ATUALIZADO: DMK WhatsApp 9\.0\.0/); assert.equal(await versaoNoAr(), '9.0.0');
  assert.deepEqual(fs.readdirSync(path.join(inst, 'backups')), ['antes-da-atualizacao.tar.gz']);
  assert.match(execFileSync('tar', ['-tzf', path.join(inst, 'backups/antes-da-atualizacao.tar.gz')], { encoding: 'utf8' }), /dados\/admin\.key/);
  assert.equal(fs.statSync(path.join(inst, 'backups/antes-da-atualizacao.tar.gz')).mode & 0o777, 0o600);

  // Versão quebrada: o conector novo nem sobe. O atualizador tem de voltar para a 9.0.0 sozinho.
  fs.writeFileSync(path.join(origem, 'VERSION'), '9.1.0\n'); fs.appendFileSync(path.join(origem, 'conector.js'), '\nthrow Error("versao quebrada de proposito");\n'); git(origem, 'commit', '-qam', 'versao 9.1.0 quebrada');
  r = atualizar(); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, /FALHOU: a versão 9\.1\.0 não respondeu/); assert.match(r.stdout, /Versão 9\.0\.0 de volta e respondendo/);
  assert.equal(await versaoNoAr(), '9.0.0'); assert.equal(fs.readFileSync(path.join(inst, 'VERSION'), 'utf8').trim(), '9.0.0');
  assert.deepEqual(fs.readdirSync(path.join(inst, 'backups')), ['antes-da-atualizacao.tar.gz'], 'continua um backup só');
  assert.equal(fs.readFileSync(path.join(inst, 'dados/admin.key'), 'utf8'), 'a'.repeat(64), 'a pasta dados não é mexida');

  // Alteração à mão num arquivo do sistema: o atualizador para antes de mexer.
  fs.writeFileSync(path.join(origem, 'VERSION'), '9.2.0\n'); git(origem, 'checkout', '-q', 'HEAD~1', '--', 'conector.js'); git(origem, 'commit', '-qam', 'versao 9.2.0');
  fs.appendFileSync(path.join(inst, 'conector.js'), '\n// mexido a mao\n');
  r = atualizar(); assert.equal(r.status, 1); assert.match(r.stderr, /alterados à mão/); assert.equal(await versaoNoAr(), '9.0.0');
});

'use strict';
// Comando dmk-wa: atualizar existe e comando errado não sai como sucesso (1.3.18).
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const CLI = path.join(__dirname, '..', 'ferramentas', 'dmk-wa.js');
const rodar = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DMK_WA_DADOS: '/tmp/dmk-wa-sem-chave' } });

test('dmk-wa: ajuda sai com 0 e lista o comando atualizar', () => {
  const r = rodar();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dmk-wa atualizar \[--verificar\]/);
});

test('dmk-wa: comando desconhecido sai com erro (não pode encadear com && e parecer sucesso)', () => {
  const r = rodar('atualizarr');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /comando desconhecido: atualizarr/);
});

test('dmk-wa atualizar: só aceita --verificar', () => {
  const r = rodar('atualizar', '--agora');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dmk-wa atualizar \[--verificar\]/);
});

// 1.3.19: a trava da atualização não pode morar dentro da pasta do código — um arquivo solto ali faz o
// "git merge" da própria atualização abortar ("untracked working tree files would be overwritten").
test('atualizador: a trava fica fora do que o Git acompanha', () => {
  const RAIZ = path.join(__dirname, '..');
  const acompanhados = spawnSync('git', ['-C', RAIZ, 'ls-files'], { encoding: 'utf8' }).stdout || '';
  assert.doesNotMatch(acompanhados, /(^|\n)\.atualizando\.lock(\n|$)/, 'o arquivo de trava não pode estar no repositório');
  const script = require('node:fs').readFileSync(path.join(RAIZ, 'instalar', 'atualizar.sh'), 'utf8');
  assert.doesNotMatch(script, /exec 9> "\$RAIZ\/\.atualizando\.lock"/, 'a trava não é criada na raiz do código');
  assert.match(script, /TRAVA="\$RAIZ\/dados\/\.atualizando\.lock"/, 'a trava fica em dados/');
  assert.doesNotMatch(script, /^exec 9>.*2>\/dev\/null/m, 'o exec da trava não pode silenciar o stderr do script');
});

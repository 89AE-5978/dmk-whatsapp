'use strict';
// Painel web do conector: arquivos de publico/, servidos pelo próprio serviço em /painel.
//
// Os arquivos não têm nada sigiloso: toda informação vem de /admin/v1, que exige a chave de
// administrador digitada na tela. Por isso o painel em si não pede senha para carregar.
// Como o serviço só atende em 127.0.0.1, de outra máquina só se chega por túnel SSH (docs/PAINEL.md).
const fs = require('node:fs'), path = require('node:path');
const PASTA = path.join(__dirname, '..', 'publico');
// Lista fixa: nada fora daqui é servido, então caminho malicioso (../) não alcança outro arquivo.
const ARQUIVOS = {
  'index.html': 'text/html; charset=utf-8',
  'painel.css': 'text/css; charset=utf-8',
  'painel.js': 'text/javascript; charset=utf-8',
};
function servir(req, p, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET' }); return res.end(); }
  if (p === '/' || p === '/painel') { res.writeHead(302, { Location: '/painel/' }); return res.end(); }
  const nome = p === '/painel/' ? 'index.html' : p.slice('/painel/'.length);
  const tipo = ARQUIVOS[nome];
  if (!tipo) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado.'); }
  const corpo = fs.readFileSync(path.join(PASTA, nome));
  res.writeHead(200, {
    'Content-Type': tipo, 'Content-Length': corpo.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    // O painel não carrega nada de fora: tudo vem desta própria origem.
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(req.method === 'HEAD' ? undefined : corpo);
}
module.exports = { servir, ARQUIVOS };

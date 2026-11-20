'use strict';
// DMK WhatsApp - conector global: várias sessões de WhatsApp para todos os sistemas DMK.
//
// Duas portas de entrada, no mesmo endereço (só 127.0.0.1; para fora, só pelo nginx com HTTPS):
//   /api/public/dmk-connector/v1/...  o mesmo protocolo "Conector DMK" da Central do DMK Prisma. É por aqui que
//                                     cada sistema troca o código pela credencial, busca eventos e envia.
//   /admin/v1/...                     administração (sessões, QR, autorizações). Exige a chave de administrador.
// Documentação: docs/API.md e docs/LIGAR-UM-SISTEMA.md.
const http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path'), { Readable } = require('node:stream');
const criarSessoes = require('./lib/sessoes');
const painel = require('./lib/painel');
const VERSAO = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
const BASE = '/api/public/dmk-connector/v1', ADMIN = '/admin/v1', LIMITE_CORPO = 15 * 1024 * 1024;
const fail = (m, status = 400) => Object.assign(Error(m), { status });
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();

function criarServidor({ dataDir, chaveAdmin, fabricaMotor, simulado = false, log = console, opcoesAtualizacao }) {
  if (!/^[a-f0-9]{64}$/.test(chaveAdmin || '')) throw Error('Chave de administrador ausente ou inválida (64 caracteres hexadecimais). Rode instalar/instalar.sh.');
  const sessoes = criarSessoes({ dataDir, fabricaMotor, log });
  const atualizacao = require('./lib/atualizacao')({ dataDir, versao: VERSAO, raiz: __dirname, ...(opcoesAtualizacao || {}) });
  const chave = hash(chaveAdmin), tentativas = new Map();
  // Atrás do Nginx (publicar-nginx.sh --painel) todo pedido chega de 127.0.0.1: a trava de
  // tentativas usaria um IP só e um curioso travaria o dono junto. O X-Real-IP que o Nginx
  // põe resolve — e só é aceito vindo do loopback, para ninguém forjar o próprio IP.
  function ipDe(req) {
    const s = req.socket.remoteAddress || '';
    const loopback = s === '127.0.0.1' || s === '::1' || s === '::ffff:127.0.0.1';
    const real = String(req.headers['x-real-ip'] || '').trim();
    return loopback && real ? real : s;
  }
  function exigirAdmin(req) {
    const ip = ipDe(req), t = tentativas.get(ip);
    if (t && t.n >= 10 && t.ate > Date.now()) throw fail('Muitas tentativas com chave errada. Aguarde um minuto.', 429);
    const dada = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!crypto.timingSafeEqual(hash(dada), chave)) {
      if (tentativas.size > 1000) tentativas.clear();
      tentativas.set(ip, { n: t && t.ate > Date.now() ? t.n + 1 : 1, ate: Date.now() + 60000 });
      throw fail('Chave de administrador inválida.', 401);
    }
  }
  async function corpo(req) {
    const partes = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > LIMITE_CORPO) throw fail('Solicitação acima do limite.', 413); partes.push(c); }
    return Buffer.concat(partes);
  }
  const objeto = (b) => { if (!b.length) return {}; try { const o = JSON.parse(b); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; return o; } catch { throw fail('JSON inválido.'); } };

  async function admin(req, p, json) {
    exigirAdmin(req);
    const b = req.method === 'POST' ? objeto(await corpo(req)) : {}, m = /^\/sessoes\/(\d+)(?:\/([a-z-]+)(?:\/([a-f0-9-]{36})\/([a-z]+))?)?$/.exec(p);
    if (p === '/atualizacao' && req.method === 'GET') return json(await atualizacao.estado());
    if (p === '/atualizacao' && req.method === 'POST') return json(await atualizacao.pedir(), 202);
    if (p === '/sessoes' && req.method === 'GET') return json({ sessoes: sessoes.listar() });
    if (p === '/sessoes' && req.method === 'POST') return json(sessoes.criar(b), 201);
    // Atendimento: conversas da sessão, quem está atendendo, liberar/transferir e modo de distribuição.
    const at = /^\/sessoes\/(\d+)\/(atendimentos|distribuicao)(?:\/(liberar|transferir))?$/.exec(p);
    if (at) {
      const [, sid, rota, acaoAt] = at;
      if (rota === 'atendimentos' && !acaoAt && req.method === 'GET') return json(sessoes.atendimentos(sid));
      if (req.method !== 'POST') throw fail('Rota não encontrada.', 404);
      if (rota === 'distribuicao' && !acaoAt) return json(sessoes.definirDistribuicao(sid, b));
      if (acaoAt === 'liberar') return json(sessoes.liberarAtendimento(sid, b));
      if (acaoAt === 'transferir') return json(sessoes.transferirAtendimento(sid, b));
      throw fail('Rota não encontrada.', 404);
    }
    if (!m) throw fail('Rota não encontrada.', 404);
    const [, id, acao, cid, sub] = m;
    if (!acao && req.method === 'GET') return json(sessoes.ver(id));
    if (acao === 'autorizacoes' && !cid && req.method === 'GET') return json({ autorizacoes: sessoes.autorizacoes(id) });
    if (req.method !== 'POST') throw fail('Rota não encontrada.', 404);
    if (acao === 'teste') return json(await sessoes.testar(id, b));
    if (acao === 'conectar') return json(await sessoes.conectar(id));
    if (acao === 'pausar') return json(await sessoes.pausar(id));
    if (acao === 'reiniciar') return json(await sessoes.reiniciar(id));
    if (acao === 'novo-qr') return json(await sessoes.novoQr(id, b));
    if (acao === 'excluir') return json(await sessoes.excluir(id, b));
    if (acao === 'autorizacoes' && !cid) return json(sessoes.autorizar(id, b), 201);
    if (acao === 'autorizacoes' && sub === 'revogar') return json(sessoes.revogar(id, cid));
    if (acao === 'autorizacoes' && sub === 'excluir') return json(sessoes.removerAutorizacao(id, cid));
    if (acao === 'autorizacoes' && sub === 'tipo') return json(sessoes.tipoConexao(id, cid, b));
    // Só no modo simulado: faz o papel do celular e do WhatsApp para testar um sistema sem número real.
    if (simulado && acao === 'simular-leitura-qr') { sessoes.motor.lerQr(id, b.telefone); return json(sessoes.ver(id)); }
    if (simulado && acao === 'simular-mensagem') { await sessoes.motor.receber(id, b); return json({ ok: true }); }
    throw fail('Rota não encontrada.', 404);
  }

  // O protocolo foi escrito para uma sessão só. Aqui o pedido é lido uma vez, descobre-se de qual sessão é o
  // código ou a credencial, e só essa sessão o recebe. Uma credencial nunca alcança outra sessão.
  async function publico(req, p, json, res) {
    const bruto = req.method === 'POST' ? await corpo(req) : Buffer.alloc(0);
    let alvo;
    if (p === BASE + '/exchange' && req.method === 'POST') alvo = sessoes.sessaoDoCodigo(objeto(bruto).code);
    else alvo = sessoes.sessaoDaCredencial(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!alvo) throw fail(p === BASE + '/exchange' ? 'Código inválido, utilizado ou expirado.' : 'Conector expirado ou revogado.', 401);
    const copia = Object.assign(Readable.from(bruto.length ? [bruto] : []), { method: req.method, url: req.url, headers: req.headers, socket: req.socket });
    await alvo.conector.publicHandle(copia, p, json, null, res);
  }

  const servidor = http.createServer(async (req, res) => {
    const json = (o, status = 200) => { const t = JSON.stringify(o); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(t); };
    try {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/health' && req.method === 'GET') {
        const l = sessoes.listar();
        return json({ ok: true, servico: 'dmk-whatsapp', versao: VERSAO, node: process.version, simulado, sessoes: l.length, conectadas: l.filter((s) => s.status === 'CONECTADO').length, ativas: l.filter((s) => s.ativa).length });
      }
      if (p === '/' || p === '/painel' || p.startsWith('/painel/')) return painel.servir(req, p, res);
      if (p.startsWith(BASE + '/')) return await publico(req, p, json, res);
      if (p.startsWith(ADMIN + '/')) return await admin(req, p.slice(ADMIN.length), json);
      throw fail('Rota não encontrada.', 404);
    } catch (e) {
      const status = Number(e.status) || 500;
      if (status >= 500 && status !== 501 && status !== 503) log.error('[dmk-whatsapp]', req.method, req.url.split('?')[0], '-', e.message);
      if (!res.headersSent) json({ error: status === 500 ? 'Erro interno do conector.' : e.message }, status); else res.end();
    }
  });
  servidor.requestTimeout = 120000;
  return { servidor, sessoes, async encerrar() { await new Promise((ok) => servidor.close(ok)); servidor.closeAllConnections?.(); await sessoes.encerrar(); } };
}

// A biblioteca de criptografia (libsignal, dentro do Baileys) escreve no console a sessão inteira — com as
// CHAVES PRIVADAS — a cada troca de sessão ("Closing session: SessionEntry {...}"). Isso ia parar no journal.
// Aqui as mensagens dela viram uma linha curta, sem objeto nenhum; o resto do console segue igual.
function limparConsoleDaCriptografia() {
  const RUIDO = /^(Closing session|Closing open session|Removing old closed session|Session already closed|Session already open|Migrating session|Decrypted message with closed session|Opening session|V1 session storage migration)/i;
  const RESUMIR = /^(Failed to decrypt|Session error|Bad MAC|No session|Unhandled bucket type)/i;
  for (const nivel of ['log', 'info', 'warn', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args) => {
      const primeiro = typeof args[0] === 'string' ? args[0] : '';
      if (RUIDO.test(primeiro)) return;
      if (RESUMIR.test(primeiro)) return original('[criptografia] ' + primeiro.slice(0, 120) + (args[1] instanceof Error ? ' (' + args[1].message + ')' : ''));
      original(...args);
    };
  }
}

if (require.main === module) {
  limparConsoleDaCriptografia();
  const dataDir = path.resolve(process.env.DMK_WA_DADOS || path.join(__dirname, 'dados'));
  const porta = Number(process.env.DMK_WA_PORTA || 8098), simulado = process.env.DMK_WA_SIMULADO === '1';
  const arquivoChave = path.join(dataDir, 'admin.key');
  if (!fs.existsSync(arquivoChave)) { console.error(`Chave de administrador não encontrada em ${arquivoChave}. Rode instalar/instalar.sh.`); process.exit(1); }
  if (fs.statSync(arquivoChave).mode & 0o077) { console.error(`${arquivoChave} está legível por outros usuários. Rode: chmod 600 ${arquivoChave}`); process.exit(1); }
  const app = criarServidor({
    dataDir, simulado, chaveAdmin: fs.readFileSync(arquivoChave, 'utf8').trim(),
    fabricaMotor: simulado ? require('./lib/motor-simulado') : (o) => require('./lib/vendor/whatsapp-baileys').createBaileysManager(o),
  });
  app.servidor.listen(porta, '127.0.0.1', () => {
    console.log(`DMK WhatsApp ${VERSAO} em http://127.0.0.1:${porta} · dados em ${dataDir}${simulado ? ' · MODO SIMULADO (não fala com o WhatsApp)' : ''}`);
    console.log(`Painel: http://127.0.0.1:${porta}/painel (só desta máquina; de fora, por túnel SSH — veja docs/PAINEL.md)`);
    app.sessoes.iniciar();
  });
  let saindo = false;
  for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, async () => {
    if (saindo) return; saindo = true;
    // 1.3.5: encerrar() espera a credencial e as chaves de cada sessão chegarem ao disco. Trava de segurança:
    // se algo prender a saída, termina em 30 s (bem antes dos 90 s em que o systemd mataria o processo à força).
    setTimeout(() => process.exit(0), 30000).unref();
    await app.encerrar().catch(() => {}); process.exit(0);
  });
}
module.exports = { criarServidor, VERSAO };

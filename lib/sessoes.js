'use strict';
// Sessões do conector: cada sessão é um número de WhatsApp com as próprias autorizações.
//
// O conector guarda só o que é da conexão: as credenciais do WhatsApp (dados/whatsapp-baileys/<chave>),
// as autorizações e a fila de eventos ainda não confirmados. Mensagens e conversas ficam no sistema
// que consome: ele busca os eventos, grava do lado dele e confirma (ACK); aí o evento sai daqui.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const criarConector = require('./vendor/dmk-chat-connector');
const fail = (m, status = 400) => Object.assign(Error(m), { status });
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const MAX_SESSOES = 50;

module.exports = function criarSessoes({ dataDir, fabricaMotor, request = fetch, log = console }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  const arquivo = path.join(dataDir, 'conector.json');
  // Gravação atômica: escreve ao lado e troca. Uma queda no meio não deixa o arquivo pela metade.
  let estado = { proximo_id: 1, sessoes: [] };
  if (fs.existsSync(arquivo)) {
    const texto = fs.readFileSync(arquivo, 'utf8');
    if (!texto.trim()) throw Error(`Arquivo ${arquivo} está vazio. Restaure o backup (backups/) antes de iniciar; nada foi alterado.`);
    estado = JSON.parse(texto);
  }
  let pendente = false;
  function gravarAgora() {
    pendente = false;
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(estado), { mode: 0o600 });
    fs.renameSync(tmp, arquivo);
  }
  // O protocolo grava a cada evento; junta as gravações do mesmo instante numa só.
  function gravar() { if (!pendente) { pendente = true; setImmediate(() => { if (pendente) gravarAgora(); }); } }

  const runtimes = new Map(), vivos = new Map(), fotos = new Map();
  let fotosEmCurso = 0, encerrado = false;
  const motor = fabricaMotor({
    runtimeMap: runtimes,
    authRoot: path.join(dataDir, 'whatsapp-baileys'),
    onMessage: async (conta, m) => {
      const v = vivos.get(Number(conta.id));
      if (!v || encerrado) return;
      await v.conector.receive({
        channel: 'WHATSAPP', provider: 'BAILEYS', peer: m.remoteJid, source: m.sourceJid || '', phone: m.phone, name: m.name,
        messageId: m.messageId, text: m.text, media: m.media, timestamp: m.timestamp, outgoing: m.fromMe === true,
        ...(m.reply?.messageId ? { reply: { messageId: String(m.reply.messageId), body: String(m.reply.body || '').slice(0, 500), type: String(m.reply.type || 'text') } } : {}),
      });
      if (!m.fromMe) { v.sessao.ultima_recebida = new Date().toISOString(); gravar(); }
    },
    onMessageStatus: async (conta, m) => { vivos.get(Number(conta.id))?.conector.delivery({ provider: 'BAILEYS', messageId: m.messageId, status: m.status }); },
    onReaction: async (conta, m) => { vivos.get(Number(conta.id))?.conector.relayReaction({ peer: String(m.targetKey?.remoteJid || ''), messageId: m.messageId, emoji: m.emoji, fromMe: m.fromMe === true }); },
    onDelete: async (conta, m) => { vivos.get(Number(conta.id))?.conector.relayRevoke({ peer: String(m.key?.remoteJid || ''), messageId: m.messageId }); },
  });
  const conta = (s) => ({ id: s.id, client_key: s.chave, label: s.nome, enabled: s.ativa ? 1 : 0 });
  const pronto = (s) => { if (!s.ativa) throw fail('Sessão pausada. Conecte a sessão antes de usar.', 503); return motor; };

  // Foto do contato: guarda 1 h (sem foto: 10 min) e faz no máximo 2 buscas ao mesmo tempo.
  async function foto(s, to) {
    const chave = s.id + ':' + to, tem = fotos.get(chave);
    if (tem && Date.now() - tem.t < (tem.d ? 3600000 : 600000)) return tem.d;
    if (fotosEmCurso >= 2) return null;
    fotosEmCurso++;
    let d = null;
    try {
      const p = await pronto(s).profilePhoto?.(conta(s), to);
      if (p?.url) {
        const r = await request(p.url, { redirect: 'error', signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const b = Buffer.from(await r.arrayBuffer());
          const tipo = b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG' ? 'image/png' : b.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
          if (tipo && b.length <= 1024 * 1024) d = { data: b, type: tipo, url: p.url };
        }
      }
    } catch {} finally { fotosEmCurso--; }
    fotos.set(chave, { t: Date.now(), d });
    while (fotos.size > 500) fotos.delete(fotos.keys().next().value);
    return d;
  }

  function ligar(s) {
    const pasta = path.join(dataDir, 'sessoes', s.chave);
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    s.store ||= {};
    const conector = criarConector({
      store: s.store, save: gravar, dataDir: pasta,
      status: () => { const r = runtimes.get(s.id); return { status: s.ativa ? r?.status || 'INICIANDO' : 'DESCONECTADO', phone: r?.phone || '' }; },
      send: async (to, text, media, reply) => {
        const citar = reply?.id ? { replyToExternalId: reply.id, replyQuote: { fromMe: reply.from_me === true, body: reply.body || '' } } : {};
        if (!media) return pronto(s).sendText(conta(s), to, text, citar);
        const temp = path.join(pasta, 'dmk-connector-media', 'send-' + crypto.randomUUID());
        fs.writeFileSync(temp, media.buffer, { mode: 0o600 });
        try { return await pronto(s).sendMedia(conta(s), to, temp, media.mimetype, media.filename, text, citar); } finally { fs.rmSync(temp, { force: true }); }
      },
      actions: {
        react: (to, id, emoji) => pronto(s).react(conta(s), to, id, emoji),
        remove: (to, id) => pronto(s).deleteMessage(conta(s), to, id),
        edit: (to, id, text) => pronto(s).editMessage(conta(s), to, id, text),
        presence: (to, state) => pronto(s).setPresence(conta(s), to, state),
        read: (to, ids) => pronto(s).markRead(conta(s), to, ids),
        getPresence: (to) => pronto(s).getPresence?.(conta(s), to),
        photo: (to) => foto(s, to),
      },
    });
    const v = { sessao: s, conector, iniciando: null };
    vivos.set(s.id, v);
    return v;
  }
  for (const s of estado.sessoes) ligar(s);

  const achar = (id) => { const v = vivos.get(Number(id)); if (!v) throw fail('Sessão não encontrada.', 404); return v; };
  function resumo(s, comQr = false) {
    const r = runtimes.get(s.id), lista = vivos.get(s.id).conector.list();
    const status = s.ativa ? r?.status || 'INICIANDO' : 'DESCONECTADO';
    return {
      id: s.id, nome: s.nome, dono: s.dono, ativa: !!s.ativa, status, telefone: r?.phone || s.telefone || '', criada_em: s.criada_em,
      ultima_recebida: s.ultima_recebida || null, autorizacoes: lista.filter((c) => !c.revoked_at).length,
      eventos_pendentes: lista.reduce((n, c) => n + c.pending, 0), erro: r?.lastError ? 'Não foi possível conectar. Confira a rede e tente de novo.' : '',
      ...(comQr && status === 'AGUARDANDO_QR' ? { qr: r?.qrDataUrl || null, qr_texto: r?.qrText || null } : {}),
    };
  }
  function criar(b) {
    const nome = String(b.nome || '').trim(), dono = String(b.dono || '').trim().toLowerCase();
    if (!nome || nome.length > 60) throw fail('Informe o nome da sessão (até 60 letras).');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(dono)) throw fail('Informe o sistema dono da sessão: letras minúsculas, números e hífen (ex.: gestao, smartcore, prisma-loja1).');
    if (estado.sessoes.length >= MAX_SESSOES) throw fail(`Limite de ${MAX_SESSOES} sessões atingido.`, 409);
    const id = estado.proximo_id++;
    const s = { id, chave: `sessao-${id}`, nome, dono, ativa: false, criada_em: new Date().toISOString(), store: {} };
    estado.sessoes.push(s);
    ligar(s);
    gravarAgora();
    return resumo(s);
  }
  async function conectar(id) {
    const v = achar(id), s = v.sessao;
    if (encerrado) throw fail('Conector encerrando.', 503);
    s.ativa = true; gravarAgora();
    if (!v.iniciando) v.iniciando = Promise.resolve().then(async () => {
      const r = runtimes.get(s.id);
      if (r && ['ERRO', 'DESCONECTADO'].includes(r.status)) await motor.stop(conta(s));
      return motor.start(conta(s));
    }).finally(() => { v.iniciando = null; });
    await v.iniciando;
    return resumo(s, true);
  }
  async function pausar(id) {
    const v = achar(id), s = v.sessao;
    await v.iniciando?.catch(() => {});
    s.ativa = false; s.telefone = runtimes.get(s.id)?.phone || s.telefone || ''; gravarAgora();
    await motor.stop(conta(s));
    return resumo(s);
  }
  // Reinício mantém a sessão: não pede QR de novo.
  async function reiniciar(id) {
    const v = achar(id), s = v.sessao;
    await v.iniciando?.catch(() => {});
    s.ativa = true; gravarAgora();
    await motor.stop(conta(s));
    v.iniciando = Promise.resolve().then(() => motor.start(conta(s))).finally(() => { v.iniciando = null; });
    await v.iniciando;
    return resumo(s, true);
  }
  async function novoQr(id, b = {}) {
    const v = achar(id), s = v.sessao;
    if (b.confirmado !== true) throw fail('Confirme a troca do número: a sessão atual será desconectada do WhatsApp.', 409);
    await v.iniciando?.catch(() => {});
    await motor.stop(conta(s), { logout: true, deleteAuth: true });
    s.ativa = true; s.telefone = ''; gravarAgora();
    await motor.start(conta(s));
    return resumo(s, true);
  }
  // Excluir apaga a conexão, as autorizações e a fila. O que cada sistema já gravou do lado dele continua lá.
  async function excluir(id, b = {}) {
    const v = achar(id), s = v.sessao;
    if (b.confirmado !== true) throw fail('Confirme a exclusão: o número é desconectado e as autorizações desta sessão deixam de valer.', 409);
    await v.iniciando?.catch(() => {});
    await motor.stop(conta(s), { logout: true, deleteAuth: true }).catch(() => {});
    vivos.delete(s.id);
    estado.sessoes.splice(estado.sessoes.indexOf(s), 1);
    fs.rmSync(path.join(dataDir, 'sessoes', s.chave), { recursive: true, force: true });
    gravarAgora();
    return { ok: true };
  }
  // Toda autorização vale para a sessão inteira (escopo SHARED do protocolo): quem recebe o código lê e
  // responde as conversas deste número. Para separar sistemas, use uma sessão (um número) para cada um.
  function autorizar(id, b = {}) {
    if (b.confirmado !== true) throw fail('Confirme que este sistema poderá ler e responder todas as conversas deste número.', 409);
    return achar(id).conector.grant({ label: b.nome, installation: b.sistema, scope: 'SHARED', shared_confirmed: true });
  }
  // Rotas públicas: descobre de qual sessão é o código ou a credencial sem entregar o pedido às outras.
  function sessaoDoCodigo(codigo) { const h = hash(codigo || ''); return [...vivos.values()].find((v) => (v.sessao.store.dmk_connectors || []).some((g) => g.code_hash === h)); }
  function sessaoDaCredencial(token) { if (!/^[a-f0-9]{64}$/.test(token || '')) return null; const h = hash(token); return [...vivos.values()].find((v) => (v.sessao.store.dmk_connectors || []).some((g) => g.token_hash === h)); }

  async function iniciar() {
    for (const s of estado.sessoes) if (s.ativa) conectar(s.id).catch((e) => log.error(`[sessao ${s.id}] não iniciou:`, e.message));
  }
  async function encerrar() {
    encerrado = true;
    for (const v of vivos.values()) { await v.iniciando?.catch(() => {}); await motor.stop(conta(v.sessao)).catch(() => {}); }
    gravarAgora();
  }
  return {
    listar: () => estado.sessoes.map((s) => resumo(s)), ver: (id) => resumo(achar(id).sessao, true), criar, conectar, pausar, reiniciar, novoQr, excluir, autorizar,
    autorizacoes: (id) => achar(id).conector.list(), revogar: (id, c) => achar(id).conector.revoke(c), removerAutorizacao: (id, c) => achar(id).conector.remove(c),
    sessaoDoCodigo, sessaoDaCredencial, iniciar, encerrar, gravarAgora, motor, runtimes,
  };
};

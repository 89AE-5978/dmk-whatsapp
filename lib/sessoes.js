'use strict';
// Sessões do conector: cada sessão é um número de WhatsApp com as próprias conexões (sistemas/chats ligados).
//
// Por sessão, em dados/sessoes/<chave>/:
//   atendimento/   conversas, mensagens e anexos, separados por conexão (lib/atendimento.js, LEIA-ME.txt lá dentro)
//   reenvio/       conteúdo dos envios para atender pedidos de reenvio do WhatsApp (lib/reenvio.js)
//   dmk-connector-media/  anexos da fila de eventos ainda não confirmados pelos sistemas
// A credencial do WhatsApp fica em dados/whatsapp-baileys/<chave>. Cada sistema continua buscando os eventos,
// gravando do lado dele e confirmando (ACK); o histórico no conector serve para consulta e para o reenvio.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const criarConector = require('./vendor/dmk-chat-connector');
const criarAtendimento = require('./atendimento');
const criarReenvio = require('./reenvio');
const fail = (m, status = 400) => Object.assign(Error(m), { status });
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const MAX_SESSOES = 50;
// Intervalo mínimo entre dois envios da MESMA sessão (ms). Rajadas são o que mais limita/derruba um número.
const INTERVALO_ENVIO = Number(process.env.DMK_WA_INTERVALO_ENVIO_MS ?? 1000);

module.exports = function criarSessoes({ dataDir, fabricaMotor, request = fetch, log = console, intervaloEnvio = INTERVALO_ENVIO }) {
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
    minSendIntervalMs: intervaloEnvio,
    // Reenvio: o conteúdo de cada envio confirmado fica em disco (7 dias) e volta quando o WhatsApp pede.
    saveMessage: async (conta, { key, bytes }) => { vivos.get(Number(conta.id))?.reenvio.guardar(key, bytes); },
    loadMessage: async (conta, key) => vivos.get(Number(conta.id))?.reenvio.buscar(key),
    onMessage: async (conta, m) => {
      const v = vivos.get(Number(conta.id));
      if (!v || encerrado) return;
      const dados = {
        channel: 'WHATSAPP', provider: 'BAILEYS', peer: m.remoteJid, source: m.sourceJid || '', phone: m.phone, name: m.name,
        messageId: m.messageId, text: m.text, media: m.media, timestamp: m.timestamp, outgoing: m.fromMe === true,
        ...(m.reply?.messageId ? { reply: { messageId: String(m.reply.messageId), body: String(m.reply.body || '').slice(0, 500), type: String(m.reply.type || 'text') } } : {}),
      };
      // Primeiro entrega (o roteamento decide quem recebe: lead para todos, conversa assumida só para o dono)…
      await v.conector.receive(dados);
      // …depois guarda no histórico da sessão, na pasta de quem está atendendo.
      v.atendimento.recebida(dados);
      // Uma linha curta por mensagem recebida (sem o texto): facilita conferir no journal se chegou.
      if (!m.fromMe) log.log?.(`[sessao ${conta.id}] recebida de ...${String(m.phone || m.remoteJid || '').replace(/@.*/, '').slice(-4)}${m.media ? ' (anexo)' : ''}`);
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
    s.distribuicao ||= 'leads';
    const v = { sessao: s, conector: null, iniciando: null };
    v.reenvio = criarReenvio(pasta);
    v.atendimento = criarAtendimento({ pasta, log, modo: () => s.distribuicao, conector: () => v.conector });
    const conector = criarConector({
      store: s.store, save: gravar, dataDir: pasta, route: v.atendimento.route,
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
    v.conector = conector;
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
      eventos_pendentes: lista.reduce((n, c) => n + c.pending, 0),
      erro: status === 'SUBSTITUIDA' ? r.lastError : r?.lastError ? 'Não foi possível conectar. Confira a rede e tente de novo.' : '',
      distribuicao: s.distribuicao, atendimentos: vivos.get(s.id).atendimento.contar(),
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
      if (r && ['ERRO', 'DESCONECTADO', 'SUBSTITUIDA'].includes(r.status)) await motor.stop(conta(s));
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
  // Cada autorização é uma CONEXÃO (um sistema/chat) com ID próprio. No modo "leads" ela recebe os leads (primeiro
  // contato) e as conversas que assumir; no modo "todos" recebe tudo, como antes.
  function autorizar(id, b = {}) {
    if (b.confirmado !== true) throw fail('Confirme que este sistema poderá ver os leads deste número e responder as conversas que assumir.', 409);
    return achar(id).conector.grant({ label: b.nome, installation: b.sistema, scope: 'SHARED', shared_confirmed: true, tipo: b.tipo });
  }
  const tipoConexao = (id, cid, b = {}) => achar(id).conector.setTipo(cid, b.tipo);
  // ---------- atendimento (painel) ----------
  function definirDistribuicao(id, b = {}) {
    const v = achar(id); if (!['leads', 'todos'].includes(b.modo)) throw fail('Modo inválido: use "leads" ou "todos".');
    v.sessao.distribuicao = b.modo; gravarAgora(); return resumo(v.sessao);
  }
  const atendimentos = (id) => ({ modo: achar(id).sessao.distribuicao, conversas: achar(id).atendimento.listar() });
  function liberarAtendimento(id, b = {}) { const v = achar(id); return v.atendimento.liberar(v.atendimento.canonico({ peer: b.peer, phone: b.peer }), { admin: true }); }
  function transferirAtendimento(id, b = {}) {
    const v = achar(id), para = v.conector.grantById(String(b.para || ''));
    if (!para) throw fail('Conexão de destino não encontrada ou revogada.', 404);
    return v.atendimento.assumir(para, v.atendimento.canonico({ peer: b.peer, phone: b.peer }), { admin: true });
  }
  // Rotas públicas: descobre de qual sessão é o código ou a credencial sem entregar o pedido às outras.
  function sessaoDoCodigo(codigo) { const h = hash(codigo || ''); return [...vivos.values()].find((v) => (v.sessao.store.dmk_connectors || []).some((g) => g.code_hash === h)); }
  function sessaoDaCredencial(token) { if (!/^[a-f0-9]{64}$/.test(token || '')) return null; const h = hash(token); return [...vivos.values()].find((v) => (v.sessao.store.dmk_connectors || []).some((g) => g.token_hash === h)); }

  let limpeza = null;
  async function iniciar() {
    for (const s of estado.sessoes) if (s.ativa) conectar(s.id).catch((e) => log.error(`[sessao ${s.id}] não iniciou:`, e.message));
    // Retenção do histórico: uma vez agora e a cada 6 h.
    const limpar = () => { for (const v of vivos.values()) try { v.atendimento.limpar(); } catch (e) { log.error(`[sessao ${v.sessao.id}] limpeza:`, e.message); } };
    limpar(); limpeza = setInterval(limpar, 6 * 3600000); limpeza.unref?.();
  }
  async function encerrar() {
    encerrado = true; clearInterval(limpeza);
    for (const v of vivos.values()) try { v.atendimento.gravarAgora(); } catch {}
    for (const v of vivos.values()) { await v.iniciando?.catch(() => {}); await motor.stop(conta(v.sessao)).catch(() => {}); }
    gravarAgora();
  }
  // Teste da sessão (botão Testar do painel): confere estado, sistemas ligados, fila e recebimento,
  // e — SÓ se um telefone for informado — envia UMA mensagem de teste real por esta sessão.
  // O recebimento se confere na prática: responda no celular e rode o teste de novo (a última recebida avança).
  async function testar(id, b = {}) {
    const v = achar(id), s = v.sessao, r = resumo(s);
    const checks = [], add = (nome, ok, detalhe) => checks.push({ nome, ok, detalhe });
    add('Sessão ativa', s.ativa === true, s.ativa ? 'Ativada.' : 'Pausada. Use Conectar.');
    add('Conexão com o WhatsApp', r.status === 'CONECTADO', r.status === 'CONECTADO' ? 'Conectado' + (r.telefone ? ' como ' + r.telefone : '') + '.' : 'Estado atual: ' + r.status + '.');
    add('Sistemas ligados', r.autorizacoes > 0 ? true : null, r.autorizacoes ? r.autorizacoes + ' sistema(s) com autorização ativa.' : 'Nenhum sistema ligado ainda. Use Ligar sistema.');
    add('Fila de eventos', r.eventos_pendentes < 200, r.eventos_pendentes === 0 ? 'Nenhum evento esperando confirmação.' : r.eventos_pendentes + ' evento(s) esperando os sistemas buscarem' + (r.eventos_pendentes >= 200 ? ' — algum sistema parou de consultar?' : '.'));
    const rt = runtimes.get(s.id);
    if (rt?.decryptFailures) add('Decifrar mensagens recebidas', rt.decryptedCount ? null : false, rt.decryptFailures + ' mensagem(ns) recebida(s) não puderam ser decifradas desde a conexão (a última em ' + new Date(rt.lastDecryptFailureAt).toLocaleString('pt-BR') + ').' + (rt.decryptedCount ? ' Outras ' + rt.decryptedCount + ' abriram normalmente.' : ' Nenhuma abriu: refaça o pareamento (Trocar número → ler o QR com o MESMO celular).'));
    add('Recebimento', s.ultima_recebida ? true : null, s.ultima_recebida ? 'Última mensagem recebida em ' + new Date(s.ultima_recebida).toLocaleString('pt-BR') + '.' : 'Nenhuma recebida ainda. Mande uma mensagem de outro celular para este número e confira de novo.');
    let envio = null;
    const telefone = String(b.telefone || '').replace(/\D/g, '');
    if (telefone) {
      if (!/^\d{10,15}$/.test(telefone)) throw fail('Informe o número com DDI e DDD, só dígitos (ex.: 5587999990000).');
      if (r.status !== 'CONECTADO') throw fail('Conecte a sessão antes de enviar a mensagem de teste.', 409);
      const out = await pronto(s).sendText(conta(s), telefone, 'Teste do DMK WhatsApp — sessão "' + s.nome + '" enviando normalmente. ' + new Date().toLocaleString('pt-BR'));
      const idExt = out?.externalId || out?.key?.id || '';
      envio = { ok: !!idExt && out?.uncertain !== true, externalId: idExt };
      add('Envio', envio.ok, envio.ok ? 'Mensagem de teste aceita pelo WhatsApp. Confira se chegou no celular ' + telefone + '.' : 'O WhatsApp não confirmou o envio. Confira a conexão antes de repetir.');
    }
    return { ok: checks.every((c) => c.ok !== false), verificado_em: new Date().toISOString(), checks, ...(envio ? { envio } : {}) };
  }
  return {
    listar: () => estado.sessoes.map((s) => resumo(s)), ver: (id) => resumo(achar(id).sessao, true), criar, conectar, pausar, reiniciar, novoQr, excluir, autorizar,
    autorizacoes: (id) => achar(id).conector.list(), revogar: (id, c) => achar(id).conector.revoke(c), removerAutorizacao: (id, c) => achar(id).conector.remove(c), testar,
    sessaoDoCodigo, sessaoDaCredencial, iniciar, encerrar, gravarAgora, motor, runtimes,
    definirDistribuicao, atendimentos, tipoConexao, liberarAtendimento, transferirAtendimento,
  };
};

'use strict';
// Atendimento de UMA sessão: quem fica com cada conversa e onde ficam as mensagens e os arquivos.
//
// Uma sessão (um número) pode estar ligada a vários sistemas/chats ("conexões" — cada autorização tem um ID).
// Regras, no modo "leads" (padrão):
//   1. Primeiro contato (conversa sem dono): a mensagem vai para TODAS as conexões. É um lead.
//   2. Uma conexão assume o lead — pelo botão "assumir" (POST /claim) ou simplesmente respondendo (POST /send).
//      A partir daí só ela recebe as mensagens desse contato e só ela pode responder. As outras recebem o aviso
//      "assigned" (se declararem X-DMK-Features: routing) para tirar a conversa da tela.
//      Conexão do tipo "avisos" (cobranças, alertas automáticos) envia sem assumir e sem ser barrada.
//   3. Quem atende finaliza (POST /release): a conversa volta a ser lead e a próxima mensagem do contato aparece
//      de novo para todas. Revogar uma conexão também devolve as conversas dela.
// No modo "todos" (o comportamento antigo) todas as conexões recebem tudo e ninguém é dono de nada.
//
// Pastas (dentro de dados/sessoes/<sessao>/atendimento — explicadas também no LEIA-ME.txt gerado lá):
//   conversas.json                         índice: contato -> dono, estado, última mensagem
//   geral/conversas/<contato>.jsonl        mensagens enquanto a conversa não tem dono (lead) ou no modo "todos"
//   geral/arquivos/AAAA-MM/<id>.<ext>      anexos dessas mensagens
//   conexoes/<ID da conexão>/conversas/…   mensagens de quem assumiu (cada conexão só enxerga a própria pasta)
//   conexoes/<ID da conexão>/arquivos/…    anexos dela
// Ao assumir, o histórico do lead (geral) muda para a pasta da conexão que assumiu.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const fail = (m, status = 400) => Object.assign(Error(m), { status });
const UUID = /^[a-f0-9-]{36}$/;
const LEIA_ME = `DMK WhatsApp — pasta de atendimento desta sessão (gerada pelo conector; não edite à mão).

conversas.json                        Índice: cada contato, quem está atendendo (dono), estado e última mensagem.
geral/conversas/<contato>.jsonl       Mensagens de conversas SEM dono (leads, primeiro contato).
geral/arquivos/AAAA-MM/               Anexos dessas mensagens.
conexoes/<ID da conexão>/conversas/   Mensagens das conversas que essa conexão (sistema/chat) assumiu.
conexoes/<ID da conexão>/arquivos/    Anexos dela.

Uma conexão nunca lê a pasta de outra. Quando assume um lead, o histórico dele sai de geral/ e vem para a pasta dela.
Cada linha de um .jsonl é uma mensagem: id, de (cliente | sistema | celular), texto, arquivo, em.
`;

// Mesmo formato de contato do protocolo (dmk-chat-connector): número com DDI@s.whatsapp.net ou LID@lid.
function canonico(m) {
  const tel = String(m.phone || '').replace(/\D/g, '');
  if (/^\d{10,15}$/.test(tel)) return tel + '@s.whatsapp.net';
  for (const v of [m.peer, m.source, m.remoteJid]) {
    const s = String(v || '');
    if (/^\d{1,30}@lid$/.test(s)) return s;
    if (/^\d{10,15}@(s\.whatsapp\.net|c\.us)$/.test(s)) return s.split('@')[0] + '@s.whatsapp.net';
  }
  return '';
}
const nomeArquivo = (peer) => peer.endsWith('@lid') ? 'lid-' + peer.split('@')[0] : peer.split('@')[0];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };

module.exports = function criarAtendimento({ pasta, modo, conector, aoAssumir = () => {}, log = console, now = Date.now, retencaoDias = 180 }) {
  const raiz = path.join(pasta, 'atendimento');
  for (const p of [raiz, path.join(raiz, 'geral', 'conversas'), path.join(raiz, 'geral', 'arquivos'), path.join(raiz, 'conexoes')]) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(raiz, 'LEIA-ME.txt'), LEIA_ME, { mode: 0o600 });
  const arquivoIndice = path.join(raiz, 'conversas.json');
  let indice = { conversas: {} };
  try { if (fs.existsSync(arquivoIndice)) indice = JSON.parse(fs.readFileSync(arquivoIndice, 'utf8')); } catch (e) { log.error('[atendimento] índice ilegível, recomeçando vazio:', e.message); }
  indice.conversas ||= {};
  let pendente = false;
  function gravarAgora() { pendente = false; const tmp = arquivoIndice + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(indice), { mode: 0o600 }); fs.renameSync(tmp, arquivoIndice); }
  function gravar() { if (!pendente) { pendente = true; setImmediate(() => { if (pendente) gravarAgora(); }); } }

  const g = () => conector(); // o conector é criado depois; pega na hora de usar
  const leads = () => modo() !== 'todos';
  const dono = (c) => { if (!c?.dono) return null; const x = g().grantById(c.dono); if (!x) { c.dono = null; c.dono_nome = ''; c.estado = 'FINALIZADO'; gravar(); } return x; };
  const pastaDe = (gid) => gid ? path.join(raiz, 'conexoes', gid) : path.join(raiz, 'geral');
  function conversa(peer, m = {}) {
    const c = indice.conversas[peer] ||= { peer, telefone: peer.endsWith('@lid') ? '' : peer.split('@')[0], nome: '', dono: null, dono_nome: '', estado: 'NOVO', criada_em: new Date(now()).toISOString() };
    if (m.name && !m.outgoing) c.nome = String(m.name).slice(0, 100);
    return c;
  }

  // ---------- gravação das mensagens ----------
  function guardarArquivo(base, media, id) {
    if (!media?.buffer?.length) return null;
    const mes = new Date(now()).toISOString().slice(0, 7), dir = path.join(base, 'arquivos', mes);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ext = EXT[String(media.mimetype || '').split(';')[0]] || (path.extname(String(media.filename || '')).slice(1).replace(/[^a-z0-9]/gi, '').slice(0, 8)) || 'bin';
    const nome = crypto.randomUUID() + '.' + ext;
    fs.writeFileSync(path.join(dir, nome), media.buffer, { mode: 0o600 });
    return { caminho: path.relative(raiz, path.join(dir, nome)).split(path.sep).join('/'), nome: String(media.filename || nome).slice(0, 150), tipo: String(media.mimetype || 'application/octet-stream'), tamanho: media.buffer.length };
  }
  function escrever(gid, peer, registro) {
    const dir = path.join(pastaDe(gid), 'conversas');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, nomeArquivo(peer) + '.jsonl'), JSON.stringify(registro) + '\n', { mode: 0o600 });
  }
  function anotar(c, registro) {
    c.ultima_em = registro.em; c.ultimo_texto = String(registro.texto || (registro.arquivo ? '📎 ' + registro.arquivo.nome : '')).slice(0, 120);
    if (registro.de === 'cliente') c.ultima_do_cliente_em = registro.em;
    gravar();
  }
  // Mensagem que chegou pelo WhatsApp (do cliente, ou digitada no próprio celular do número).
  // 1.3.9 — Depois de uma reconexão o WhatsApp pode reentregar a mesma mensagem (visto na VPS: uma vez pelo número,
  // outra pelo LID). Os sistemas já não recebiam a repetição; o histórico gravava duas vezes. Agora devolve false.
  const jaGravadas = new Set();
  function recebida(m) {
    const peer = canonico(m); if (!peer || !m.messageId) return false;
    const chave = String(m.messageId);
    if (jaGravadas.has(chave)) return false;
    jaGravadas.add(chave); if (jaGravadas.size > 5000) jaGravadas.delete(jaGravadas.values().next().value);
    const c = conversa(peer, m);
    if (leads() && !m.outgoing && !dono(c) && c.estado !== 'NOVO') { c.estado = 'NOVO'; c.reaberta_em = new Date(now()).toISOString(); }
    const gid = leads() ? dono(c)?.id || null : null;
    // "em" é a hora em que chegou ao conector (ordena o histórico sem empate de segundos); "enviada_em" é a do WhatsApp.
    const registro = { id: String(m.messageId), de: m.outgoing ? 'celular' : 'cliente', texto: String(m.text || ''), em: new Date(now()).toISOString(), enviada_em: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null, conexao: gid };
    try { registro.arquivo = guardarArquivo(pastaDe(gid), m.media, registro.id); escrever(gid, peer, registro); anotar(c, registro); }
    catch (e) { log.error('[atendimento] mensagem não gravada no histórico:', e.message); }
  }
  // Mensagem enviada por uma conexão (POST /send confirmado).
  function enviada(conexao, peer, { externalId, text, media }) {
    jaGravadas.add(String(externalId)); // o eco do próprio envio não entra de novo como "celular"
    // Aviso enviado a uma conversa de outro: vai para a pasta de quem atende (ele vê o que o cliente recebeu).
    const c = conversa(peer), gid = !leads() ? null : soEnvia(conexao) ? dono(c)?.id || null : conexao.id;
    const registro = { id: String(externalId), de: 'sistema', texto: String(text || ''), em: new Date(now()).toISOString(), conexao: conexao.id, conexao_nome: conexao.label };
    try { registro.arquivo = guardarArquivo(pastaDe(gid), media, registro.id); escrever(gid, peer, registro); anotar(c, registro); }
    catch (e) { log.error('[atendimento] envio não gravado no histórico:', e.message); }
  }

  // ---------- quem atende ----------
  function lerLinhas(arquivo) { try { return fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
  // O histórico do lead (pasta geral) vai para a pasta de quem assumiu, com os anexos.
  function moverLead(peer, gid) {
    const de = path.join(raiz, 'geral', 'conversas', nomeArquivo(peer) + '.jsonl');
    if (!fs.existsSync(de)) return;
    const destino = pastaDe(gid);
    for (const r of lerLinhas(de)) {
      if (r.arquivo?.caminho?.startsWith('geral/arquivos/')) {
        const novo = path.join(destino, r.arquivo.caminho.slice('geral/'.length));
        try { fs.mkdirSync(path.dirname(novo), { recursive: true, mode: 0o700 }); fs.renameSync(path.join(raiz, r.arquivo.caminho), novo); r.arquivo.caminho = path.relative(raiz, novo).split(path.sep).join('/'); } catch {}
      }
      escrever(gid, peer, r);
    }
    fs.rmSync(de, { force: true });
  }
  function assumir(conexao, peer, { admin = false } = {}) {
    if (!leads()) throw fail('Esta sessão está no modo "todos": não há dono de conversa.', 409);
    const c = conversa(peer), atual = dono(c);
    if (atual && atual.id === conexao.id) return resumo(c, conexao);
    if (atual && !admin) throw fail(`Este contato já está em atendimento por "${atual.label}".`, 409);
    if (atual) g().notify('released', { peer }, (x) => x.id === atual.id); // transferência: quem perdeu tira da tela
    c.dono = conexao.id; c.dono_nome = conexao.label; c.estado = 'EM_ATENDIMENTO'; c.assumida_em = new Date(now()).toISOString();
    try { aoAssumir(peer); } catch (e) { log.error('[atendimento] aviso ao chatbot:', e.message); } // atendente humano assumiu: o chatbot para
    moverLead(peer, conexao.id);
    gravarAgora();
    const aviso = { peer, phone: c.telefone, owner: { id: conexao.id, label: conexao.label } };
    g().notify('assigned', { ...aviso, mine: true }, (x) => x.id === conexao.id);
    g().notify('assigned', { ...aviso, mine: false }, (x) => x.id !== conexao.id);
    return resumo(c, conexao);
  }
  function liberar(peer, { conexao = null, admin = false } = {}) {
    const c = indice.conversas[peer]; if (!c) throw fail('Conversa não encontrada.', 404);
    const atual = dono(c);
    if (atual && !admin && atual.id !== conexao?.id) throw fail(`Só "${atual.label}", que está atendendo, pode finalizar.`, 409);
    c.dono = null; c.dono_nome = ''; c.estado = 'FINALIZADO'; c.finalizada_em = new Date(now()).toISOString();
    gravarAgora();
    g().notify('released', { peer, phone: c.telefone });
    return resumo(c, conexao);
  }
  function liberarDe(gid) { for (const c of Object.values(indice.conversas)) if (c.dono === gid) { c.dono = null; c.dono_nome = ''; c.estado = 'FINALIZADO'; c.finalizada_em = new Date(now()).toISOString(); } gravarAgora(); }
  const resumo = (c, quem) => ({ peer: c.peer, phone: c.telefone, name: c.nome, state: c.estado, owner: c.dono ? { id: c.dono, label: c.dono_nome } : null, mine: !!quem && c.dono === quem.id, last_at: c.ultima_em || null, last_text: c.ultimo_texto || '' });

  // ---------- regras usadas pelo protocolo (dmk-chat-connector, opção route) ----------
  // 1.3.6 — Sistema que SÓ ENVIA: o do tipo "avisos" e também o que está ligado como atendimento mas nunca buscou
  // mensagens (está ligado há mais de 2 minutos e nunca chamou /events). Ele não pode assumir conversa nem receber
  // lead: ninguém lê do lado dele. Era o caso do Smart Core em produção — mandava um aviso, virava "dono" do
  // contato e as respostas desse contato deixavam de aparecer no Prisma e nos outros ("parou de sincronizar").
  const soEnvia = (x) => x.tipo === 'avisos' || (!x.last_events_at && now() - (x.paired_at || 0) > 120000);
  // Conversa que ficou com um sistema que só envia volta a ser de todos (conserta o que já estava preso).
  function soltarPresas() {
    const mudas = new Set(g().list().filter((x) => !x.revoked_at && soEnvia(x)).map((x) => x.id));
    for (const c of Object.values(indice.conversas)) if (c.dono && mudas.has(c.dono)) { try { liberar(c.peer, { admin: true }); } catch (e) { log.error('[atendimento] não liberou conversa presa:', e.message); } }
  }
  // Eventos de conversa que já estavam parados na fila de quem só envia saem de lá (ficam só os recibos de entrega
  // dos avisos que ele mesmo mandou). Nada se perde: as mensagens estão no histórico da sessão e nos outros sistemas.
  const DE_CONVERSA = new Set(['message', 'reaction', 'revoke', 'edit', 'assigned', 'released', 'presence']);
  function limparFilasMudas() {
    for (const x of g().list()) {
      if (x.revoked_at || !x.pending || !soEnvia(x)) continue;
      const n = g().dropEvents(x.id, (e) => !DE_CONVERSA.has(e.type));
      if (n) log.log?.(`[atendimento] ${n} evento(s) de conversa tirados da fila de "${x.label}", que só envia.`);
    }
  }
  const route = {
    alvos(peer, m) {
      limparFilasMudas();
      // 1.3.8 — No modo "todos" o sistema que só envia (Avisos) também não recebe conversa: antes ele recebia tudo,
      // a fila dele só crescia (ninguém lê) e ia bater no limite de 1000 eventos.
      if (!leads()) { const l = g().list().filter((x) => !x.revoked_at); return l.some(soEnvia) ? new Set(l.filter((x) => !soEnvia(x)).map((x) => x.id)) : null; }
      soltarPresas();
      const c = indice.conversas[peer], d = dono(c);
      if (d) return new Set([d.id]);
      // Lead: vai para todas as conexões de atendimento. As de avisos (cobrança, alertas) não recebem conversa
      // — só os recibos dos próprios envios —, senão a fila delas enche de mensagens que ninguém lê.
      return new Set(g().list().filter((x) => !x.revoked_at && !soEnvia(x)).map((x) => x.id));
    },
    antesDeEnviar(conexao, peer) {
      // Conexão de avisos (cobrança, alertas do Smart Core…): envia sem assumir nem ser barrada.
      if (!leads() || soEnvia(conexao)) return;
      const d = dono(indice.conversas[peer]);
      if (d && d.id !== conexao.id) throw fail(`Este contato está em atendimento por "${d.label}".`, 409);
      if (!d) assumir(conexao, peer);
    },
    podeAgir(conexao, peer) {
      if (!leads() || soEnvia(conexao)) return;
      const d = dono(indice.conversas[peer]);
      if (d && d.id !== conexao.id) throw fail(`Este contato está em atendimento por "${d.label}".`, 409);
    },
    enviado: (conexao, peer, dados) => enviada(conexao, peer, dados),
    // 1.3.12 — Etiqueta que acompanha cada mensagem entregue a uma conexão.
    etiqueta(conexao, peer) {
      if (!leads()) return { mode: 'todos', state: 'TODOS', owner: null, mine: false };
      const c = indice.conversas[peer], d = dono(c);
      return { mode: 'leads', state: d ? 'EM_ATENDIMENTO' : 'NOVO', owner: d ? { id: d.id, label: d.label } : null, mine: !!d && d.id === conexao.id };
    },
    liberarDe,
    // Rotas públicas novas (o protocolo já autenticou a conexão).
    async handle(conexao, req, p, json, res, input) {
      const url = new URL(req.url, 'http://x'), q = (k) => url.searchParams.get(k);
      const alvo = (v) => { const peer = canonico({ phone: v, peer: v }); if (!peer) throw fail('Informe o contato (telefone com DDI e DDD, ou LID).'); return peer; };
      if (req.method === 'GET' && p === '/routing') { json({ mode: leads() ? 'leads' : 'todos', connection: { id: conexao.id, label: conexao.label } }); return true; }
      if (req.method === 'POST' && p === '/claim') { json(assumir(conexao, alvo((await input(req)).to))); return true; }
      if (req.method === 'POST' && p === '/release') { json(liberar(alvo((await input(req)).to), { conexao })); return true; }
      if (req.method === 'GET' && p === '/conversations') {
        // Cada conexão vê os leads (sem dono) e as próprias conversas — nunca as de outra.
        const lista = Object.values(indice.conversas).filter((c) => !leads() || !dono(c) || c.dono === conexao.id)
          .sort((a, b) => String(b.ultima_em || '').localeCompare(String(a.ultima_em || ''))).slice(0, 500).map((c) => resumo(c, conexao));
        json({ mode: leads() ? 'leads' : 'todos', conversations: lista }); return true;
      }
      if (req.method === 'GET' && p === '/messages') {
        const peer = alvo(q('to')), c = indice.conversas[peer], d = dono(c);
        if (leads() && d && d.id !== conexao.id) throw fail(`Este contato está em atendimento por "${d.label}".`, 409);
        const nome = nomeArquivo(peer) + '.jsonl';
        let msgs = [...lerLinhas(path.join(raiz, 'geral', 'conversas', nome)), ...lerLinhas(path.join(raiz, 'conexoes', conexao.id, 'conversas', nome))].sort((a, b) => String(a.em).localeCompare(String(b.em)));
        const antes = q('before'); if (antes) msgs = msgs.filter((r) => String(r.em) < antes);
        const limite = Math.min(200, Math.max(1, Number(q('limit')) || 50));
        json({ peer, messages: msgs.slice(-limite), more: msgs.length > limite }); return true;
      }
      if (req.method === 'GET' && p === '/file') {
        // Só anexos da pasta geral ou da pasta desta conexão.
        const caminho = String(q('path') || '');
        if (!/^(geral|conexoes\/[a-f0-9-]{36})\/arquivos\/\d{4}-\d{2}\/[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(caminho) || (caminho.startsWith('conexoes/') && caminho.split('/')[1] !== conexao.id)) throw fail('Arquivo não encontrado.', 404);
        const arq = path.join(raiz, caminho);
        if (!fs.existsSync(arq)) throw fail('Arquivo não encontrado.', 404);
        const b = fs.readFileSync(arq);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(b); return true;
      }
      return false;
    },
  };

  // ---------- limpeza (retenção) ----------
  // Anexos com mais de retencaoDias saem por mês inteiro; conversas paradas há mais tempo que isso saem do índice e do disco.
  function limpar() {
    const corteMes = new Date(now() - retencaoDias * 86400000).toISOString().slice(0, 7), corte = new Date(now() - retencaoDias * 86400000).toISOString();
    const bases = [path.join(raiz, 'geral'), ...fs.readdirSync(path.join(raiz, 'conexoes')).filter((n) => UUID.test(n)).map((n) => path.join(raiz, 'conexoes', n))];
    for (const base of bases) {
      const arq = path.join(base, 'arquivos');
      if (fs.existsSync(arq)) for (const mes of fs.readdirSync(arq)) if (/^\d{4}-\d{2}$/.test(mes) && mes < corteMes) fs.rmSync(path.join(arq, mes), { recursive: true, force: true });
    }
    for (const c of Object.values(indice.conversas)) {
      if (c.dono || !c.ultima_em || c.ultima_em >= corte) continue;
      for (const base of bases) fs.rmSync(path.join(base, 'conversas', nomeArquivo(c.peer) + '.jsonl'), { force: true });
      delete indice.conversas[c.peer];
    }
    gravarAgora();
  }

  return {
    route, recebida, assumir, liberar, liberarDe, limpar, gravarAgora,
    // Quem está atendendo este contato (null = ninguém; é o que o chatbot consulta antes de responder).
    donoDe: (peer) => (leads() ? dono(indice.conversas[peer]) : null),
    // Para o painel (administração): todas as conversas, com dono.
    listar: () => Object.values(indice.conversas).map((c) => { dono(c); return { ...resumo(c), criada_em: c.criada_em, assumida_em: c.assumida_em || null, finalizada_em: c.finalizada_em || null }; })
      .sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || ''))),
    contar: () => { const l = Object.values(indice.conversas); return { total: l.length, em_atendimento: l.filter((c) => c.dono).length, leads: l.filter((c) => !c.dono && c.estado === 'NOVO').length }; },
    canonico,
  };
};
module.exports.canonico = canonico;

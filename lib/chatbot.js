'use strict';
// Chatbot do conector: atendimento automático por regras, por CONEXÃO (cada empresa tem o seu).
//
// Como funciona, em uma frase: quando chega mensagem de um contato que NINGUÉM está atendendo, o conector
// percorre o fluxo da conexão marcada como "atende novos contatos" e responde sozinho; assim que um atendente
// assume (ou responde pelo próprio celular do número), o fluxo daquele contato para na hora.
//
// O fluxo é um FLUXOGRAMA: uma lista de nós ligados uns aos outros. Cada nó tem um tipo:
//   mensagem    envia um texto e segue sozinho para o próximo nó
//   pergunta    envia um texto com opções e ESPERA a resposta; as regras dizem para onde ir
//   transferir  para o fluxo e deixa a conversa para um atendente humano
//   encerrar    termina o atendimento (com uma mensagem de despedida, se houver)
//   acao        chama um endereço HTTPS do sistema da empresa e usa a resposta dele (texto e próximo nó)
//
// Quem desenha o fluxograma é o sistema da empresa (DMK Prisma, Gestão, etc.) usando a chave que já tem:
// ele lê e grava o fluxo por GET/PUT /bot. O conector é o motor e o dono da verdade — ver docs/CHATBOT.md.
//
// O arquivo guarda apenas: o fluxo de cada conexão (fluxos/<conexão>.json) e em que etapa cada contato está
// (estados.json). O texto das conversas continua no histórico do atendimento.
const fs = require('node:fs'), path = require('node:path');
const fail = (m, status = 400) => Object.assign(Error(m), { status });

// ---------- comparação de texto ----------
// Tira acento, deixa minúsculo e junta espaços: "Não  QUERO" vira "nao quero".
const norma = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const SIM = ['sim', 's', 'claro', 'quero', 'ok', 'certo', 'isso', 'positivo', 'aceito', 'pode', 'yes', 'confirmo', 'confirmar', 'bora', 'vamos'];
const NAO = ['nao', 'n', 'negativo', 'nunca', 'no', 'recuso', 'cancelar', 'cancela', 'deixa', 'depois'];
const comeca = (t, lista) => lista.some((p) => t === p || t.startsWith(p + ' ') || t.startsWith(p + ','));

// Confere UMA condição contra a mensagem que chegou. É comparação de texto, não inteligência artificial:
// "reconhecer o sentido" aqui é a lista de palavras/sinônimos que a empresa escreve na regra.
function combina(quando, ctx) {
  const t = norma(ctx.texto), v = norma(quando?.valor), lista = (Array.isArray(quando?.valores) ? quando.valores : []).map(norma).filter(Boolean);
  switch (String(quando?.tipo || '')) {
    case 'qualquer': return true;
    case 'igual': return !!v && t === v;
    case 'contem': return !!v && t.includes(v);
    case 'comeca': return !!v && t.startsWith(v);
    case 'numero': return !!v && t.replace(/\D/g, '') === v.replace(/\D/g, '') && t.replace(/\D/g, '') !== '';
    case 'sim': return comeca(t, SIM);
    case 'nao': return comeca(t, NAO);
    case 'palavras': return lista.some((p) => t.includes(p)); // sinônimos: "boleto", "fatura", "2 via"
    case 'anexo': return !!ctx.anexo;
    case 'email': return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(ctx.texto || '').trim());
    case 'telefone': return /^\d{10,13}$/.test(String(ctx.texto || '').replace(/\D/g, ''));
    default: return false;
  }
}
const TIPOS_QUANDO = ['qualquer', 'igual', 'contem', 'comeca', 'numero', 'sim', 'nao', 'palavras', 'anexo', 'email', 'telefone'];
const TIPOS_NO = ['mensagem', 'pergunta', 'transferir', 'encerrar', 'acao'];

// Troca {{nome}}, {{telefone}}, {{resposta}} e o que o fluxo tiver guardado.
const preencher = (texto, dados) => String(texto || '').replace(/\{\{\s*([a-z0-9_]{1,30})\s*\}\}/gi, (_, k) => String(dados?.[k.toLowerCase()] ?? '')).trim();

// ---------- conferência do fluxo (nada entra sem passar por aqui) ----------
const ID_NO = /^[a-z0-9_-]{1,40}$/i;
const texto = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
function limparFluxo(f) {
  if (!f || typeof f !== 'object') throw fail('Fluxo inválido.');
  const nos = f.nos && typeof f.nos === 'object' ? f.nos : null;
  if (!nos) throw fail('Informe "nos" com pelo menos um nó.');
  const ids = Object.keys(nos);
  if (!ids.length) throw fail('O fluxo está vazio: crie pelo menos um nó.');
  if (ids.length > 100) throw fail('Limite de 100 nós por fluxo.');
  const limpos = {};
  for (const id of ids) {
    if (!ID_NO.test(id)) throw fail(`Nome de nó inválido: "${id}". Use letras, números, - e _ (até 40).`);
    const n = nos[id] || {}, tipo = String(n.tipo || '');
    if (!TIPOS_NO.includes(tipo)) throw fail(`Nó "${id}": tipo deve ser ${TIPOS_NO.join(', ')}.`);
    const out = { tipo };
    const t = texto(n.texto, 3000); if (t) out.texto = t;
    if (tipo !== 'encerrar' && tipo !== 'transferir' && !t && tipo !== 'acao') throw fail(`Nó "${id}": informe o texto da mensagem.`);
    // Aparência do envio: ler a mensagem do cliente, "digitando…" e uma pausa antes de responder.
    if (n.lido === true) out.lido = true;
    if (n.citar === true) out.citar = true;
    for (const [k, max] of [['digitando', 15000], ['atraso', 15000]]) {
      const v = Math.round(Number(n[k]) || 0);
      if (v < 0 || v > max) throw fail(`Nó "${id}": "${k}" deve ficar entre 0 e ${max} milissegundos.`);
      if (v) out[k] = v;
    }
    // Opções mostradas ao cliente. Cada uma pode levar direto a um nó (sem precisar escrever regra).
    const opcoes = (Array.isArray(n.opcoes) ? n.opcoes : []).slice(0, 10).map((o) => {
      const rotulo = texto(o?.rotulo, 72); if (!rotulo) return null;
      const op = { rotulo };
      if (o?.ir) op.ir = String(o.ir);
      const d = texto(o?.descricao, 72); if (d) op.descricao = d;
      return op;
    }).filter(Boolean);
    if (opcoes.length) out.opcoes = opcoes;
    if (n.estilo && ['texto', 'lista', 'botoes'].includes(n.estilo)) out.estilo = n.estilo;
    // Regras: a primeira que combinar decide o caminho.
    const regras = (Array.isArray(n.regras) ? n.regras : []).slice(0, 20).map((r) => {
      const tipoQ = String(r?.quando?.tipo || '');
      if (!TIPOS_QUANDO.includes(tipoQ)) throw fail(`Nó "${id}": condição "${tipoQ || 'vazia'}" não existe. Use: ${TIPOS_QUANDO.join(', ')}.`);
      if (!r?.ir) throw fail(`Nó "${id}": toda regra precisa do nó de destino ("ir").`);
      const quando = { tipo: tipoQ };
      const v = texto(r.quando.valor, 120); if (v) quando.valor = v;
      const vs = (Array.isArray(r.quando.valores) ? r.quando.valores : []).slice(0, 30).map((x) => texto(x, 60)).filter(Boolean);
      if (vs.length) quando.valores = vs;
      if (tipoQ === 'palavras' && !vs.length) throw fail(`Nó "${id}": a condição "palavras" precisa da lista de palavras.`);
      if (['igual', 'contem', 'comeca', 'numero'].includes(tipoQ) && !v) throw fail(`Nó "${id}": a condição "${tipoQ}" precisa do valor.`);
      return { quando, ir: String(r.ir) };
    });
    if (regras.length) out.regras = regras;
    for (const k of ['proximo', 'senao']) if (n[k]) out[k] = String(n[k]);
    const g = texto(n.guardar, 30).toLowerCase();
    if (g) { if (!/^[a-z0-9_]{1,30}$/.test(g)) throw fail(`Nó "${id}": "guardar" aceita letras, números e _.`); out.guardar = g; }
    if (tipo === 'acao') {
      const url = texto(n.url, 400);
      if (!/^https:\/\/[^\s]+$/i.test(url)) throw fail(`Nó "${id}": a ação precisa de um endereço https do seu sistema.`);
      out.url = url;
      const seg = Math.round(Number(n.espera_seg) || 8);
      if (seg < 1 || seg > 20) throw fail(`Nó "${id}": "espera_seg" deve ficar entre 1 e 20.`);
      out.espera_seg = seg;
      if (n.cabecalho && typeof n.cabecalho === 'object') {
        out.cabecalho = {};
        for (const k of Object.keys(n.cabecalho).slice(0, 5)) if (/^[A-Za-z0-9-]{1,40}$/.test(k)) out.cabecalho[k] = texto(n.cabecalho[k], 200);
      }
      if (n.ir_erro) out.ir_erro = String(n.ir_erro);
    }
    if (tipo === 'pergunta' && !regras.length && !opcoes.some((o) => o.ir)) throw fail(`Nó "${id}": uma pergunta precisa de regras ou de opções com destino.`);
    limpos[id] = out;
  }
  // Todo destino precisa existir — é o que impede o fluxograma de apontar para o vazio.
  const existe = (alvo, onde) => { if (alvo && !limpos[alvo]) throw fail(`${onde} aponta para o nó "${alvo}", que não existe.`); };
  for (const [id, n] of Object.entries(limpos)) {
    existe(n.proximo, `Nó "${id}" ("próximo")`); existe(n.senao, `Nó "${id}" ("senão")`); existe(n.ir_erro, `Nó "${id}" ("ir_erro")`);
    for (const r of n.regras || []) existe(r.ir, `Nó "${id}" (regra "${r.quando.tipo}")`);
    for (const o of n.opcoes || []) existe(o.ir, `Nó "${id}" (opção "${o.rotulo}")`);
  }
  const inicio = String(f.inicio || ids[0]);
  if (!limpos[inicio]) throw fail(`O nó inicial "${inicio}" não existe.`);
  const c = f.config && typeof f.config === 'object' ? f.config : {};
  const config = {
    inativo_min: Math.min(1440, Math.max(1, Math.round(Number(c.inativo_min) || 30))),
    maximo_erros: Math.min(5, Math.max(0, Math.round(Number.isFinite(Number(c.maximo_erros)) ? Number(c.maximo_erros) : 2))),
    palavra_atendente: (Array.isArray(c.palavra_atendente) ? c.palavra_atendente : ['atendente', 'humano', 'pessoa']).slice(0, 10).map((x) => texto(x, 40)).filter(Boolean),
    ir_atendente: c.ir_atendente ? String(c.ir_atendente) : '',
    texto_transferencia: texto(c.texto_transferencia, 500) || 'Certo! Já estou chamando um atendente. É só aguardar aqui.',
  };
  if (config.ir_atendente && !limpos[config.ir_atendente]) throw fail(`"ir_atendente" aponta para o nó "${config.ir_atendente}", que não existe.`);
  return { nome: texto(f.nome, 80) || 'Atendimento automático', inicio, config, nos: limpos };
}

// ---------- modelos prontos (a empresa copia e edita) ----------
const MODELOS = {
  departamentos: {
    nome: 'Menu por departamento', inicio: 'menu',
    config: { inativo_min: 30, maximo_erros: 2, palavra_atendente: ['atendente', 'humano'], ir_atendente: '', texto_transferencia: 'Certo! Já estou chamando um atendente. É só aguardar aqui.' },
    nos: {
      menu: { tipo: 'pergunta', texto: 'Olá, {{nome}}! Sou o atendimento automático. Como posso ajudar?\n1 - Suporte\n2 - Financeiro\n3 - Falar com atendente', estilo: 'botoes', lido: true, digitando: 1200,
        opcoes: [{ rotulo: 'Suporte', ir: 'suporte' }, { rotulo: 'Financeiro', ir: 'financeiro' }, { rotulo: 'Atendente', ir: 'humano' }],
        regras: [{ quando: { tipo: 'palavras', valores: ['suporte', 'problema', 'nao funciona', 'sem sinal'] }, ir: 'suporte' },
                 { quando: { tipo: 'palavras', valores: ['financeiro', 'boleto', 'fatura', 'pagamento', '2 via'] }, ir: 'financeiro' }], senao: 'nao_entendi' },
      suporte: { tipo: 'pergunta', texto: 'Me conte em uma frase o que está acontecendo, por favor.', digitando: 900, guardar: 'problema',
        regras: [{ quando: { tipo: 'qualquer' }, ir: 'humano' }] },
      financeiro: { tipo: 'pergunta', texto: 'Posso enviar a sua fatura em aberto?', estilo: 'botoes', digitando: 900,
        opcoes: [{ rotulo: 'Sim', ir: 'humano' }, { rotulo: 'Não', ir: 'fim' }],
        regras: [{ quando: { tipo: 'sim' }, ir: 'humano' }, { quando: { tipo: 'nao' }, ir: 'fim' }], senao: 'nao_entendi' },
      nao_entendi: { tipo: 'mensagem', texto: 'Desculpe, não entendi. Vou te mostrar as opções de novo.', digitando: 700, proximo: 'menu' },
      humano: { tipo: 'transferir', texto: 'Perfeito! Já estou chamando um atendente. É só aguardar aqui.' },
      fim: { tipo: 'encerrar', texto: 'Obrigado pelo contato! Se precisar, é só chamar.' },
    },
  },
  fora_do_horario: {
    nome: 'Recado fora do horário', inicio: 'aviso',
    config: { inativo_min: 60, maximo_erros: 1, palavra_atendente: ['atendente'], ir_atendente: '', texto_transferencia: 'Vou deixar seu recado com a equipe.' },
    nos: {
      aviso: { tipo: 'pergunta', texto: 'Olá, {{nome}}! Nosso atendimento está fora do horário agora. Quer deixar um recado?', estilo: 'botoes', lido: true, digitando: 1000,
        opcoes: [{ rotulo: 'Sim', ir: 'recado' }, { rotulo: 'Não', ir: 'fim' }],
        regras: [{ quando: { tipo: 'sim' }, ir: 'recado' }, { quando: { tipo: 'nao' }, ir: 'fim' }], senao: 'recado' },
      recado: { tipo: 'pergunta', texto: 'Pode escrever aqui. Assim que abrirmos, a equipe responde.', digitando: 800, guardar: 'recado',
        regras: [{ quando: { tipo: 'qualquer' }, ir: 'anotado' }] },
      anotado: { tipo: 'transferir', texto: 'Anotado, obrigado! A equipe responde no próximo horário de atendimento.' },
      fim: { tipo: 'encerrar', texto: 'Tudo bem! Quando precisar, é só chamar.' },
    },
  },
};

module.exports = function criarChatbot({ pasta, conector, atendimento, enviar, presenca, lido, aoEnviar, buscar = fetch, log = console, now = Date.now }) {
  const raiz = path.join(pasta, 'chatbot'), dirFluxos = path.join(raiz, 'fluxos');
  fs.mkdirSync(dirFluxos, { recursive: true, mode: 0o700 });
  const arqEstados = path.join(raiz, 'estados.json');
  let estados = {};
  try { if (fs.existsSync(arqEstados)) estados = JSON.parse(fs.readFileSync(arqEstados, 'utf8')) || {}; } catch (e) { log.error('[chatbot] estados ilegíveis, recomeçando vazio:', e.message); }
  const gravarEstados = () => { const tmp = arqEstados + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(estados), { mode: 0o600 }); fs.renameSync(tmp, arqEstados); };

  const arqFluxo = (gid) => path.join(dirFluxos, gid + '.json');
  const ler = (gid) => { try { return JSON.parse(fs.readFileSync(arqFluxo(gid), 'utf8')); } catch { return null; } };
  function gravar(gid, dados) {
    const tmp = arqFluxo(gid) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados), { mode: 0o600 });
    fs.renameSync(tmp, arqFluxo(gid));
  }
  const vazio = (gid) => ({ ativo: false, atende_novos: false, fluxo: null, atualizado_em: null, conexao: gid });
  const doConector = (gid) => ler(gid) || vazio(gid);

  // Só uma conexão por sessão responde os contatos novos — senão duas responderiam o mesmo cliente.
  function quemAtendeNovos() {
    for (const g of conector().list()) {
      if (g.revoked_at) continue;
      const b = ler(g.id);
      if (b?.ativo && b.atende_novos && b.fluxo) return { grant: g, bot: b };
    }
    return null;
  }

  // ---------- execução ----------
  const chave = (peer) => String(peer || '');
  function pausar(ms) { return ms > 0 ? new Promise((r) => setTimeout(r, Math.min(15000, ms))) : Promise.resolve(); }

  async function responder(no, ctx, estado) {
    const corpo = preencher(no.texto, estado.dados);
    if (!corpo) return null;
    if (no.lido && ctx.messageId) await lido(ctx.peer, [ctx.messageId]).catch(() => {});
    if (no.atraso) await pausar(no.atraso);
    if (no.digitando) {
      await presenca(ctx.peer, 'composing').catch(() => {});
      await pausar(no.digitando);
      await presenca(ctx.peer, 'paused').catch(() => {});
    }
    const opcoes = {};
    if (no.citar && ctx.messageId) opcoes.replyToExternalId = ctx.messageId, opcoes.replyQuote = { fromMe: false, body: String(ctx.texto || '').slice(0, 200) };
    if (no.opcoes?.length && no.estilo && no.estilo !== 'texto') {
      opcoes.interactive = { style: no.estilo, body: corpo, items: no.opcoes.map((o, i) => ({ id: 'op' + (i + 1), label: o.rotulo })) };
    }
    const out = await enviar(ctx.peer, corpo, opcoes);
    await aoEnviar(ctx.peer, out?.externalId, corpo, estado.conexao).catch(() => {});
    return out;
  }

  // Chama o sistema da empresa e usa a resposta: { texto?, ir?, dados? }
  async function chamarAcao(no, ctx, estado) {
    const corpo = JSON.stringify({ peer: ctx.peer, phone: ctx.phone || '', name: ctx.name || '', text: ctx.texto || '', node: estado.no, data: estado.dados || {} });
    const r = await buscar(no.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(no.cabecalho || {}) }, body: corpo, signal: AbortSignal.timeout(no.espera_seg * 1000) });
    if (!r.ok) throw Error('resposta ' + r.status);
    const j = await r.json();
    return j && typeof j === 'object' ? j : {};
  }

  // Decide o próximo nó a partir da resposta do cliente.
  function destino(no, ctx) {
    for (const r of no.regras || []) if (combina(r.quando, ctx)) return r.ir;
    const t = norma(ctx.texto);
    const porNumero = Number(t.replace(/\D/g, ''));
    const lista = (no.opcoes || []).filter((o) => o.ir);
    if (porNumero >= 1 && porNumero <= lista.length && t.replace(/\D/g, '') === String(porNumero)) return lista[porNumero - 1].ir;
    const porTexto = lista.find((o) => norma(o.rotulo) === t);
    if (porTexto) return porTexto.ir;
    return null;
  }

  async function transferir(ctx, estado, no) {
    const bot = doConector(estado.conexao);
    const msg = preencher(no?.texto || bot.fluxo?.config?.texto_transferencia, estado.dados);
    if (msg) await responder({ ...no, texto: msg }, ctx, estado).catch((e) => log.error('[chatbot] aviso de transferência:', e.message));
    delete estados[chave(ctx.peer)];
    gravarEstados();
    conector().notify('bot', { peer: ctx.peer, phone: ctx.phone || '', action: 'transferir', data: estado.dados || {} }, () => true, 'bot');
  }

  // Entrada principal: uma mensagem que chegou do WhatsApp.
  async function aoReceber(ctx) {
    const peer = chave(ctx.peer);
    if (!peer) return false;
    const estado = estados[peer];
    // Mensagem escrita no próprio celular do número (atendente humano respondeu): o fluxo para na hora.
    if (ctx.outgoing) {
      if (estado) { delete estados[peer]; gravarEstados(); conector().notify('bot', { peer, action: 'parou', motivo: 'atendente respondeu' }, () => true, 'bot'); }
      return false;
    }
    // Conversa que já tem atendente humano: o chatbot não entra.
    if (atendimento.donoDe(peer)) { if (estado) { delete estados[peer]; gravarEstados(); } return false; }

    let bot, grant;
    if (estado) {
      grant = conector().grantById(estado.conexao);
      bot = grant ? doConector(estado.conexao) : null;
      if (!bot?.ativo || !bot.fluxo) { delete estados[peer]; gravarEstados(); return false; }
    } else {
      const escolhido = quemAtendeNovos();
      if (!escolhido) return false;
      grant = escolhido.grant; bot = escolhido.bot;
      // "novo": a primeira mensagem do contato não é resposta de pergunta nenhuma — ela só abre o fluxo.
      estados[peer] = { conexao: grant.id, no: bot.fluxo.inicio, em: now(), erros: 0, dados: {}, novo: true };
    }
    const atual = estados[peer];
    atual.dados = { ...atual.dados, nome: ctx.name || atual.dados?.nome || '', telefone: ctx.phone || '', resposta: String(ctx.texto || '') };
    // Parado há muito tempo: recomeça do início em vez de responder fora de contexto.
    if (now() - (atual.em || 0) > bot.fluxo.config.inativo_min * 60000) { atual.no = bot.fluxo.inicio; atual.erros = 0; }

    const pedeAtendente = (bot.fluxo.config.palavra_atendente || []).some((p) => norma(ctx.texto).includes(norma(p)));
    try {
      if (pedeAtendente) {
        const alvo = bot.fluxo.config.ir_atendente;
        if (alvo) { atual.no = alvo; } else { await transferir(ctx, atual, null); return true; }
      } else if (!atual.novo) {
        const no = bot.fluxo.nos[atual.no];
        if (no && no.tipo === 'pergunta') {
          if (no.guardar) atual.dados[no.guardar] = String(ctx.texto || '').slice(0, 500);
          const ir = destino(no, ctx);
          if (ir) { atual.no = ir; atual.erros = 0; }
          else {
            atual.erros = (atual.erros || 0) + 1;
            if (atual.erros > bot.fluxo.config.maximo_erros) { await transferir(ctx, atual, null); return true; }
            atual.no = no.senao || atual.no;
            if (!no.senao) { await responder(no, ctx, atual); atual.em = now(); gravarEstados(); return true; }
          }
        }
      }
      // Caminha pelo fluxograma até parar numa pergunta (ou terminar).
      for (let passo = 0; passo < 12; passo++) {
        const no = bot.fluxo.nos[atual.no];
        if (!no) { delete estados[peer]; gravarEstados(); return true; }
        if (no.tipo === 'transferir') { await transferir(ctx, atual, no); return true; }
        if (no.tipo === 'encerrar') {
          if (no.texto) await responder(no, ctx, atual);
          delete estados[peer]; gravarEstados();
          conector().notify('bot', { peer, phone: ctx.phone || '', action: 'encerrou', data: atual.dados }, () => true, 'bot');
          return true;
        }
        if (no.tipo === 'acao') {
          let r = {};
          try { r = await chamarAcao(no, ctx, atual); }
          catch (e) {
            log.error(`[chatbot] ação "${atual.no}" falhou:`, e.message);
            if (no.ir_erro) { atual.no = no.ir_erro; continue; }
            await transferir(ctx, atual, null); return true;
          }
          if (r.dados && typeof r.dados === 'object') for (const [k, v] of Object.entries(r.dados).slice(0, 20)) atual.dados[String(k).toLowerCase().slice(0, 30)] = String(v ?? '').slice(0, 500);
          if (r.texto) await responder({ ...no, texto: String(r.texto).slice(0, 3000) }, ctx, atual);
          const ir = r.ir && bot.fluxo.nos[r.ir] ? r.ir : no.proximo;
          if (!ir) { delete estados[peer]; gravarEstados(); return true; }
          atual.no = ir; continue;
        }
        await responder(no, ctx, atual);
        if (no.tipo === 'pergunta') break;
        if (!no.proximo) { delete estados[peer]; gravarEstados(); return true; }
        atual.no = no.proximo;
      }
      atual.novo = false; atual.em = now(); gravarEstados();
      return true;
    } catch (e) {
      log.error('[chatbot] falha ao atender:', e.message);
      return false;
    }
  }

  // Quando um atendente assume a conversa, o fluxo daquele contato acaba.
  function pararPara(peer) {
    const k = chave(peer);
    if (!estados[k]) return false;
    delete estados[k]; gravarEstados();
    return true;
  }

  const estadoPublico = ([peer, e]) => ({ peer, conexao: e.conexao, node: e.no, since: new Date(e.em).toISOString(), erros: e.erros || 0, dados: e.dados || {} });
  const listarEstados = (gid) => Object.entries(estados).filter(([, e]) => !gid || e.conexao === gid).map(estadoPublico)
    .sort((a, b) => b.since.localeCompare(a.since));

  // ---------- rotas do sistema da empresa (já autenticado pelo token da conexão) ----------
  async function rotas(conexao, req, p, json, res, input) {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && p === '/bot') { const b = doConector(conexao.id); json({ ...b, modelos: Object.keys(MODELOS) }); return true; }
    if (req.method === 'GET' && p === '/bot/modelos') { json({ modelos: MODELOS }); return true; }
    if (req.method === 'PUT' && p === '/bot') {
      const b = await input(req), atual = doConector(conexao.id);
      const fluxo = b.fluxo === null ? null : limparFluxo(b.fluxo);
      const novo = { ...atual, conexao: conexao.id, fluxo, atualizado_em: new Date(now()).toISOString() };
      if (typeof b.ativo === 'boolean') novo.ativo = b.ativo;
      if (typeof b.atende_novos === 'boolean') novo.atende_novos = b.atende_novos;
      if (novo.ativo && !fluxo) throw fail('Não dá para ativar sem um fluxo.');
      if (novo.atende_novos) desmarcarOutros(conexao.id);
      gravar(conexao.id, novo);
      json(novo); return true;
    }
    if (req.method === 'POST' && p === '/bot/ativar') {
      const b = await input(req), atual = doConector(conexao.id);
      if (b.ativo !== false && !atual.fluxo) throw fail('Grave um fluxo antes de ativar.');
      atual.ativo = b.ativo !== false;
      if (typeof b.atende_novos === 'boolean') atual.atende_novos = b.atende_novos;
      if (atual.ativo && atual.atende_novos) desmarcarOutros(conexao.id);
      gravar(conexao.id, atual); json(atual); return true;
    }
    if (req.method === 'GET' && p === '/bot/estados') { json({ states: listarEstados(conexao.id) }); return true; }
    if (req.method === 'POST' && p === '/bot/sair') {
      const b = await input(req), peer = atendimento.canonico({ phone: b.to, peer: b.to });
      if (!peer) throw fail('Informe o contato.');
      json({ ok: pararPara(peer) }); return true;
    }
    return false;
  }
  function desmarcarOutros(gid) {
    for (const g of conector().list()) {
      if (g.id === gid) continue;
      const b = ler(g.id);
      if (b?.atende_novos) { b.atende_novos = false; gravar(g.id, b); }
    }
  }

  return {
    aoReceber, pararPara, rotas, limparFluxo, listarEstados, MODELOS,
    // painel (administração)
    resumo: () => conector().list().filter((g) => !g.revoked_at).map((g) => {
      const b = doConector(g.id);
      return { conexao: g.id, label: g.label, ativo: !!b.ativo, atende_novos: !!b.atende_novos, nos: b.fluxo ? Object.keys(b.fluxo.nos).length : 0, nome: b.fluxo?.nome || '', atualizado_em: b.atualizado_em, em_fluxo: listarEstados(g.id).length };
    }),
    estados: () => listarEstados(),
    definir: (gid, dados) => {
      const g = conector().grantById(gid); if (!g) throw fail('Conexão não encontrada ou revogada.', 404);
      const atual = doConector(gid);
      if (dados.modelo) { if (!MODELOS[dados.modelo]) throw fail('Modelo não encontrado.', 404); atual.fluxo = limparFluxo(MODELOS[dados.modelo]); atual.atualizado_em = new Date(now()).toISOString(); }
      if (typeof dados.ativo === 'boolean') { if (dados.ativo && !atual.fluxo) throw fail('Esta conexão ainda não tem fluxo. Copie um modelo ou monte o fluxo no sistema da empresa.'); atual.ativo = dados.ativo; }
      if (typeof dados.atende_novos === 'boolean') atual.atende_novos = dados.atende_novos;
      if (atual.ativo && atual.atende_novos) desmarcarOutros(gid);
      gravar(gid, atual);
      return { ...atual, label: g.label };
    },
    // o atendimento avisa quando um humano assume
    aoAssumir: pararPara,
  };
};
module.exports.limparFluxoDe = limparFluxo;
module.exports.combina = combina;
module.exports.preencher = preencher;

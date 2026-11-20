'use strict';
// Painel do DMK WhatsApp. Sem framework: um arquivo só, fala com /admin/v1 usando a chave guardada
// nesta aba (sessionStorage — some ao fechar a aba; nunca vai para localStorage nem para o servidor
// fora do cabeçalho Authorization).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const telaEntrada = $('#entrada'), tela = $('#tela'), fundo = $('#fundo');
  let chave = '';
  let sessoes = [];
  let filtroTexto = '';
  let filtroEstados = new Set(); // vazio = todos
  let atualizando = null;

  function avisar(mensagem) {
    const t = $('#toast'); $('#toastTexto').textContent = mensagem; t.hidden = false;
    try { new (window.AudioContext || window.webkitAudioContext)().close(); } catch {}
    clearTimeout(avisar._t); avisar._t = setTimeout(() => { t.hidden = true; }, 5000);
  }
  async function api(metodo, caminho, corpo) {
    let r;
    try { r = await fetch('/admin/v1' + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + chave, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined }); }
    catch { throw Error('Não consegui falar com o conector. Confira se o serviço está ativo.'); }
    if (r.status === 401) { entrar(''); throw Error('Chave de administrador inválida.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || `Erro ${r.status}`);
    return j;
  }
  const chamar = (metodo, caminho, corpo, botao) => {
    if (botao) botao.disabled = true;
    return api(metodo, caminho, corpo).catch((e) => { avisar(e.message); throw e; }).finally(() => { if (botao) botao.disabled = false; });
  };

  // ---------- entrada ----------
  function entrar(valor) {
    chave = valor;
    if (valor) { sessionStorage.setItem('dmk-wa-chave', valor); telaEntrada.hidden = true; tela.hidden = false; iniciar(); }
    else { sessionStorage.removeItem('dmk-wa-chave'); telaEntrada.hidden = false; tela.hidden = true; clearInterval(atualizando); }
  }
  $('#formEntrada').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = $('#chave').value.trim();
    chave = valor; // precisa estar valendo antes do teste, senão a chamada abaixo sempre vai sem chave (Bearer vazio) e qualquer chave digitada parece errada
    try { await api('GET', '/sessoes'); } catch (e) {
      chave = ''; if (!/inválida/.test(e.message)) return avisar(e.message); return avisar('Chave incorreta.');
    }
    entrar(valor);
  });
  $('#btSair').addEventListener('click', () => entrar(''));

  // Copiar com retorno visual (o ícone vira um check por um instante). Sem avisos nativos; se o
  // navegador negar a área de transferência, o texto fica selecionado para copiar com Ctrl+C.
  async function copiar(texto, bt) {
    // 1.3.5: alguns navegadores (janela embutida, aba sem permissão) negam navigator.clipboard e o botão não fazia
    // nada. Segunda tentativa pelo método antigo, com um campo temporário; se as duas falharem, avisa o que fazer.
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; } catch {}
    if (!ok) {
      const t = document.createElement('textarea'); t.value = texto; t.setAttribute('readonly', ''); t.className = 'fora-da-tela';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, texto.length);
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
    }
    if (!ok) { avisar('O navegador não deixou copiar. O texto ficou selecionado: aperte Ctrl+C.'); return false; }
    if (bt) { const use = bt.querySelector('use'), antes = use.getAttribute('href'); use.setAttribute('href', '#i-ok'); bt.classList.add('copiado'); setTimeout(() => { use.setAttribute('href', antes); bt.classList.remove('copiado'); }, 1600); }
    return true;
  }
  $('#btCopiarComando').addEventListener('click', async () => { if (!await copiar($('#cmdChave').value, $('#btCopiarComando'))) $('#cmdChave').select(); });

  // ---------- atualização do conector pelo painel ----------
  // GET /atualizacao compara as versões; POST grava o pedido que o systemd (root) atende com o
  // atualizar.sh de sempre (backup e volta automática). Aqui só acompanhamos pelo /health.
  $('#btAtualizacao').addEventListener('click', () => {
    const m = abrirModal({ titulo: 'Atualização do conector', estreito: true, corpo: `
      <div class="dados">
        <div class="dado"><span>Instalada</span><b data-at-atual>…</b></div>
        <div class="dado"><span>Publicada</span><b data-at-nova>consultando…</b></div>
      </div>
      <p class="aviso" data-at-aviso hidden></p>
      <p class="nota">A atualização guarda backup e, se algo não voltar, o conector repõe a versão anterior sozinho. As sessões reconectam com a credencial salva.</p>`,
      rodape: [
        { texto: 'Buscar de novo', onClick: (mm, bt) => consultarAtualizacao(mm, bt) },
        { texto: 'Atualizar agora', principal: true, onClick: (mm, bt) => pedirAtualizacao(mm, bt) },
      ] });
    $('[data-acao="1"]', m).disabled = true;
    consultarAtualizacao(m);
  });
  async function consultarAtualizacao(m, bt) {
    const aviso = $('[data-at-aviso]', m); aviso.hidden = true; aviso.className = 'aviso';
    try {
      const e = await chamar('GET', '/atualizacao', null, bt);
      $('[data-at-atual]', m).textContent = e.versao_atual;
      $('[data-at-nova]', m).textContent = e.versao_nova || '—';
      $('[data-acao="1"]', m).disabled = !(e.ha_nova && e.gatilho_pronto);
      if (e.erro) { aviso.textContent = e.erro; aviso.hidden = false; }
      else if (!e.ha_nova) { aviso.textContent = 'Já está na versão mais nova.'; aviso.classList.add('ok'); aviso.hidden = false; }
      else if (!e.gatilho_pronto) { aviso.textContent = 'Há versão nova, mas o gatilho ainda não existe nesta VPS. Rode uma vez, como root: bash /opt/dmk-whatsapp/instalar/atualizar.sh — das próximas vezes este botão resolve sozinho.'; aviso.hidden = false; }
      else { aviso.textContent = 'Versão nova disponível. A atualização leva por volta de um minuto e o painel reconecta sozinho.'; aviso.hidden = false; }
    } catch {}
  }
  async function pedirAtualizacao(m, bt) {
    if (m.dataset.pronta) return location.reload();
    const aviso = $('[data-at-aviso]', m), daqui = $('[data-at-atual]', m).textContent;
    const r = await chamar('POST', '/atualizacao', {}, bt).catch(() => null); if (!r) return;
    bt.disabled = true; $('[data-acao="0"]', m).disabled = true;
    aviso.className = 'aviso'; aviso.hidden = false;
    aviso.textContent = `Atualizando ${r.de} → ${r.para}… O conector reinicia sozinho; esta tela avisa quando terminar.`;
    const inicio = Date.now();
    const olhar = async () => {
      if (!document.body.contains(m)) return;
      try {
        const h = await (await fetch('/health', { cache: 'no-store' })).json();
        if (h.versao && h.versao !== daqui) {
          m.dataset.pronta = '1'; aviso.className = 'aviso ok';
          aviso.textContent = `Atualizado para ${h.versao}. Recarregue a página para ver tudo novo.`;
          const b1 = $('[data-acao="1"]', m); b1.textContent = 'Recarregar'; b1.disabled = false; return;
        }
      } catch {}
      if (Date.now() - inicio > 5 * 60000) { aviso.className = 'aviso perigo'; aviso.textContent = 'Não concluiu em 5 minutos — pode ter voltado sozinha para a versão anterior. Na VPS: journalctl -u dmk-wa-atualizar -n 40 --no-pager'; return; }
      setTimeout(olhar, 3000);
    };
    setTimeout(olhar, 5000);
  }

  // ---------- carregar / render ----------
  const ESTADOS = { CONECTADO: ['Conectado', 'on'], AGUARDANDO_QR: ['Aguardando QR', 'qr'], INICIANDO: ['Iniciando', 'qr'], RECONECTANDO: ['Reconectando', 'qr'], DESCONECTADO: ['Desconectado', 'off'], SUBSTITUIDA: ['Aberta em outro lugar', 'erro'], ERRO: ['Erro', 'erro'] };
  function selo(estado) { const [texto, classe] = ESTADOS[estado] || [estado, 'off']; return `<span class="selo ${classe}">${texto}</span>`; }
  function kpis() {
    const total = sessoes.length, conectadas = sessoes.filter((s) => s.status === 'CONECTADO').length;
    const sistemas = sessoes.reduce((n, s) => n + s.autorizacoes, 0), fila = sessoes.reduce((n, s) => n + s.eventos_pendentes, 0);
    const erro = sessoes.filter((s) => s.erro).length;
    $('#kpis').innerHTML = [
      ['i-wifi', total, 'sessão(ões)'], ['i-fone', conectadas, 'conectada(s)'],
      ['i-chave', sistemas, 'sistema(s) ligado(s)'], ['i-fila', fila, 'evento(s) na fila'],
      ['i-alerta', erro, 'com erro'],
    ].map(([icone, numero, rotulo]) => `<div class="kpi"><svg><use href="#${icone}"/></svg><div><b>${numero}</b><span>${rotulo}</span></div></div>`).join('');
  }
  function linhas() {
    const termo = filtroTexto.trim().toLowerCase();
    return sessoes.filter((s) => (!filtroEstados.size || filtroEstados.has(s.status)) &&
      (!termo || [s.id, s.nome, s.dono, s.telefone].some((v) => String(v || '').toLowerCase().includes(termo))));
  }
  function render() {
    kpis();
    const lista = linhas();
    $('#corpo').innerHTML = lista.map((s) => `<tr data-id="${s.id}">
      <td class="id">${s.id}</td><td>${selo(s.status)}</td><td>${s.telefone || '—'}</td>
      <td>${esc(s.dono)}</td><td>${esc(s.nome)}</td><td class="num">${s.autorizacoes}</td><td class="num">${s.eventos_pendentes}</td>
    </tr>`).join('');
    $('#vazio').hidden = lista.length > 0;
    $('#vazio').textContent = sessoes.length ? 'Nenhuma sessão com esse filtro.' : 'Nenhuma sessão. Clique em "Nova sessão".';
    $('#contaFiltros').hidden = !filtroEstados.size; $('#contaFiltros').textContent = filtroEstados.size;
    $$('#corpo tr').forEach((tr) => tr.addEventListener('click', () => abrirFicha(Number(tr.dataset.id))));
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function carregar() {
    const { sessoes: lista } = await api('GET', '/sessoes');
    sessoes = lista.slice().sort((a, b) => a.id - b.id); render();
    const aberto = $('.modal[data-id]');
    if (aberto) { const id = Number(aberto.dataset.id); atualizarFichaAberta(id); atualizarQrSeNecessario(id); }
  }
  function iniciar() {
    fetch('/health').then((r) => r.json()).then((j) => { $('#versao').textContent = 'v' + j.versao + (j.simulado ? ' · SIMULADO' : ''); }).catch(() => {});
    const tentar = () => carregar().then(() => $('#pontoServico').classList.remove('off')).catch((e) => { $('#pontoServico').classList.add('off'); avisar(e.message); });
    tentar();
    clearInterval(atualizando); atualizando = setInterval(tentar, 4000);
  }
  $('#btAtualizar').addEventListener('click', () => carregar().catch((e) => avisar(e.message)));
  $('#busca').addEventListener('input', (ev) => { filtroTexto = ev.target.value; render(); });

  // ---------- filtros (diálogo único do sistema) ----------
  function abrirFiltros() {
    const atual = new Set(filtroEstados);
    // Sem caixa de marcar do navegador (saía gigante e desalinhada, herdando o estilo dos campos de texto):
    // cada estado é um botão de liga/desliga com o mesmo selo colorido da lista.
    const m = abrirModal({ titulo: 'Filtros', icone: 'filtro', estreito: true, corpo: `<div class="campos">
      <div class="campo"><label>Estado da sessão</label><div class="opcoes-filtro" role="group" aria-label="Estado da sessão">${Object.keys(ESTADOS).map((valor) =>
        `<button type="button" class="opcao-filtro" data-valor="${valor}" aria-pressed="${atual.has(valor)}"><span class="marca-filtro"><svg><use href="#i-ok"/></svg></span>${selo(valor)}</button>`).join('')}</div>
        <span class="dica">Toque nos estados que quer ver. Sem nenhum marcado, a lista mostra todos.</span></div>
    </div>`, rodape: [
      { texto: 'Limpar', onClick: (mm) => { filtroEstados = new Set(); render(); mm.remove(); fundo.hidden = true; } },
      { texto: 'Aplicar', principal: true, onClick: (mm) => {
        filtroEstados = new Set($$('.opcao-filtro[aria-pressed=true]', mm).map((c) => c.dataset.valor)); render(); mm.remove(); fundo.hidden = true; } },
    ] });
    $$('.opcao-filtro', m).forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
  }
  $('#btFiltros').addEventListener('click', abrirFiltros);

  // ---------- modal genérico ----------
  function abrirModal({ titulo, corpo, rodape = [], estreito = false, id, icone = 'marca', abas = '' }) {
    fundo.hidden = false;
    const m = document.createElement('div'); m.className = 'modal' + (estreito ? ' estreito' : ''); if (id) m.dataset.id = id;
    // Cabeçalho padrão: ícone + título + fechar. Abas (quando há) ficam numa faixa própria, fora do corpo que rola.
    // Sem botões, não há rodapé (antes sobrava uma faixa vazia esticada embaixo da ficha).
    m.innerHTML = `<header><span class="chip-modal"><svg><use href="#i-${icone}"/></svg></span><h2>${esc(titulo)}</h2><button class="bt bt-icone" data-fechar title="Fechar" aria-label="Fechar"><svg><use href="#i-fechar"/></svg></button></header>
      ${abas}<div class="corpo-modal">${corpo}</div>
      ${rodape.length ? `<footer>${rodape.map((b, i) => `<button class="bt ${b.principal ? 'bt-principal' : ''} ${b.perigo ? 'bt-perigo' : ''}" data-acao="${i}">${esc(b.texto)}</button>`).join('')}</footer>` : ''}`;
    document.body.appendChild(m);
    const fechar = () => { m.remove(); if (!$('.modal')) fundo.hidden = true; };
    $('[data-fechar]', m).addEventListener('click', fechar);
    fundo.onclick = () => $$('.modal').forEach((x) => { if (x === document.body.lastElementChild) fechar(); });
    rodape.forEach((b, i) => $(`[data-acao="${i}"]`, m).addEventListener('click', (ev) => b.onClick(m, ev.currentTarget)));
    return m;
  }

  // ---------- nova sessão ----------
  $('#btNova').addEventListener('click', () => {
    const m = abrirModal({ titulo: 'Nova sessão', estreito: true, corpo: `<div class="campos">
      <div class="campo"><label for="novoNome">Nome</label><input id="novoNome" maxlength="60" placeholder='Ex.: "Atendimento"'></div>
      <div class="campo"><label for="novoDono">Sistema dono</label><input id="novoDono" maxlength="40" placeholder="Ex.: gestao, smartcore, prisma-loja1">
        <span class="dica">Minúsculas, números e hífen. Cada sistema diferente usa um nome diferente.</span></div>
    </div>`, rodape: [{ texto: 'Criar', principal: true, onClick: async (mm, bt) => {
      const nome = $('#novoNome', mm).value.trim(), dono = $('#novoDono', mm).value.trim();
      if (!nome || !dono) return avisar('Informe nome e sistema dono.');
      const s = await chamar('POST', '/sessoes', { nome, dono }, bt); mm.remove(); fundo.hidden = true; await carregar(); abrirFicha(s.id);
    } }] });
    $('#novoNome', m).focus();
  });

  // ---------- ficha da sessão (abas) ----------
  async function abrirFicha(id) {
    const s = sessoes.find((x) => x.id === id); if (!s) return;
    const m = abrirModal({ titulo: `${s.nome} · sessão ${s.id}`, id, icone: 'fone', abas: `
      <div class="abas" role="tablist">
        <button class="aba" role="tab" aria-selected="true" data-aba="geral">Geral</button>
        <button class="aba" role="tab" aria-selected="false" data-aba="atendimentos">Atendimentos</button>
        <button class="aba" role="tab" aria-selected="false" data-aba="sistemas">Sistemas ligados</button>
      </div>`, corpo: `
      <div data-painel="geral"></div><div data-painel="atendimentos" hidden></div><div data-painel="sistemas" hidden></div>`, rodape: [] });
    $$('.aba', m).forEach((a) => a.addEventListener('click', () => {
      $$('.aba', m).forEach((x) => x.setAttribute('aria-selected', String(x === a)));
      $$('[data-painel]', m).forEach((p) => p.hidden = p.dataset.painel !== a.dataset.aba);
      if (a.dataset.aba === 'sistemas') carregarAutorizacoes(m, id);
      if (a.dataset.aba === 'atendimentos') carregarAtendimentos(m, id, true);
    }));
    desenharGeral(m, s);
    atualizarFichaAberta(id);
    atualizarQrSeNecessario(id);
  }
  // A lista (GET /sessoes, usada no polling) não traz o QR; só o detalhe de uma sessão (GET /sessoes/:id) traz.
  // Por isso, com a ficha aberta e aguardando QR, busca o detalhe à parte em vez de confiar só na lista.
  async function atualizarQrSeNecessario(id) {
    const s = sessoes.find((x) => x.id === id);
    if (!s || s.status !== 'AGUARDANDO_QR') return;
    try { Object.assign(s, await api('GET', `/sessoes/${id}`)); atualizarFichaAberta(id); } catch {}
  }
  function desenharGeral(m, s) {
    const painel = $('[data-painel=geral]', m);
    painel.innerHTML = `
      <div class="dados">
        <div class="dado"><span>Estado</span>${selo(s.status)}</div>
        <div class="dado"><span>Número</span><b>${s.telefone || '—'}</b></div>
        <div class="dado"><span>Dono</span><b>${esc(s.dono)}</b></div>
        <div class="dado"><span>Criada em</span><b>${new Date(s.criada_em).toLocaleString('pt-BR')}</b></div>
        <div class="dado"><span>Última mensagem</span><b>${s.ultima_recebida ? new Date(s.ultima_recebida).toLocaleString('pt-BR') : '—'}</b></div>
        <div class="dado"><span>Eventos na fila</span><b>${s.eventos_pendentes}</b></div>
        <div class="dado"><span>Distribuição</span><b title="${s.distribuicao === 'todos' ? 'Todas as conexões recebem tudo' : 'Lead aparece para todas; quem assume fica com a conversa'}">${s.distribuicao === 'todos' ? 'Todos' : 'Leads'}</b></div>
        <div class="dado"><span>Em atendimento · leads</span><b>${s.atendimentos ? s.atendimentos.em_atendimento + ' · ' + s.atendimentos.leads : '—'}</b></div>
      </div>
      ${s.erro ? `<p class="aviso perigo">${esc(s.erro)}</p>` : ''}
      <div data-qr></div>
      <div class="grupo-bt grupo-rodape">
        ${s.ativa && s.status !== 'CONECTADO' ? '' : s.ativa
          ? '<button class="bt" data-acao-ficha="pausar"><svg><use href="#i-pausa"/></svg><span>Pausar</span></button>'
          : '<button class="bt bt-principal" data-acao-ficha="conectar"><svg><use href="#i-play"/></svg><span>Conectar</span></button>'}
        <button class="bt" data-acao-ficha="reiniciar"><svg><use href="#i-girar"/></svg><span>Reiniciar</span></button>
        <button class="bt" data-acao-ficha="teste"><svg><use href="#i-ok"/></svg><span>Testar</span></button>
        <button class="bt" data-acao-ficha="autorizar"><svg><use href="#i-chave"/></svg><span>Ligar sistema</span></button>
        <button class="bt bt-perigo" data-acao-ficha="trocar-numero"><svg><use href="#i-wifi"/></svg><span>Trocar número</span></button>
        <button class="bt bt-perigo" data-acao-ficha="excluir" title="Excluir esta sessão"><svg><use href="#i-lixo"/></svg><span>Excluir</span></button>
      </div>`;
    $$('[data-acao-ficha]', m).forEach((bt) => bt.addEventListener('click', () => acaoFicha(m, s.id, bt.dataset.acaoFicha, bt)));
  }
  function atualizarFichaAberta(id) {
    const s = sessoes.find((x) => x.id === id), m = $(`.modal[data-id="${id}"]`); if (!s || !m) return;
    const aba = $('.aba[aria-selected=true]', m)?.dataset.aba || 'geral';
    if (aba === 'geral') desenharGeral(m, s);
    if (aba === 'atendimentos') carregarAtendimentos(m, id, false);
    const alvoQr = $('[data-qr]', m);
    if (alvoQr) alvoQr.innerHTML = s.status === 'AGUARDANDO_QR' && s.qr ? `<div class="quadro-qr"><img src="${s.qr}" alt="QR Code do WhatsApp" width="240" height="240"><p>No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho, e aponte para este código. Ele é renovado sozinho enquanto não for lido.</p></div>` : '';
  }
  async function acaoFicha(m, id, acao, bt) {
    if (acao === 'teste') return abrirTeste(id);
    if (acao === 'conectar' || acao === 'reiniciar') { await chamar('POST', `/sessoes/${id}/${acao}`, null, bt); await carregar(); return atualizarQrSeNecessario(id); }
    if (acao === 'pausar') { await chamar('POST', `/sessoes/${id}/pausar`, null, bt); return carregar(); }
    if (acao === 'autorizar') return abrirAutorizar(id);
    if (acao === 'trocar-numero') return confirmarPerigo('Trocar o número', 'O número atual é desconectado agora mesmo e um novo QR é mostrado. Os sistemas ligados a esta sessão passam a falar pelo número novo.', async (bt2) => { await chamar('POST', `/sessoes/${id}/novo-qr`, { confirmado: true }, bt2); m.querySelector('.aba').click(); await carregar(); return atualizarQrSeNecessario(id); });
    if (acao === 'excluir') return confirmarPerigo('Excluir sessão', 'O número é desconectado e as autorizações desta sessão deixam de valer. O que os sistemas já gravaram do lado deles continua lá.', async (bt2) => { await chamar('POST', `/sessoes/${id}/excluir`, { confirmado: true }, bt2); m.remove(); fundo.hidden = true; return carregar(); });
  }
  // ---------- teste da sessão (checagens + envio de teste opcional) ----------
  // Abre já conferindo (sem enviar nada). "Enviar teste" manda UMA mensagem real para o número
  // informado — por isso só envia se o campo for preenchido. Recebimento: responda no celular e
  // use "Conferir de novo" — a checagem de última recebida avança.
  function abrirTeste(id) {
    const m = abrirModal({ titulo: 'Teste da sessão', estreito: true, corpo: `
      <ul class="checagens" data-teste-lista><li data-ok="null"><span class="sinal"><svg><use href="#i-girar"/></svg></span><div><b>Conferindo…</b><span>Consultando a sessão.</span></div></li></ul>
      <div class="campo"><label for="telTeste">Enviar mensagem de teste para (opcional)</label><input id="telTeste" inputmode="numeric" maxlength="15" placeholder="DDI+DDD+número, ex.: 5587999990000" spellcheck="false">
        <span class="dica">Só envia se você preencher. Use um número seu: a mensagem sai de verdade por esta sessão.</span></div>`,
      rodape: [
        { texto: 'Conferir de novo', onClick: (mm, bt) => rodarTeste(mm, id, bt, false) },
        { texto: 'Enviar teste', principal: true, onClick: (mm, bt) => rodarTeste(mm, id, bt, true) },
      ] });
    rodarTeste(m, id);
  }
  async function rodarTeste(m, id, bt, comEnvio) {
    const telefone = comEnvio ? $('#telTeste', m).value.replace(/\D/g, '') : '';
    if (comEnvio && !telefone) { avisar('Preencha o número para enviar a mensagem de teste.'); $('#telTeste', m).focus(); return; }
    const r = await chamar('POST', `/sessoes/${id}/teste`, telefone ? { telefone } : null, bt).catch(() => null); if (!r || !document.body.contains(m)) return;
    const icone = (ok) => ok === true ? 'i-ok' : ok === false ? 'i-fechar' : 'i-fila';
    $('[data-teste-lista]', m).innerHTML = r.checks.map((c) => `<li data-ok="${c.ok}"><span class="sinal"><svg><use href="#${icone(c.ok)}"/></svg></span><div><b>${esc(c.nome)}</b><span>${esc(c.detalhe)}</span></div></li>`).join('');
  }

  function confirmarPerigo(titulo, texto, onConfirmar) {
    abrirModal({ titulo, estreito: true, corpo: `<p class="aviso perigo">${esc(texto)}</p>`, rodape: [
      // Fecha só este aviso: se a ficha continua aberta por baixo, o fundo escurecido continua.
      { texto: 'Cancelar', onClick: (m) => { m.remove(); if (!$('.modal')) fundo.hidden = true; } },
      { texto: 'Confirmar', perigo: true, onClick: async (m, bt) => { await onConfirmar(bt); m.remove(); if (!$('.modal')) fundo.hidden = true; } },
    ] });
  }

  // ---------- autorizar sistema ----------
  function abrirAutorizar(id) {
    const m = abrirModal({ titulo: 'Ligar sistema', estreito: true, corpo: `<p class="aviso">Cada sistema ligado é uma conexão com ID próprio. Ele recebe os leads (primeiro contato) deste número; quando assume ou responde um lead, a conversa fica só com ele até finalizar.</p>
      <div class="campos campos-espaco">
        <div class="campo"><label for="autNome">Nome (aparece na lista de sistemas ligados)</label><input id="autNome" maxlength="100" placeholder='Ex.: "Site da gestão"'></div>
        <div class="campo"><label for="autSistema">Sistema</label><input id="autSistema" maxlength="150" placeholder="Ex.: gestao"></div>
        <div class="campo"><label>Tipo</label><div class="grupo-bt seg" data-tipo-nova>
          <button type="button" class="bt bt-mini bt-principal" data-t="atendimento">Atendimento</button><button type="button" class="bt bt-mini" data-t="avisos">Avisos</button></div>
          <span class="dica">Atendimento: assume a conversa quando responde. Avisos (cobrança, alertas): envia sem assumir.</span></div>
      </div>`, rodape: [{ texto: 'Gerar código', principal: true, onClick: async (mm, bt) => {
        const nome = $('#autNome', mm).value.trim(), sistema = $('#autSistema', mm).value.trim(), tipo = $('[data-tipo-nova] .bt-principal', mm).dataset.t;
        if (!nome || !sistema) return avisar('Informe nome e sistema.');
        const a = await chamar('POST', `/sessoes/${id}/autorizacoes`, { nome, sistema, tipo, confirmado: true }, bt);
        mm.remove(); fundo.hidden = true; mostrarCodigo(a.code);
      } }] });
    $$('[data-tipo-nova] .bt', m).forEach((b) => b.addEventListener('click', () => $$('[data-tipo-nova] .bt', m).forEach((x) => x.classList.toggle('bt-principal', x === b))));
  }
  function mostrarCodigo(codigo) {
    abrirModal({ titulo: 'Código gerado', estreito: true, corpo: `
      <p>Vale 10 minutos e um uso só. Entregue este código a quem for ligar o sistema (veja também <code>docs/PROMPT-PARA-AGENTES.md</code> no repositório).</p>
      <div class="codigo"><input readonly value="${esc(codigo)}" id="valorCodigo"><button class="bt bt-icone" id="btCopiar" title="Copiar"><svg><use href="#i-copiar"/></svg></button></div>`,
      rodape: [{ texto: 'Fechar', principal: true, onClick: (m) => { m.remove(); fundo.hidden = true; } }] });
    $('#btCopiar').addEventListener('click', async () => { if (!await copiar(codigo, $('#btCopiar'))) $('#valorCodigo').select(); });
  }

  // ---------- sistemas ligados ----------
  // Cada sistema busca os eventos a cada poucos segundos. Ligado, com mais de 2 minutos sem consultar, é ele que
  // parou (reiniciou e não voltou, perdeu a rede, foi desligado) — a fila dele cresce e as mensagens não aparecem lá.
  function consulta(a) {
    if (a.revoked_at || !a.paired) return '—';
    // 1.3.6: "consulta" é BUSCAR mensagens (last_events_at). Sistema que só envia (avisos, alertas) nunca busca —
    // isso é normal e não é "parado".
    if (!a.last_events_at) return a.tipo === 'avisos' ? '<span class="selo off" title="Conexão de avisos: envia e não recebe conversas">Só envia</span>'
      : '<span class="selo qr" title="Este sistema nunca buscou mensagens. Se ele só envia avisos, marque Avisos. O conector já não entrega conversas a ele.">Só envia · marque Avisos</span>';
    const seg = Math.max(0, Math.round((Date.now() - new Date(a.last_events_at).getTime()) / 1000)); // o protocolo guarda em milissegundos
    const ha = seg < 60 ? 'agora' : seg < 3600 ? 'há ' + Math.round(seg / 60) + ' min' : seg < 86400 ? 'há ' + Math.round(seg / 3600) + ' h' : 'há ' + Math.round(seg / 86400) + ' dia(s)';
    return seg > 120 ? `<span class="selo erro" title="Última busca de mensagens em ${new Date(a.last_events_at).toLocaleString('pt-BR')}">Parado ${ha}</span>` : `<span class="selo on">${ha}</span>`;
  }
  async function carregarAutorizacoes(m, id) {
    const alvo = $('[data-painel=sistemas]', m); alvo.innerHTML = 'Carregando…';
    const { autorizacoes } = await api('GET', `/sessoes/${id}/autorizacoes`);
    alvo.classList.add('quadro');
    alvo.innerHTML = autorizacoes.length ? `<table class="dmk-lista">
      <thead><tr><th>Conexão</th><th>Tipo</th><th>Estado</th><th>Última consulta</th><th class="num">Fila</th><th></th></tr></thead>
      <tbody>${autorizacoes.map((a) => `<tr>
        <td class="contato"><b>${esc(a.label)}</b><small title="ID completo: ${esc(a.id)}">${esc(a.installation)} · ID ${esc(a.id.slice(0, 8))}</small></td>
        <td><div class="grupo-bt seg">${['atendimento', 'avisos'].map((t) => `<button class="bt bt-mini ${a.tipo === t ? 'bt-principal' : ''}" data-tipo="${t}" data-aut="${a.id}" title="${t === 'avisos' ? 'Envia avisos sem assumir a conversa (cobrança, alertas)' : 'Assume a conversa quando responde'}" ${a.revoked_at ? 'disabled' : ''}>${t === 'avisos' ? 'Avisos' : 'Atendimento'}</button>`).join('')}</div></td>
        <td>${a.revoked_at ? '<span class="selo off">Revogada</span>' : a.paired ? '<span class="selo on">Ligada</span>' : '<span class="selo qr">Aguardando</span>'}</td>
        <td>${consulta(a)}</td>
        <td class="num">${a.pending}</td>
        <td><div class="grupo-bt">${a.revoked_at ? '' : `<button class="bt bt-mini bt-so-icone bt-perigo" data-revogar="${a.id}" title="Revogar o acesso deste sistema" aria-label="Revogar o acesso de ${esc(a.label)}"><svg><use href="#i-fechar"/></svg></button>`}<button class="bt bt-mini bt-so-icone" data-excluir-aut="${a.id}" title="Excluir do histórico desta sessão" aria-label="Excluir ${esc(a.label)} do histórico"><svg><use href="#i-lixo"/></svg></button></div></td>
      </tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhum sistema ligado a esta sessão.</p>';
    $$('[data-tipo]', alvo).forEach((bt) => bt.addEventListener('click', async () => { if (bt.classList.contains('bt-principal')) return; await chamar('POST', `/sessoes/${id}/autorizacoes/${bt.dataset.aut}/tipo`, { tipo: bt.dataset.tipo }, bt); carregarAutorizacoes(m, id); }));
    $$('[data-revogar]', alvo).forEach((bt) => bt.addEventListener('click', () => confirmarPerigo('Revogar acesso', 'O sistema para de ler e enviar por esta sessão na próxima consulta.', async (bt2) => { await chamar('POST', `/sessoes/${id}/autorizacoes/${bt.dataset.revogar}/revogar`, null, bt2); carregarAutorizacoes(m, id); carregar(); })));
    $$('[data-excluir-aut]', alvo).forEach((bt) => bt.addEventListener('click', () => confirmarPerigo('Excluir do histórico', 'A autorização sai da lista desta sessão. Se ainda estiver ativa, o acesso do sistema é cortado agora. O que o sistema já gravou do lado dele continua lá.', async (bt2) => { await chamar('POST', `/sessoes/${id}/autorizacoes/${bt.dataset.excluirAut}/excluir`, null, bt2); carregarAutorizacoes(m, id); carregar(); })));
  }

  // ---------- atendimentos (quem está atendendo cada conversa) ----------
  // Lista padrão: Pesquisar + modo de distribuição numa linha; cabeçalhos ordenáveis; paginação no rodapé.
  // Redesenha só quando os dados mudam (o polling de 4 s não reseta pesquisa, ordem nem página).
  const SITUACAO = { NOVO: ['Lead', 'qr'], EM_ATENDIMENTO: ['Em atendimento', 'on'], FINALIZADO: ['Finalizada', 'off'] };
  async function carregarAtendimentos(m, id, primeira) {
    const alvo = $('[data-painel=atendimentos]', m);
    if (primeira || !alvo.dataset.pronto) {
      alvo.dataset.pronto = '1'; alvo.innerHTML = `
        <div class="barra-aba">
          <div class="busca"><svg><use href="#i-lupa"/></svg><input type="search" data-at-busca placeholder="Pesquisar contato, nome ou conexão" spellcheck="false"></div>
          <div class="grupo-bt seg" role="group" aria-label="Distribuição">
            <button class="bt bt-mini" data-modo="leads" title="Lead novo aparece para todas as conexões; quem assume fica com a conversa">Leads</button>
            <button class="bt bt-mini" data-modo="todos" title="Todas as conexões recebem e respondem tudo">Todos</button>
          </div>
        </div>
        <div class="quadro"><table class="dmk-lista"><thead><tr>
          <th data-ord="name">Contato</th><th data-ord="state">Situação</th><th data-ord="owner">Atendendo</th><th data-ord="last_at">Última</th><th></th>
        </tr></thead><tbody data-at-corpo></tbody></table><p class="vazio" data-at-vazio hidden></p></div>
        <div class="paginacao" data-at-pag></div>`;
      alvo._estado = { termo: '', ord: 'last_at', desc: true, pagina: 1, por: 10, dados: null, assinatura: '' };
      $('[data-at-busca]', alvo).addEventListener('input', (ev) => { alvo._estado.termo = ev.target.value; alvo._estado.pagina = 1; desenharAtendimentos(m, id); });
      $$('[data-modo]', alvo).forEach((bt) => bt.addEventListener('click', async () => {
        if (alvo._estado.dados?.modo === bt.dataset.modo) return;
        await chamar('POST', `/sessoes/${id}/distribuicao`, { modo: bt.dataset.modo }, bt); await carregar(); carregarAtendimentos(m, id, false);
      }));
      $$('th[data-ord]', alvo).forEach((th) => th.addEventListener('click', () => { const e = alvo._estado; e.desc = e.ord === th.dataset.ord ? !e.desc : false; e.ord = th.dataset.ord; desenharAtendimentos(m, id); }));
    }
    let dados; try { dados = await api('GET', `/sessoes/${id}/atendimentos`); } catch (e) { return avisar(e.message); }
    const assinatura = JSON.stringify(dados);
    if (assinatura === alvo._estado.assinatura) return;
    alvo._estado.assinatura = assinatura; alvo._estado.dados = dados; desenharAtendimentos(m, id);
  }
  function desenharAtendimentos(m, id) {
    const alvo = $('[data-painel=atendimentos]', m), e = alvo._estado; if (!e?.dados) return;
    $$('[data-modo]', alvo).forEach((bt) => bt.classList.toggle('bt-principal', bt.dataset.modo === e.dados.modo));
    const termo = e.termo.trim().toLowerCase(), valor = (c) => e.ord === 'owner' ? c.owner?.label || '' : e.ord === 'name' ? c.name || c.phone || '' : String(c[e.ord] ?? '');
    const lista = e.dados.conversas.filter((c) => !termo || [c.phone, c.peer, c.name, c.owner?.label].some((v) => String(v || '').toLowerCase().includes(termo)))
      .sort((a, b) => valor(a).localeCompare(valor(b), 'pt-BR', { numeric: true }) * (e.desc ? -1 : 1));
    const paginas = Math.max(1, Math.ceil(lista.length / e.por)); e.pagina = Math.min(e.pagina, paginas);
    const pagina = lista.slice((e.pagina - 1) * e.por, e.pagina * e.por);
    $$('th[data-ord]', alvo).forEach((th) => th.dataset.dir = th.dataset.ord === e.ord ? (e.desc ? 'desc' : 'asc') : '');
    $('[data-at-corpo]', alvo).innerHTML = pagina.map((c) => { const [t, cl] = SITUACAO[c.state] || [c.state, 'off']; return `<tr>
      <td class="contato"><b>${esc(c.name || c.phone || c.peer)}</b><small>${esc(c.phone || c.peer)}</small></td><td><span class="selo ${cl}">${t}</span></td>
      <td>${c.owner ? esc(c.owner.label) : '<span class="fraco">todas as conexões</span>'}</td>
      <td>${c.last_at ? new Date(c.last_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td><div class="grupo-bt">${c.owner ? `<button class="bt bt-mini bt-icone-mini" data-liberar="${esc(c.peer)}" title="Liberar: finalizar e devolver para todas as conexões"><svg><use href="#i-girar"/></svg></button>` : ''}
        ${e.dados.modo === 'leads' ? `<button class="bt bt-mini bt-icone-mini" data-transferir="${esc(c.peer)}" title="Transferir para outra conexão"><svg><use href="#i-sair"/></svg></button>` : ''}</div></td>
    </tr>`; }).join('');
    const vazio = $('[data-at-vazio]', alvo); vazio.hidden = lista.length > 0;
    vazio.textContent = e.dados.conversas.length ? 'Nenhuma conversa com essa pesquisa.' : 'Nenhuma conversa ainda. Elas aparecem aqui quando o número recebe ou envia mensagens.';
    const nums = []; for (let p = Math.max(1, Math.min(e.pagina - 2, paginas - 4)); p <= Math.min(paginas, Math.max(1, Math.min(e.pagina - 2, paginas - 4)) + 4); p++) nums.push(p);
    $('[data-at-pag]', alvo).innerHTML = `<span class="total">${lista.length} conversa(s)</span><div class="grupo-bt">
      <button class="bt bt-mini" data-pag="${e.pagina - 1}" ${e.pagina <= 1 ? 'disabled' : ''} title="Anterior">‹</button>
      ${nums.map((p) => `<button class="bt bt-mini ${p === e.pagina ? 'bt-principal' : ''}" data-pag="${p}">${p}</button>`).join('')}
      <button class="bt bt-mini" data-pag="${e.pagina + 1}" ${e.pagina >= paginas ? 'disabled' : ''} title="Próxima">›</button>
      ${[10, 25, 50, 100].map((n) => `<button class="bt bt-mini ${n === e.por ? 'bt-principal' : ''}" data-por="${n}" title="${n} por página">${n}</button>`).join('')}</div>`;
    $$('[data-pag]', alvo).forEach((bt) => bt.addEventListener('click', () => { e.pagina = Number(bt.dataset.pag); desenharAtendimentos(m, id); }));
    $$('[data-por]', alvo).forEach((bt) => bt.addEventListener('click', () => { e.por = Number(bt.dataset.por); e.pagina = 1; desenharAtendimentos(m, id); }));
    $$('[data-liberar]', alvo).forEach((bt) => bt.addEventListener('click', () => confirmarPerigo('Liberar conversa', 'A conversa sai de quem está atendendo e volta a ser lead: a próxima mensagem do contato aparece para todas as conexões.', async (bt2) => { await chamar('POST', `/sessoes/${id}/atendimentos/liberar`, { peer: bt.dataset.liberar }, bt2); carregarAtendimentos(m, id, false); })));
    $$('[data-transferir]', alvo).forEach((bt) => bt.addEventListener('click', () => abrirTransferir(m, id, bt.dataset.transferir, e.dados.conversas.find((c) => c.peer === bt.dataset.transferir)?.owner?.id)));
  }
  async function abrirTransferir(ficha, id, peer, donoAtual) {
    const { autorizacoes } = await api('GET', `/sessoes/${id}/autorizacoes`).catch((e) => { avisar(e.message); return { autorizacoes: [] }; });
    const ligadas = autorizacoes.filter((a) => a.paired && !a.revoked_at && a.id !== donoAtual);
    if (!ligadas.length) return avisar('Nenhuma outra conexão ligada a esta sessão para receber a conversa.');
    const m = abrirModal({ titulo: 'Transferir conversa', estreito: true, corpo: `<p class="nota">Escolha a conexão que passa a atender ${esc(peer.split('@')[0])}. A conexão atual deixa de ver a conversa.</p>
      <div class="lista-escolha">${ligadas.map((a) => `<button class="bt" data-para="${a.id}"><svg><use href="#i-chave"/></svg><span>${esc(a.label)} <small>${esc(a.installation)}</small></span></button>`).join('')}</div>` });
    $$('[data-para]', m).forEach((bt) => bt.addEventListener('click', async () => { await chamar('POST', `/sessoes/${id}/atendimentos/transferir`, { peer, para: bt.dataset.para }, bt); m.remove(); carregarAtendimentos(ficha, id, false); }));
  }

  // ---------- início ----------
  const guardada = sessionStorage.getItem('dmk-wa-chave'); if (guardada) { $('#chave').value = guardada; entrar(guardada); }
})();

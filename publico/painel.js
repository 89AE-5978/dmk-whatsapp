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

  // ---------- carregar / render ----------
  const ESTADOS = { CONECTADO: ['Conectado', 'on'], AGUARDANDO_QR: ['Aguardando QR', 'qr'], INICIANDO: ['Iniciando', 'qr'], DESCONECTADO: ['Desconectado', 'off'], ERRO: ['Erro', 'erro'] };
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
    const aberto = $('.modal[data-id]'); if (aberto) atualizarFichaAberta(Number(aberto.dataset.id));
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
    abrirModal({ titulo: 'Filtros', estreito: true, corpo: `<div class="campos">
      <div class="campo"><label>Estado</label>${Object.entries(ESTADOS).map(([valor, [rotulo]]) =>
        `<label style="display:flex;align-items:center;gap:.5rem;font-weight:400;padding:.25rem 0">
          <input type="checkbox" value="${valor}" ${atual.has(valor) ? 'checked' : ''}> ${rotulo}</label>`).join('')}</div>
    </div>`, rodape: [
      { texto: 'Limpar', onClick: (m) => { filtroEstados = new Set(); render(); m.remove(); fundo.hidden = true; } },
      { texto: 'Aplicar', principal: true, onClick: (m) => {
        filtroEstados = new Set($$('input[type=checkbox]:checked', m).map((c) => c.value)); render(); m.remove(); fundo.hidden = true; } },
    ] });
  }
  $('#btFiltros').addEventListener('click', abrirFiltros);

  // ---------- modal genérico ----------
  function abrirModal({ titulo, corpo, rodape = [], estreito = false, id }) {
    fundo.hidden = false;
    const m = document.createElement('div'); m.className = 'modal' + (estreito ? ' estreito' : ''); if (id) m.dataset.id = id;
    m.innerHTML = `<header><h2>${esc(titulo)}</h2><button class="bt bt-icone" data-fechar title="Fechar"><svg><use href="#i-fechar"/></svg></button></header>
      <div class="corpo-modal">${corpo}</div>
      <footer>${rodape.map((b, i) => `<button class="bt ${b.principal ? 'bt-principal' : ''} ${b.perigo ? 'bt-perigo' : ''}" data-acao="${i}">${esc(b.texto)}</button>`).join('')}</footer>`;
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
    const m = abrirModal({ titulo: `${s.nome} · sessão ${s.id}`, id, corpo: `
      <div class="abas" role="tablist">
        <button class="aba" role="tab" aria-selected="true" data-aba="geral">Geral</button>
        <button class="aba" role="tab" aria-selected="false" data-aba="sistemas">Sistemas ligados</button>
      </div>
      <div data-painel="geral"></div><div data-painel="sistemas" hidden></div>`, rodape: [] });
    $$('.aba', m).forEach((a) => a.addEventListener('click', () => {
      $$('.aba', m).forEach((x) => x.setAttribute('aria-selected', String(x === a)));
      $$('[data-painel]', m).forEach((p) => p.hidden = p.dataset.painel !== a.dataset.aba);
      if (a.dataset.aba === 'sistemas') carregarAutorizacoes(m, id);
    }));
    desenharGeral(m, s);
    atualizarFichaAberta(id);
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
      </div>
      ${s.erro ? `<p class="aviso perigo">${esc(s.erro)}</p>` : ''}
      <div data-qr></div>
      <div class="grupo-bt" style="margin-top:1rem;flex-wrap:wrap">
        ${s.ativa && s.status !== 'CONECTADO' ? '' : s.ativa
          ? '<button class="bt" data-acao-ficha="pausar"><svg><use href="#i-pausa"/></svg><span>Pausar</span></button>'
          : '<button class="bt bt-principal" data-acao-ficha="conectar"><svg><use href="#i-play"/></svg><span>Conectar</span></button>'}
        <button class="bt" data-acao-ficha="reiniciar"><svg><use href="#i-girar"/></svg><span>Reiniciar</span></button>
        <button class="bt" data-acao-ficha="autorizar"><svg><use href="#i-chave"/></svg><span>Ligar sistema</span></button>
        <button class="bt bt-perigo" data-acao-ficha="trocar-numero"><svg><use href="#i-wifi"/></svg><span>Trocar número</span></button>
        <button class="bt bt-perigo" data-acao-ficha="excluir"><svg><use href="#i-lixo"/></svg><span>Excluir sessão</span></button>
      </div>`;
    $$('[data-acao-ficha]', m).forEach((bt) => bt.addEventListener('click', () => acaoFicha(m, s.id, bt.dataset.acaoFicha, bt)));
  }
  function atualizarFichaAberta(id) {
    const s = sessoes.find((x) => x.id === id), m = $(`.modal[data-id="${id}"]`); if (!s || !m) return;
    if (!$('.aba[aria-selected=true]', m) || $('.aba[aria-selected=true]', m).dataset.aba === 'geral') desenharGeral(m, s);
    const alvoQr = $('[data-qr]', m);
    if (alvoQr) alvoQr.innerHTML = s.status === 'AGUARDANDO_QR' && s.qr ? `<div class="qr"><img src="${s.qr}" alt="QR Code do WhatsApp" width="240" height="240"><p>No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho, e aponte para este código. Ele é renovado sozinho enquanto não for lido.</p></div>` : '';
  }
  async function acaoFicha(m, id, acao, bt) {
    if (acao === 'conectar' || acao === 'reiniciar') { await chamar('POST', `/sessoes/${id}/${acao}`, null, bt); return carregar(); }
    if (acao === 'pausar') { await chamar('POST', `/sessoes/${id}/pausar`, null, bt); return carregar(); }
    if (acao === 'autorizar') return abrirAutorizar(id);
    if (acao === 'trocar-numero') return confirmarPerigo('Trocar o número', 'O número atual é desconectado agora mesmo e um novo QR é mostrado. Os sistemas ligados a esta sessão passam a falar pelo número novo.', async (bt2) => { await chamar('POST', `/sessoes/${id}/novo-qr`, { confirmado: true }, bt2); m.querySelector('.aba').click(); return carregar(); });
    if (acao === 'excluir') return confirmarPerigo('Excluir sessão', 'O número é desconectado e as autorizações desta sessão deixam de valer. O que os sistemas já gravaram do lado deles continua lá.', async (bt2) => { await chamar('POST', `/sessoes/${id}/excluir`, { confirmado: true }, bt2); m.remove(); fundo.hidden = true; return carregar(); });
  }
  function confirmarPerigo(titulo, texto, onConfirmar) {
    abrirModal({ titulo, estreito: true, corpo: `<p class="aviso perigo">${esc(texto)}</p>`, rodape: [
      { texto: 'Cancelar', onClick: (m) => { m.remove(); fundo.hidden = true; } },
      { texto: 'Confirmar', perigo: true, onClick: async (m, bt) => { await onConfirmar(bt); m.remove(); fundo.hidden = true; } },
    ] });
  }

  // ---------- autorizar sistema ----------
  function abrirAutorizar(id) {
    const m = abrirModal({ titulo: 'Ligar sistema', estreito: true, corpo: `<p class="aviso">O sistema autorizado poderá ler e responder todas as conversas deste número.</p>
      <div class="campos" style="margin-top:.75rem">
        <div class="campo"><label for="autNome">Nome (aparece na lista de sistemas ligados)</label><input id="autNome" maxlength="100" placeholder='Ex.: "Site da gestão"'></div>
        <div class="campo"><label for="autSistema">Sistema</label><input id="autSistema" maxlength="150" placeholder="Ex.: gestao"></div>
      </div>`, rodape: [{ texto: 'Gerar código', principal: true, onClick: async (mm, bt) => {
        const nome = $('#autNome', mm).value.trim(), sistema = $('#autSistema', mm).value.trim();
        if (!nome || !sistema) return avisar('Informe nome e sistema.');
        const a = await chamar('POST', `/sessoes/${id}/autorizacoes`, { nome, sistema, confirmado: true }, bt);
        mm.remove(); fundo.hidden = true; mostrarCodigo(a.code);
      } }] });
  }
  function mostrarCodigo(codigo) {
    abrirModal({ titulo: 'Código gerado', estreito: true, corpo: `
      <p>Vale 10 minutos e um uso só. Entregue este código a quem for ligar o sistema (veja também <code>docs/PROMPT-PARA-AGENTES.md</code> no repositório).</p>
      <div class="codigo"><input readonly value="${esc(codigo)}" id="valorCodigo"><button class="bt bt-icone" id="btCopiar" title="Copiar"><svg><use href="#i-copiar"/></svg></button></div>`,
      rodape: [{ texto: 'Fechar', principal: true, onClick: (m) => { m.remove(); fundo.hidden = true; } }] });
    $('#btCopiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText(codigo); avisar('Código copiado.'); } catch { $('#valorCodigo').select(); } });
  }

  // ---------- sistemas ligados ----------
  async function carregarAutorizacoes(m, id) {
    const alvo = $('[data-painel=sistemas]', m); alvo.innerHTML = 'Carregando…';
    const { autorizacoes } = await api('GET', `/sessoes/${id}/autorizacoes`);
    alvo.innerHTML = autorizacoes.length ? `<table class="dmk-lista" style="border:1px solid var(--borda);border-radius:.5rem">
      <thead><tr><th>Sistema</th><th>Nome</th><th>Estado</th><th class="num">Fila</th><th></th></tr></thead>
      <tbody>${autorizacoes.map((a) => `<tr>
        <td>${esc(a.installation)}</td><td>${esc(a.label)}</td>
        <td>${a.revoked_at ? '<span class="selo off">Revogada</span>' : a.paired ? '<span class="selo on">Ligada</span>' : '<span class="selo qr">Aguardando</span>'}</td>
        <td class="num">${a.pending}</td>
        <td>${a.revoked_at ? '' : `<button class="bt bt-perigo" data-revogar="${a.id}">Revogar</button>`}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="vazio" style="display:block">Nenhum sistema ligado a esta sessão.</p>';
    $$('[data-revogar]', alvo).forEach((bt) => bt.addEventListener('click', () => confirmarPerigo('Revogar acesso', 'O sistema para de ler e enviar por esta sessão na próxima consulta.', async (bt2) => { await chamar('POST', `/sessoes/${id}/autorizacoes/${bt.dataset.revogar}/revogar`, null, bt2); carregarAutorizacoes(m, id); carregar(); })));
  }

  // ---------- início ----------
  const guardada = sessionStorage.getItem('dmk-wa-chave'); if (guardada) { $('#chave').value = guardada; entrar(guardada); }
  api('GET', '/sessoes').then(() => {}).catch(() => {});
})();

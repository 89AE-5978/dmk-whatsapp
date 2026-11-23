'use strict';
// DMK WhatsApp - comando de administração (dmk-wa). Fala com o conector desta máquina usando a chave
// de administrador guardada em dados/admin.key; por isso só o root consegue usar. A chave nunca é mostrada.
const fs = require('node:fs'), path = require('node:path');
const RAIZ = path.resolve(__dirname, '..'), PORTA = process.env.DMK_WA_PORTA || lerPorta();
const DADOS = process.env.DMK_WA_DADOS || path.join(RAIZ, 'dados');
function lerPorta() { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'instalacao.json'), 'utf8')).porta; } catch { return 8098; } }
const AJUDA = `DMK WhatsApp - administração do conector

  dmk-wa status                              versão, sessões e quantas estão conectadas
  dmk-wa sessoes                             lista as sessões
  dmk-wa nova "<nome>" <sistema-dono>        cria uma sessão (ex.: dmk-wa nova "Atendimento" gestao)
  dmk-wa conectar <id>                       liga a sessão; mostra o QR aqui no terminal até você ler
  dmk-wa pausar <id>                         desliga sem perder a sessão (não pede QR ao voltar)
  dmk-wa reiniciar <id>                      reinicia a conexão mantendo a sessão
  dmk-wa trocar-numero <id> --confirmar      desconecta o número e mostra QR para outro
  dmk-wa excluir <id> --confirmar            apaga a sessão e as autorizações dela
  dmk-wa autorizar <id> "<nome>" <sistema> --confirmar [--avisos]
                                             gera o código (10 min, um uso) para ligar um sistema à sessão;
                                             --avisos: conexão só de avisos (envia sem assumir a conversa)
  dmk-wa autorizacoes <id>                   sistemas ligados à sessão
  dmk-wa revogar <id> <autorizacao>          corta o acesso de um sistema na hora
  dmk-wa atendimentos <id>                   conversas da sessão e qual conexão está atendendo cada uma
  dmk-wa liberar <id> <telefone>             devolve a conversa para todas as conexões (lead de novo)
  dmk-wa distribuicao <id> leads|todos       leads: quem assume fica com a conversa; todos: todo mundo recebe tudo
  dmk-wa conferir                            confere a biblioteca do WhatsApp instalada e abre uma conexão de teste (QR)
  dmk-wa atualizar [--verificar]             traz a versão nova do GitHub (com backup e volta automática);
                                             --verificar só diz se há versão nova, sem alterar nada
`;
async function api(metodo, caminho, corpo) {
  let chave;
  try { chave = fs.readFileSync(path.join(DADOS, 'admin.key'), 'utf8').trim(); } catch { throw Error(`Não consegui ler ${path.join(DADOS, 'admin.key')}. Rode como root.`); }
  let r;
  try { r = await fetch(`http://127.0.0.1:${PORTA}${caminho}`, { method: metodo, headers: { Authorization: 'Bearer ' + chave, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined }); }
  catch { throw Error(`O conector não respondeu na porta ${PORTA}. Veja: systemctl status dmk-wa-conector`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || `Erro ${r.status}`);
  return j;
}
const linha = (s) => `  ${String(s.id).padEnd(4)}${s.status.padEnd(15)}${(s.telefone || '-').padEnd(16)}${s.dono.padEnd(18)}${s.nome}  (${s.autorizacoes} sistema(s), ${s.eventos_pendentes} evento(s) na fila)`;
const cabecalho = '  ID  ESTADO         NÚMERO          DONO              NOME';
const confirmado = (args) => args.includes('--confirmar');
async function mostrarQrAteConectar(id, primeiro) {
  let s = primeiro, ultimo = '';
  for (let i = 0; i < 180; i++) {
    if (s.status === 'CONECTADO') { console.log(`\nCONECTADO: sessão ${s.id} "${s.nome}" no número ${s.telefone}.`); return; }
    if (s.qr_texto && s.qr_texto !== ultimo) {
      ultimo = s.qr_texto;
      let desenho = '';
      try { desenho = await require('qrcode').toString(s.qr_texto, { type: 'terminal', small: true }); } catch { desenho = '(não foi possível desenhar o QR neste terminal)\n'; }
      console.log(`\nNo celular: WhatsApp > Aparelhos conectados > Conectar um aparelho, e aponte para o QR abaixo.\n\n${desenho}`);
    }
    await new Promise((ok) => setTimeout(ok, 2000));
    s = await api('GET', `/admin/v1/sessoes/${id}`);
  }
  console.log(`\nO QR não foi lido em 6 minutos. Estado atual: ${s.status}. Rode "dmk-wa conectar ${id}" de novo.`);
  process.exitCode = 1;
}
async function principal([comando, ...args]) {
  const id = args[0];
  const exigirId = () => { if (!/^\d+$/.test(id || '')) throw Error('Informe o número (ID) da sessão. Veja: dmk-wa sessoes'); };
  switch (comando) {
    case 'status': { const r = await fetch(`http://127.0.0.1:${PORTA}/health`).then((x) => x.json()).catch(() => null); if (!r) throw Error(`O conector não respondeu na porta ${PORTA}.`); console.log(`DMK WhatsApp ${r.versao} · Node ${r.node} · ${r.sessoes} sessão(ões), ${r.conectadas} conectada(s)${r.simulado ? ' · MODO SIMULADO' : ''}`); break; }
    case 'sessoes': { const { sessoes } = await api('GET', '/admin/v1/sessoes'); console.log(sessoes.length ? [cabecalho, ...sessoes.map(linha)].join('\n') : 'Nenhuma sessão. Crie uma: dmk-wa nova "<nome>" <sistema-dono>'); break; }
    case 'nova': { const s = await api('POST', '/admin/v1/sessoes', { nome: args[0], dono: args[1] }); console.log(`Sessão ${s.id} "${s.nome}" criada para ${s.dono}. Agora: dmk-wa conectar ${s.id}`); break; }
    case 'conectar': exigirId(); await mostrarQrAteConectar(id, await api('POST', `/admin/v1/sessoes/${id}/conectar`)); break;
    case 'reiniciar': exigirId(); await mostrarQrAteConectar(id, await api('POST', `/admin/v1/sessoes/${id}/reiniciar`)); break;
    case 'pausar': { exigirId(); const s = await api('POST', `/admin/v1/sessoes/${id}/pausar`); console.log(`Sessão ${s.id} pausada. Para voltar: dmk-wa conectar ${s.id}`); break; }
    case 'trocar-numero': exigirId(); if (!confirmado(args)) throw Error('Isto desconecta o número atual. Repita com --confirmar.'); await mostrarQrAteConectar(id, await api('POST', `/admin/v1/sessoes/${id}/novo-qr`, { confirmado: true })); break;
    case 'excluir': exigirId(); if (!confirmado(args)) throw Error('Isto desconecta o número e apaga as autorizações desta sessão. Repita com --confirmar.'); await api('POST', `/admin/v1/sessoes/${id}/excluir`, { confirmado: true }); console.log(`Sessão ${id} excluída.`); break;
    case 'autorizar': {
      exigirId(); if (!confirmado(args)) throw Error('O sistema autorizado verá os leads deste número e responderá as conversas que assumir. Repita com --confirmar.');
      const a = await api('POST', `/admin/v1/sessoes/${id}/autorizacoes`, { nome: args[1], sistema: args[2], confirmado: true, tipo: args.includes('--avisos') ? 'avisos' : 'atendimento' });
      console.log(`Código para ligar "${a.label}" à sessão ${id} (vale 10 minutos, um uso só):\n\n  ${a.code}\n\nNo sistema, informe este código e o endereço do conector. Veja docs/LIGAR-UM-SISTEMA.md.`); break;
    }
    case 'autorizacoes': { exigirId(); const { autorizacoes } = await api('GET', `/admin/v1/sessoes/${id}/autorizacoes`); console.log(autorizacoes.length ? autorizacoes.map((a) => `  ${a.id}  ${a.revoked_at ? 'REVOGADA ' : a.paired ? 'LIGADA   ' : 'AGUARDA  '} ${(a.tipo || 'atendimento').padEnd(12)} ${a.installation.padEnd(18)} ${a.label}  (${a.pending} na fila, vale até ${new Date(a.expires_at).toLocaleDateString('pt-BR')})`).join('\n') : 'Nenhum sistema ligado a esta sessão.'); break; }
    case 'revogar': exigirId(); await api('POST', `/admin/v1/sessoes/${id}/autorizacoes/${args[1]}/revogar`); console.log('Acesso revogado. O sistema para na próxima consulta.'); break;
    case 'atendimentos': {
      exigirId(); const { modo, conversas } = await api('GET', `/admin/v1/sessoes/${id}/atendimentos`);
      console.log(`Distribuição: ${modo === 'leads' ? 'leads (quem assume fica com a conversa)' : 'todos (todas as conexões recebem tudo)'}`);
      console.log(conversas.length ? conversas.map((c) => `  ${(c.phone || c.peer).padEnd(16)}${c.state.padEnd(16)}${(c.owner ? c.owner.label : '— todas —').padEnd(24)}${c.name || ''}`).join('\n') : 'Nenhuma conversa ainda.'); break;
    }
    case 'liberar': exigirId(); await api('POST', `/admin/v1/sessoes/${id}/atendimentos/liberar`, { peer: args[1] }); console.log('Conversa devolvida para todas as conexões.'); break;
    case 'distribuicao': exigirId(); { const s = await api('POST', `/admin/v1/sessoes/${id}/distribuicao`, { modo: args[1] }); console.log(`Sessão ${s.id}: distribuição "${s.distribuicao}".`); } break;
    case 'conferir': { const r = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'conferir-baileys.js'), '--qr'], { stdio: 'inherit', cwd: RAIZ }); process.exitCode = r.status; break; }
    // 1.3.18: atualizar pelo próprio comando. Antes só existia o script (e o botão do painel), então
    // "dmk-wa atualizar" caía na ajuda e parecia ter funcionado.
    case 'atualizar': {
      const script = path.join(RAIZ, 'instalar', 'atualizar.sh');
      if (!fs.existsSync(script)) throw Error(`Não encontrei ${script}. Atualize pelo painel ou refaça a instalação.`);
      if (args.length && args[0] !== '--verificar') throw Error('Use: dmk-wa atualizar [--verificar]');
      const r = require('node:child_process').spawnSync('bash', [script, ...args], { stdio: 'inherit', cwd: RAIZ });
      process.exitCode = r.status === null ? 1 : r.status; break;
    }
    // Comando errado não pode sair como sucesso: senão um "dmk-wa comando-errado && dmk-wa status"
    // imprime a ajuda, segue em frente e parece que deu certo.
    default:
      if (comando && comando !== 'ajuda' && comando !== '--help' && comando !== '-h') {
        console.error(`ERRO: comando desconhecido: ${comando}\n`); console.error(AJUDA); process.exitCode = 1; break;
      }
      console.log(AJUDA);
  }
}
principal(process.argv.slice(2)).catch((e) => { console.error('ERRO: ' + e.message); process.exit(1); });

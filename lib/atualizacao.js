'use strict';
// Atualização pelo painel, sem dar root ao conector (o serviço roda como o usuário dmkwa):
//   GET  /admin/v1/atualizacao  compara o VERSION instalado com o publicado no ramo main (leitura simples).
//   POST /admin/v1/atualizacao  grava dados/atualizar.pedido. Uma unidade systemd .path (root), criada por
//        instalar/atualizar.sh (garantir_gatilho_atualizacao), percebe o arquivo e roda o MESMO
//        instalar/atualizar.sh de sempre — com backup e volta automática. O serviço reinicia e o painel
//        reconecta sozinho. O conector nunca executa nada como root.
const fs = require('node:fs'), path = require('node:path');
const fail = (m, status = 400) => Object.assign(Error(m), { status });
module.exports = function ({ dataDir, versao, raiz, buscar = fetch,
  arquivoGatilho = '/etc/systemd/system/dmk-wa-atualizar.path',
  urlVersao = 'https://raw.githubusercontent.com/89AE-5978/dmk-whatsapp/main/VERSION' }) {
  const pedido = path.join(dataDir, 'atualizar.pedido');
  let cache = null; // {quando, nova} — evita bater no GitHub a cada abertura do modal
  async function estado(semCache) {
    let nova = null, erro = '';
    if (!semCache && cache && Date.now() - cache.quando < 60000) nova = cache.nova;
    else {
      try {
        const r = await buscar(urlVersao, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw 0;
        nova = String(await r.text()).trim();
        if (!/^\d+\.\d+\.\d+$/.test(nova)) throw 0;
        cache = { quando: Date.now(), nova };
      } catch { nova = null; erro = 'Não foi possível consultar a versão publicada no GitHub. Confira a saída da VPS para a internet.'; }
    }
    return { versao_atual: versao, versao_nova: nova, ha_nova: !!nova && nova !== versao,
      gatilho_pronto: fs.existsSync(arquivoGatilho), pedido_pendente: fs.existsSync(pedido), ...(erro ? { erro } : {}) };
  }
  async function pedir() {
    const e = await estado(true);
    if (e.erro) throw fail(e.erro, 502);
    if (!e.ha_nova) throw fail('Já está na versão mais nova (' + versao + ').', 409);
    if (!e.gatilho_pronto) throw fail('Há versão nova, mas o gatilho ainda não existe nesta VPS. Rode uma vez, como root: bash ' + path.join(raiz, 'instalar', 'atualizar.sh') + ' — das próximas vezes o botão atualiza sozinho.', 409);
    fs.writeFileSync(pedido, new Date().toISOString() + '\n', { mode: 0o600 });
    return { ok: true, iniciada: true, de: versao, para: e.versao_nova };
  }
  return { estado, pedir };
};

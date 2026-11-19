#!/usr/bin/env bash
# DMK WhatsApp - atualiza o conector para a versão mais nova publicada no GitHub (ramo main).
#
#   bash instalar/atualizar.sh              atualiza se houver versão nova
#   bash instalar/atualizar.sh --verificar  só diz se há versão nova; não altera nada
#
# O que faz, nesta ordem:
#   1. Confere se há revisão nova. Se não há, termina sem tocar em nada.
#   2. Guarda UM backup em backups/antes-da-atualizacao.tar.gz (a pasta dados inteira e a revisão atual).
#      O backup novo é escrito ao lado e só então substitui o anterior.
#   3. Traz o código novo, o Node (se NODE_VERSION mudou) e as dependências.
#   4. Reinicia o serviço e espera: a versão nova responder e as sessões que estavam conectadas voltarem.
#   5. Se algo falhar, volta o código, o Node e as dependências para como estavam e reinicia.
# A pasta dados NÃO é restaurada na volta automática: as credenciais do WhatsApp mudam enquanto a sessão
# está ligada, e repor uma cópia antiga poderia derrubar a sessão. O backup fica para uso manual.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=instalar/comum.sh
source "$RAIZ/instalar/comum.sh"
MODO="${1:-}"
[[ "$MODO" == "" || "$MODO" == "--verificar" ]] || parar_com "Use: atualizar.sh [--verificar]"
RAMO="${DMK_WA_RAMO:-main}"
ESPERA="${DMK_WA_ESPERA:-120}"
cd "$RAIZ"
[[ -d .git ]] || parar_com "$RAIZ não é um clone do repositório; o atualizador precisa do Git."
exec 9> "$RAIZ/.atualizando.lock"
flock -n 9 || parar_com "Já existe uma atualização em andamento."  # os comandos que reiniciam o serviço fecham o descritor 9 para não herdar a trava
git fetch --quiet origin "$RAMO" || parar_com "Não foi possível consultar o GitHub. Nada foi alterado."
ANTES="$(git rev-parse HEAD)"; NOVA_REV="$(git rev-parse "origin/$RAMO")"
ATUAL="$(tr -d ' \n' < VERSION)"; NOVA="$(git show "origin/$RAMO:VERSION" | tr -d ' \n')"
if [[ "$ANTES" == "$NOVA_REV" ]]; then dizer "Já está na versão mais nova ($ATUAL)."; exit 0; fi
git merge-base --is-ancestor "$ANTES" "$NOVA_REV" || parar_com "A instalação tem revisões que não estão no GitHub. Nada foi alterado; confira com 'git status' e 'git log'."
if [[ "$MODO" == "--verificar" ]]; then dizer "Há versão nova: $ATUAL -> $NOVA. Rode sem --verificar para atualizar."; exit 0; fi
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || parar_com "Há arquivos do sistema alterados à mão nesta pasta. Nada foi alterado; veja 'git status'."
CONECTADAS="$(sessoes_conectadas)"
dizer "Atualizando DMK WhatsApp $ATUAL -> $NOVA ($CONECTADAS sessão(ões) conectada(s) agora)"
mkdir -p backups; chmod 700 backups
printf '%s\n' "$ANTES" > dados/.revisao-antes-da-atualizacao 2>/dev/null || true
tar -czf backups/.antes-da-atualizacao.tmp -C "$RAIZ" dados && chmod 600 backups/.antes-da-atualizacao.tmp && mv -f backups/.antes-da-atualizacao.tmp backups/antes-da-atualizacao.tar.gz
rm -f dados/.revisao-antes-da-atualizacao
dizer "Backup: $RAIZ/backups/antes-da-atualizacao.tar.gz (revisão anterior: ${ANTES:0:12})"

voltar() {
  dizer "FALHOU: $1"
  dizer "Voltando para a versão $ATUAL..."
  git reset --quiet --hard "$ANTES"
  if [[ -d node.anterior ]]; then rm -rf node; mv node.anterior node; fi
  instalar_dependencias "$RAIZ" || true
  "$SYSTEMCTL" restart "$SERVICO" 9>&- || true
  if esperar_saude "$ATUAL" 60; then dizer "Versão $ATUAL de volta e respondendo. Sessões conectadas: $(sessoes_conectadas)."; else dizer "ATENÇÃO: o serviço não respondeu depois da volta. Veja: journalctl -u $SERVICO -n 40 --no-pager"; fi
  exit 1
}
git merge --quiet --ff-only "$NOVA_REV" || parar_com "Não foi possível trazer o código novo. Nada foi alterado."
rm -rf node.anterior
garantir_node "$RAIZ" || voltar "não foi possível instalar o Node novo."
instalar_dependencias "$RAIZ" || voltar "não foi possível instalar as dependências."
chown -R dmkwa:dmkwa dados 2>/dev/null || true
"$SYSTEMCTL" restart "$SERVICO" 9>&- || voltar "o serviço não reiniciou."
esperar_saude "$NOVA" 60 || voltar "a versão $NOVA não respondeu em 60 s."
# As sessões reconectam sozinhas com a credencial salva; espera voltarem todas as que estavam conectadas.
for ((i = 0; i < ESPERA; i++)); do [[ "$(sessoes_conectadas)" -ge "$CONECTADAS" ]] && break; sleep 1; done
[[ "$(sessoes_conectadas)" -ge "$CONECTADAS" ]] || voltar "só $(sessoes_conectadas) de $CONECTADAS sessão(ões) reconectaram em $ESPERA s."
rm -rf node.anterior
dizer "ATUALIZADO: DMK WhatsApp $NOVA ativo, $(sessoes_conectadas) sessão(ões) conectada(s)."

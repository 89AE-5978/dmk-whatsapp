#!/usr/bin/env bash
# DMK WhatsApp - liga ou desliga a atualização automática diária (04:10, hora da máquina).
#
#   bash instalar/agendar-atualizacao.sh ligar
#   bash instalar/agendar-atualizacao.sh desligar
#
# Ligada, a máquina roda instalar/atualizar.sh todo dia: se houver versão nova no GitHub ela é aplicada,
# com backup e volta automática se as sessões não reconectarem. O resultado fica em
# journalctl -u dmk-wa-atualizar. Vem desligada: quem decide ligar é você.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$RAIZ/instalar/comum.sh"
[[ "$(id -u)" == "0" ]] || parar_com "Rode como root."
case "${1:-}" in
  ligar)
    printf '[Unit]\nDescription=DMK WhatsApp - atualizacao automatica\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/env bash %s/instalar/atualizar.sh\n' "$RAIZ" > /etc/systemd/system/dmk-wa-atualizar.service
    printf '[Unit]\nDescription=DMK WhatsApp - confere versao nova todo dia\n\n[Timer]\nOnCalendar=*-*-* 04:10:00\nRandomizedDelaySec=600\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/dmk-wa-atualizar.timer
    "$SYSTEMCTL" daemon-reload; "$SYSTEMCTL" enable --now --quiet dmk-wa-atualizar.timer
    dizer "Atualização automática LIGADA (todo dia, perto das 04:10). Para ver o último resultado: journalctl -u dmk-wa-atualizar -n 30 --no-pager" ;;
  desligar)
    "$SYSTEMCTL" disable --now --quiet dmk-wa-atualizar.timer 2>/dev/null || true
    rm -f /etc/systemd/system/dmk-wa-atualizar.timer; "$SYSTEMCTL" daemon-reload   # a unidade de serviço fica: o botão Atualizar do painel usa a mesma
    dizer "Atualização automática DESLIGADA (o botão Atualizar do painel continua funcionando). Para atualizar à mão: bash $RAIZ/instalar/atualizar.sh" ;;
  *) parar_com "Use: agendar-atualizacao.sh ligar|desligar" ;;
esac

#!/usr/bin/env bash
# DMK WhatsApp - remove o serviço e os ponteiros de fora da pasta. Não apaga a pasta.
#
#   bash instalar/desinstalar.sh --confirmar
#
# As sessões (dados/) e o backup continuam na pasta; apagar a pasta é uma decisão sua, feita à mão.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$RAIZ/instalar/comum.sh"
[[ "$(id -u)" == "0" ]] || parar_com "Rode como root."
[[ "${1:-}" == "--confirmar" ]] || parar_com "Isto para o WhatsApp de todos os sistemas ligados a este conector. Rode com --confirmar."
"$SYSTEMCTL" disable --now --quiet dmk-wa-atualizar.timer 2>/dev/null || true
"$SYSTEMCTL" disable --now --quiet "$SERVICO" 2>/dev/null || true
rm -f "/etc/systemd/system/$SERVICO.service" /etc/systemd/system/dmk-wa-atualizar.service /etc/systemd/system/dmk-wa-atualizar.timer /usr/local/bin/dmk-wa
"$SYSTEMCTL" daemon-reload
dizer "Serviço e comando removidos. A pasta $RAIZ (com dados/ e backups/) foi mantida."

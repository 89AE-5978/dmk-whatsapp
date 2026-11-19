#!/usr/bin/env bash
# DMK WhatsApp - instala o conector nesta pasta (a pasta onde o repositório foi clonado, ex.: /opt/dmk-whatsapp).
#
#   bash instalar/instalar.sh
#
# Tudo fica dentro da pasta: node/ (Node próprio), node_modules/, dados/ (sessões e chave), backups/.
# Fora dela só os ponteiros que o Linux exige, anotados em instalacao.json:
#   /etc/systemd/system/dmk-wa-conector.service   o serviço
#   /usr/local/bin/dmk-wa                         o comando de administração
# Não mexe em nenhum outro serviço, site ou pasta da máquina. Pode ser rodado de novo: não apaga sessões
# nem troca a chave de administrador.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=instalar/comum.sh
source "$RAIZ/instalar/comum.sh"
[[ "$(id -u)" == "0" ]] || parar_com "Rode como root."
[[ -f "$RAIZ/conector.js" && -f "$RAIZ/VERSION" ]] || parar_com "$RAIZ não é a pasta do DMK WhatsApp."
VERSAO="$(tr -d ' \n' < "$RAIZ/VERSION")"
if ! "$SYSTEMCTL" is-active --quiet "$SERVICO" 2>/dev/null && ss -ltnH "sport = :$PORTA" 2>/dev/null | grep -q .; then
  parar_com "A porta $PORTA já está em uso por outro programa. Rode de novo com DMK_WA_PORTA=<porta livre> na frente."
fi
dizer "Instalando DMK WhatsApp $VERSAO em $RAIZ (porta $PORTA, só em 127.0.0.1)"
garantir_node "$RAIZ"
instalar_dependencias "$RAIZ" || parar_com "Não foi possível instalar as dependências. Nada foi ativado."
# Usuário próprio e sem login: o conector não roda como root.
id dmkwa >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$RAIZ" --shell /usr/sbin/nologin dmkwa
mkdir -p "$RAIZ/dados" "$RAIZ/backups"
if [[ ! -s "$RAIZ/dados/admin.key" ]]; then
  (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$RAIZ/dados/admin.key")
  dizer "Chave de administrador criada em $RAIZ/dados/admin.key (o comando dmk-wa a usa; ela não é mostrada na tela)."
fi
chown -R dmkwa:dmkwa "$RAIZ/dados"; chmod 700 "$RAIZ/dados" "$RAIZ/backups"; chmod 600 "$RAIZ/dados/admin.key"
cat > "/etc/systemd/system/$SERVICO.service" <<UNIT
[Unit]
Description=DMK WhatsApp - conector global (varias sessoes)
After=network-online.target
Wants=network-online.target

[Service]
User=dmkwa
Group=dmkwa
WorkingDirectory=$RAIZ
Environment=NODE_ENV=production DMK_WA_PORTA=$PORTA DMK_WA_DADOS=$RAIZ/dados
ExecStart=$RAIZ/node/bin/node $RAIZ/conector.js
Restart=always
RestartSec=5
MemoryMax=1G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$RAIZ/dados

[Install]
WantedBy=multi-user.target
UNIT
ln -sfn "$RAIZ/ferramentas/dmk-wa" /usr/local/bin/dmk-wa
chmod +x "$RAIZ/ferramentas/dmk-wa" "$RAIZ/instalar/"*.sh
printf '{\n  "sistema": "dmk-whatsapp",\n  "pasta": "%s",\n  "porta": %s,\n  "usuario": "dmkwa",\n  "fora_da_pasta": ["/etc/systemd/system/%s.service", "/usr/local/bin/dmk-wa"]\n}\n' "$RAIZ" "$PORTA" "$SERVICO" > "$RAIZ/instalacao.json"
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable --quiet "$SERVICO"
"$SYSTEMCTL" restart "$SERVICO"
if esperar_saude "$VERSAO" 60; then
  dizer "PRONTO: DMK WhatsApp $VERSAO ativo em http://127.0.0.1:$PORTA"
  dizer "Próximo passo: dmk-wa nova \"Nome da sessão\" <sistema-dono>   (veja docs/INSTALACAO.md)"
else
  parar_com "O serviço não respondeu em 60 s. Veja: journalctl -u $SERVICO -n 40 --no-pager"
fi

#!/usr/bin/env bash
# DMK WhatsApp - publica o conector num domínio HTTPS.
#
# Só o caminho do protocolo (/api/public/dmk-connector/v1/) sai para a internet. Qualquer outro
# endereço responde 404: a administração (/admin/v1), o painel (/painel) e a saúde (/health)
# continuam existindo apenas em 127.0.0.1, alcançáveis só por túnel SSH.
#
# Por que isso é necessário: os sistemas DMK que falam o protocolo exigem "https://dominio" num
# IP público, na porta 443. Eles não conseguem falar com 127.0.0.1:8098 direto.
#
# Não encosta em nenhum outro site da máquina: cria um arquivo próprio em sites-available e,
# se algo falhar, remove o que criou e recarrega o Nginx como estava.
#
# Uso:  sudo bash instalar/publicar-nginx.sh zap.danilodss.com.br voce@email.com
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=instalar/comum.sh
source "$RAIZ/instalar/comum.sh"

DOMINIO="${1:-}"; EMAIL="${2:-}"
NGINX_DIR="${DMK_WA_NGINX_DIR:-/etc/nginx}"
NGINX="${DMK_WA_NGINX:-nginx}"
CERTBOT="${DMK_WA_CERTBOT:-certbot}"
BASE_PUBLICA='/api/public/dmk-connector/v1/'

[[ "$(id -u)" == "0" ]] || parar_com "Rode como root."
[[ -n "$DOMINIO" ]] || parar_com "Uso: sudo bash instalar/publicar-nginx.sh <dominio> <email>"
[[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || parar_com "Informe só o domínio, em minúsculas, sem https:// e sem caminho."
[[ -n "$EMAIL" ]] || parar_com "Informe um e-mail para o certificado (avisos de expiração)."
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]] || parar_com "E-mail inválido: $EMAIL"
command -v "$NGINX" >/dev/null || parar_com "O Nginx não está instalado nesta máquina."
ARQUIVO="$NGINX_DIR/sites-available/dmk-wa-$DOMINIO"
LIGADO="$NGINX_DIR/sites-enabled/dmk-wa-$DOMINIO"

# Recusa domínio que já pertence a outro site, antes de escrever qualquer coisa.
# Duas etapas: primeiro as linhas server_name, depois o domínio como palavra inteira nelas.
DOMINIO_RE="${DOMINIO//./\\.}"
for outro in "$NGINX_DIR"/sites-available/*; do
  [[ -f "$outro" && "$outro" != "$ARQUIVO" ]] || continue
  if grep -E "^[[:space:]]*server_name[[:space:]]" "$outro" \
     | grep -qE "(^|[[:space:]])$DOMINIO_RE([[:space:];]|$)"; then
    parar_com "O domínio $DOMINIO já é usado por $(basename "$outro"). Escolha outro ou retire-o de lá antes."
  fi
done

# O conector precisa estar no ar: publicar um endereço que responde erro não ajuda ninguém.
if [[ "${DMK_WA_SEM_REDE:-}" != "1" ]]; then
  curl -fsS --max-time 5 "http://127.0.0.1:$PORTA/health" >/dev/null \
    || parar_com "O conector não respondeu em 127.0.0.1:$PORTA. Suba o serviço antes de publicar: systemctl start $SERVICO"
fi

dizer "Publicando $DOMINIO -> 127.0.0.1:$PORTA (somente $BASE_PUBLICA)"
NOVO=0; [[ -f "$ARQUIVO" ]] || NOVO=1
GUARDA="$(mktemp -d)"
[[ $NOVO -eq 0 ]] && cp -a "$ARQUIVO" "$GUARDA/antes"

desfazer() {
  dizer ''
  dizer 'FALHOU. Desfazendo e deixando o Nginx como estava...'
  if [[ $NOVO -eq 1 ]]; then rm -f "$ARQUIVO" "$LIGADO"; else cp -a "$GUARDA/antes" "$ARQUIVO"; fi
  "$NGINX" -t >/dev/null 2>&1 && "$SYSTEMCTL" reload nginx >/dev/null 2>&1 || true
  rm -rf "$GUARDA"
  exit 1
}
trap desfazer ERR

# Primeiro só HTTP: o certbot precisa responder ao desafio antes de existir certificado.
cat > "$ARQUIVO" <<EOF
# DMK WhatsApp - gerado por instalar/publicar-nginx.sh. Editar aqui é perdido na próxima publicação.
server {
  listen 80;
  listen [::]:80;
  server_name $DOMINIO;
  # Só o protocolo do conector sai para a internet.
  location $BASE_PUBLICA {
    proxy_pass http://127.0.0.1:$PORTA$BASE_PUBLICA;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 90;
    client_max_body_size 20m;
  }
  # Administração, painel e saúde ficam só em 127.0.0.1.
  location / { return 404; }
}
EOF
ln -sfn "$ARQUIVO" "$LIGADO"
"$NGINX" -t >/dev/null
"$SYSTEMCTL" reload nginx

if [[ "${DMK_WA_SEM_CERTBOT:-}" == "1" ]]; then
  dizer '(teste) certificado pulado.'
else
  command -v "$CERTBOT" >/dev/null || parar_com "O certbot não está instalado. Instale com: apt-get install -y certbot python3-certbot-nginx"
  dizer "Pedindo o certificado para $DOMINIO..."
  "$CERTBOT" --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL" --redirect
  "$NGINX" -t >/dev/null
  "$SYSTEMCTL" reload nginx
fi

# Confere o que ficou publicado: o protocolo tem de responder e o resto tem de ficar fora.
if [[ "${DMK_WA_SEM_REDE:-}" != "1" ]]; then
  dizer 'Conferindo o que ficou exposto...'
  protocolo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMINIO${BASE_PUBLICA}events" || true)"
  # Sem credencial o protocolo responde 401: é a prova de que chegou no conector.
  [[ "$protocolo" == "401" ]] || { dizer "O protocolo respondeu $protocolo em vez de 401 (sem credencial)."; false; }
  for proibido in admin/v1/sessoes health painel/; do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMINIO/$proibido" || true)"
    [[ "$codigo" == "404" ]] || { dizer "PERIGO: https://$DOMINIO/$proibido respondeu $codigo; deveria ser 404."; false; }
  done
  dizer "OK: só o protocolo está exposto; administração, painel e saúde continuam fora."
fi

trap - ERR
rm -rf "$GUARDA"
# Anota o arquivo do Nginx junto dos outros ponteiros de fora da pasta, para o desinstalador achar.
if [[ -f "$RAIZ/instalacao.json" ]] && ! grep -q "dmk-wa-$DOMINIO" "$RAIZ/instalacao.json"; then
  python3 - "$RAIZ/instalacao.json" "$ARQUIVO" "$LIGADO" "$DOMINIO" <<'PY'
import json,sys
caminho,disponivel,ligado,dominio=sys.argv[1:5]
with open(caminho) as f: dados=json.load(f)
fora=dados.setdefault('fora_da_pasta',[])
for p in (disponivel,ligado):
    if p not in fora: fora.append(p)
dados['dominio_publico']=dominio
with open(caminho,'w') as f: json.dump(dados,f,ensure_ascii=False,indent=2); f.write('\n')
PY
fi

dizer ''
dizer "PRONTO: o conector atende em https://$DOMINIO${BASE_PUBLICA}"
dizer 'Nos sistemas DMK, informe apenas o domínio (sem caminho e sem porta).'
dizer "A administração continua só em 127.0.0.1:$PORTA, por túnel SSH."

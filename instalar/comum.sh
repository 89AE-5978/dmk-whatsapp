#!/usr/bin/env bash
# DMK WhatsApp - funções usadas pelo instalador e pelo atualizador. Não é para rodar sozinho.
#
# Variáveis DMK_WA_* abaixo existem para os testes automáticos trocarem o systemctl e pularem os
# downloads. Em produção ninguém as define.
SERVICO="dmk-wa-conector"
SYSTEMCTL="${DMK_WA_SYSTEMCTL:-systemctl}"
PORTA="${DMK_WA_PORTA:-8098}"

dizer() { printf '%s\n' "$*"; }
parar_com() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

# Node próprio dentro da pasta (node/), na versão do arquivo NODE_VERSION, conferido pelo SHA-256
# publicado em nodejs.org. Nenhum outro sistema usa este Node e este conector não usa o de ninguém.
garantir_node() {
  local raiz="$1" versao atual arquivo temp soma
  versao="$(tr -d ' \n' < "$raiz/NODE_VERSION")"
  [[ "$versao" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || parar_com "NODE_VERSION inválido: $versao"
  atual="$("$raiz/node/bin/node" --version 2>/dev/null || true)"
  if [[ "$atual" == "v$versao" ]]; then dizer "Node $atual já instalado."; return 0; fi
  if [[ "${DMK_WA_SEM_REDE:-}" == "1" ]]; then dizer "(teste) download do Node $versao pulado."; return 0; fi
  [[ "$(uname -m)" == "x86_64" ]] || parar_com "Este instalador baixa o Node para x86_64; esta máquina é $(uname -m)."
  arquivo="node-v$versao-linux-x64.tar.xz"
  temp="$(mktemp -d "$raiz/.node-novo-XXXXXX")"
  dizer "Baixando Node $versao..."
  curl -fsSL --retry 3 -o "$temp/$arquivo" "https://nodejs.org/dist/v$versao/$arquivo" || { rm -rf "$temp"; parar_com "Não foi possível baixar o Node $versao."; }
  curl -fsSL --retry 3 -o "$temp/SHASUMS256.txt" "https://nodejs.org/dist/v$versao/SHASUMS256.txt" || { rm -rf "$temp"; parar_com "Não foi possível baixar a lista de conferência do Node."; }
  soma="$(grep " $arquivo\$" "$temp/SHASUMS256.txt" | cut -d' ' -f1)"
  [[ -n "$soma" && "$(sha256sum "$temp/$arquivo" | cut -d' ' -f1)" == "$soma" ]] || { rm -rf "$temp"; parar_com "O arquivo do Node não confere com o SHA-256 publicado. Nada foi trocado."; }
  mkdir "$temp/node" && tar -xJf "$temp/$arquivo" -C "$temp/node" --strip-components=1
  [[ "$("$temp/node/bin/node" --version)" == "v$versao" ]] || { rm -rf "$temp"; parar_com "O Node baixado não executa nesta máquina."; }
  rm -rf "$raiz/node.anterior"
  [[ -d "$raiz/node" ]] && mv "$raiz/node" "$raiz/node.anterior"
  mv "$temp/node" "$raiz/node"; rm -rf "$temp"
  dizer "Node v$versao instalado em $raiz/node."
}

# Dependências (Baileys e qrcode) nas versões fixadas no package.json. Com package-lock.json no
# repositório usa "npm ci", que instala exatamente o que foi travado.
instalar_dependencias() {
  local raiz="$1"
  if [[ "${DMK_WA_SEM_REDE:-}" == "1" ]]; then dizer "(teste) instalação de dependências pulada."; return 0; fi
  local npm=("$raiz/node/bin/node" "$raiz/node/lib/node_modules/npm/bin/npm-cli.js")
  if [[ -f "$raiz/package-lock.json" ]]; then (cd "$raiz" && "${npm[@]}" ci --omit=dev --no-audit --no-fund) || return 1
  else (cd "$raiz" && "${npm[@]}" install --omit=dev --no-audit --no-fund --no-package-lock) || return 1; fi
}

# Espera o serviço responder com a versão esperada. Devolve 0 quando respondeu.
esperar_saude() {
  local versao="$1" segundos="${2:-60}" i resposta
  for ((i = 0; i < segundos; i++)); do
    resposta="$(curl -fsS -m 3 "http://127.0.0.1:$PORTA/health" 2>/dev/null || true)"
    if [[ "$resposta" == *"\"versao\":\"$versao\""* ]]; then return 0; fi
    sleep 1
  done
  return 1
}
# Quantas sessões estão conectadas agora (0 se o serviço não responde).
sessoes_conectadas() {
  curl -fsS -m 3 "http://127.0.0.1:$PORTA/health" 2>/dev/null | sed -n 's/.*"conectadas":\([0-9]*\).*/\1/p' | grep . || echo 0
}

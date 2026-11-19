# Ligar um sistema ao conector

Regra: **uma sessão por número, uma autorização por sistema**. Sistemas que devem ver as mesmas
conversas recebem autorizações da mesma sessão. Sistemas que não devem se ver usam sessões diferentes.

Em todos os casos o primeiro passo é gerar o código na VPS:

```bash
dmk-wa autorizar <id-da-sessão> "<nome do sistema>" <sistema> --confirmar
```

## Sistema na mesma máquina do conector

Endereço: `http://127.0.0.1:8098`. Não passa pela internet e não precisa de nginx.

### Site da gestão (`/opt/dmk`)

O site já tem o cliente (`conector.py`, "Provedor = Central DMK"). O endereço da central é lido da
variável `DMK_CONECTOR_URL` antes da configuração gravada.

1. Em `/opt/dmk/config.env`, acrescente `DMK_CONECTOR_URL=http://127.0.0.1:8098` e reinicie `dmk-site`.
2. No site: WhatsApp > Conexão > Provedor **Central DMK**, e informe o código.
3. Confirme ida e volta com um número de teste antes de desligar a ponte antiga (`dmk-whatsapp`).

Ainda não conferido na máquina: este roteiro foi escrito lendo o `conector.py`; o caminho exato na tela
pode ter outro nome. A ponte antiga e o conector não podem ficar ligados no mesmo número ao mesmo tempo.

### DMK Smart Core

Ainda não tem cliente. Para avisos (bomba, travas, alarmes) basta `POST /send`; o exemplo abaixo serve
de base.

## Sistema em outra máquina

Os clientes existentes (PDV do Prisma, `conector.py`) exigem HTTPS. Publique **só** o caminho do
protocolo num subdomínio com certificado:

```nginx
server {
    server_name wa.exemplo.com.br;
    client_max_body_size 16m;
    location /api/public/dmk-connector/v1/ {
        proxy_pass http://127.0.0.1:8098;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60;
    }
    location / { return 404; }
    # listen 443 ssl e certificados: pelo certbot
}
```

`/admin/v1` e `/health` não entram no nginx.

No PDV do Prisma: WhatsApp > Criar instância > Conector DMK, com a origem `https://wa.exemplo.com.br` e o código.

## Sistema novo: o mínimo em Python

```python
import json, secrets, time, urllib.request
BASE = 'http://127.0.0.1:8098/api/public/dmk-connector/v1'

def chamar(metodo, rota, corpo=None, token=None):
    cab = {'Content-Type': 'application/json', 'X-DMK-Features': 'actions'}
    if token: cab['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + rota, json.dumps(corpo).encode() if corpo else None, cab, method=metodo)
    return json.load(urllib.request.urlopen(req, timeout=30))

# 1) Uma vez: troca o código pela credencial. GUARDE a credencial com proteção; ela não é mostrada de novo.
token = chamar('POST', '/exchange', {'code': 'CODIGO_DO_DMK_WA', 'protocol': 2})['token']

# 2) Enviar. O request_id é seu: gere, grave e repita o MESMO se precisar tentar de novo.
chamar('POST', '/send', {'to': '5581999999999', 'text': 'Bomba ligada às 14:02', 'request_id': 'aviso_' + secrets.token_hex(12)}, token)

# 3) Receber: busca, grava do seu lado, confirma. Só depois da confirmação o evento sai do conector.
while True:
    r = chamar('GET', '/events', token=token)
    for ev in r['events']:
        gravar_no_meu_banco(ev)            # se tiver anexo: GET /media/<id> ANTES de confirmar
    if r['events']: chamar('POST', '/ack', {'ids': [ev['id'] for ev in r['events']]}, token)
    time.sleep(4)
```

Resposta 401 em qualquer chamada = acesso revogado ou vencido: pare as consultas e peça um código novo.
A autorização vale 90 dias.

## Testar sem número real

Suba um conector à parte no modo simulado, em outra porta e outra pasta de dados:

```bash
mkdir -p /tmp/wa-teste && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /tmp/wa-teste/admin.key && chmod 600 /tmp/wa-teste/admin.key
DMK_WA_SIMULADO=1 DMK_WA_PORTA=8198 DMK_WA_DADOS=/tmp/wa-teste /opt/dmk-whatsapp/node/bin/node /opt/dmk-whatsapp/conector.js
```

Com a chave de `/tmp/wa-teste/admin.key` em `Authorization: Bearer`, `POST /admin/v1/sessoes/<id>/simular-leitura-qr`
faz o papel do celular e `POST /admin/v1/sessoes/<id>/simular-mensagem` (`{"de":"5581999990001","texto":"oi"}`)
faz o papel de um cliente escrevendo. Essas duas rotas só existem no modo simulado.

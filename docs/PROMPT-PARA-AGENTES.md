# Prompt para outros agentes — ligar um sistema ao DMK WhatsApp

Entregue o texto abaixo (da linha `---` até o fim) ao agente que for ligar um sistema ao conector.
Ele é autossuficiente: não depende de nada desta conversa.

Antes de entregar, troque os campos entre `<>` pelos valores do caso:

| Campo | O que pôr |
|---|---|
| `<SISTEMA>` | o sistema que vai ser ligado (ex.: site da gestão em `/opt/dmk`, DMK Smart Core, PDV de uma empresa) |
| `<ENDERECO>` | `http://127.0.0.1:8098` se o sistema roda na mesma máquina; senão o subdomínio HTTPS |
| `<CODIGO>` | o código gerado com `dmk-wa autorizar` (vale 10 minutos, um uso só) |

---

## Contexto

Você vai ligar o sistema **`<SISTEMA>`** ao **DMK WhatsApp**, o conector global de WhatsApp da DMK.

O conector é um serviço só, instalado em `/opt/dmk-whatsapp` na VPS, que mantém as conexões de WhatsApp
de todos os sistemas DMK. Cada **sessão** é um número de WhatsApp. Cada sistema recebe uma
**autorização** numa sessão e passa a ler e responder as conversas daquele número.

Repositório e documentação: `https://github.com/89AE-5978/dmk-whatsapp`

**Antes de escrever qualquer linha de código, leia `docs/API.md` do repositório — inteira.** Ela é a
referência completa da API: gateways, credencial, eventos com todos os campos, **todos os formatos de
envio com exemplo pronto** (texto, citação, imagem, vídeo, documento, áudio, mensagem de voz,
localização, cartão de contato, enquete, lista e botões), limites, o que fazer com cada código de erro,
logs e o que a API **não** faz. Não invente rota nem formato: o que não está lá, não existe.
Depois dela, `docs/LIGAR-UM-SISTEMA.md` (exemplos por sistema) e `docs/CHATBOT.md` (automação).

## Divisão de responsabilidades (não misture)

| O conector guarda | O seu sistema guarda |
|---|---|
| A conexão do número (credenciais do WhatsApp) | As conversas e o histórico |
| As autorizações | Os contatos e o atendimento |
| Os eventos que você ainda não confirmou | Os anexos, depois de baixados |

Assim que você confirma um evento (`POST /ack`), ele sai do conector. **O conector não é o seu banco de
mensagens**: se você não gravar antes de confirmar, a mensagem se perde.

## O que você precisa fazer

Endereço do conector: **`<ENDERECO>`** · Base do protocolo: `/api/public/dmk-connector/v1`

### 1. Trocar o código pela credencial (uma vez só)

```
POST <ENDERECO>/api/public/dmk-connector/v1/exchange
{ "code": "<CODIGO>", "protocol": 2 }
→ { "token": "...", "connector": { ... } }
```

Grave a credencial (`token`) com proteção, do mesmo jeito que o sistema guarda outras senhas. Ela não é
mostrada de novo. O código vale 10 minutos e um uso: se perder, peça outro a quem administra a VPS
(`dmk-wa autorizar`). **Sem `"protocol": 2` a troca é recusada com 409** e o código não é gasto.

### 2. Receber mensagens

Laço a cada 4 segundos, com `Authorization: Bearer <credencial>` e o cabeçalho `X-DMK-Features: actions`:

```
GET  /events                 → { events: [ { id, type, data, at } ], status: { status, phone } }
GET  /media/<id do evento>   → bytes do anexo (SÓ antes de confirmar)
POST /ack  { "ids": [...] }  → confirma até 30 eventos
```

Ordem obrigatória: **buscar → baixar o anexo (se houver) → gravar no seu banco → confirmar**. Nunca
confirme antes de gravar.

Tipos de evento: `message` (traz `peer`, `phone`, `name`, `messageId`, `text`, `media`, `outgoing`,
`timestamp`), `delivery` (`messageId`, `status`), e com o cabeçalho `actions` também `reaction`,
`revoke` (apagada) e `edit`.

### 3. Enviar mensagens

```
POST /send
{ "to": "5581999999999", "text": "Mensagem", "request_id": "um_id_seu_unico" }
→ { "externalId": "..." }
```

- `request_id`: de 16 a 100 letras, números, `_` ou `-`. **Gere, grave antes de enviar e repita o mesmo
  se precisar tentar de novo.** Mesmo ID com o mesmo conteúdo devolve o mesmo `externalId` sem enviar
  duas vezes. Mesmo ID com conteúdo diferente é recusado (409).
- Anexo: `"media": { "base64": "...", "mimetype": "...", "filename": "..." }`, até 10 MB.
- Citação: `"reply": { "id": "<messageId>", "from_me": false, "body": "trecho citado" }`.

Outras operações (mesma credencial): `POST /react`, `POST /edit`, `POST /delete`, `POST /presence`,
`GET /presence?to=`, `POST /read`, `GET /photo?to=`.

### 3b. Atendimento compartilhado (mesmo número em vários sistemas)

Se a sessão estiver ligada a mais de um sistema (modo `leads`, o padrão):

- Envie `X-DMK-Features: actions,routing` no `GET /events`.
- Lead novo chega para todos. Mostre um botão **Assumir** (`POST /claim { "to" }`); responder com
  `POST /send` também assume.
- Evento `assigned` com `mine: false`: outro sistema assumiu — **tire a conversa da tela**. Com `mine: true`
  a conversa é sua.
- Evento `released`: a conversa foi finalizada e volta a ser lead.
- Botão **Finalizar** = `POST /release { "to" }`.
- `GET /conversations` e `GET /messages?to=` devolvem só leads e as conversas do seu sistema.
- `409` com "em atendimento por …" ao enviar: outro sistema está com o contato; não insista.
- Sistema que só manda notificação (cobrança, alerta): peça ao administrador para marcar a conexão como
  **Avisos** no painel — assim ela envia sem assumir a conversa de ninguém.

### 4. Tratar os erros exatamente assim

| Resposta | O que significa | O que fazer |
|---|---|---|
| `401` | Autorização revogada ou vencida (vale 90 dias) | **Pare o laço de consulta.** Marque o canal como desconectado e peça um código novo. Não fique tentando. |
| `409` com `"delivery_uncertain": true` | O WhatsApp não confirmou o envio | Confira a conversa antes de repetir. **Não gere outro `request_id`** para contornar. |
| `400`/`503` sem `delivery_uncertain` | Recusado de vez: número sem WhatsApp ou sessão desconectada. Nada foi enviado | Mostre o erro. Pode repetir o **mesmo** `request_id` depois de corrigir. |
| `409` "em atendimento por …" | Outro sistema assumiu este contato | Tire a conversa da tela; não reenvie. |
| `429` | Consultas demais | Aumente o intervalo. |

## Regras que você não pode quebrar

1. **Não invente outro protocolo.** Use exatamente as rotas acima. Elas são as mesmas da Central do DMK
   Prisma; qualquer sistema DMK que já fale "Conector DMK" funciona sem alteração.
2. **Nunca publique `/admin/v1` nem `/health` no nginx.** Só o caminho `/api/public/dmk-connector/v1/`
   pode sair para a internet, e por HTTPS.
3. **Nunca grave a credencial em registro (log), em arquivo de texto aberto nem no Git.**
4. **Não mexa em outras sessões.** A credencial que você recebeu vale para uma sessão só. Se precisar de
   outro número, peça outra sessão a quem administra; não tente usar a mesma credencial.
5. **Dois programas não podem usar o mesmo número ao mesmo tempo.** Se o sistema já tinha uma ponte
   própria de WhatsApp, desligue-a antes de conectar o mesmo número aqui, ou use outro número.
6. **Não altere nada dentro de `/opt/dmk-whatsapp`.** O conector é mantido pelo repositório dele e se
   atualiza sozinho. Mudanças feitas à mão travam o atualizador.
7. **Antes de ligar em produção**, confirme ida e volta com um número de teste: mande uma mensagem,
   veja chegar no seu sistema, responda e veja chegar no celular.

## Se o sistema for em Python, o mínimo funcionando

```python
import json, secrets, time, urllib.request
BASE = '<ENDERECO>/api/public/dmk-connector/v1'

def chamar(metodo, rota, corpo=None, token=None):
    cab = {'Content-Type': 'application/json', 'X-DMK-Features': 'actions'}
    if token: cab['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + rota, json.dumps(corpo).encode() if corpo else None, cab, method=metodo)
    return json.load(urllib.request.urlopen(req, timeout=30))

token = chamar('POST', '/exchange', {'code': '<CODIGO>', 'protocol': 2})['token']  # uma vez; guarde

chamar('POST', '/send', {'to': '5581999999999', 'text': 'Olá',
                         'request_id': 'env_' + secrets.token_hex(12)}, token)

while True:                                   # laço de recebimento
    r = chamar('GET', '/events', token=token)
    for ev in r['events']:
        gravar_no_meu_banco(ev)               # anexo: GET /media/<ev["id"]> ANTES do ack
    if r['events']:
        chamar('POST', '/ack', {'ids': [ev['id'] for ev in r['events']]}, token)
    time.sleep(4)
```

## Como testar sem gastar um número real

Peça a quem administra a VPS para subir um conector de teste no modo simulado (está em
`docs/LIGAR-UM-SISTEMA.md`, seção "Testar sem número real"). Nele, duas rotas de administração fazem o
papel do celular e de um cliente escrevendo, e nada vai para o WhatsApp de verdade.

## O que relatar ao terminar

1. Onde a credencial ficou guardada no sistema (o arquivo ou campo, **sem mostrar o valor**).
2. O teste de ida e volta que você fez, com o resultado.
3. O que mudou no código do sistema, arquivo por arquivo.
4. O que ficou pendente ou não deu para conferir.

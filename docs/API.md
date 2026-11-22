# API do Conector DMK WhatsApp — referência completa

Versão desta documentação: **1.3.16** (confira em `GET /health` → `versao`).
Vale para o conector que roda em `/opt/dmk-whatsapp` (serviço `dmk-wa-conector`).

Esta página descreve **como a API se comporta hoje**: o que dá para enviar, o que dá para receber, o
que não existe, os limites, os códigos de erro, os logs e como a automação (chatbot) entra no meio.
Quem for ligar um sistema deve ler **esta página inteira** antes de escrever código — não adivinhe
rotas nem formatos.

Índice:

1. [Como o conector é organizado](#1-como-o-conector-é-organizado)
2. [Portas e gateways](#2-portas-e-gateways)
3. [Começar em 5 passos](#3-começar-em-5-passos)
4. [Credencial, sessão e conexão](#4-credencial-sessão-e-conexão)
5. [Receber mensagens (`GET /events`)](#5-receber-mensagens-get-events)
6. [Enviar (`POST /send`) — todos os formatos](#6-enviar-post-send--todos-os-formatos)
7. [Ações sobre mensagens e contato](#7-ações-sobre-mensagens-e-contato)
8. [Atendimento: leads, assumir e finalizar](#8-atendimento-leads-assumir-e-finalizar)
9. [Automação (chatbot)](#9-automação-chatbot)
10. [Limites e validações](#10-limites-e-validações)
11. [Erros: o que fazer com cada código](#11-erros-o-que-fazer-com-cada-código)
12. [Administração — `/admin/v1`](#12-administração--adminv1)
13. [Logs e diagnóstico](#13-logs-e-diagnóstico)
14. [Como o conector evita travar](#14-como-o-conector-evita-travar)
15. [O que a API **não** faz](#15-o-que-a-api-não-faz)
16. [Novidades da 1.3.16](#16-novidades-da-1316)

---

## 1. Como o conector é organizado

```
WhatsApp (celular/aparelho)
        │  biblioteca Baileys 7 (WhatsApp Web)
   ┌────▼───────────────────────────────────────────────┐
   │  SESSÃO = um número de WhatsApp                    │
   │   ├─ histórico e anexos (pasta por conexão)        │
   │   ├─ chatbot (fluxo por conexão)                   │
   │   └─ CONEXÕES (autorizações): um sistema cada      │
   │        • DMK Prisma      (atendimento)             │
   │        • DMK Gestão      (atendimento)             │
   │        • DMK Smart Core  (avisos)                  │
   └────┬───────────────────────────────────────────────┘
        │  protocolo HTTP (esta API)
   sistemas/chats
```

- **Sessão**: um número de WhatsApp. Até 50 sessões no mesmo conector.
- **Conexão** (autorização): um sistema ligado àquela sessão, com **ID próprio**, credencial própria,
  fila de eventos própria e pasta própria de histórico/anexos. Vários sistemas usam o mesmo número sem
  se ver.
- **Tipo da conexão**: `atendimento` (conversa com o cliente) ou `avisos` (só dispara: cobrança, alerta
  do Smart Core; não assume conversa e não é barrada por quem está atendendo).
- **Distribuição**: `leads` (padrão) — contato novo vai para todas as conexões de atendimento, quem
  responde fica com ele — ou `todos` — todos recebem tudo.

Cada mensagem recebida é **entregue às conexões** e **gravada no histórico da sessão**, na pasta de
quem está atendendo. Mesmo que um sistema fique dias fora do ar, a conversa está guardada
(`GET /conversations` e `GET /messages`).

---

## 2. Portas e gateways

| Gateway | Endereço | Para quê | Autenticação |
|---|---|---|---|
| Saúde | `GET http://127.0.0.1:8098/health` | Monitoramento | nenhuma |
| Protocolo dos sistemas | `/api/public/dmk-connector/v1/...` | Receber e enviar mensagens | `Authorization: Bearer <credencial da conexão>` (menos `/exchange`) |
| Administração | `/admin/v1/...` | Criar sessão, ligar sistema, QR, distribuição | `Authorization: Bearer <conteúdo de dados/admin.key>` |
| Painel web | `/painel/` | Tela para humanos (túnel SSH) | a mesma chave de admin |

A porta é `8098` por padrão (`DMK_WA_PORTA`). O protocolo também responde pelo subdomínio HTTPS
(ex.: `https://zap.danilodss.com.br/api/public/dmk-connector/v1/...`); **a administração e o painel só
pelo túnel SSH**, nunca abertos na internet.

Todas as respostas são JSON. Erro vem sempre como `{ "error": "mensagem em português" }` com o código
HTTP correspondente — a mensagem pode ir direto para a tela do atendente.

`GET /health` devolve: `ok`, `versao`, `node`, `simulado`, `sessoes`, `ativas`, `conectadas`. Nada
sensível (serve para o monitoramento externo).

---

## 3. Começar em 5 passos

Peça ao administrador um **código de 10 minutos** (painel → Sistemas ligados → Ligar um sistema, ou
`POST /admin/v1/sessoes/<id>/autorizacoes`). Depois:

```bash
BASE=https://zap.danilodss.com.br/api/public/dmk-connector/v1

# 1) Trocar o código pela credencial permanente (vale 90 dias, renova sozinha ao usar)
curl -s -X POST $BASE/exchange -H 'Content-Type: application/json' \
  -d '{"code":"CODIGO-DE-10-MINUTOS","protocol":2}'
# → {"token":"...","connector":{"id":7,"label":"DMK Gestão","session":"DMK"}}

TOKEN=...   # guarde criptografado; é o acesso ao WhatsApp da empresa

# 2) Saber quem eu sou nesta sessão (ID da conexão e modo de distribuição)
curl -s $BASE/routing -H "Authorization: Bearer $TOKEN"

# 3) Buscar eventos (laço de 3 a 5 segundos)
curl -s $BASE/events -H "Authorization: Bearer $TOKEN" \
  -H 'X-DMK-Features: actions, routing, purge'

# 4) Confirmar o que gravou (senão volta no próximo /events)
curl -s -X POST $BASE/ack -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"ids":[12,13]}'

# 5) Responder
curl -s -X POST $BASE/send -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"to":"5587999990000","text":"Oi! Como posso ajudar?","request_id":"gestao-2026-11-22-000001"}'
```

Regra de ouro: **um laço de `/events` + `/ack` por conexão**, sempre na mesma ordem (buscar → baixar
anexo → gravar → confirmar). Nunca confirme antes de gravar.

---

## 4. Credencial, sessão e conexão

| Método e caminho | Entrada | Resultado |
|---|---|---|
| `POST /exchange` | `{ "code", "protocol": 2 }` | `{ "token", "connector": { id, label, session } }`. O código vale 10 min e **um uso**. Sem `protocol: 2` → 409, sem gastar o código. |
| `GET /routing` | — | `{ "mode": "leads" \| "todos", "connection": { "id", "label" } }` |

- A credencial pertence a **uma conexão de uma sessão**: ela define de qual número são os eventos e de
  qual número saem os envios. Não dá para "escolher o número" no envio.
- Vale **90 dias sem uso**; cada chamada renova. Revogada ou vencida → `401` em tudo (peça um código
  novo ao administrador).
- Guarde a credencial criptografada, nunca no código-fonte nem em log.

---

## 5. Receber mensagens (`GET /events`)

| Método e caminho | Resultado |
|---|---|
| `GET /events` | `{ "events": [...], "status": { "status", "phone" }, "history_pending": bool, "sync_error"? }` — até **30 eventos** por chamada, na ordem em que chegaram. |
| `GET /media/<id do evento>` | Bytes do anexo daquele evento. **Baixe antes do `/ack`**; depois do ack o arquivo é apagado. |
| `POST /ack` | `{ "ids": [..] }` (até 30). Remove os eventos confirmados da fila. |

Declare o que o seu sistema entende no cabeçalho **`X-DMK-Features`** (lista separada por vírgula). Sem
declarar, o conector só manda o que todo sistema antigo entende:

| Recurso | O que passa a receber |
|---|---|
| `actions` | `reaction`, `revoke`, `edit` |
| `routing` | `assigned`, `released` e o campo `routing` em cada mensagem |
| `purge` | `purge` (conversa apagada na central) |

### Eventos

Todo evento é `{ "id": número, "type": "...", "data": { ... }, "at": ms }`.

| `type` | `data` |
|---|---|
| `message` | `channel: "WHATSAPP"`, `provider: "BAILEYS"`, `peer` (ex.: `5587999990000@s.whatsapp.net`), `phone`, `name`, `messageId`, `text`, `timestamp`, `outgoing` (true = saiu do celular/outro sistema), `media?`, `rich?`, `reply?`, `routing?` |
| `delivery` | `messageId`, `status` (número do WhatsApp: 2 = enviado ao servidor, 3 = entregue, 4 = lido, 5 = tocado) |
| `reaction` | `peer`, `messageId`, `emoji` (vazio = reação tirada), `fromMe` |
| `revoke` | `peer`, `messageId` — a mensagem foi apagada para todos |
| `edit` | `peer`, `messageId`, `text` — texto novo |
| `assigned` | `peer`, `phone`, `owner: { id, label }`, `mine` — alguém assumiu a conversa; se `mine` for falso, tire-a da tela |
| `released` | `peer` — conversa finalizada, volta a ser lead para todos |
| `purge` | `{ "peer" }` ou `{ "all": true }` — conversa (ou tudo) apagada na central |

Campos de `message` que valem explicação:

- **`media`** — `{ mimetype, filename, size, voz?, figurinha?, segundos? }`. O conteúdo vem em
  `GET /media/<id do evento>`. `voz: true` é mensagem de voz gravada na hora (mostre a bolha do play);
  `figurinha: true` é sticker (não é foto); `segundos` é a duração do áudio/vídeo.
  Anexo acima de 10 MB, ou fila de anexos cheia, não vem como arquivo: o `text` ganha um aviso entre
  colchetes e o arquivo fica no histórico da sessão (`GET /file`).
- **`rich`** — quando o cliente (ou uma empresa) manda lista, botões, enquete, localização ou cartão de
  contato, o conector entrega **o texto legível em `text`** e a estrutura em `rich`, para o chat
  desenhar o cartão: `{ tipo: "interativa"|"lista"|"botoes"|"localizacao"|"contato", titulo?, corpo?,
  rodape?, opcoes?: [{ rotulo, tipo: "resposta"|"link"|"copiar"|"item"|"lista", valor?, descricao?,
  linhas? }], local?: { lat, lng, nome?, endereco? }, contatos?: [{ nome, telefones[] }] }`.
  Quem não usa `rich` mostra só o `text` e não perde nada.
- **`reply`** — `{ messageId, body, type }`: a mensagem do cliente está citando outra.
- **`routing`** (desde a 1.3.12, precisa de `X-DMK-Features: routing`) — `{ mode, state: "NOVO" |
  "EM_ATENDIMENTO" | "TODOS", owner: { id, label } | null, mine }`. É a **etiqueta de atendimento**: o
  chat sabe na hora, sem outra consulta, se mostra "Assumir" (state `NOVO`), "Finalizar" (`mine: true`)
  ou nada (conversa de outro sistema).
- **`outgoing: true`** — mensagem que saiu pelo próprio celular ou por outro sistema. Mostre do lado
  direito do chat, mas **não trate como mensagem do cliente** (não acione robô, não conte como lead).

### Fila de eventos

| Situação | O que acontece |
|---|---|
| Normal | Até 1.000 eventos esperando o sistema buscar. |
| Sistema sem buscar há mais de 1 hora | **Fila rolante**: ficam os 500 mais novos, o resto é descartado. |
| Evento parado há mais de 7 dias | Descartado. |
| Fila cheia (1.000) | Envios dessa conexão passam a ser recusados com `503` até ela esvaziar. |
| Conexão só de `avisos` | Não recebe mensagens; a fila fica praticamente vazia. O painel mostra "Esvaziar fila" se precisar. |

Nada disso perde conversa: o histórico da sessão continua completo. A fila é só o "correio" do sistema.

---

## 6. Enviar (`POST /send`) — todos os formatos

Corpo comum:

```json
{
  "to": "5587999990000",
  "text": "texto que vai, ou que serve de reserva",
  "request_id": "sistema-ano-mes-dia-sequencial",
  "reply":       { "id": "ID_DA_MENSAGEM", "from_me": false, "body": "trecho citado" },
  "media":       { "base64": "...", "mimetype": "image/jpeg", "filename": "foto.jpg", "voz": false },
  "native":      { "type": "poll | location | contact", "...": "..." },
  "interactive": { "style": "list | buttons", "body": "...", "items": [ { "id", "label" } ] }
}
```

Resposta: `{ "ok": true, "externalId": "ID_DA_MENSAGEM_NO_WHATSAPP" }` — guarde o `externalId` para
casar com os eventos `delivery`, `reaction`, `revoke` e `edit`.

Regras que valem para **todo** envio:

- `to`: telefone completo com DDI e DDD, só dígitos (`5587999990000`). Também aceita
  `...@s.whatsapp.net`, `...@c.us` e `...@lid` (quando o LID já foi visto pelo conector). **Grupos não
  são atendidos.**
- `text` é **sempre obrigatório** e é a **reserva**: é o que vai se o formato especial não puder ser
  enviado, é o que fica no histórico e é o que aparece em quem só mostra texto. Em lista/botões,
  escreva no `text` as opções numeradas.
- `request_id`: 16 a 100 caracteres (letras, números, `_`, `-`). **Obrigatório.** Mesmo `request_id`
  com o mesmo conteúdo devolve o mesmo `externalId` sem enviar de novo (seguro para repetir depois de
  um timeout); com conteúdo diferente → `409`.
- Use **um** formato especial por envio: `media`, `native` ou `interactive` — nunca dois juntos.
- `reply` funciona com qualquer um deles.

### 6.1 Texto

```json
{ "to": "5587999990000", "text": "Seu pedido #1234 saiu para entrega 🚚", "request_id": "gestao-20261122-000001" }
```

Até 16.000 caracteres. Emoji, acento e quebra de linha (`\n`) podem. Negrito/itálico seguem o próprio
WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`, ```` ```monoespaçado``` ````).

### 6.2 Resposta citando outra mensagem

```json
{ "to": "5587999990000", "text": "Confirmado!", "reply": { "id": "3EB0A1B2C3", "from_me": false, "body": "Pode confirmar?" },
  "request_id": "gestao-20261122-000002" }
```

`id` é o `messageId` do evento recebido (ou um `externalId` seu). O conector usa a mensagem original
guardada em memória (7 dias) para a citação sair perfeita; se não tiver mais, monta a citação pelo
`body` que você mandou — por isso **mande sempre o `body`**.

### 6.3 Imagem, vídeo, documento

```json
{ "to": "5587999990000", "text": "Segue o comprovante", "request_id": "gestao-20261122-000003",
  "media": { "base64": "<arquivo em base64>", "mimetype": "application/pdf", "filename": "comprovante.pdf" } }
```

| Tipo | `mimetype` | Como chega no WhatsApp |
|---|---|---|
| Imagem | `image/jpeg`, `image/png`, `image/webp` | Foto, com o `text` como legenda |
| Vídeo | `video/mp4` | Vídeo, com o `text` como legenda |
| Documento | `application/pdf`, `application/octet-stream` | Documento com o nome de `filename` (sempre mande um nome com extensão) |
| Áudio (arquivo) | `audio/mpeg`, `audio/mp4`, `audio/ogg`… | Arquivo de áudio com play |
| Áudio de voz | `audio/ogg; codecs=opus` + `"voz": true` | **Mensagem de voz** (bolha com onda) |

Limites: **10 MB** por arquivo depois de decodificado (o `base64` em si pode ter até 14 MiB). Mimetype
fora da lista → `400`.

### 6.4 Áudio de voz (mensagem gravada) — 1.3.16

```json
{ "to": "5587999990000", "text": "🎤 Mensagem de voz", "request_id": "gestao-20261122-000004",
  "media": { "base64": "<ogg/opus em base64>", "mimetype": "audio/ogg; codecs=opus",
             "filename": "voz.ogg", "voz": true } }
```

`voz: true` (ou `ptt: true`) só vale para `audio/*`. Para o WhatsApp mostrar a **bolha de voz** de
verdade, o arquivo precisa ser **ogg/opus mono**; em qualquer outro formato ele aparece como arquivo de
áudio. Convertendo com ffmpeg:

```bash
ffmpeg -i entrada.mp3 -c:a libopus -ac 1 -b:a 32k -application voip voz.ogg
```

Sem `voz: true`, áudio vai como **arquivo** — é o comportamento de sempre, nada muda para quem já
enviava áudio.

### 6.5 Localização

```json
{ "to": "5587999990000", "text": "Estamos aqui: Rua A, 10 — Centro", "request_id": "gestao-20261122-000005",
  "native": { "type": "location", "lat": -8.0714, "lng": -39.1247, "name": "DMK Soluções", "address": "Rua A, 10 — Centro" } }
```

Formato oficial da biblioteca, aparece como mapinha clicável. `lat`/`lng` em grau decimal.

### 6.6 Cartão de contato

```json
{ "to": "5587999990000", "text": "Contato do suporte: +55 87 99999-0000", "request_id": "gestao-20261122-000006",
  "native": { "type": "contact", "name": "Suporte DMK", "phone": "5587999990000" } }
```

`phone` só com dígitos e com DDI.

### 6.7 Enquete

```json
{ "to": "5587999990000", "text": "Qual o melhor dia? 1) Segunda 2) Terça", "request_id": "gestao-20261122-000007",
  "native": { "type": "poll", "name": "Qual o melhor dia?", "options": ["Segunda", "Terça"], "multiple": false } }
```

De 2 a 12 opções. **O voto volta como mensagem de texto** (`Enquete "Qual o melhor dia?": Terça`),
enquanto a enquete estiver na memória do conector (7 dias) — não existe evento próprio de voto.

### 6.8 Lista e botões (experimental)

```json
{ "to": "5587999990000",
  "text": "Escolha uma opção:\n1) Financeiro\n2) Suporte\n3) Comercial",
  "request_id": "gestao-20261122-000008",
  "interactive": { "style": "buttons", "body": "Escolha uma opção:", "footer": "DMK Soluções",
                   "button": "Ver opções",
                   "items": [ { "id": "fin", "label": "Financeiro" }, { "id": "sup", "label": "Suporte" },
                              { "id": "com", "label": "Comercial" } ] } }
```

| Estilo | Limite | Observação |
|---|---|---|
| `buttons` | até 3 itens, rótulo de 20 letras | Acima disso o conector troca para lista automaticamente |
| `list` | até 10 linhas | `button` é o texto do botão que abre a lista |

**Atenção, é experimental**: o WhatsApp não garante esse formato fora da API oficial da Meta e em
alguns aparelhos ele não aparece. Por isso o `text` com as opções numeradas é obrigatório — é o que o
cliente vê quando o cartão não passa. **Teste com o seu número antes de usar com cliente.** A escolha
do cliente volta como mensagem de texto com o `id` da opção.

### 6.9 Resumo: o que dá para enviar

| Quero mandar | Como |
|---|---|
| Texto | `text` |
| Texto citando outra mensagem | `text` + `reply` |
| Foto / vídeo / PDF / arquivo | `media` (`mimetype` do tipo) |
| Áudio como arquivo | `media` com `audio/*` |
| **Mensagem de voz** | `media` com `audio/ogg; codecs=opus` + `voz: true` |
| Localização | `native: { type: "location" }` |
| Cartão de contato | `native: { type: "contact" }` |
| Enquete | `native: { type: "poll" }` |
| Lista / botões | `interactive` (experimental) |
| Reação, editar, apagar, digitando, visto | rotas próprias (seção 7) |

---

## 7. Ações sobre mensagens e contato

| Método e caminho | Entrada | Observação |
|---|---|---|
| `POST /react` | `{ "to", "messageId", "emoji" }` | Emoji vazio tira a reação. Até 8 caracteres. |
| `POST /edit` | `{ "to", "messageId", "text" }` | **Só mensagens enviadas por este número** (409 caso contrário). |
| `POST /delete` | `{ "to", "messageId" }` | Apaga para todos. Mesma regra do `/edit`. |
| `POST /presence` | `{ "to", "state": "composing" \| "recording" \| "paused" \| "available" }` | "digitando…" / "gravando áudio…". Mande antes de uma resposta demorada; o WhatsApp apaga sozinho em alguns segundos. |
| `GET /presence?to=` | — | `{ "state", "at" }`: o contato está digitando/gravando. |
| `POST /read` | `{ "to", "messageIds": [..] }` | Marca como lida (os dois tiques azuis), até 50 por chamada. |
| `GET /photo?to=` | — | Foto do contato (até 1 MB) ou `204` se não tiver. Com `format=url` devolve `{ "url" }`. Guardada 1 h (sem foto, 10 min). |

Essas ações respeitam o atendimento: se a conversa está assumida por outra conexão, a resposta é `409`.
Conexão de `avisos` não é barrada.

---

## 8. Atendimento: leads, assumir e finalizar

No modo `leads` (padrão): contato **sem dono** é lead e aparece em **todas** as conexões de
atendimento. Quem assume — por `POST /claim` ou simplesmente respondendo com `POST /send` — fica
**sozinho** com a conversa; as outras param de receber e levam `409` se tentarem responder. Ao
finalizar (`POST /release`), a conversa volta a ser lead para todas.

| Método e caminho | Entrada / resultado |
|---|---|
| `POST /claim` | `{ "to" }` → assume. `409` se outra conexão já atende. |
| `POST /release` | `{ "to" }` → finaliza. Só quem atende (ou o admin). |
| `GET /conversations` | Leads + conversas desta conexão (nunca as de outra): `peer`, `phone`, `name`, `state` (`NOVO`, `EM_ATENDIMENTO`, `FINALIZADO`), `owner`, `mine`, `last_at`, `last_text`. |
| `GET /messages?to=&before=&limit=` | Histórico guardado no conector, até 200 por vez: `id`, `de` (`cliente`, `sistema`, `celular`), `texto`, `arquivo`, `em`. `409` se outra conexão atende. |
| `GET /file?path=` | Bytes de um anexo do histórico (o `arquivo.caminho` do `/messages`). Só da pasta geral ou da própria conexão. |

Onde fica guardado (dentro de `dados/atendimentos/sessao-<id>/`): uma pasta por conexão, com
`conversas.jsonl` (histórico) e `arquivos/` (anexos). Retenção de **180 dias**. É o que garante que um
sistema fora do ar não perde nada.

Para o atendente humano saber o que está acontecendo sem consultar nada, use o campo `routing` de cada
mensagem (seção 5) e os eventos `assigned`/`released`.

---

## 9. Automação (chatbot)

O conector responde sozinho **quem ainda não tem atendente**. O fluxo é por conexão (cada empresa, com
a sua credencial, tem o seu), montado pelo próprio sistema:

| Método e caminho | Para quê |
|---|---|
| `GET /bot` | Fluxo e configuração atuais. |
| `PUT /bot` | Grava o fluxo (nós, condições, ações, tempos). |
| `POST /bot/ativar` | `{ "ativo": true \| false }`. |
| `GET /bot/modelos` | Modelos prontos (menu de departamentos, fora do horário). |
| `GET /bot/estados` | Em que etapa cada contato está (para a tela de fluxograma). |
| `POST /bot/sair` | `{ "to" }` — tira este contato do fluxo agora (ele volta a entrar depois). |
| `GET /bot/ignorados` | Contatos marcados como "nunca atender". |
| `POST /bot/ignorar` | `{ "to", "ativo": true \| false }` — `true` = **nunca mais** atender esse contato; `false` = voltar a atender. |

Regras de tempo que evitam o robô responder a cada "oi":

- **Anti-flood** (`antiflood_seg`, 10 s): mensagens em rajada não reiniciam o fluxo.
- **Aguardando atendente** (`aguardando_min`, 60 min): enquanto o contato espera humano, o robô fica
  calado.
- **Depois de finalizar** (`repetir_apos_min`, 120 min): quem acabou de ser atendido só cai no fluxo de
  novo quando esse tempo vencer.
- **Nunca atender**: lista por contato, no painel ou por `POST /bot/ignorar { "to", "ativo": true }`.

Quando o robô transfere para humano, a conversa vira lead normal — quem assumir recebe o histórico do
que o robô conversou. Detalhes, formato do fluxo e exemplos: **[CHATBOT.md](CHATBOT.md)**.

---

## 10. Limites e validações

| O que | Limite | Se passar |
|---|---|---|
| `text` | 16.000 caracteres | `400` |
| `request_id` | 16 a 100 caracteres `[A-Za-z0-9_-]` | `400` |
| `media.base64` | 14 MiB de base64 / **10 MB** de arquivo | `400` |
| `media.mimetype` | `image/jpeg|png|webp`, `audio/*`, `video/mp4`, `application/pdf`, `application/octet-stream` (aceita `; codecs=…`) | `400` |
| `reply.id` / `messageId` | 4 a 120 caracteres `[A-Za-z0-9_.:-]` | `400` |
| Enquete | 2 a 12 opções | `400` |
| Botões | 3 itens, 20 letras no rótulo | vira lista |
| Lista | 10 linhas | sobra é cortada |
| `POST /read` | 50 ids por chamada | sobra ignorada |
| Chamadas por minuto, por endereço de rede | 1.200 (e 20 em `/exchange`) | `429` |
| `POST /send` por minuto | 600 por conexão | `429` |
| Ações (`/react`, `/edit`, `/delete`, `/read`) | 240 por minuto por conexão | `429` |
| `/presence` | 600 por minuto (POST) · 900 (GET) | `429` |
| `GET /photo` | 300 por minuto, foto até 1 MB | `429` / `204` |
| Envios ao mesmo tempo | 5 por conexão | `429` |
| Envios registrados por conexão | 5.000 | `409` (admin limpa) |
| Fila de eventos por conexão | 1.000 (rolante em 500 depois de 1 h sem buscar; 7 dias de validade) | `503` no envio |
| Anexos pendentes por sessão | 256 MB | anexo não vem como arquivo, fica no histórico |
| Sessões no conector | 50 | `400` |
| Intervalo entre envios da mesma sessão | 1 s, um por vez (`DMK_WA_INTERVALO_ENVIO_MS`) | só espera |

Sessões diferentes **não** esperam umas pelas outras: cada número tem a sua fila de envio.

---

## 11. Erros: o que fazer com cada código

| Código | Quando | O que fazer |
|---|---|---|
| `400` | Pedido inválido (campo faltando, tamanho, mimetype, número sem WhatsApp) | Corrija. **Nada foi enviado**; o mesmo `request_id` pode ser reaproveitado. |
| `401` | Credencial revogada ou vencida (90 dias) | Peça um código novo e faça `/exchange`. Não fique repetindo. |
| `403` | Contato não autorizado nesta conexão | Conexão com lista de contatos fixa; fale com o administrador. |
| `409` + `"request_id reutilizado com conteúdo diferente"` | Mesmo ID, conteúdo diferente | Gere um `request_id` novo. |
| `409` + `delivery_uncertain: true` | O WhatsApp não confirmou o envio | **Pode ter ido.** Confira o histórico antes de repetir e **não troque o `request_id`** — repetir com o mesmo ID é seguro. |
| `409` + `"em atendimento por …"` | A conversa é de outra conexão (modo `leads`) | Não insista; mostre "em atendimento por X" ou peça transferência ao admin. |
| `409` + "só dá para apagar ou editar mensagens enviadas por este número" | Tentou editar/apagar mensagem do cliente | Não é possível, é regra do WhatsApp. |
| `429` | Mais de 120 chamadas/min ou 5 envios ao mesmo tempo | Espere e repita com o mesmo `request_id`. |
| `501` | Recurso que esta central não tem | Não tente de novo. |
| `503` | Sessão desconectada, ou fila cheia | **Nada foi enviado**; repita mais tarde. Veja `status` em `/events`. |

Resumo prático: `409 delivery_uncertain` → **repita com o mesmo ID**. `400`/`503` → corrija e mande de
novo. Qualquer outro `409` → não repita no automático.

---

## 12. Administração — `/admin/v1`

`Authorization: Bearer <dados/admin.key>`. Normalmente usado pelo comando `dmk-wa` e pelo painel; as
rotas estão aqui para quem for fazer tela. Dez chaves erradas seguidas do mesmo endereço bloqueiam por
um minuto.

| Método e caminho | Entrada / resultado |
|---|---|
| `GET /sessoes` | `id`, `nome`, `dono`, `ativa`, `status`, `telefone`, `autorizacoes`, `eventos_pendentes`. |
| `POST /sessoes` | `{ "nome", "dono" }` → sessão criada (desligada). Até 50. |
| `GET /sessoes/<id>` | A sessão; com `status: AGUARDANDO_QR` traz `qr` (imagem) e `qr_texto`. |
| `POST /sessoes/<id>/conectar` | Liga. Sem credencial salva, devolve o QR. |
| `POST /sessoes/<id>/pausar` | Desliga mantendo a sessão. |
| `POST /sessoes/<id>/reiniciar` | Reinicia mantendo a sessão. |
| `POST /sessoes/<id>/novo-qr` | `{ "confirmado": true }` — **desconecta o número atual** e gera QR para outro. |
| `POST /sessoes/<id>/excluir` | `{ "confirmado": true }` — apaga sessão, autorizações e fila. |
| `GET /sessoes/<id>/autorizacoes` | Sistemas ligados. |
| `POST /sessoes/<id>/autorizacoes` | `{ "nome", "sistema", "confirmado": true, "tipo"? }` → `code` (10 min, um uso). `tipo`: `atendimento` (padrão) ou `avisos`. |
| `POST /sessoes/<id>/autorizacoes/<aid>/tipo` | `{ "tipo": "atendimento" \| "avisos" }`, sem trocar a credencial. |
| `POST /sessoes/<id>/autorizacoes/<aid>/limpar-fila` | Descarta os eventos que esperam esse sistema (o histórico continua). |
| `POST /sessoes/<id>/autorizacoes/<aid>/revogar` | Corta o acesso na hora. |
| `POST /sessoes/<id>/autorizacoes/<aid>/excluir` | Revoga e remove o cadastro. Revogar/excluir devolve as conversas dela para todos. |
| `GET /sessoes/<id>/atendimentos` | `{ modo, conversas }` — cada conversa com `owner`. |
| `POST /sessoes/<id>/atendimentos/liberar` | `{ "peer" }` → volta a ser lead. |
| `POST /sessoes/<id>/atendimentos/transferir` | `{ "peer", "para": "<ID da conexão>" }`. |
| `POST /sessoes/<id>/distribuicao` | `{ "modo": "leads" \| "todos" }`. |
| `GET /sessoes/<id>/chatbot` | Fluxo e configuração do chatbot de cada conexão da sessão. |
| `GET /sessoes/<id>/chatbot/estados` | Em que etapa cada contato está (é o que a aba Chatbot do painel mostra). |
| `POST /sessoes/<id>/chatbot/ignorar` | `{ "peer", "ativo": true \| false }` — nunca atender / voltar a atender. |
| `POST /sessoes/<id>/autorizacoes/<aid>/bot` | Grava o fluxo do chatbot daquela conexão pelo lado do admin (mesmo formato do `PUT /bot`). |

O resumo da sessão traz **`recebendo`**: `true` quando o WhatsApp confirmou entrega de mensagens a este
aparelho nesta conexão, `false` quando está conectado há mais de 90 s sem esse sinal (o painel mostra
"Sem receber") e `null` enquanto confere. **`CONECTADO` sozinho não garante recebimento** — é por isso
que esse campo existe.

Estados da sessão: `DESCONECTADO`, `INICIANDO`, `AGUARDANDO_QR`, `CONECTADO`, `RECONECTANDO`, `ERRO` e
`SUBSTITUIDA` (a mesma credencial foi aberta em outro lugar — código 440: outra VPS, cópia da pasta
`dados`, serviço duplicado; o conector para essa sessão em vez de brigar em loop, desligue a cópia e use
Reiniciar).

---

## 13. Logs e diagnóstico

Tudo vai para o journal do serviço:

```bash
# VPS de produção (srv2071960)
journalctl -u dmk-wa-conector -n 200 --no-pager
journalctl -u dmk-wa-conector -f           # acompanhar ao vivo
dmk-wa status                              # resumo das sessões
```

Linhas que o conector escreve (sem conteúdo de mensagem, só o necessário):

| Linha | Significa |
|---|---|
| `✅ WhatsApp Baileys "<nome>" conectado: <número>` | Sessão no ar |
| `[sessao N] recebida de ...9399` | Mensagem recebida (4 últimos dígitos) |
| `[sessao N] enviando texto/voz/image/jpeg/poll/list para ...9399` | **1.3.16**: um envio aceito, com o formato |
| `[envio recusado] "<sistema>" → 409: <motivo>` | Envio barrado (validação, atendimento, fila), com quem pediu e o motivo |
| `[BAILEYS:<nome>] Stream Errored (ack)` | Queda de stream; o conector reconecta sozinho |
| `[BAILEYS:<nome>] conectado há 90 s sem sinal de recebimento: reabrindo a conexão (1/2)` | Watchdog de recebimento |
| `sessão N: SUBSTITUIDA` | Credencial aberta em outro lugar (440) |

**Modo diagnóstico** (liga em 5 s, não reinicia nada):

```bash
# VPS de produção (srv2071960)
touch /opt/dmk-whatsapp/dados/diagnostico     # liga
rm -f /opt/dmk-whatsapp/dados/diagnostico     # desliga
```

Com ele ligado aparecem linhas `[DIAG]` dizendo para quais conexões cada mensagem foi entregue, se o
contato foi reconhecido, e a **estrutura** (nomes dos campos, nunca os valores) das mensagens — é o que
se usa para investigar citação, LID e formato novo. Deixe ligado só enquanto investiga.

Chaves de criptografia nunca aparecem no log: o conector filtra as mensagens que a biblioteca de
criptografia tentava imprimir.

---

## 14. Como o conector evita travar

O histórico de travamentos do WhatsApp Web está tratado assim — vale saber para não culpar o sistema
errado:

| Proteção | O que faz |
|---|---|
| **Confirmação de `<status>`** (1.3.8) | O WhatsApp manda um aviso de status que a biblioteca não confirmava; sem a confirmação ele **para de entregar mensagens** e a sessão fica "conectada e muda". O conector confirma. Era a causa do "manda mas não recebe". |
| **Watchdog de recebimento** | 90 s conectado sem nenhum sinal de entrega → reinicia a sessão (no máximo 2 vezes seguidas, para não entrar em loop). |
| **Fila de envio** | Um envio por vez por sessão, 1 s de intervalo: evita o bloqueio por rajada. |
| **Cache de mensagens (`getMessage`)** | Guarda as mensagens enviadas (7 dias) para responder aos pedidos de reenvio do WhatsApp — sem isso o cliente vê "Aguardando mensagem". |
| **Código 440** | A mesma credencial aberta em dois lugares não vira loop de reconexão: a sessão para como `SUBSTITUIDA`. |
| **Fila rolante + validade** | Sistema fora do ar não enche a memória: 500 eventos mais novos depois de 1 h, 7 dias de validade, histórico intacto. |
| **Liberação do `request_id`** | Erro definitivo libera o ID na hora (até a 1.2 ele ficava preso e o sistema não conseguia mais mandar aquele pedido). |
| **`recebendo`** no resumo | O painel e o `dmk-wa status` mostram "Sem receber" em vez de um "Conectado" enganoso. |

---

## 15. O que a API **não** faz

| Não existe | Por quê |
|---|---|
| Formulários (**Flows**), catálogo, carrinho e pedidos | São da API oficial da Meta (WhatsApp Cloud API), não da biblioteca que o conector usa. |
| Botão que abre link ou liga (CTA) no envio | A biblioteca só recebe esses formatos; mandar, não. (Mande o link no texto.) |
| **Grupos** | O conector trata conversa com cliente; `to` de grupo é recusado. |
| Status / stories, chamadas, newsletter/canal | Fora do escopo do atendimento. |
| Escolher outro número no envio | A credencial já define o número (uma conexão pertence a uma sessão). |
| Evento próprio de voto de enquete | O voto chega como mensagem de texto. |
| Editar/apagar mensagem do cliente | Regra do WhatsApp: só as suas. |

Resumindo, o que **dá** para mandar hoje: texto, citação, imagem, vídeo, documento, áudio, **mensagem de
voz**, localização, cartão de contato, enquete e — em modo experimental — lista e botões. Mais reação,
edição, apagar, "digitando…", "gravando…" e "visto".

---

## 16. Novidades da 1.3.16

- **Mensagem de voz no envio**: `media.voz: true` manda áudio como gravação (ptt). Sem a marca, áudio
  continua indo como arquivo.
- **Mimetype com parâmetro aceito**: `audio/ogg; codecs=opus` não é mais recusado.
- **Áudio e figurinha recebidos vêm marcados**: `media.voz`, `media.figurinha`, `media.segundos` — o
  chat desenha a bolha certa sem adivinhar.
- **Um log por envio aceito** (`[sessao N] enviando <formato> para ...9399`), para conferir no journal o
  que saiu, sem expor conteúdo.
- Esta documentação, reescrita como referência completa.

---

Outras páginas: [CHATBOT.md](CHATBOT.md) (fluxo e automação) ·
[LIGAR-UM-SISTEMA.md](LIGAR-UM-SISTEMA.md) (passo a passo por sistema) ·
[PAINEL.md](PAINEL.md) (tela de gestão) · [INSTALACAO.md](INSTALACAO.md) (instalar e atualizar) ·
[PROMPT-PARA-AGENTES.md](PROMPT-PARA-AGENTES.md) (texto pronto para quem for integrar).

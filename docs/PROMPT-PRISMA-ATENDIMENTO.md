# Prompt para o agente do DMK Prisma — corrigir o atendimento do WhatsApp (conector DMK)

Entregue ao agente do DMK Prisma **o texto abaixo da linha `---`**. Ele é autossuficiente: não depende
desta conversa e já traz os arquivos e as linhas onde está o problema.

---

## O que está errado hoje

No DMK Prisma, quando um atendente assume uma conversa de WhatsApp, ela **continua aparecendo para os
outros sistemas**; e quando outro sistema assume, o Prisma **continua vendo e respondendo**. O controle
de dono não existe do lado do Prisma.

Isso **não é defeito do conector**. O conector (repositório público `89AE-5978/dmk-whatsapp`, serviço em
`https://zap.danilodss.com.br`) já faz todo o controle: lead novo vai para todas as conexões, quem assume
fica sozinho com a conversa, as outras param de receber e levam `409` se tentarem responder, e ao
finalizar a conversa volta a ser lead. O Prisma é que **não declara que entende isso** e **não usa as
rotas**.

Provas no código do DMK Prisma (`dmksolutions/DMK-Prisma`):

| Onde | O que está lá | O que falta |
|---|---|---|
| `sistema/lib/dmk-chat-connector-client.js:79` | `"X-DMK-Features": onPurge ? "actions,purge" : "actions"` | falta **`routing`** — sem ele o conector nem manda os avisos de assumir/finalizar, nem a etiqueta nas mensagens |
| `sistema/lib/dmk-chat-connector-client.js` (função `poll`) | trata `message`, `delivery`, `reaction`, `revoke`, `purge` | faltam **`assigned`** e **`released`** |
| o cliente inteiro | `exchange`, `events`, `ack`, `media/<id>`, `send` | faltam **`/routing`**, **`/claim`**, **`/release`**, **`/conversations`** |
| `sistema/database.js` (`chat_conversations`) | `assigned_user_id` (atendente interno) | falta guardar o **dono no conector** (qual sistema atende) |

**Antes de escrever qualquer linha de código, leia `docs/API.md` do repositório
`89AE-5978/dmk-whatsapp` — inteira, com atenção às seções 5 (eventos), 8 (atendimento) e 11 (erros).**
Não invente rota nem formato: o que não está lá, não existe.

## Como o conector controla o atendimento (resumo do que você vai usar)

- Cada sistema ligado é uma **conexão** com ID próprio. O Prisma é uma; a DMK Gestão é outra; o Smart
  Core é outra (essa é do tipo "avisos" e não assume conversa).
- Modo `leads` (o que está ligado): conversa sem dono aparece para todos. **Quem assume** — por
  `POST /claim` **ou simplesmente respondendo com `POST /send`** — fica sozinho com ela.
- Toda mensagem entregue traz a etiqueta **`routing`**:
  `{ mode, state: "NOVO" | "EM_ATENDIMENTO" | "TODOS", owner: { id, label } | null, mine: true|false }`.
  É ela que diz, sem consulta extra, se a conversa é lead, de quem é, e se é sua.
- Eventos extras que chegam com `X-DMK-Features: routing`:
  `assigned` → `{ peer, phone, owner: { id, label }, mine }` (alguém assumiu);
  `released` → `{ peer }` (finalizou, virou lead de novo).
- `GET /routing` diz quem você é: `{ mode, connection: { id, label } }`.
- `GET /conversations` lista os leads + as conversas **desta** conexão, com `state`, `owner`, `mine`.
- `POST /claim { to }` assume; `POST /release { to }` finaliza. `409` em `/claim` = outra conexão já
  atende.

## Tarefas

### 1. Declarar o recurso `routing`

Em `sistema/lib/dmk-chat-connector-client.js`, no cabeçalho de `GET /events`, declarar sempre
`actions,routing` (e `purge` quando houver `onPurge`). Sem isso, nada do resto funciona.

### 2. Saber quem o Prisma é nesta sessão

Ao ligar a conexão (e a cada reconexão), chamar `GET /routing` e guardar na conta
(`whatsapp_accounts` ou na configuração do conector) o `connection.id`, o `connection.label` e o `mode`.
O `connection.id` é o que vai permitir comparar com o `owner.id` dos eventos.

### 3. Guardar o dono da conversa

Criar as colunas em `chat_conversations` (migração, sem apagar dados):
`connector_state TEXT` (`NOVO` | `EM_ATENDIMENTO` | `FINALIZADO` | `TODOS`),
`connector_owner_id TEXT`, `connector_owner_label TEXT`, `connector_mine INTEGER DEFAULT 0`.

Em toda mensagem recebida pelo conector, se vier `routing`, gravar esses quatro campos na conversa antes
de inserir a mensagem (hoje o `routing` chega junto do evento e é descartado: ele passa por
`onMessage` no objeto `m`).

### 4. Tratar `assigned` e `released`

No `poll` do cliente, junto dos outros tipos:

- `assigned`: achar a conversa pelo `peer`/`phone`; gravar `connector_state='EM_ATENDIMENTO'`,
  `owner_id`, `owner_label`, `mine`. **Se `mine` for falso, a conversa sai da fila de atendimento do
  Prisma** (não aparece na lista de abertas, não notifica, não conta como não lida) e o campo de
  resposta fica bloqueado, com o aviso "Em atendimento por `<label>`".
- `released`: `connector_state='NOVO'`, limpar dono, `mine=0`, e a conversa volta a aparecer para todos.

Os dois eventos precisam ser confirmados com `POST /ack` como qualquer outro.

### 5. Botões Assumir e Finalizar no chat

Na tela de atendimento (Central e PDV), para conversas cujo canal é WhatsApp pelo conector:

- conversa com `connector_state='NOVO'` → botão **Assumir** → `POST /claim { to: <telefone> }`.
  Em `409`, mostrar "Já está em atendimento por `<label>`" e atualizar a conversa em vez de insistir.
- conversa `mine=1` → botão **Finalizar** → `POST /release { to }` → a conversa volta a ser lead.
- conversa `mine=0` com dono → **somente leitura**: sem campo de resposta, sem reação, sem apagar,
  com o selo "Em atendimento por `<label>`".
- Responder uma conversa que é lead continua valendo como assumir (o conector assume sozinho) — mas o
  botão precisa existir para o atendente assumir sem mandar mensagem.

### 6. Tratar os erros do envio como manda a documentação

No cliente, ao receber a resposta de `POST /send` (seção 11 do `docs/API.md`):

- `409` com "em atendimento por …" → **não reenviar**; marcar a conversa como de outro sistema e avisar
  o atendente na tela.
- `409` com `delivery_uncertain: true` → pode ter ido: repetir **com o mesmo `request_id`**, nunca com
  um novo.
- `400` / `503` → nada foi enviado; mostrar o motivo e permitir tentar de novo.
- `401` → credencial revogada: pedir novo código, sem ficar repetindo a chamada.

### 7. Sincronizar ao ligar

Ao iniciar a conexão, chamar `GET /conversations` e reconciliar o estado das conversas locais
(`state`, `owner`, `mine`). É isso que corrige as conversas que já estão erradas hoje, sem precisar
esperar mensagem nova. Para uma conversa sem histórico local, usar
`GET /messages?to=&limit=` para trazer o que o conector guardou.

### 8. Não tratar mensagem própria como mensagem do cliente

Mensagem com `outgoing: true` saiu do próprio celular ou de outro sistema: mostrar no chat do lado do
atendente, mas **não** contar como lead, **não** acionar robô e **não** marcar como não lida. Conferir
se o Prisma já faz isso.

### 9. Conferir a resposta citada

`sistema/server.js` (por volta da linha 2147) já monta o `reply_to` com um alternativo quando a mensagem
citada não está no banco local. O relato do mantenedor é que **a citação não aparece no cartão do chat**
quando a mensagem vem pelo conector. Conferir a renderização no front-end (`sistema/public/app.js`,
cartão de mensagem) e corrigir, sem mexer no padrão visual já aprovado do cartão.

### 10. Aproveitar o que o conector ganhou nas versões 1.3.16 e 1.3.17

- `media.voz: true` no evento = **mensagem de voz** (mostrar a bolha com play, não "arquivo de áudio");
  `media.figurinha: true` = figurinha; `media.segundos` = duração.
- No envio, para mandar voz: `media: { base64, mimetype: "audio/ogg; codecs=opus", filename, voz: true }`.

## Como validar (é o critério de aceitação)

Com o Prisma e a DMK Gestão ligados **à mesma sessão** do conector:

1. Cliente manda mensagem → aparece nos dois como **lead**.
2. Prisma clica em **Assumir** → no Prisma fica "Minha"; **na Gestão a conversa some** da fila.
3. Gestão tenta responder → recebe `409` e mostra "em atendimento por DMK Prisma".
4. Prisma clica em **Finalizar** → a conversa volta a aparecer nos dois como lead.
5. Agora ao contrário: a Gestão assume → **no Prisma a conversa fica só leitura**, com o selo
  "Em atendimento por DMK Gestão", e o campo de resposta bloqueado.
6. Reiniciar o Prisma → depois do `GET /conversations`, os estados continuam certos.
7. No painel do conector (aba **Atendimentos** da sessão) o dono mostrado bate com o que as telas mostram.

Provar os sete passos antes de publicar.

## Regras do mantenedor (valem para esta tarefa)

- **Não** trocar o número, não gerar QR novo, não mexer na distribuição (`leads`) nem nas autorizações
  existentes do conector — nada disso é necessário aqui.
- Testar **ao vivo** no sistema rodando antes de publicar em produção; não publicar várias versões "no
  chute" deixando o mantenedor testar.
- Padrão visual do DMK Prisma: selos e botões dentro do padrão já aprovado do chat, grupo de botões numa
  linha só, nada de componente nativo do navegador, texto que não couber termina em "…".
- Mexer só no que esta tarefa pede; o que estiver fora e errado, relatar em vez de alterar junto.

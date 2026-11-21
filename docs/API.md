# Referência

Endereço: `http://127.0.0.1:8098` (ou o subdomínio HTTPS, só para o protocolo). Respostas em JSON;
erro vem como `{ "error": "mensagem" }` com o código HTTP correspondente.

## Sem autenticação

| Método e caminho | Resultado |
|---|---|
| `GET /health` | `ok`, `versao`, `node`, `simulado`, `sessoes`, `ativas`, `conectadas`. Nada sensível. |

## Protocolo dos sistemas — `/api/public/dmk-connector/v1`

Igual ao da Central do DMK Prisma. `Authorization: Bearer <credencial>` em tudo, menos em `/exchange`.
A credencial pertence a uma sessão; ela define de qual número são os eventos e os envios.

| Método e caminho | Entrada / resultado |
|---|---|
| `POST /exchange` | `{ "code", "protocol": 2 }` → `{ "token", "connector" }`. O código vale 10 min e um uso. Sem `protocol: 2`: 409, sem gastar o código. |
| `GET /events` | Até 30 eventos, `status` (`status`, `phone`), `history_pending`, `sync_error`. Envie `X-DMK-Features: actions` para receber também `reaction`, `revoke` e `edit`. |
| `GET /media/<id do evento>` | Bytes do anexo. Baixe antes de confirmar. |
| `POST /ack` | `{ "ids": [..] }` (até 30) depois de gravar cada evento. |
| `POST /send` | `{ "to", "text", "request_id" }` → `{ "externalId" }`. Anexo: `media: { base64, mimetype, filename }` (até 10 MB). Citação: `reply: { id, from_me, body }`. Lista/botões nativos (experimental, 1.3.4): `interactive: { style: "list"\|"buttons", body, footer?, button?, items: [{ id, label }] }` — o `text` segue obrigatório, com as opções numeradas, e é usado quando o nativo não é possível; a escolha do cliente volta como mensagem com o `id` no texto. |
| `POST /react` | `{ "to", "messageId", "emoji" }` (emoji vazio tira a reação). |
| `POST /edit` | `{ "to", "messageId", "text" }`, só mensagens enviadas por este número. |
| `POST /delete` | `{ "to", "messageId" }`, só mensagens enviadas por este número. |
| `POST /presence` | `{ "to", "state": "composing" \| "paused" }`. |
| `GET /presence?to=` | `{ "state", "at" }`: o contato está digitando ou gravando. |
| `POST /read` | `{ "to", "messageIds": [..] }`. |
| `GET /photo?to=` | Foto do contato (até 1 MB) ou 204. Com `format=url`: `{ "url" }`. |

### Atendimento (1.3.0) — uma sessão, várias conexões

Cada autorização é uma **conexão** (um sistema/chat) com ID próprio. No modo `leads` (padrão):
lead novo (conversa sem dono) vai para todas as conexões; quem assume — por `POST /claim` ou
respondendo com `POST /send` — fica sozinho com a conversa até finalizar (`POST /release`). As outras
param de receber as mensagens desse contato e não conseguem responder (409). No modo `todos`, todo
mundo recebe tudo, como antes.

Conexão do tipo **avisos** (cobrança, alertas do Smart Core…): envia sem assumir a conversa e sem ser barrada
por quem atende; o aviso aparece no histórico de quem está atendendo. Defina no painel (Sistemas ligados →
Tipo), em `POST /admin/v1/sessoes/<id>/autorizacoes` com `"tipo": "avisos"` ou em
`POST /admin/v1/sessoes/<id>/autorizacoes/<aid>/tipo { "tipo" }`.

| Método e caminho | Entrada / resultado |
|---|---|
| `GET /routing` | `{ mode: "leads" \| "todos", connection: { id, label } }` — o ID desta conexão. |
| `POST /send` com `native` | Enquete, localização ou cartão de contato (ver abaixo). |
| `POST /claim` | `{ "to" }` → assume a conversa. 409 se outra conexão já atende. |
| `POST /release` | `{ "to" }` → finaliza: a conversa volta a ser lead para todas. Só quem atende. |
| `GET /conversations` | Leads + conversas desta conexão (nunca as de outra): `peer`, `phone`, `name`, `state` (`NOVO`, `EM_ATENDIMENTO`, `FINALIZADO`), `owner`, `mine`, `last_at`, `last_text`. |
| `GET /messages?to=&before=&limit=` | Histórico guardado no conector (até 200 por vez): `id`, `de` (`cliente`, `sistema`, `celular`), `texto`, `arquivo`, `em`. 409 se outra conexão atende. |
| `GET /file?path=` | Bytes de um anexo do histórico (`arquivo.caminho`). Só da pasta geral ou da própria conexão. |

Desde a 1.3.12 **toda mensagem entregue traz o campo `routing`**, para o chat saber na hora se precisa mostrar
"Assumir" ou "Finalizar", sem outra consulta: `{ mode: "leads" | "todos", state: "NOVO" | "EM_ATENDIMENTO" |
"TODOS", owner: { id, label } | null, mine: true | false }`. `mine: true` é conversa deste sistema; `state:
"NOVO"` é lead (ninguém assumiu). Quem não conhece o campo simplesmente o ignora.

Envie `X-DMK-Features: routing` (junto com `actions`, se usar) no `GET /events` para receber também:
`assigned` — `{ peer, phone, owner: { id, label }, mine }` (alguém assumiu; se `mine` for falso, tire a
conversa da tela) — e `released` — `{ peer }` (finalizada; volta a ser lead). Sistemas antigos não recebem
esses eventos: para eles basta que as mensagens da conversa de outro parem de chegar.

### Formatos que o WhatsApp aceita no envio (`POST /send`)

`text` continua obrigatório e é a **reserva**: é o que vai se o formato não puder ser enviado, e é o que fica no
histórico para quem só mostra texto. Use **um** campo por envio, sem anexo:

| Campo | Conteúdo | Observação |
|---|---|---|
| `native: { type: "poll", name, options[2..12], multiple? }` | Enquete | Formato oficial da biblioteca. O voto do cliente volta como mensagem de texto (`Enquete "...": opção`), enquanto a enquete estiver guardada (7 dias). |
| `native: { type: "location", lat, lng, name?, address? }` | Localização | Formato oficial. |
| `native: { type: "contact", name, phone }` | Cartão de contato | Formato oficial. `phone` só com dígitos, com DDI. |
| `interactive: { style: "list" \| "buttons", body, footer?, button?, items[] }` | Lista ou botões | **Experimental**: o WhatsApp não garante esse formato fora da API oficial e pode não aparecer em alguns aparelhos. Botões: até 3, rótulo de até 20 letras; acima disso vira lista (até 10 linhas). Teste com o seu número antes de usar com clientes. |

Formulários (Flows), catálogo e pedidos são da API oficial da Meta e não existem nesta biblioteca: não dá para
enviar por aqui. Enquete, localização, contato, lista e botões são o que há.

Eventos: `{ id, type, data, at }`. `message` traz `peer`, `phone`, `name`, `messageId`, `text`, `media`,
`outgoing`, `timestamp`. `delivery` traz `messageId` e `status`.

Regras que valem a pena saber:

- `request_id`: 16 a 100 letras, números, `_` ou `-`. Mesmo ID com o mesmo conteúdo devolve o mesmo
  `externalId` sem enviar de novo; com conteúdo diferente, 409.
- 409 com `delivery_uncertain: true`: o WhatsApp não confirmou. Confira antes de repetir; não troque o ID.
- 400/503 sem `delivery_uncertain`: recusado de vez (número sem WhatsApp, sessão desconectada). Nada foi
  enviado e o mesmo `request_id` pode ser usado de novo depois de corrigir (até a 1.2 ele ficava preso).
- 409 com "em atendimento por …": o contato está com outra conexão (modo `leads`).
- 503 no envio: a sessão não está conectada.
- Envios da mesma sessão saem um por vez, com 1 s de intervalo (`DMK_WA_INTERVALO_ENVIO_MS`). Sessões
  diferentes não esperam umas pelas outras.
- 401: credencial revogada ou vencida (90 dias).
- Limites por autorização: 1.000 eventos na fila, 5.000 envios registrados. Limite de 256 MB de anexos pendentes por sessão.

## Administração — `/admin/v1`

`Authorization: Bearer <chave de dados/admin.key>`. Use pelo comando `dmk-wa`; as rotas existem para
quem for fazer uma tela. Dez chaves erradas seguidas do mesmo endereço bloqueiam por um minuto.

| Método e caminho | Entrada / resultado |
|---|---|
| `GET /sessoes` | Lista: `id`, `nome`, `dono`, `ativa`, `status`, `telefone`, `autorizacoes`, `eventos_pendentes`. |
| `POST /sessoes` | `{ "nome", "dono" }` → sessão criada (desligada). Até 50 sessões. |
| `GET /sessoes/<id>` | A sessão; com `status: AGUARDANDO_QR` traz `qr` (imagem) e `qr_texto`. |
| `POST /sessoes/<id>/conectar` | Liga. Sem credencial salva, devolve o QR. |
| `POST /sessoes/<id>/pausar` | Desliga mantendo a sessão. |
| `POST /sessoes/<id>/reiniciar` | Reinicia mantendo a sessão. |
| `POST /sessoes/<id>/novo-qr` | `{ "confirmado": true }`. Desconecta o número e gera QR para outro. |
| `POST /sessoes/<id>/excluir` | `{ "confirmado": true }`. Apaga sessão, autorizações e fila. |
| `GET /sessoes/<id>/autorizacoes` | Sistemas ligados à sessão. |
| `POST /sessoes/<id>/autorizacoes` | `{ "nome", "sistema", "confirmado": true, "tipo"? }` → `code` (10 min, um uso). `tipo`: `atendimento` (padrão) ou `avisos`. |
| `POST /sessoes/<id>/autorizacoes/<aid>/tipo` | `{ "tipo": "atendimento" \| "avisos" }` sem trocar a credencial. |
| `POST /sessoes/<id>/autorizacoes/<aid>/revogar` | Corta o acesso na hora. |
| `POST /sessoes/<id>/autorizacoes/<aid>/excluir` | Revoga e remove o cadastro. Revogar/excluir devolve as conversas dela para todos. |
| `GET /sessoes/<id>/atendimentos` | `{ modo, conversas }` — cada conversa com `owner` (quem atende). |
| `POST /sessoes/<id>/atendimentos/liberar` | `{ "peer" }` → volta a ser lead para todas as conexões. |
| `POST /sessoes/<id>/atendimentos/transferir` | `{ "peer", "para": "<ID da conexão>" }`. |
| `POST /sessoes/<id>/distribuicao` | `{ "modo": "leads" \| "todos" }`. |

O resumo da sessão traz `recebendo`: `true` quando o WhatsApp confirmou a entrega de mensagens a este aparelho
nesta conexão, `false` quando está conectado há mais de 90 s sem esse sinal (o painel mostra "Sem receber") e
`null` enquanto confere ou quando não está conectado. `CONECTADO` sozinho não garante recebimento.

Estados da sessão: `DESCONECTADO`, `INICIANDO`, `AGUARDANDO_QR`, `CONECTADO`, `RECONECTANDO`, `ERRO` e
`SUBSTITUIDA` — a mesma credencial foi aberta em outro lugar (código 440: outra VPS, cópia da pasta `dados`,
serviço duplicado). O conector para essa sessão em vez de brigar em loop com a outra cópia; desligue a cópia
e use Reiniciar.

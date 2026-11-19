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
| `POST /send` | `{ "to", "text", "request_id" }` → `{ "externalId" }`. Anexo: `media: { base64, mimetype, filename }` (até 10 MB). Citação: `reply: { id, from_me, body }`. |
| `POST /react` | `{ "to", "messageId", "emoji" }` (emoji vazio tira a reação). |
| `POST /edit` | `{ "to", "messageId", "text" }`, só mensagens enviadas por este número. |
| `POST /delete` | `{ "to", "messageId" }`, só mensagens enviadas por este número. |
| `POST /presence` | `{ "to", "state": "composing" \| "paused" }`. |
| `GET /presence?to=` | `{ "state", "at" }`: o contato está digitando ou gravando. |
| `POST /read` | `{ "to", "messageIds": [..] }`. |
| `GET /photo?to=` | Foto do contato (até 1 MB) ou 204. Com `format=url`: `{ "url" }`. |

Eventos: `{ id, type, data, at }`. `message` traz `peer`, `phone`, `name`, `messageId`, `text`, `media`,
`outgoing`, `timestamp`. `delivery` traz `messageId` e `status`.

Regras que valem a pena saber:

- `request_id`: 16 a 100 letras, números, `_` ou `-`. Mesmo ID com o mesmo conteúdo devolve o mesmo
  `externalId` sem enviar de novo; com conteúdo diferente, 409.
- 409 com `delivery_uncertain: true`: o WhatsApp não confirmou. Confira antes de repetir; não troque o ID.
- 503 no envio: a sessão não está conectada.
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
| `POST /sessoes/<id>/autorizacoes` | `{ "nome", "sistema", "confirmado": true }` → `code` (10 min, um uso). |
| `POST /sessoes/<id>/autorizacoes/<aid>/revogar` | Corta o acesso na hora. |
| `POST /sessoes/<id>/autorizacoes/<aid>/excluir` | Revoga e remove o cadastro. |

Estados da sessão: `DESCONECTADO`, `INICIANDO`, `AGUARDANDO_QR`, `CONECTADO`, `ERRO`.

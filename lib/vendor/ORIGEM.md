# Arquivos reaproveitados do DMK Prisma

Estes quatro arquivos vieram de `dmksolutions/DMK-Prisma`, pasta `sistema/lib`, revisão
`56027ed89700a453a93eadfcd275055dd3a5fbfc` (19/11/2026):

| Arquivo | Papel |
|---|---|
| `dmk-chat-connector.js` | Protocolo Conector DMK (`/api/public/dmk-connector/v1`): autorizações, fila de eventos, envio, ações. **Alterado na 1.3.0** (ver abaixo). |
| `whatsapp-baileys.js` | Motor Baileys com várias sessões. **Alterado** (ver abaixo). |
| `chat-contact-profile.js` | Apoio do motor (foto do contato: `safePhoto`). Faltava na cópia até a 1.2 — a foto sempre voltava vazia. |
| `whatsapp-retry-cache.js` | Apoio do motor. Sem alteração. |
| `chat-contact-identity.js` | Apoio do motor. Sem alteração. |

## Alterações feitas aqui (todas marcadas com "DMK WhatsApp" no código)

`whatsapp-baileys.js`:
- `runtime.qrText` (QR no terminal).
- `saveMessage`/`loadMessage` com os bytes do proto: o reenvio sobrevive a reinício e serve anexos também.
- `stop()` sem logout não apaga mais o cache de reenvio.
- Código 440 (sessão substituída) para a sessão com estado `SUBSTITUIDA` em vez de reconectar em loop.
- Envios da mesma sessão em fila, com `minSendIntervalMs`; dois envios sem resposta reabrem o socket.
- `proto` exportado pelo normalizador do módulo.
- (1.3.8) Confirma o nó `<status>` que o Baileys rc14 ignora (issue #2858), registra o motivo do `stream:error`
  e vigia o "conectado sem receber" (`runtime.receiving`, reabertura do socket). Ao subir a biblioteca para uma
  versão que já trate `<status>`, o tratador daqui se desliga sozinho (`listenerCount('CB:status')`).
- 1.3.4: `messageText` usa `whatsapp-formatos.js` (mensagens de empresa em texto). O mesmo arquivo existe no DMK Prisma (`sistema/lib/whatsapp-formatos.js`, mod 1.523); manter os dois iguais.

`dmk-chat-connector.js`:
- Opção `route` (distribuição de atendimento — `lib/atendimento.js`): quem recebe cada conversa, quem pode
  responder/agir, rotas `/claim`, `/release`, `/conversations`, `/messages`, `/file`, `/routing`.
- `notify()` (eventos `assigned`/`released` para quem declara `routing`) e `grantById()`.
- Erro definitivo no envio libera o `request_id` em vez de deixá-lo "incerto" para sempre.

Por que copiar em vez de reescrever: o site (`conector.py`) e os PDVs do Prisma já falam este protocolo
e ele já tem testes no Prisma. Usando o mesmo código, o conector global responde igual à Central.

Ao trazer uma versão nova do Prisma: compare com a cópia daqui, reaplique as alterações acima (procure
"DMK WhatsApp" no código), atualize a revisão e rode `npm test` — `tests/motor.test.js` e
`tests/atendimento.test.js` acusam se alguma alteração se perdeu.

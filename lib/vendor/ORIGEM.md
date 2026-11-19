# Arquivos reaproveitados do DMK Prisma

Estes quatro arquivos vieram de `dmksolutions/DMK-Prisma`, pasta `sistema/lib`, revisão
`56027ed89700a453a93eadfcd275055dd3a5fbfc` (19/11/2026):

| Arquivo | Papel |
|---|---|
| `dmk-chat-connector.js` | Protocolo Conector DMK (`/api/public/dmk-connector/v1`): autorizações, fila de eventos, envio, ações. Sem alteração. |
| `whatsapp-baileys.js` | Motor Baileys com várias sessões. **Uma linha acrescentada** (`runtime.qrText`), para o QR poder ser mostrado no terminal. |
| `whatsapp-retry-cache.js` | Apoio do motor. Sem alteração. |
| `chat-contact-identity.js` | Apoio do motor. Sem alteração. |

Por que copiar em vez de reescrever: o site (`conector.py`) e os PDVs do Prisma já falam este protocolo
e ele já tem testes no Prisma. Usando o mesmo código, o conector global responde igual à Central.

Ao trazer uma versão nova do Prisma: copie os arquivos, reaplique a linha `runtime.qrText=update.qr;`
logo depois de `runtime.qrDataUrl=await QRCode.toDataURL(...)`, atualize a revisão acima e rode `npm test`.

# DMK WhatsApp — conector global

Um serviço só de WhatsApp para todos os sistemas DMK, com **várias sessões** (cada sessão é um número).
Cada sistema se liga à sessão dele com um código, busca os eventos, grava do lado dele e confirma.

**Versão:** veja `VERSION` · **Histórico:** `CHANGELOG.md`

## O que o conector guarda (e o que não guarda)

| Guarda | Não guarda |
|---|---|
| A conexão de cada número (credenciais do WhatsApp) | Conversas e histórico |
| As autorizações (quem pode usar qual sessão) | Contatos, etiquetas, atendimento |
| Os eventos ainda não confirmados pelo sistema dono | Anexos já confirmados |

Mensagens, conversas e arquivos ficam na pasta de cada sistema. Quando o sistema confirma um evento,
ele sai do conector.

## Como conversa com os sistemas

Fala o protocolo **Conector DMK** (`/api/public/dmk-connector/v1`), o mesmo da Central do DMK Prisma.
O site da gestão (`conector.py`) e os PDVs do Prisma já sabem usá-lo. O código do protocolo e do motor
Baileys veio do DMK Prisma sem reescrita (`lib/vendor/ORIGEM.md`).

A diferença para a Central: lá existe uma sessão só, compartilhada. Aqui cada autorização pertence a
uma sessão, e a credencial de uma sessão não lê nem envia por outra.

## Pasta única

```
/opt/dmk-whatsapp/
  conector.js  lib/  instalar/  ferramentas/  docs/  tests/     código (vem do GitHub)
  node/            Node próprio, na versão de NODE_VERSION
  node_modules/    Baileys e qrcode, nas versões do package.json
  dados/           sessões, autorizações, fila e admin.key   (nunca vai para o GitHub)
  backups/         um backup só: antes-da-atualizacao.tar.gz
  instalacao.json  o que existe fora da pasta
```

Fora da pasta: `/etc/systemd/system/dmk-wa-conector.service` e `/usr/local/bin/dmk-wa`.

## Documentação

- `docs/INSTALACAO.md` — instalar, criar a primeira sessão, atualizar, desinstalar.
- `docs/LIGAR-UM-SISTEMA.md` — como ligar a gestão, o Smart Core, o Prisma ou um sistema novo.
- `docs/API.md` — referência das operações.

## Testes

`node --test tests/*.test.js` — usam um motor simulado, sem falar com o WhatsApp. Conferem o protocolo
por sessão, o isolamento entre sessões, a fila com confirmação, a administração, o reinício e o
atualizador (versão nova, volta automática da versão quebrada).

O que os testes **não** cobrem: a conexão real com o WhatsApp (QR, envio, recebimento). Isso só se
confere na máquina, com um número de teste.

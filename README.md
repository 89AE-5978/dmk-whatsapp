# DMK WhatsApp — conector global

Um serviço só de WhatsApp para todos os sistemas DMK, com **várias sessões** (cada sessão é um número).
Cada sistema se liga à sessão dele com um código, busca os eventos, grava do lado dele e confirma.

**Versão:** veja `VERSION` · **Histórico:** `CHANGELOG.md`

> © 2026 **Danilo Silva dos Santos — DMK Soluções**. Todos os direitos reservados.
> O repositório é público para consulta, auditoria e atualização dos sistemas autorizados: **usar
> depende de autorização por escrito** ([LICENSE](LICENSE) ·
> [Termos de Uso](docs/TERMOS-DE-USO.md) · [Política de Privacidade](docs/POLITICA-DE-PRIVACIDADE.md)).
> A conexão com o WhatsApp é feita pela biblioteca de código aberto **Baileys** (MIT — WhiskeySockets);
> este conector **não é produto do WhatsApp nem da Meta** e não usa a API oficial
> ([Créditos](docs/CREDITOS.md)).

## Uma sessão, várias conexões (1.3.0)

Cada sessão é um número. Cada sistema/chat ligado a ela é uma **conexão**, com ID próprio.

- **Lead novo** (primeiro contato): aparece em todas as conexões.
- **Quem assume** (botão assumir ou simplesmente respondendo) fica sozinho com a conversa: as outras
  param de receber as mensagens desse contato, recebem o aviso para tirar da tela e não conseguem responder.
- **Finalizou**: a conversa volta a ser lead e a próxima mensagem do contato aparece de novo para todas.
- **Conexão de avisos** (cobrança, alertas do Smart Core): envia sem assumir a conversa — o lead não fica
  preso num sistema que só manda notificação. O tipo de cada conexão se troca no painel (Sistemas ligados).
- Pelo painel (aba Atendimentos da sessão) dá para ver quem atende cada conversa, liberar, transferir e trocar
  o modo para "todos" (todas as conexões recebem tudo, como antes da 1.3.0).

## Chatbot (atendimento automático)

Cada sistema ligado pode montar um fluxograma de atendimento e o conector responde sozinho quem ainda não tem
atendente — com "digitando…", confirmação de leitura, botões e lista. Assim que alguém assume a conversa (pelo
sistema ou pelo próprio celular do número), o robô para naquele contato. O passo a passo e a API estão em
[docs/CHATBOT.md](docs/CHATBOT.md); no painel, a aba **Chatbot** da sessão liga, desliga e mostra em que etapa
cada contato está.

## O que o conector guarda

| Onde | O quê |
|---|---|
| `dados/whatsapp-baileys/<sessão>` | A credencial de cada número |
| `dados/conector.json` | Sessões, conexões (autorizações) e eventos ainda não confirmados |
| `dados/sessoes/<sessão>/atendimento/` | Conversas, mensagens e anexos, **numa pasta por conexão** (`LEIA-ME.txt` lá dentro explica). Uma conexão nunca lê a pasta de outra |
| `dados/sessoes/<sessão>/reenvio/` | Conteúdo dos envios dos últimos 7 dias, para o WhatsApp conseguir reenviar a mensagem ao celular do cliente (evita "Aguardando mensagem") |

Os sistemas continuam buscando os eventos, gravando do lado deles e confirmando. Anexos do histórico ficam
180 dias; conversas paradas há mais tempo que isso saem sozinhas.

## Como conversa com os sistemas

Fala o protocolo **Conector DMK** (`/api/public/dmk-connector/v1`), o mesmo da Central do DMK Prisma.
O site da gestão (`conector.py`) e os PDVs do Prisma já sabem usá-lo. O código do protocolo e do motor
Baileys veio do DMK Prisma sem reescrita (`lib/vendor/ORIGEM.md`).

A diferença para a Central: lá existe uma sessão só, compartilhada. Aqui cada autorização pertence a
uma sessão, a credencial de uma sessão não lê nem envia por outra, e dentro da sessão vale a distribuição
de leads acima.

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
- `docs/API.md` — **referência completa da API**: todos os formatos de envio (texto, mídia, áudio, voz,
  localização, contato, enquete, lista, botões), eventos, limites, erros, administração, logs e automação.
  É a página que quem for integrar precisa ler.
- `docs/PAINEL.md` — painel web para gerenciar sem terminal (acesso por túnel SSH).
- `docs/PROMPT-PARA-AGENTES.md` — texto pronto para entregar a quem (ou ao agente que) for ligar um sistema.
- `docs/PROMPT-AJUSTE-1.3.md` — texto para ajustar um sistema já ligado à distribuição de leads da 1.3 (Assumir/Finalizar), com o bloco de cada sistema.
- `LICENSE`, `docs/TERMOS-DE-USO.md`, `docs/POLITICA-DE-PRIVACIDADE.md`, `docs/CREDITOS.md` — direitos,
  condições de uso, LGPD e as licenças de terceiros (Baileys e companhia). O painel mostra um resumo no
  botão do escudo, no topo.

## Testes

`node --test tests/*.test.js` — usam um motor simulado, sem falar com o WhatsApp. Conferem o protocolo
por sessão, o isolamento entre sessões, a fila com confirmação, a administração, o reinício e o
atualizador (versão nova, volta automática da versão quebrada).

O que os testes **não** cobrem: a conexão real com o WhatsApp (QR, envio, recebimento). Isso só se
confere na máquina, com um número de teste.

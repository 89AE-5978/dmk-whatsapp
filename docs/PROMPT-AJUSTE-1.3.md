# Prompt para outros agentes — ajustar um sistema JÁ ligado para o conector 1.3

Para ligar um sistema novo, use [PROMPT-PARA-AGENTES.md](PROMPT-PARA-AGENTES.md). Este aqui é para os sistemas
que já têm credencial e precisam acompanhar a distribuição de leads (Assumir/Finalizar) da versão 1.3.
Entregue o "Texto comum" a todos e acrescente o bloco do sistema em questão.

---

Texto comum (cole em todos):

Você vai ajustar a integração deste sistema com o DMK WhatsApp, o conector global de WhatsApp da DMK.
Ele foi atualizado para a versão 1.3. Leia antes de mexer:
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/API.md
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/PROMPT-PARA-AGENTES.md

Endereço do protocolo: https://zap.danilodss.com.br/api/public/dmk-connector/v1
Este sistema JÁ está ligado: use a credencial que ele já tem guardada. Não troque código de novo.
Não invente outro protocolo nem mude o que já funciona.

O que mudou no conector:
1. Uma sessão (um número de WhatsApp) atende vários sistemas. Cada sistema é uma "conexão" com ID próprio
   (GET /routing devolve o ID e o modo).
2. Lead novo (primeiro contato) chega para todos os sistemas. Quem assume fica sozinho com a conversa:
   - POST /claim {"to"} assume; responder com POST /send também assume;
   - POST /release {"to"} finaliza e a conversa volta a ser lead para todos.
3. Envie o cabeçalho "X-DMK-Features: actions,routing" no GET /events. Com ele chegam também:
   - "assigned" {peer, phone, owner:{id,label}, mine}: se mine=false, tire a conversa da tela deste sistema;
   - "released" {peer}: a conversa foi finalizada e volta a ser lead.
4. GET /conversations (leads + conversas deste sistema) e GET /messages?to=&before=&limit= (histórico guardado
   no conector, anexos em GET /file?path=) servem para montar ou recuperar a lista e o histórico.
5. Erros que você precisa tratar:
   - 409 com "em atendimento por …": outro sistema está com o contato. Não reenvie; tire da tela.
   - 400 ou 503 SEM delivery_uncertain: recusado de vez, nada foi enviado. Mostre o erro. Pode repetir o
     MESMO request_id depois de corrigir.
   - 409 com delivery_uncertain:true: não confirmado. Confira antes de repetir e não troque o request_id.
   - 401: credencial revogada. Pare o laço e avise.

Regras de que reações, resposta citada e apagar dependem:
- Guarde o "peer" de cada mensagem EXATAMENTE como veio no evento (pode terminar em @lid ou em
  @s.whatsapp.net) e use esse mesmo valor no campo "to" das respostas, reações, apagar, editar e lido.
  Não converta para só o número.
- Guarde o "messageId" de cada mensagem. É ele que vai em reply.id (resposta citada), em /react e em /delete.
- Mensagem recebida com "reply" traz a citação: mostre-a.
- Eventos "reaction", "revoke" e "edit" atualizam a mensagem correspondente pelo messageId.

Laço de eventos: a cada 4 s, GET /events → baixar o anexo (GET /media/<id>) → gravar → POST /ack.
Nunca confirme antes de gravar. A fila do conector tem limite: sistema que não confirma enche a fila.

Teste e relate:
(a) lead aparece; (b) assumir some do outro sistema; (c) finalizar volta para todos;
(d) receber, responder citando, reagir e apagar, nos dois sentidos; (e) anexo nos dois sentidos.
Relate o que mudou, o que testou e o que não conseguiu testar.

Bloco do DMK Prisma (conexão DMK-PRISMA, tipo Atendimento):

Este sistema é o DMK Prisma (Central). No chat de atendimento da Central e dos PDVs que usam o conector externo:
- conversa sem dono: selo "Lead" e botão "Assumir";
- conversa sua: botão "Finalizar"; ao receber "assigned" com mine=false, a conversa some da lista;
- siga o padrão visual do Prisma: cartão de mensagem com as ferramentas em ícones, botões numa linha só, sem
  componentes nativos do navegador, caber em 100% de zoom nos três front-ends.
Valide ao vivo antes de publicar na main.

Bloco do DMK Gestão (conexão DMK-SERVICOES, tipo Atendimento):

Este sistema é o DMK Gestão (sistema.dmksolutions.io, /opt/dmk-gestao). Mesmo comportamento do atendimento:
selo "Lead", botões "Assumir" e "Finalizar", conversa some quando outro sistema assume. Mantenha o padrão
visual do DMK Prisma.

Bloco do DMK Smart Core (conexão IOT-ESP32, tipo Avisos):

Este sistema é o DMK Smart Core. Ele só ENVIA avisos (alertas das centrais). A conexão dele está marcada como
"Avisos" no conector: envia sem assumir conversa e não recebe leads.
- Não precisa de Assumir/Finalizar nem de tela de conversa.
- Mesmo assim, consulte GET /events e confirme com POST /ack (recibos de entrega dos avisos). Hoje há 36
  eventos parados na fila desta conexão porque ninguém confirma.
- Trate os erros de envio como descrito acima (400/503 definitivo, 409 incerto).

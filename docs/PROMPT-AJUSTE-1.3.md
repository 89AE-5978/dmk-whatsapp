# Prompt para outros agentes — ajustar um sistema JÁ ligado para o conector 1.3

Para ligar um sistema novo, use [PROMPT-PARA-AGENTES.md](PROMPT-PARA-AGENTES.md). Este aqui é para os sistemas
que já têm credencial e precisam acompanhar a distribuição de leads (Assumir/Finalizar) e os formatos de envio
da versão 1.3. Entregue o "Texto comum" a todos e acrescente o bloco do sistema em questão.

---

Texto comum (cole em todos):

Você vai ajustar a integração deste sistema com o DMK WhatsApp, o conector global de WhatsApp da DMK.
Ele está na versão 1.3.12. Leia antes de mexer:
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/API.md
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/PROMPT-PARA-AGENTES.md

Endereço do protocolo: https://zap.danilodss.com.br/api/public/dmk-connector/v1
Este sistema JÁ está ligado: use a credencial que ele já tem guardada. Não troque código de novo.
Não invente outro protocolo nem mude o que já funciona.

1. QUEM ATENDE CADA CONVERSA — a decisão é do conector, não do chat
Uma sessão (um número de WhatsApp) atende vários sistemas. Cada sistema é uma "conexão" com ID próprio.
Lead novo (primeiro contato) chega para todos. Quem assume fica sozinho com a conversa: os outros param de
receber as mensagens daquele contato e recebem 409 se tentarem responder. Seu sistema não precisa decidir
nada disso, só refletir na tela.
- POST /claim {"to"} assume; responder com POST /send também assume.
- POST /release {"to"} finaliza e a conversa volta a ser lead para todos.
- Toda mensagem entregue traz o campo routing:
    { mode: "leads"|"todos", state: "NOVO"|"EM_ATENDIMENTO"|"TODOS", owner: {id,label}|null, mine: true|false }
  Use ESTE campo para desenhar a tela, sem consultar mais nada:
    state "NOVO"  -> lead, ninguém assumiu: mostre "Assumir";
    mine true     -> a conversa é deste sistema: mostre "Finalizar";
    mode "todos"  -> sessão sem dono de conversa: não mostre nenhum dos dois.
- Envie o cabeçalho "X-DMK-Features: actions,routing" no GET /events. Com ele chegam também:
    "assigned" {peer, phone, owner:{id,label}, mine}: se mine=false, tire a conversa da tela deste sistema;
    "released" {peer}: a conversa foi finalizada e volta a ser lead.
- GET /routing devolve o ID desta conexão e o modo da sessão.
- GET /conversations (leads + conversas deste sistema) e GET /messages?to=&before=&limit= (histórico guardado
  no conector, anexos em GET /file?path=) servem para montar ou recuperar a lista e o histórico.

2. FORMATOS DE ENVIO (POST /send)
"text" continua obrigatório e é a RESERVA: é o que vai se o formato não puder ser enviado e é o que fica no
histórico. Use um campo por envio, sem anexo:
- native {"type":"poll","name":...,"options":[2 a 12],"multiple":false}  -> enquete (formato oficial).
  O voto do cliente volta como mensagem de texto: Enquete "nome": opção escolhida.
- native {"type":"location","lat":...,"lng":...,"name":...,"address":...} -> localização (formato oficial).
- native {"type":"contact","name":...,"phone":"5587..."}                  -> cartão de contato (formato oficial).
- interactive {"style":"list"|"buttons","body":...,"footer":...,"button":...,"items":[{"id","label"}]}
  -> lista ou botões. EXPERIMENTAL: o WhatsApp não garante esse formato fora da API oficial e pode não
  aparecer em alguns aparelhos. Botões: até 3, rótulo de até 20 letras; acima disso vira lista (até 10 linhas).
  Sempre mande o "text" com as opções numeradas, que é o que vai na reserva.
Formulários (Flows), catálogo e pedidos são exclusivos da API oficial da Meta: não existem aqui, não tente.

3. ERROS A TRATAR
- 409 com "em atendimento por …": outro sistema está com o contato. Não reenvie; tire da tela.
- 400 ou 503 SEM delivery_uncertain: recusado de vez, nada foi enviado. Mostre o erro. Pode repetir o
  MESMO request_id depois de corrigir.
- 409 com delivery_uncertain:true: não confirmado. Confira antes de repetir e NÃO troque o request_id.
- 409 "request_id reutilizado com conteúdo diferente": você repetiu um ID com outro conteúdo. request_id é
  aleatório e novo por mensagem (16 a 100 caracteres [a-zA-Z0-9_-]); numa nova tentativa da MESMA mensagem,
  reenvie o corpo idêntico com o mesmo ID.
- 401: credencial revogada. Pare o laço e avise.

4. REAÇÃO, RESPOSTA CITADA E APAGAR
- Guarde o "peer" de cada mensagem EXATAMENTE como veio no evento (pode terminar em @lid ou em
  @s.whatsapp.net) e use esse mesmo valor no campo "to" das respostas, reações, apagar, editar e lido.
  Não converta para só o número.
- Guarde o "messageId" de cada mensagem. É ele que vai em reply.id (resposta citada), em /react e em /delete.
- Mensagem recebida com "reply" {messageId, body, type} traz a citação: mostre o balão citado.
- Ao responder citando, mande reply {"id","from_me","body"} com o id da mensagem original.
- Eventos "reaction", "revoke" e "edit" atualizam a mensagem correspondente pelo messageId.

5. LAÇO DE EVENTOS
A cada 4 s: GET /events -> baixar o anexo (GET /media/<id>) -> gravar -> POST /ack.
Nunca confirme antes de gravar. A fila do conector tem limite: sistema que não confirma enche a fila.

Teste e relate:
(a) lead aparece; (b) assumir some do outro sistema; (c) finalizar volta para todos;
(d) receber, responder citando, reagir e apagar, nos dois sentidos; (e) anexo nos dois sentidos;
(f) enquete, localização e contato, se o sistema for usar.
Relate o que mudou, o que testou e o que não conseguiu testar.

---

Bloco do DMK Prisma (conexão DMK-PRISMA, tipo Atendimento):

Este sistema é o DMK Prisma (Central). No chat de atendimento da Central e dos PDVs que usam o conector externo:
- use o campo routing de cada mensagem: selo "Lead" e botão "Assumir" quando state="NOVO"; botão "Finalizar"
  quando mine=true; ao receber "assigned" com mine=false, a conversa some da lista;
- DEFEITO CONFIRMADO A CORRIGIR: a resposta citada não aparece no chat do Prisma, nos dois sentidos — nem a
  citação que o cliente envia, nem a que o atendente manda (no DMK Smart Core, ligado ao MESMO conector, a
  citação aparece normalmente, então o conector está entregando certo). Investigue a gravação e a montagem do
  cartão de mensagem no chat: o evento recebido traz reply {messageId, body, type} e o envio deve mandar
  reply {"id","from_me","body"}. Confirme com o log do conector antes de dar por resolvido;
- siga o padrão visual do Prisma: cartão de mensagem com as ferramentas em ícones, botões numa linha só, sem
  componentes nativos do navegador, caber em 100% de zoom nos três front-ends.
Valide ao vivo antes de publicar na main.

Bloco do DMK Gestão (conexão DMK-SERVICOES, tipo Atendimento):

Este sistema é o DMK Gestão (sistema.dmksolutions.io, /opt/dmk-gestao). Mesmo comportamento do atendimento:
selo "Lead", botões "Assumir" e "Finalizar" pelo campo routing, conversa some quando outro sistema assume.
Mantenha o padrão visual do DMK Prisma.

Bloco do DMK Smart Core (conexões IOT-ESP32 tipo Avisos e IOT-ESP32 Atendimento tipo Atendimento):

Este sistema tem DUAS conexões no conector e elas não se misturam:
- IOT-ESP32 (tipo Avisos): só ENVIA alertas das centrais. Envia sem assumir conversa e não recebe lead nem
  mensagem de conversa — só os recibos de entrega dos próprios avisos. Mesmo assim, consulte GET /events e
  confirme com POST /ack, senão a fila dela enche (hoje há eventos parados ali porque ninguém confirma).
- IOT-ESP32 Atendimento (tipo Atendimento): é a do chat, com Assumir/Finalizar pelo campo routing.
Não troque os papéis das duas nem use a credencial de uma no lugar da outra.

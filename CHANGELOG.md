# Histórico

## 1.3.19 — 23/11/2026

**A atualização voltou a passar** — a 1.3.18 subiu com o arquivo de trava `.atualizando.lock` dentro do
repositório por engano. Na VPS, o atualizador cria essa trava na mesma pasta antes de buscar o código,
e o `git merge` abortava com *"untracked working tree files would be overwritten by merge"*, sem
atualizar nada (a instalação ficava presa na versão anterior, intacta).

- O arquivo saiu do repositório e entrou no `.gitignore`.
- A trava passou a ficar em `dados/.atualizando.lock`, **fora do que o Git acompanha** (com `/tmp` como
  reserva), para que nunca mais atrapalhe o merge da própria atualização.
- Teste novo guarda as duas coisas: o arquivo não pode estar no repositório e o script não pode criar a
  trava na raiz do código.

Quem ficou preso na 1.3.17 só precisa rodar a atualização de novo; não é preciso apagar nada à mão.

## 1.3.18 — 22/11/2026

**`dmk-wa atualizar`** — atualizar deixou de depender de decorar o caminho do script:

- `dmk-wa atualizar` traz a versão nova do GitHub (com backup e volta automática, como sempre) e
  `dmk-wa atualizar --verificar` só diz se há versão nova, sem alterar nada. O script
  `instalar/atualizar.sh` continua existindo e fazendo o trabalho.
- **Comando errado agora sai com erro**, em vez de imprimir a ajuda e sair como sucesso. Antes, um
  `dmk-wa comando-que-nao-existe && dmk-wa status` imprimia a ajuda, seguia em frente e parecia ter
  funcionado — foi exatamente o que aconteceu com `dmk-wa atualizar`, que não existia.
- Ajuda do comando atualizada; `docs/INSTALACAO.md` mostra o comando curto primeiro.

## 1.3.17 — 22/11/2026

**Cara nova: o conector de mensagens agora é verde**
- Painel inteiro na identidade verde DMK (topo, botões, cartões, listas, modais, selos), no lugar do azul
  que é dos outros sistemas. Verde é a cor do módulo de mensagens.
- Logotipo e ícone (favicon) novos: **balão de conversa**, desenho próprio da DMK — não é marca de
  terceiro nem cópia de ícone de ninguém.
- Lista vazia agora mostra ilustração + título + explicação, nunca só um texto solto (padrão do sistema).
- Topo no celular numa linha só: o nome não quebra mais, a etiqueta de versão sai e os botões de ícone
  ficam alinhados.
- Cartão de direitos no botão do escudo (topo) e link no rodapé da tela de entrada.

**Direitos, termos, privacidade e créditos**
- `LICENSE`: obra de Danilo Silva dos Santos (DMK Soluções), © 2026, todos os direitos reservados. O
  repositório é público para consulta, auditoria e atualização — **usar depende de autorização por
  escrito**.
- `docs/TERMOS-DE-USO.md`: condições de uso, responsabilidades de quem usa, riscos de conexão não
  oficial (número pode ser limitado ou bloqueado), garantias e limites, suspensão, foro.
- `docs/POLITICA-DE-PRIVACIDADE.md`: LGPD — quem é controlador e operador, que dados passam pelo
  conector, onde ficam, por quanto tempo (180 dias no histórico), segurança e direitos do titular.
- `docs/CREDITOS.md`: a biblioteca **Baileys** (MIT — WhiskeySockets) é quem fala o protocolo do
  WhatsApp Web, com o aviso de licença original; demais componentes; e o aviso de que o conector não é
  produto do WhatsApp nem da Meta e não usa a API oficial.
- `GET /health` passou a devolver `direitos` e `lib`: o aviso anda junto com o serviço.
- `docs/API.md` ganhou a seção 0 (direitos, uso e créditos) e o README traz o aviso logo no começo.

## 1.3.16 — 22/11/2026

**Documentação completa da API** — `docs/API.md` foi reescrita como referência profissional: gateways e
portas, começar em 5 passos com `curl`, cada evento com seus campos, **cada formato de envio com exemplo
pronto** (texto, citação, imagem, vídeo, documento, áudio, mensagem de voz, localização, contato, enquete,
lista e botões), tabela de limites, o que fazer com cada código de erro, rotas de administração, logs,
as proteções contra travamento e a lista do que a API **não** faz (Flows, catálogo, pedidos, grupos).

**Mensagem de voz**
- `POST /send` com `media: { ..., "voz": true }` manda áudio como gravação de voz (aquela bolha com o play
  e a onda). Sem a marca, áudio continua indo como arquivo — nada muda para quem já enviava.
- `audio/ogg; codecs=opus` passou a ser aceito (antes o mimetype com parâmetro era recusado com 400).
- Áudio e figurinha recebidos vêm marcados: `media.voz`, `media.figurinha` e `media.segundos`, para o chat
  desenhar a bolha certa sem adivinhar pelo nome do arquivo.

**Mais log**
- Uma linha por envio aceito no journal: `[sessao N] enviando texto|voz|image/jpeg|poll|list para ...9399`
  (formato e quatro últimos dígitos, sem o conteúdo da mensagem).

## 1.3.15 — 21/11/2026

**O robô não responde de novo a cada "oi"**
- Mesma mensagem repetida em poucos segundos (`antiflood_seg`, 10 s) é ignorada: não repete o menu e não
  conta como resposta errada — antes três "oi" seguidos empurravam o cliente até a transferência.
- Depois de transferir, o contato fica em espera (`aguardando_min`, 60 min): enquanto nenhum atendente
  assume, o robô não manda mais nada naquela conversa.
- Depois de encerrar, ou quando uma pessoa atende, começa uma carência (`repetir_apos_min`, 120 min) antes
  de o contato poder entrar no fluxo de novo. Tudo configurável por fluxo; `0` desliga a espera.
- `GET /bot/estados` mostra só quem está no fluxograma; com `?todas=1` vem também quem está em espera, com o
  campo `phase` (`fluxo`, `aguardando`, `humano`, `fim`).

**Contato que nunca passa pelo robô**
- `POST /bot/ignorar { to, ativo }` e `GET /bot/ignorados`; no painel, "Nunca atender" e "Voltar a atender"
  na aba Chatbot; pela administração, `POST /admin/v1/sessoes/<id>/chatbot/ignorar`.
- As mensagens desse contato continuam chegando para os atendentes: só o robô fica de fora.

## 1.3.14 — 21/11/2026

**Chatbot: atendimento automático por regras, um fluxo por conexão**
- O conector responde sozinho quem ainda não tem atendente, pelo fluxograma que cada sistema monta com a
  credencial que já tem. Assim que alguém assume a conversa — pelo sistema ou respondendo no próprio celular
  do número — o robô para naquele contato.
- Nós: `mensagem`, `pergunta`, `transferir`, `encerrar` e `acao` (consulta um endereço https do sistema da
  empresa e segue pela resposta). Condições: número, igual, contém, começa, sim, não, lista de palavras,
  anexo, e-mail, telefone e qualquer. Variáveis `{{nome}}`, `{{telefone}}`, `{{resposta}}` e o que o fluxo
  guardar. Por nó: marcar como lida, "digitando…", atraso, citar a mensagem e botões ou lista.
- Protege contra fluxo mal montado: até 100 nós, todo destino tem que existir, no máximo 12 passos por
  mensagem, volta ao início depois de `inativo_min` parado e chama um atendente depois de `maximo_erros`.
- Rotas novas para os sistemas: `GET/PUT /bot`, `POST /bot/ativar`, `GET /bot/estados`, `POST /bot/sair`,
  `GET /bot/modelos`; evento `bot` para quem declara `X-DMK-Features: bot`.
- Painel: aba **Chatbot** na ficha da sessão — liga, desliga, escolhe quem atende os contatos novos, copia um
  modelo pronto e mostra em que etapa cada contato está, com o botão de tirar do fluxo.
- Documentação: `docs/CHATBOT.md` (tudo o que o fluxo aceita) e `docs/PROMPT-CHATBOT.md` (prompt para os
  agentes montarem a tela do fluxograma).
- O protocolo passou a aceitar PUT nas rotas públicas (é como o fluxo é gravado).

## 1.3.13 — 21/11/2026

**Fila de eventos não cresce mais sem limite**
- Visto na VPS: a conexão de avisos do Smart Core tinha 43 eventos parados, porque ela nunca busca eventos.
  Eram sobras de antes da 1.3.12 e recibos de entrega dos próprios avisos — nenhum sistema ia lê-los.
- Agora a fila de quem não busca eventos há mais de 1 h é **rolante**: guarda os 500 mais novos e descarta os
  antigos, em vez de encher até os 1000 e passar a recusar com "Fila do conector cheia". Nada se perde de
  verdade: as mensagens ficam no histórico da sessão (`GET /messages`).
- Qualquer evento parado há mais de **7 dias** é descartado, com o anexo, na faxina que já roda a cada 6 h.
- Painel: a coluna **Fila** mostra numa dica a data do evento mais antigo, e cada conexão com fila ganhou o
  botão **Esvaziar a fila** (`POST /admin/v1/sessoes/<id>/autorizacoes/<aid>/limpar-fila`).
- O selo "Só envia · marque Avisos" virou "Só envia ⚠" (o recado completo ficou na dica), senão a linha não
  cabia com o botão novo.

## 1.3.12 — 21/11/2026

- **Etiqueta de atendimento em toda mensagem entregue** (`routing`): modo, situação (lead ou em atendimento),
  quem assumiu e se é o próprio sistema. O chat passa a saber na hora se mostra "Assumir" ou "Finalizar", sem
  consultar nada. Quem decide continua sendo o conector; a etiqueta só conta a decisão.
- **Envio de enquete, localização e cartão de contato** (`POST /send` com `native`), nos formatos oficiais da
  biblioteca. O voto do cliente na enquete volta como mensagem de texto legível. Lista e botões (`interactive`,
  desde a 1.3.4) seguem como experimentais. Formulários (Flows), catálogo e pedidos são exclusivos da API
  oficial da Meta e não existem nesta biblioteca.

## 1.3.11 — 21/11/2026

- Modo diagnóstico mostra a estrutura (só os nomes dos campos, nunca o conteúdo) de cada mensagem recebida e de
  cada resposta citada enviada — para localizar por que a citação não aparece nos dois sentidos.

## 1.3.10 — 21/11/2026

- **Resposta citada chegava sem a citação no celular.** O sistema mostrava o balão citado, o cliente recebia uma
  mensagem comum. A mensagem original fica guardada com o endereço novo do WhatsApp (LID) e o envio vai para o
  número; com endereços diferentes a biblioteca marcava a citação como "de outra conversa". Agora a citação usa o
  mesmo endereço do envio.
- Todo envio recusado pelo conector vai para o journal: `[envio recusado] "<conexão>" → <código>: <motivo>`,
  sem o conteúdo. Antes só o sistema que enviou via a recusa.

## 1.3.9 — 21/11/2026

Visto no teste da 1.3.8 na VPS (que confirmou a causa: 20 nós `<status>` pendentes foram confirmados e as mensagens
retidas chegaram todas de uma vez):
- Mensagem reentregue pelo WhatsApp depois da reconexão (mesmo ID, uma vez pelo número e outra pelo LID) era
  gravada duas vezes no histórico da sessão e contada duas vezes como recebida. Os sistemas já não recebiam a
  repetição; agora o histórico também não.
- Journal mais limpo: mensagens de controle da própria conta (`protocolMessage` de sincronização entre aparelhos)
  geravam um aviso "formato não tratado" por mensagem, e cópias de envios de outro aparelho que não abriam eram
  contadas como falha de recebimento. Nenhuma das duas é mensagem de cliente — saem sem aviso e sem contar.

## 1.3.8 — 21/11/2026

**"Conectado", mas nenhuma mensagem chega — e queda "Stream Errored (ack)" a cada ~50 minutos**
- Causa (falha conhecida do Baileys 7.0.0-rc14, issue #2858, ainda sem correção publicada lá): o WhatsApp passou a
  mandar o status (story) dos contatos num nó `<status>` solto e a biblioteca não tem tratador para ele — nunca
  confirma. O servidor fica esperando a confirmação, **segura as mensagens novas** da sessão e uns 50 minutos depois
  derruba a conexão. Ao reconectar ele reenvia o mesmo `<status>` e o ciclo recomeça. Envio continua funcionando,
  por isso o estado ficava "Conectado".
- Correção: o motor confirma o nó `<status>` na hora (sem ler o conteúdo). Se uma versão futura da biblioteca já
  trouxer o tratador, o nosso não é registrado.
- Quando o WhatsApp derruba o stream, o journal agora diz o motivo completo (`motivo=ack classe=status tipo=media`).
- "Conectado" deixou de ser tratado como garantia de recebimento: o motor espera o sinal do servidor de que as
  pendências foram entregues. Sem esse sinal (nem mensagem alguma) em 90 s, reabre só o socket, sem QR — no máximo
  2 vezes seguidas. O resumo da sessão ganhou `recebendo` (true / false / null = ainda conferindo).
- Painel: selo **Sem receber** (na lista e na ficha, com a orientação), o cartão **Última recebida** mostra há
  quanto tempo ("há 3 h"; a data completa aparece ao passar o mouse) e o **Testar** ganhou "Canal de recebimento".

**Fila de quem só envia (Avisos)**
- No modo "todos" a conexão de Avisos recebia todas as conversas; como ela nunca lê, a fila só crescia até o limite
  de 1000. Agora, nos dois modos, quem só envia não recebe eventos de conversa — só os recibos de entrega dos
  avisos que ele mesmo mandou — e os eventos de conversa que já estavam parados na fila dele são retirados
  (nada se perde: as mensagens estão no histórico da sessão e nos outros sistemas).

## 1.3.7 — 20/11/2026

- Painel, diálogo **Filtros**: as caixas de marcar do navegador saíam gigantes e desalinhadas (herdavam o estilo
  dos campos de texto). Agora cada estado é uma opção de liga/desliga no padrão do painel, com o mesmo selo
  colorido da lista; cabeçalho com o ícone de filtro. Nenhum componente nativo do navegador no diálogo.

## 1.3.6 — 20/11/2026

**A causa do "parou de sincronizar": sistema que só envia virava dono da conversa**
- Visto em produção: o Smart Core (ligado como *atendimento*) mandou uma mensagem de teste a um contato e, pela
  regra "quem responde fica com a conversa", virou o dono dela. Só que o Smart Core só ENVIA — nunca busca
  mensagens. As respostas daquele contato passaram a ir só para a fila dele (44 eventos parados) e sumiram do
  Prisma e do Serviços. Para quem olha, o WhatsApp "travou" depois que o sistema mandou o aviso.
- Agora o conector reconhece o sistema que só envia: o do tipo **Avisos** e também o que está ligado como
  atendimento há mais de 2 minutos e **nunca buscou mensagens**. Ele envia sem assumir a conversa, não é barrado
  e não recebe lead. Conversa que já estava presa com um sistema assim é devolvida a todos na próxima mensagem.
- O conector passou a guardar quando cada sistema buscou mensagens (`last_events_at`) e desde quando está ligado
  (`paired_at`). A coluna **Última consulta** e o **Testar** usam a busca de mensagens — na 1.3.5 usavam o último
  pedido qualquer e acusavam de "Parado" um sistema que só envia. Agora ele aparece como "Só envia" (e, se estiver
  como atendimento, "Só envia · marque Avisos"); "Parado há X" fica só para quem buscava e deixou de buscar.

## 1.3.5 — 20/11/2026

**"Depois de atualizar, para de sincronizar"**
- Ao parar uma sessão (pausar, reiniciar ou ATUALIZAR o conector), a última alteração da credencial do WhatsApp
  que estava na fila de gravação era descartada, e gravações de chaves de criptografia em andamento podiam ser
  cortadas pela saída do processo. A sessão voltava "Conectada" com chaves antigas — risco de as mensagens
  recebidas não abrirem mais. Agora a parada fecha o socket e só solta a sessão depois que credencial e chaves
  estão inteiras no disco (o mesmo numa queda com reconexão, antes de abrir o socket novo). Ao trocar número ou
  excluir, nada é regravado. Saída do serviço com trava de 30 s.
- Para achar QUEM parou: a aba **Sistemas ligados** mostra a **última consulta** de cada sistema e marca
  "Parado há X" quando um sistema ligado fica mais de 2 minutos sem buscar eventos; o **Testar** ganhou a
  conferência "Sistemas consultando", com o nome, desde quando e quantos eventos estão na fila dele.
  (Na VPS de produção, em 20/11, era o Smart Core que não consultava desde a noite anterior; Prisma e Serviços
  seguiam normais. O conserto desse caso é no cliente do sistema que parou.)

**Painel**
- Ícone na aba do navegador (`/painel/icone.svg`) e manifesto (`/painel/app.webmanifest`): dá para instalar o
  painel como aplicativo, com a barra na cor da marca; no celular a barra do navegador já usa a cor.
- Ficha da sessão: abas numa faixa própria (os cartões ficavam colados nelas), cartões em 4 colunas (2 no
  celular), cabeçalho com ícone e sem a faixa vazia que sobrava embaixo.
- Sistemas ligados: ações só com ícone e ID junto do nome — a tabela cabe sem rolar de lado no computador.
- Botão de copiar: quando o navegador nega a área de transferência, tenta o método antigo; se também falhar,
  avisa e deixa o texto selecionado (antes o botão simplesmente não fazia nada).

## 1.3.4 — 20/11/2026

- Mensagens "de empresa" (as que a Celpe/Neoenergia, bancos e lojas mandam: interativas, com botões, listas,
  modelos e enquetes) chegavam aos sistemas como "Conteúdo recebido pelo WhatsApp (interactiveMessage).
  Visualização deste formato indisponível". Agora chegam como texto: título, corpo, rodapé e as opções oferecidas
  (com o link ou código de cada botão, quando há). Anexo no cabeçalho é sinalizado para ver no celular.
  Vale para as próximas mensagens; as que já chegaram com o aviso antigo ficam como estão.
- Essas mensagens, os cartões de contato e as localizações também seguem para os sistemas num campo novo e
  opcional do evento, `rich` (tipo, título, corpo, rodapé, opções, contatos, local), para quem quiser desenhar um
  cartão. Quem não conhece o campo continua usando só o texto.
- Envio de lista e botões nativos do WhatsApp (experimental): `POST /send` aceita o campo opcional `interactive`
  (`style` "list" ou "buttons", `body`, `footer`, `button`, `items` com `id` e `label`). O `text` continua
  obrigatório e deve trazer as opções numeradas: é o que vai quando o envio nativo não é possível. Botões: até 3,
  com rótulo de até 20 letras; fora disso vira lista (até 10 linhas). O WhatsApp não garante esse formato fora da
  API oficial — pode não aparecer em alguns aparelhos; teste com o seu número antes de usar com clientes.
  A escolha do cliente volta como mensagem comum, com o `id` da opção no texto.

## 1.3.3 — 20/11/2026

- Toda queda de conexão com o WhatsApp vai para o journal com o código e o motivo. No teste da 1.3.2 o aviso
  "Buffer timeout reached" se repetia a cada minuto — sinal de reconexão — e a queda em si não aparecia.

## 1.3.2 — 19/11/2026

- Modo diagnóstico para o recebimento: `touch /opt/dmk-whatsapp/dados/diagnostico` liga, apagar o arquivo desliga
  (vale em até 5 s, sem reiniciar). Cada mensagem que chega gera linhas `[DIAG]` só com o formato — o nó bruto
  entregue pelo servidor, o pacote depois de decifrar e se o conector entregou às conexões. Nunca o texto.

## 1.3.1 — 19/11/2026

Teste na VPS da 1.3.0: envio ok, mas nenhuma mensagem recebida chegava aos sistemas — e não aparecia nada no log.
- O socket do WhatsApp rodava com o registro de erros desligado: "failed to decrypt message" (mensagem recebida que
  não abre) não aparecia em lugar nenhum. Agora avisos e erros dele vão para o journal, numa linha curta, sem repetir.
- Mensagem recebida que não pôde ser decifrada era descartada em silêncio. Agora é contada, avisada no journal e
  aparece no Testar do painel, com a orientação de refazer o pareamento quando nenhuma abre.
- Uma linha por mensagem recebida no journal (final do número, sem o texto), para conferir se chegou.
- A biblioteca de criptografia despejava a sessão inteira — com chaves privadas — no journal a cada troca de sessão
  ("Closing session: SessionEntry"). Essas mensagens saem do log; falhas de decifrar viram uma linha curta.
- Conexão do tipo Avisos não recebe mais leads (só os recibos dos próprios envios): a fila dela enchia de mensagens
  que ninguém lia.

## 1.3.0 — 19/11/2026

**Travamento e "a mensagem vai, mas ninguém consegue ler"** (celular do cliente em "Aguardando mensagem"):
- Biblioteca do WhatsApp de 6.7.24 para **7.0.0-rc14**. A 6.7 não sabia lidar com o endereçamento novo do
  WhatsApp (LID e token de privacidade): o envio era aceito, mas o aparelho do cliente não conseguia abrir.
  O motor já tinha o código para LID; faltava a biblioteca que o entrega.
- Reenvio persistente: o conteúdo exato de cada envio (inclusive anexo) fica 7 dias em
  `dados/sessoes/<sessão>/reenvio/`. Antes ficava só em memória e sumia ao pausar, reiniciar ou atualizar —
  todo pedido de reenvio que chegasse depois ficava sem resposta.
- Código 440 (a mesma credencial aberta em outro lugar — outra VPS, cópia da pasta `dados`, serviço
  duplicado): a sessão para com o estado "Aberta em outro lugar" em vez de reconectar em loop. As duas cópias
  brigando é exatamente o "funciona 2 ou 3 mensagens e trava".
- Envios da mesma sessão em fila, com 1 s de intervalo; sessões diferentes não esperam umas pelas outras.
- Conexão "zumbi" (aparece conectada, não responde): dois envios sem resposta reabrem só aquele socket, sem QR.
- Erro definitivo (número sem WhatsApp, sessão desconectada) não deixa mais o `request_id` preso como
  "incerto" — o sistema repetia o mesmo ID e recebia 409 para sempre.
- Foto do contato voltava sempre vazia (faltava `chat-contact-profile.js` na cópia do motor).

**Uma sessão, várias conexões — distribuição de leads:**
- Cada sistema ligado é uma conexão com ID próprio. Lead novo vai para todas; quem assume (`/claim`) ou
  responde fica sozinho com a conversa; finalizar (`/release`) devolve para todas. Eventos `assigned` e
  `released` para quem declara `X-DMK-Features: routing`. Sistemas antigos funcionam sem mudança.
- Tipo de conexão **Avisos** (cobrança, alertas do Smart Core): envia sem assumir e sem ser barrada; o
  aviso aparece no histórico de quem atende. Troca pelo painel, sem gerar código novo.
- Histórico guardado no conector, numa pasta por conexão: `dados/sessoes/<sessão>/atendimento/`
  (`geral/` para leads, `conexoes/<ID>/` para cada conexão, com `LEIA-ME.txt`). Rotas `/conversations`,
  `/messages`, `/file`. Anexos ficam 180 dias.
- Painel: aba **Atendimentos** na ficha da sessão (quem atende cada conversa, Liberar, Transferir, modo
  Leads/Todos); estados Reconectando e Aberta em outro lugar.
- `dmk-wa atendimentos | liberar | distribuicao | conferir` e `ferramentas/conferir-baileys.js`
  (confere a biblioteca e abre uma conexão de teste até o QR, sem parear nada). O CI faz o mesmo a cada publicação.

**Painel (correções):** o selo amarelo "Aguardando QR" saía desmontado (a classe `.qr` era também a do
quadro do QR); o selo de estado dentro da ficha saía em maiúsculas; confirmar um aviso apagava o fundo
escurecido com a ficha ainda aberta; um pedido sem chave ao abrir a página gerava erro 401 no console.

## 1.2.1 — 19/11/2026

- Visual do painel no padrão DMK: conteúdo com folga nas laterais (nada encostado na borda da janela) e centralizado com largura máxima em monitor largo; corpo dos modais com a mesma folga.
- Ações da ficha da sessão (Pausar, Reiniciar, Testar, Ligar sistema, Trocar número, Excluir) em botões compactos que cabem numa linha só, sem cortar; se a tela for muito estreita, o grupo rola na horizontal, como nas demais telas.

## 1.2.0 — 19/11/2026

- `publicar-nginx.sh --painel`: publica também o painel (/painel/), a administração (/admin/v1/) e a saúde (/health) no domínio HTTPS — dá para administrar direto pelo navegador, sem túnel SSH. A chave de administrador continua obrigatória em toda rota de administração, e o script confere na prática: se a administração abrir sem chave, desfaz a publicação sozinho. Rodar de novo sem `--painel` tira o painel do ar.
- A trava de tentativas de chave errada agora enxerga o IP real de quem chega pelo Nginx (X-Real-IP, aceito só do loopback): um curioso bloqueado não trava o dono junto.

## 1.1.2 — 19/11/2026

- Corrigido: o botão Excluir (e o Revogar) da aba Sistemas ligados não respondia ao clique. Causa: no script que montou a 1.0.5, `$` dentro da string de substituição do `String.replace` vira ` (padrão especial do JavaScript), e as duas ligações de evento saíram com `$(` em vez de `$(` — o console acusava "$(...).forEach is not a function".
- Corrigido: a CSP do conector (style-src 'self') bloqueava os `style=` inline do painel (avisos no console e espaçamentos perdidos). Todos os estilos inline — inclusive os antigos — viraram classes no painel.css (.nota, .linha-marcar, .grupo-rodape, .campos-espaco, .quadro).
- A tabela de Sistemas ligados ganhou moldura própria (.quadro) e rola na horizontal quando aperta, sem cortar o texto dos selos.
- `package.json` acertado para acompanhar o arquivo VERSION (tinha ficado em 1.0.5 nas versões 1.1.x).

## 1.1.1 — 19/11/2026

- `publicar-nginx.sh`: numa máquina com mais de uma conta Let's Encrypt registrada, o certbot parava para perguntar qual usar e travava a publicação (aconteceu na VPS). Agora o script escolhe sozinho a mesma conta que os certificados já existentes usam — assim o domínio novo renova junto com os outros. Se os certificados atuais não apontarem uma conta só, ele para, lista as contas e ensina a escolher com `--conta <id>`.

## 1.1.0 — 19/11/2026

- `instalar/publicar-nginx.sh`: publica o conector num domínio HTTPS, expondo **somente** `/api/public/dmk-connector/v1/`. Administração, painel e saúde continuam só em 127.0.0.1. O script confere na prática o que ficou exposto e desfaz a publicação se a administração aparecer de fora; recusa domínio que já pertença a outro site e não toca em nenhum outro site da máquina.
- Era a peça que faltava para ligar sistemas que exigem `https://dominio` em IP público na porta 443 (o DMK Smart Core é um deles: recusa endereço local de propósito).

## 1.0.5 — 19/11/2026

- Entrada: o comando de pegar a chave virou uma caixa de código com botão Copiar (o ícone vira um check ao copiar); texto numa linha só, sem quebrar.
- Sistemas ligados: além de Revogar, botão **Excluir** remove a autorização do histórico da sessão (com confirmação; se ainda ativa, o acesso é cortado na hora) — a rota `autorizacoes/excluir` já existia no conector, faltava na tela. Botões das linhas agrupados, compactos, sem quebrar linha.
- O copiar do código de autorização ganhou o mesmo retorno visual (check), sem aviso de erro para uma ação que deu certo.
- Botão **Testar** na ficha da sessão: confere ativação, conexão, sistemas ligados, fila e última recebida — e, se um telefone for informado, envia UMA mensagem de teste real pela sessão (rota nova `POST /admin/v1/sessoes/:id/teste`). Nada é enviado sem telefone.
- Efeitos profissionais: entrada suave de modais/fundo/toast, KPIs com elevação no hover, bolinha de saúde e selo "Aguardando QR" pulsando, transições nos controles — tudo respeitando `prefers-reduced-motion`.

## 1.0.4 — 19/11/2026

- Painel com visual novo, profissional, na identidade DMK (azul tecnológico, azul-escuro, preto e branco): marca da DMK no topo e na tela de entrada, topo em gradiente com filete de acento, KPIs com ícone em chip e número em destaque, lista com cabeçalho em micro-maiúsculas e realce lateral no hover, selos de estado com anel colorido, QR emoldurado em cartão azul-escuro (destaque para a leitura), código de autorização com caixa tracejada, foco visível nos controles e rolagem fina na lista. Só aparência: classes, ids e comportamento do painel são os mesmos.
- Atualização pelo painel: botão no topo mostra a versão instalada e a publicada e atualiza com um clique. O conector (usuário dmkwa, sem root) grava `dados/atualizar.pedido`; uma unidade systemd `.path` (root), criada pelo `instalar/atualizar.sh` e pelo `instalar/instalar.sh`, percebe o pedido e roda o atualizador de sempre, com backup e volta automática. `agendar-atualizacao.sh desligar` deixou de apagar a unidade de serviço (o botão usa a mesma). Rotas novas: `GET/POST /admin/v1/atualizacao`.
- Alinhado o `package.json` à versão do arquivo `VERSION` (ficava em 1.0.0 desde a primeira publicação; o guia de publicação pede os dois).

## 1.0.3 — 19/11/2026

- Corrigido: a ficha da sessão nunca mostrava o QR Code. A lista usada pela tela (`GET /sessoes`, para o painel todo) não traz o QR por design — só o detalhe de uma sessão (`GET /sessoes/:id`) traz — mas a ficha usava só os dados da lista. Agora, com a ficha aberta e a sessão "Aguardando QR", o painel busca o detalhe à parte (ao abrir a ficha, a cada atualização automática e logo após Conectar/Reiniciar/Trocar número).

## 1.0.2 — 19/11/2026

- Corrigido: a tela de login do painel nunca sumia depois de entrar com a chave certa (o login funcionava de verdade — dava para ver nas chamadas repetidas com sucesso — mas a tela ficava por cima). Causa: as classes `.entrada` e `.tela` definem `display: grid`, e isso faz o navegador ignorar o atributo `hidden` (CSS do autor sempre vence o padrão do navegador, não importa a especificidade). Adicionada a regra `[hidden] { display: none !important; }`.

## 1.0.1 — 19/11/2026

- Corrigido: a tela de entrada do painel (`/painel`) testava a chave de administrador antes de guardá-la na variável usada para montar o cabeçalho `Authorization`, então a chamada de teste sempre ia sem chave e qualquer chave digitada aparecia como "Chave incorreta". Agora a chave é aplicada antes do teste.

## 1.0.0 — 19/11/2026

Primeira versão.

- Painel web em `/painel` (criar, conectar com QR na tela, pausar, reiniciar, trocar número, excluir, ligar/revogar sistemas).
- Várias sessões de WhatsApp, cada uma com as próprias autorizações.
- Protocolo Conector DMK (`/api/public/dmk-connector/v1`), igual ao da Central do DMK Prisma.
- Administração por `dmk-wa` e por `/admin/v1`, com chave de administrador.
- Instalador com Node próprio, atualizador com um backup e volta automática, atualização diária opcional.
- Modo simulado para testar um sistema sem número real.

Ainda não conferido em máquina real: conexão com o WhatsApp (QR, envio, recebimento) e o instalador.
Sem `package-lock.json`: as dependências diretas estão fixadas, as indiretas ainda não.

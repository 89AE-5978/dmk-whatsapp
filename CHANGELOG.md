# Histórico

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

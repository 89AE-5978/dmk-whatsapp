# Histórico

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

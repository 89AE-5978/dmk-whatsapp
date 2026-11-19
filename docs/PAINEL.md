# Painel web

Uma tela para gerenciar as sessões sem usar o terminal: criar, conectar (com o QR na própria tela),
pausar, reiniciar, trocar número, excluir, e ligar/revogar sistemas.

O conector serve o painel sozinho, em `/painel`, no mesmo endereço e porta do protocolo
(`http://127.0.0.1:8098` por padrão). Não precisa instalar nada a mais nem abrir outra porta.

## Acessar

O serviço só atende em `127.0.0.1`, então de fora da VPS o caminho é um túnel SSH:

```bash
ssh -L 8098:127.0.0.1:8098 root@<endereço-da-vps>
```

Com o túnel aberto, abra no seu navegador: **http://127.0.0.1:8098/painel**

A tela pede a chave de administrador (a mesma de `dmk-wa` e de `/opt/dmk-whatsapp/dados/admin.key`).
Ela fica só nesta aba do navegador (`sessionStorage`) — sai ao fechar a aba, nunca é gravada no disco
do computador nem enviada para fora do próprio conector.

## Por que não publicar na internet

O painel em si (HTML, CSS, JS) não tem segredo, mas ele fala com `/admin/v1`, que controla todas as
sessões de todos os sistemas. Por isso ele não deve ter porta própria exposta nem entrar no nginx —
mesma regra do `/admin/v1` em `docs/INSTALACAO.md`. O túnel SSH exige a chave da própria VPS antes de
sequer chegar à tela de login do painel; é a camada de proteção de verdade.

## O que a tela mostra e faz

- **Topo:** nome do serviço, versão, uma bolinha que fica vermelha se o conector parar de responder.
- **Cartões (KPIs):** total de sessões, quantas conectadas, sistemas ligados, eventos na fila, sessões
  com erro — sempre numa linha só.
- **Lista:** uma linha por sessão (estado, número, dono, nome, sistemas ligados, fila). Clicar abre a
  ficha. Pesquisar busca em tudo; Filtros filtra por estado.
- **Ficha da sessão** (aba Geral): dados, o QR quando está esperando a leitura (atualiza sozinho),
  Conectar/Pausar, Reiniciar, Ligar sistema (gera o código), Trocar número e Excluir — as duas últimas
  pedem confirmação.
- **Ficha da sessão** (aba Sistemas ligados): quem tem autorização, estado e um botão para revogar.

A lista e a ficha aberta se atualizam sozinhas a cada 4 segundos.

## O que o painel não faz

Não mostra nem armazena o conteúdo das conversas — isso fica no sistema dono, nunca no conector.
Não gera o código em Python/exemplo de integração: isso está em `docs/PROMPT-PARA-AGENTES.md`.

## Atualizar pelo painel

O botão de atualização no topo (seta para baixo) mostra a versão instalada e a publicada no GitHub e
atualiza com um clique. Por baixo: o conector grava `dados/atualizar.pedido` e uma unidade systemd
`.path` (root) percebe o arquivo e roda `instalar/atualizar.sh` — o mesmo de sempre, com backup e
volta automática. O conector nunca executa nada como root.

Na primeira vez (instalações feitas antes desta versão), rode uma vez na VPS, como root:
`bash /opt/dmk-whatsapp/instalar/atualizar.sh` — isso instala o gatilho; das próximas vezes o botão
resolve sozinho. O painel avisa quando a versão nova responder e pede só um recarregar da página.

## Painel pelo domínio (sem túnel SSH)

Por padrão o painel só existe em 127.0.0.1 (túnel SSH). Para acessá-lo direto pelo navegador,
publique-o junto com o domínio:

```bash
sudo bash /opt/dmk-whatsapp/instalar/publicar-nginx.sh zap.seudominio.com.br voce@email.com --painel
```

Isso expõe `/painel/`, `/admin/v1/` e `/health` em HTTPS. Toda rota de administração continua
exigindo a chave de administrador (64 hexadecimais — impossível de adivinhar), com trava de
tentativas por IP; o painel em si é só a tela de entrada. O script confere na prática: se a
administração abrir sem chave, ele desfaz a publicação sozinho.

Para tirar o painel do ar e voltar ao modo túnel, rode o mesmo comando **sem** `--painel`.

# Histórico

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

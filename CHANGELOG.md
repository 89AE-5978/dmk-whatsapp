# Histórico

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

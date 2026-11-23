# Política de Privacidade — DMK WhatsApp (conector)

Titular do software: **Danilo Silva dos Santos — DMK Soluções** · dmksolucoessmart@gmail.com
Versão: 1.0 — 22/11/2026 · Base legal: Lei 13.709/2018 (LGPD).

## 1. Quem é quem

| Papel | Quem é | O que decide |
|---|---|---|
| **Controlador** | a empresa que usa o conector (dona do número de WhatsApp) | por que e para que trata as mensagens, quem atende, quanto tempo guarda |
| **Operador** | DMK Soluções (software e manutenção) | executa conforme as instruções do controlador |
| **Titular dos dados** | o cliente/contato que conversa pelo WhatsApp | exerce os direitos do item 6 |

O conector roda **no servidor do controlador** (VPS da empresa). A DMK Soluções acessa esse servidor
apenas para instalar, atualizar e dar suporte, quando autorizada.

## 2. Que dados passam pelo conector

- **Número de telefone** e **nome de exibição** do contato no WhatsApp; foto de perfil, quando o sistema
  pede (guardada em memória por até 1 hora).
- **Conteúdo das mensagens**: texto, áudio, mensagem de voz, imagem, vídeo, documento, localização,
  cartão de contato, enquete, reação e as marcações de entregue/lido.
- **Dados de funcionamento**: identificador da mensagem, horários, qual sistema atendeu, etapa do
  chatbot, e registros técnicos (logs) com o **formato** da mensagem e os **quatro últimos dígitos** do
  número — nunca o conteúdo.
- **Credenciais dos sistemas** e chave de administrador, guardadas como resumo criptográfico (hash).

Não há coleta para publicidade, não há venda de dados e não há perfilamento automatizado de pessoas.

## 3. Para que são usados

Atender e responder conversas, distribuir o atendimento entre os sistemas, manter o histórico para
continuidade, disparar avisos operacionais (cobrança, alerta técnico) solicitados pelo controlador,
executar a automação configurada e permitir auditoria e suporte técnico.

A base legal costuma ser **execução de contrato** com o cliente, **legítimo interesse** no atendimento
ou **consentimento**, no caso de mensagem promocional — a escolha e o registro da base legal são do
controlador.

## 4. Onde ficam e por quanto tempo

| Dado | Onde | Prazo |
|---|---|---|
| Histórico de conversas e anexos | pasta do conector, separada por sessão e por sistema, permissão restrita | **180 dias**, depois apagado |
| Fila de eventos de cada sistema | disco do servidor | até o sistema confirmar; descartada em 7 dias |
| Anexo de mensagem na fila | disco do servidor | apagado assim que o sistema confirma |
| Mensagens recentes em memória (reenvio e citação) | memória do processo | 7 dias |
| Registros técnicos (journal) | servidor | conforme a política do sistema operacional (padrão: rotação do journald) |
| Credenciais e sessão do WhatsApp | pasta `dados`, permissão restrita | enquanto a sessão existir |

Nada é enviado para servidor da DMK Soluções: os dados ficam no servidor do controlador. O conteúdo das
mensagens trafega pela infraestrutura do próprio WhatsApp/Meta, que tem política própria.

## 5. Segurança

Credenciais em hash, arquivos com permissão restrita, painel e administração acessíveis **só por túnel
SSH** (nunca abertos na internet), protocolo dos sistemas por HTTPS, limites de chamadas por minuto,
bloqueio após tentativas erradas de chave, logs sem conteúdo de mensagem e filtro que impede chaves de
criptografia de aparecerem em log. Incidente de segurança com risco relevante é comunicado ao
controlador, que avalia a comunicação à ANPD e aos titulares.

## 6. Direitos do titular dos dados

Confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade,
informação sobre compartilhamento e revogação do consentimento (art. 18 da LGPD).

O pedido deve ser feito **à empresa com quem a pessoa conversa** (o controlador), que é quem responde.
O conector oferece os meios para atender: exclusão de conversa, lista de "nunca atender" por contato
(que faz o robô e os disparos pararem para aquele número) e exportação do histórico.

## 7. Mensagens automáticas e robô

Quando há chatbot, a primeira mensagem informa que é atendimento automático, e o contato é transferido
para uma pessoa quando pede. "Nunca atender" tira o contato da automação de forma definitiva. Pedido de
parar de receber ("sair", "não quero mais") deve ser atendido na hora pelo controlador.

## 8. Terceiros

A comunicação com o WhatsApp Web é feita pela biblioteca de código aberto **Baileys** (MIT —
WhiskeySockets), executada no próprio servidor: ela não envia dados para os seus autores nem para a DMK
Soluções. O transporte das mensagens é do WhatsApp (Meta), sujeito à política de privacidade dessa
empresa. Detalhes e avisos de licença em [CREDITOS.md](CREDITOS.md).

## 9. Mudanças

A versão vigente é a deste arquivo no repositório, com a data no topo. Mudança relevante é comunicada a
quem está autorizado a usar o conector.

---

Relacionados: `LICENSE` · [TERMOS-DE-USO.md](TERMOS-DE-USO.md) · [CREDITOS.md](CREDITOS.md)

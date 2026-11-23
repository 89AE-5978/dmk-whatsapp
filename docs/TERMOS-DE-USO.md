# Termos de Uso — DMK WhatsApp (conector)

Titular: **Danilo Silva dos Santos — DMK Soluções** · contato: dmksolucoessmart@gmail.com
Versão destes termos: 1.0 — 22/11/2026 (vale a partir da versão 1.3.17 do conector).

Ao instalar, ligar um sistema, usar o painel ou chamar a API deste conector, você aceita estes termos.
Se não concordar, não use.

## 1. O que é o DMK WhatsApp

Serviço instalado em servidor próprio que mantém conexões de WhatsApp e permite que os sistemas
autorizados recebam e enviem mensagens pelo número da empresa, com histórico, distribuição de
atendimento e automação (chatbot). O funcionamento está descrito em `docs/API.md`.

## 2. Direitos autorais e autorização

O conector é obra de Danilo Silva dos Santos (DMK Soluções) e está protegido pela Lei 9.610/1998
(direitos autorais) e pela Lei 9.609/1998 (programas de computador).

**O uso depende de autorização por escrito do titular**, mesmo com o repositório público. A
autorização identifica quem pode usar e pode trazer prazo e limites (número de sessões, números de
WhatsApp, sistemas ligados). Não é transferível. Os detalhes estão no arquivo `LICENSE`.

Em termos práticos: o repositório público existe para consultar, auditar e atualizar o que já é
autorizado — não para copiar o sistema.

## 3. Quem é responsável por quê

**Do titular (DMK Soluções)**: manter o conector funcionando conforme a documentação, corrigir falhas
em prazo razoável, avisar sobre mudanças que afetem as integrações e manter a documentação em dia.

**De quem usa**:

- usar apenas com números de WhatsApp que lhe pertencem ou que você tem autorização para operar;
- obter o consentimento das pessoas que vão receber as mensagens e respeitar o pedido de parar
  ("não quero mais receber"), que deve ser atendido na mesma hora;
- não usar o conector para *spam*, disparo em massa para quem não pediu, mensagem enganosa, golpe,
  cobrança indevida, assédio, discurso de ódio, conteúdo ilegal ou qualquer prática vedada pelos
  **Termos do WhatsApp/Meta** — cujo cumprimento é responsabilidade de quem usa;
- guardar as credenciais (chave de administrador e credenciais dos sistemas) em segurança e avisar o
  titular na hora em que suspeitar de vazamento;
- não tentar burlar limites técnicos, nem usar o conector para acessar conversa de terceiro sem
  autorização.

## 4. WhatsApp, Meta e a biblioteca usada

Este conector **não é produto do WhatsApp nem da Meta** e não tem relação, patrocínio ou aprovação
dessas empresas. Ele não usa a API oficial (WhatsApp Business/Cloud API): a conversa com o WhatsApp Web
é feita pela biblioteca de código aberto **Baileys** (MIT — WhiskeySockets), listada com o aviso
original em `docs/CREDITOS.md`.

Consequências disso, que você aceita ao usar:

- o WhatsApp pode mudar o seu funcionamento sem avisar, e recursos podem parar de funcionar até a
  biblioteca e o conector serem atualizados;
- **o número pode ser limitado ou bloqueado pelo WhatsApp** — risco próprio de conexão não oficial,
  agravado por disparo em massa e por mensagens não solicitadas;
- recursos que só existem na API oficial (formulários/Flows, catálogo, pedidos) não estão disponíveis;
- "WhatsApp" e "Meta" são marcas das respectivas titulares, citadas apenas para indicar
  compatibilidade.

## 5. Dados e mensagens

As mensagens e os arquivos passam pelo conector e ficam guardados no servidor onde ele está instalado,
pelo prazo indicado na `docs/POLITICA-DE-PRIVACIDADE.md` (hoje 180 dias no histórico de atendimento).
Quem contrata o uso é o **controlador** desses dados; o titular do software atua como **operador**,
seguindo as instruções de quem contrata. A política de privacidade é parte destes termos.

## 6. Garantias e limites

O software é fornecido "no estado em que se encontra". Não há garantia de disponibilidade contínua, de
entrega de mensagem pelo WhatsApp nem de resultado comercial. O titular não responde por
indisponibilidade do WhatsApp, bloqueio de número, perda de mensagem, lucro cessante ou dano
indireto. Onde a lei admitir limite de responsabilidade, ele fica restrito ao valor pago pelo uso nos
12 meses anteriores ao evento.

## 7. Suspensão e encerramento

A autorização pode ser suspensa ou encerrada em caso de descumprimento destes termos, uso ilegal, risco
à segurança ou falta de pagamento, quando houver. Encerrado o uso, cessa o direito de executar o
software; os dados podem ser exportados em prazo combinado e depois removidos.

## 8. Mudanças, lei aplicável e foro

Estes termos podem ser atualizados; a versão vigente é a deste arquivo no repositório, com a data no
topo. Mudança relevante é comunicada a quem está autorizado. Aplica-se a lei brasileira; fica eleito o
foro da comarca de Petrolina (PE), salvo regra legal em sentido diverso.

---

Documentos relacionados: `LICENSE` (direitos e autorização) ·
[POLITICA-DE-PRIVACIDADE.md](POLITICA-DE-PRIVACIDADE.md) · [CREDITOS.md](CREDITOS.md) ·
[API.md](API.md) (funcionamento técnico).

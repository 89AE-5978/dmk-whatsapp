# Prompt para os agentes — tela de fluxograma do chatbot

Cole o texto abaixo no agente do sistema (DMK Prisma, DMK Gestão, Smart Core). Ele constrói a tela; o motor,
as regras e o acompanhamento já estão prontos no conector.

---

Você vai criar a tela do **Chatbot** deste sistema. O motor já existe no conector DMK WhatsApp (versão 1.3.14):
ele é quem responde o cliente, guarda em que etapa cada contato está e para sozinho quando um atendente assume.
Você faz a TELA que monta o fluxograma e acompanha. Não reimplemente o motor nem invente outro protocolo.

Leia antes de mexer:
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/CHATBOT.md  (fluxo, tipos de nó, condições, rotas)
- https://github.com/89AE-5978/dmk-whatsapp/blob/main/docs/API.md

Endereço: https://zap.danilodss.com.br/api/public/dmk-connector/v1
Credencial: a MESMA que este sistema já usa no conector. Não peça chave nova ao usuário.

## O que a tela precisa ter

1. **Lista de fluxos** no padrão do sistema (linha compacta, Pesquisar + um botão de Filtros, ordenação e
   paginação). Cada empresa/conexão tem o seu fluxo. Clicar abre a ficha num modal grande.

2. **Fluxograma** (o coração da tela): os nós em caixas ligadas por setas, arrastáveis, com zoom e ajuste à
   tela. Cada caixa mostra o tipo (mensagem, pergunta, transferir, encerrar, ação), o começo do texto e as
   saídas. As setas saem das regras/opções e entram no nó de destino. Caixa com destino faltando fica marcada
   em vermelho. Desenhe com SVG ou canvas próprio, no padrão visual do sistema — nada de componente nativo do
   navegador, botões sempre numa linha só, tudo cabendo em 100% de zoom, página travada e só a área do
   fluxograma rolando.

3. **Editor do nó** (abre ao clicar na caixa, em painel flutuante que fecha no × ou clicando fora):
   - texto da mensagem, com os atalhos {{nome}}, {{telefone}}, {{resposta}} e as variáveis guardadas;
   - opções (rótulo e para onde vai), estilo texto / botões / lista;
   - aparência do envio: marcar como lida, "digitando…" (ms), atraso (ms), citar a mensagem do cliente;
   - regras: condição (número, igual, contém, começa, sim, não, palavras, anexo, e-mail, telefone, qualquer),
     valor ou lista de palavras, e o nó de destino; mais o "senão";
   - guardar a resposta numa variável;
   - no nó de ação: endereço https do seu sistema, cabeçalhos, tempo de espera e o caminho de erro.

4. **Ligar/desligar** o chatbot e marcar **"atende contatos novos"**, com aviso claro de que só uma conexão por
   número atende os novos.

5. **Acompanhamento**: lista de quem está no fluxo agora (contato, etapa, desde quando) e um botão para tirar
   do fluxo. Atualize a cada poucos segundos, redesenhando só quando os dados mudam.

6. **Modelos prontos**: `GET /bot/modelos` traz fluxos que o usuário copia e edita.

## Como conversar com o conector

- `GET /bot` para carregar; `PUT /bot` com `{ fluxo, ativo, atende_novos }` para gravar.
- O conector confere o fluxo inteiro e, quando recusa, a mensagem diz o nó e o motivo
  (ex.: `Nó "menu" (regra "palavras") aponta para o nó "x", que não existe.`). Mostre esse texto na tela,
  destacando o nó citado — não tente adivinhar nem gravar por cima.
- `POST /bot/ativar` liga/desliga sem reenviar o fluxo.
- `GET /bot/estados` para o acompanhamento; `POST /bot/sair {to}` para tirar um contato.
- Declare `X-DMK-Features: actions,routing,bot` no `GET /events` para receber também os eventos `bot`
  (`transferir`, `encerrou`, `parou`) e mostrar no chat que a conversa saiu do robô.

## Cuidados

- Não grave o fluxo a cada tecla: um botão Salvar, com aviso de alterações não salvas.
- Nunca ligue o chatbot sem fluxo — o conector recusa.
- O atendente sempre vence: se alguém assume a conversa, o robô para. Deixe isso visível na tela.
- Teste com o seu próprio número antes de ligar para clientes, principalmente botões e listas, que são
  experimentais no WhatsApp.

Teste e relate: criar fluxo do zero, copiar um modelo, gravar com erro de propósito (ver a mensagem do nó),
ligar, conversar pelo WhatsApp passando por pergunta, opção numerada, palavra-chave, transferência e
encerramento, e acompanhar as etapas na tela. Diga o que mudou, o que testou e o que não conseguiu testar.

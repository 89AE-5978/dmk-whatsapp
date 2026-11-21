# Chatbot do conector — atendimento automático por regras

O conector responde sozinho quem ainda não tem atendente. Quem decide é o conector; o sistema da empresa
desenha o fluxograma e acompanha. Vale para qualquer número (sessão) e para cada sistema ligado (conexão).

## Como funciona, em cinco linhas

1. Chega mensagem de um contato que **ninguém está atendendo**.
2. O conector pega o fluxo da conexão marcada como **"atende contatos novos"** nessa sessão.
3. Caminha pelo fluxograma: envia mensagens, faz perguntas, espera a resposta e segue pelas regras.
4. Guarda em que etapa cada contato está (dá para ver no painel e por `GET /bot/estados`).
5. **Assim que um atendente assume** (pelo sistema ou respondendo no próprio celular do número), o fluxo
   daquele contato para na hora.

Desligar é imediato: `POST /bot/ativar {"ativo": false}` ou o botão no painel.

## A chave é a que a empresa já tem

Cada sistema ligado ao conector tem a sua credencial (o `token` do `POST /exchange`). O mesmo número pode ter
várias conexões — uma por empresa — e **cada uma tem o seu fluxo**, separado das outras. Não existe chave nova
para o chatbot: quem já está ligado já pode montar o fluxo dele.

## As rotas (o sistema da empresa usa a credencial dele)

Endereço: `https://zap.danilodss.com.br/api/public/dmk-connector/v1`

| Método e caminho | O que faz |
|---|---|
| `GET /bot` | Devolve `{ ativo, atende_novos, fluxo, atualizado_em, modelos }` desta conexão. |
| `PUT /bot` | Grava `{ fluxo, ativo?, atende_novos? }`. O fluxo é conferido inteiro; erro traz o nó e o motivo. `fluxo: null` apaga. |
| `POST /bot/ativar` | `{ ativo, atende_novos? }` liga ou desliga sem reenviar o fluxo. |
| `GET /bot/estados` | Em que etapa cada contato desta conexão está: `peer`, `node`, `since`, `erros`, `dados`. |
| `POST /bot/sair` | `{ to }` tira um contato do fluxo (fica para um atendente). |
| `GET /bot/modelos` | Fluxos prontos para copiar e editar. |

Quem declarar `X-DMK-Features: bot` no `GET /events` também recebe eventos `bot`:
`{ peer, phone, action: "transferir" | "encerrou" | "parou", data }` — útil para o chat avisar que o robô
terminou e a conversa é com um humano agora.

## O fluxograma

```json
{
  "nome": "Atendimento DMK",
  "inicio": "menu",
  "config": {
    "inativo_min": 30,
    "maximo_erros": 2,
    "palavra_atendente": ["atendente", "humano"],
    "ir_atendente": "",
    "texto_transferencia": "Certo! Já estou chamando um atendente.",
    "repetir_apos_min": 120,
    "aguardando_min": 60,
    "antiflood_seg": 10
  },
  "nos": {
    "menu": {
      "tipo": "pergunta",
      "texto": "Olá {{nome}}! Como posso ajudar?",
      "estilo": "botoes",
      "lido": true, "digitando": 1200, "atraso": 0, "citar": false,
      "opcoes": [
        { "rotulo": "Suporte", "ir": "suporte" },
        { "rotulo": "Financeiro", "ir": "financeiro" }
      ],
      "regras": [
        { "quando": { "tipo": "palavras", "valores": ["boleto", "fatura", "2 via"] }, "ir": "financeiro" }
      ],
      "senao": "nao_entendi"
    },
    "suporte":  { "tipo": "pergunta", "texto": "Me conte o que houve.", "guardar": "problema",
                  "regras": [{ "quando": { "tipo": "qualquer" }, "ir": "humano" }] },
    "financeiro": { "tipo": "mensagem", "texto": "Um instante…", "proximo": "humano" },
    "nao_entendi": { "tipo": "mensagem", "texto": "Não entendi.", "proximo": "menu" },
    "humano": { "tipo": "transferir", "texto": "Anotei: {{problema}}. Chamando um atendente." },
    "fim": { "tipo": "encerrar", "texto": "Obrigado!" }
  }
}
```

### Para o robô não responder de novo a cada "oi"

O conector guarda em que pé ficou cada contato, e isso decide se ele volta a ser atendido:

| Situação | O que o robô faz |
|---|---|
| Está no meio do fluxograma | Segue normalmente. |
| Mandou a MESMA mensagem de novo em menos de `antiflood_seg` | Ignora: não repete o menu e não conta como resposta errada. |
| Foi transferido e espera um atendente | Fica calado por `aguardando_min` minutos. |
| O fluxo terminou, ou um atendente atendeu | Fica calado por `repetir_apos_min` minutos (carência). |
| Está na lista de "nunca atender" | Nunca entra no fluxo. |

| Config | Padrão | Para que serve |
|---|---|---|
| `repetir_apos_min` | 120 | Minutos de carência depois de encerrar ou de ser atendido por uma pessoa. `0` desliga. |
| `aguardando_min` | 60 | Minutos de silêncio enquanto o contato espera um atendente assumir. |
| `antiflood_seg` | 10 | Segundos em que a mesma mensagem repetida é ignorada. |
| `inativo_min` | 30 | Parado esse tempo no meio do fluxo, o contato recomeça do início. |

`GET /bot/estados` mostra só quem está dentro do fluxograma; com `?todas=1` vem também quem está em espera,
com o campo `phase`: `fluxo`, `aguardando`, `humano` ou `fim`.

### Nunca atender um contato

| Método e caminho | O que faz |
|---|---|
| `POST /bot/ignorar` | `{ to, ativo }` — `ativo: true` tira o contato do robô para sempre; `false` desfaz. |
| `GET /bot/ignorados` | Lista dos contatos marcados. |

No painel, os mesmos botões ficam na aba Chatbot ("Nunca atender" e "Voltar a atender"), e pela administração
em `POST /admin/v1/sessoes/<id>/chatbot/ignorar { peer, ativo }`. As mensagens desse contato continuam
chegando normalmente para os atendentes: o que muda é só o robô não responder.

### Tipos de nó

| Tipo | O que faz |
|---|---|
| `mensagem` | Envia o texto e segue sozinho para `proximo`. Sem `proximo`, o atendimento acaba ali. |
| `pergunta` | Envia o texto (com `opcoes`, se houver) e **espera** a resposta. As `regras` e as `opcoes` dizem para onde ir; `senao` é o caminho de quando nada combina. |
| `transferir` | Envia o texto (ou o `texto_transferencia`) e devolve a conversa para os atendentes. |
| `encerrar` | Envia o texto, se houver, e termina. |
| `acao` | Chama um endereço `https` do seu sistema e segue pela resposta dele (ver abaixo). |

### Como cada nó aparece no WhatsApp

| Campo | Efeito |
|---|---|
| `lido: true` | Marca a mensagem do cliente como lida (os dois tiques azuis). |
| `digitando: 1200` | Mostra "digitando…" por 1,2 s antes de enviar (0 a 15000). |
| `atraso: 500` | Espera antes de começar (0 a 15000). |
| `citar: true` | Responde citando a mensagem do cliente. |
| `estilo` | `texto` (padrão), `botoes` (até 3 opções curtas) ou `lista` (até 10). Botões e listas são **experimentais**: o WhatsApp não garante esse formato fora da API oficial, por isso o texto do nó deve trazer as opções numeradas. |
| `opcoes` | `{ rotulo, ir?, descricao? }`. O cliente pode responder pelo **número** da opção ou escrevendo o rótulo. |
| `guardar: "problema"` | Guarda a resposta do cliente com esse nome, para usar como `{{problema}}` depois. |

Variáveis prontas em qualquer texto: `{{nome}}`, `{{telefone}}`, `{{resposta}}` (a última mensagem do cliente)
e tudo o que você tiver guardado com `guardar`.

### Condições das regras

A primeira regra que combinar decide o caminho. A comparação ignora acento e maiúscula.

| `tipo` | Combina quando |
|---|---|
| `numero` | O cliente mandou esse número (`valor: "2"`). |
| `igual` / `contem` / `comeca` | Comparação direta com `valor`. |
| `sim` / `nao` | Respostas afirmativas e negativas comuns ("sim", "claro", "quero" / "não", "agora não"). |
| `palavras` | Qualquer palavra da lista `valores` aparece na mensagem. É assim que se reconhece o assunto ("boleto", "fatura", "2 via"). |
| `anexo` | O cliente mandou foto, áudio ou documento. |
| `email` / `telefone` | A resposta tem cara de e-mail ou de telefone (útil em cadastro). |
| `qualquer` | Serve para "aceite o que vier e siga". |

Isto é comparação de texto, não inteligência artificial: o "sentido" vem da lista de palavras que você escreve.

### Nó de ação (o fluxo consulta o seu sistema)

```json
{ "tipo": "acao", "url": "https://seu-sistema/bot/consulta", "espera_seg": 8,
  "cabecalho": { "X-Chave": "..." }, "proximo": "fim", "ir_erro": "humano" }
```

O conector envia `POST` com `{ peer, phone, name, text, node, data }` e espera um JSON:
`{ "texto": "Sua fatura vence dia 10.", "ir": "fim", "dados": { "vencimento": "10" } }`. Todos os campos são
opcionais: `texto` é enviado ao cliente, `ir` troca o próximo nó e `dados` vira variável. Se o seu sistema não
responder a tempo, o fluxo segue por `ir_erro` (ou chama um atendente).

### Regras de segurança do fluxo

Nada é gravado sem conferência: até 100 nós, todo destino tem que existir, textos até 3000 letras, no máximo
10 opções e 20 regras por nó, `url` só `https`. O erro diz qual nó e o que está faltando, para a tela mostrar.
Em cada mensagem o conector caminha no máximo 12 nós, então um laço mal montado não trava o atendimento.
Depois de `inativo_min` sem falar, o contato recomeça do início. Passando de `maximo_erros` respostas que não
combinam com nada, o conector chama um atendente em vez de insistir.

## Administração (painel)

| Método e caminho | O que faz |
|---|---|
| `GET /admin/v1/sessoes/<id>/chatbot` | Conexões da sessão: fluxo, ligado, quem atende novos, quantos no fluxo. |
| `GET /admin/v1/sessoes/<id>/chatbot/estados` | Todos os contatos em atendimento automático. |
| `POST /admin/v1/sessoes/<id>/autorizacoes/<aid>/bot` | `{ ativo?, atende_novos?, modelo? }` — `modelo` copia um fluxo pronto. |

Na ficha da sessão, a aba **Chatbot** faz tudo isso pela tela, inclusive tirar um contato do fluxo.
Só uma conexão por sessão atende os contatos novos: ao marcar uma, a anterior é desmarcada sozinha.

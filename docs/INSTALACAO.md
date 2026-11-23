# Instalação e operação

Todos os comandos são na VPS, como root.

## 1. Instalar

```bash
git clone https://github.com/<conta>/<repositorio>.git /opt/dmk-whatsapp
bash /opt/dmk-whatsapp/instalar/instalar.sh
```

O instalador baixa o Node da versão em `NODE_VERSION` (conferindo o SHA-256 publicado em nodejs.org),
instala as dependências, cria o usuário `dmkwa`, a chave de administrador e o serviço
`dmk-wa-conector`. O conector atende só em `127.0.0.1`, porta 8098.

Se a porta 8098 estiver ocupada: `DMK_WA_PORTA=8100 bash /opt/dmk-whatsapp/instalar/instalar.sh`.

Termina com `PRONTO: DMK WhatsApp <versão> ativo`.

Também sobe um painel web em `/painel` (veja `docs/PAINEL.md` para acessar por túnel SSH).

## 2. Criar e conectar uma sessão

```bash
dmk-wa nova "Atendimento" gestao     # nome livre + sistema dono
dmk-wa conectar 1                    # mostra o QR no terminal até você ler com o celular
dmk-wa sessoes
```

No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho.

## 3. Ligar um sistema à sessão

```bash
dmk-wa autorizar 1 "Site da gestão" gestao --confirmar
```

Mostra um código que vale 10 minutos e um uso. O que fazer com ele está em `LIGAR-UM-SISTEMA.md`.

## 4. Publicar num domínio (quando o sistema não roda na mesma máquina)

Um sistema na mesma VPS pode usar `http://127.0.0.1:8098` direto. Mas vários clientes DMK —
o DMK Smart Core, por exemplo — exigem `https://dominio` num IP público, na porta 443: eles
recusam endereços locais de propósito. Para esses, publique o conector:

```bash
sudo bash instalar/publicar-nginx.sh zap.seudominio.com.br voce@email.com
```

Antes de rodar, aponte o DNS do domínio para o IP da VPS.

O script expõe **somente** `/api/public/dmk-connector/v1/`. Qualquer outro endereço responde 404:
a administração (`/admin/v1`), o painel (`/painel`) e a saúde (`/health`) continuam existindo só em
127.0.0.1, alcançáveis apenas por túnel SSH. No fim ele confere isso na prática — se a
administração aparecer de fora, ele desfaz a publicação e avisa. Nenhum outro site da máquina é
tocado, e ele recusa um domínio que já pertença a outro site.

Nos sistemas DMK, informe só o domínio, sem caminho e sem porta.

## Dia a dia

| Para | Comando |
|---|---|
| Ver se está tudo no ar | `dmk-wa status` e `dmk-wa sessoes` |
| Reiniciar uma sessão sem perder a conexão | `dmk-wa reiniciar <id>` |
| Desligar uma sessão por um tempo | `dmk-wa pausar <id>` |
| Trocar o número de uma sessão | `dmk-wa trocar-numero <id> --confirmar` |
| Cortar o acesso de um sistema | `dmk-wa autorizacoes <id>` e `dmk-wa revogar <id> <autorização>` |
| Ver o registro do serviço | `journalctl -u dmk-wa-conector -n 50 --no-pager` |

## Atualizar

```bash
dmk-wa atualizar --verificar   # só diz se há versão nova, não altera nada
dmk-wa atualizar               # atualiza (backup e volta automática se algo não subir)
```

O comando é um atalho para o script, que também pode ser chamado direto:

```bash
bash /opt/dmk-whatsapp/instalar/atualizar.sh --verificar
bash /opt/dmk-whatsapp/instalar/atualizar.sh
```

O atualizador guarda um backup (`backups/antes-da-atualizacao.tar.gz`, sempre o mesmo arquivo), troca o
código, o Node e as dependências, reinicia e espera as sessões reconectarem. Se a versão nova não
responder ou alguma sessão não voltar, ele repõe a versão anterior sozinho.

Na volta automática a pasta `dados` não é reposta: as credenciais do WhatsApp mudam com a sessão ligada,
e uma cópia antiga poderia derrubá-la. O backup serve para recuperação manual.

Também dá para atualizar **pelo painel** (botão no topo): veja docs/PAINEL.md. Na primeira vez rode o
comando acima uma vez para instalar o gatilho; depois disso o botão resolve sozinho.

Atualização automática diária (vem desligada):

```bash
bash /opt/dmk-whatsapp/instalar/agendar-atualizacao.sh ligar      # todo dia, perto das 04:10
bash /opt/dmk-whatsapp/instalar/agendar-atualizacao.sh desligar
journalctl -u dmk-wa-atualizar -n 30 --no-pager                   # último resultado
```

## Publicar uma versão nova (quem desenvolve)

1. Altere o código, suba `VERSION` e `package.json`, anote em `CHANGELOG.md`.
2. Para trocar o Node ou o Baileys: mude `NODE_VERSION` ou a versão em `package.json`.
3. `node --test tests/*.test.js` e publique no ramo `main`. As máquinas pegam na próxima atualização.

## Desinstalar

```bash
bash /opt/dmk-whatsapp/instalar/desinstalar.sh --confirmar
```

Remove o serviço e o comando. A pasta (com `dados/` e `backups/`) fica; apagá-la é à mão.

## Segurança

- O conector roda como o usuário `dmkwa`, sem login, e só grava em `dados/`.
- `dados/` é 700 e `admin.key` é 600. A chave nunca é mostrada na tela.
- Códigos e credenciais dos sistemas ficam gravados só como resumo (hash).
- A administração (`/admin/v1`) nunca deve ser publicada no nginx. Veja `LIGAR-UM-SISTEMA.md`.

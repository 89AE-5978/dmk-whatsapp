# Créditos e licenças de terceiros

O **DMK WhatsApp** é desenvolvido por **Danilo Silva dos Santos — DMK Soluções** (direitos no arquivo
`LICENSE`). Ele usa componentes de código aberto, respeitando integralmente as licenças abaixo. Os
avisos originais ficam neste arquivo e devem acompanhar qualquer cópia autorizada do sistema.

## Baileys — a biblioteca que fala com o WhatsApp Web

| | |
|---|---|
| Pacote | `@whiskeysockets/baileys` **7.0.0-rc14** |
| Autoria | Rajeh Taher / **WhiskeySockets** |
| Licença | **MIT** |
| Repositório | https://github.com/WhiskeySockets/Baileys |

**É a Baileys que faz a conexão com o WhatsApp.** Ela implementa o protocolo do WhatsApp Web
(o mesmo do "aparelho conectado" que você vê no celular): pareamento por QR, criptografia ponta a
ponta pelo protocolo Signal, envio e recebimento de mensagens, mídia, enquete, reação, presença e
confirmação de leitura. Tudo roda no servidor do conector — a biblioteca não manda nada para os seus
autores.

O que o DMK WhatsApp acrescenta em volta dela: várias sessões no mesmo serviço, protocolo HTTP para os
sistemas, histórico por conexão, distribuição de atendimento (leads), chatbot, painel, e as proteções
contra travamento descritas em [API.md](API.md) — entre elas a confirmação do aviso `<status>`, que a
biblioteca não fazia e que deixava a sessão "conectada e muda".

Por ser uma biblioteca **não oficial**, valem os avisos dos Termos de Uso: o WhatsApp pode mudar sem
avisar, recursos podem parar até sair atualização, e o número pode ser limitado ou bloqueado. Recursos
exclusivos da API oficial da Meta (formulários/Flows, catálogo, pedidos) não existem aqui.

A cópia da biblioteca usada pelo conector fica em `lib/vendor/` apenas na parte adaptada
(`lib/vendor/whatsapp-baileys.js` é **código da DMK** que opera a Baileys; as alterações estão
registradas em `lib/vendor/ORIGEM.md`). A biblioteca em si é instalada pelo `npm`.

### Aviso de licença original (MIT)

```
MIT License

Copyright (c) 2025 Rajeh Taher/WhiskeySockets

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Outros componentes

| Componente | Para quê | Licença |
|---|---|---|
| `qrcode` 1.5.4 | desenhar o QR do pareamento no painel e no terminal | MIT |
| Node.js 22 | plataforma onde o conector roda | MIT |
| systemd, nginx, certbot (opcionais, do servidor) | serviço, HTTPS do subdomínio | LGPL-2.1+ / BSD-2 / Apache-2.0 |

O painel não carrega nada de fora: sem CDN, sem fonte externa, sem framework. Os ícones e o logotipo
(balão de conversa verde) são desenhos próprios da DMK Soluções, feitos em SVG dentro do próprio
projeto — não são de biblioteca de ícones nem imitam marca de terceiro.

## WhatsApp e Meta

"WhatsApp" e "Meta" são marcas da **Meta Platforms, Inc.**, citadas apenas para indicar
compatibilidade. Este projeto **não é produto do WhatsApp nem da Meta**, não tem relação, patrocínio
nem aprovação dessas empresas e não usa a API oficial (WhatsApp Business/Cloud API). A identidade
visual do conector é própria e não reproduz marca, logotipo ou ícone dessas empresas.

---

Relacionados: `LICENSE` · [TERMOS-DE-USO.md](TERMOS-DE-USO.md) ·
[POLITICA-DE-PRIVACIDADE.md](POLITICA-DE-PRIVACIDADE.md) · [API.md](API.md)

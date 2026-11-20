'use strict';
// Mensagens de empresa do WhatsApp viram texto legível (1.3.4). Formatos montados à mão conforme o que o
// Baileys entrega; a mensagem real da Celpe não está disponível aqui (o servidor guardou só o aviso antigo).
const test=require('node:test'),assert=require('node:assert/strict'),F=require('../lib/vendor/whatsapp-formatos');
test('mensagens de empresa, contato e localização: texto e estrutura',()=>{
// interativa com botões de fluxo nativo (o formato "interactiveMessage" que aparecia como indisponível)
assert.equal(F.texto({interactiveMessage:{header:{title:'Neoenergia'},body:{text:'Sua fatura de novembro está disponível.'},footer:{text:'Atendimento 116'},nativeFlowMessage:{buttons:[{name:'cta_url',buttonParamsJson:JSON.stringify({display_text:'Ver fatura',url:'https://exemplo.test/f'})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'Falar com atendente',id:'a1'})},{name:'cta_copy',buttonParamsJson:JSON.stringify({display_text:'Copiar código Pix',copy_code:'000201'})}]}}}),
 'Neoenergia\nSua fatura de novembro está disponível.\nAtendimento 116\nOpções: Ver fatura (https://exemplo.test/f) · Falar com atendente · Copiar código Pix (000201)');
// cabeçalho com documento e sem título; JSON de botão quebrado não derruba
assert.equal(F.texto({interactiveMessage:{header:{hasMediaAttachment:true,documentMessage:{fileName:'fatura.pdf'}},body:{text:'Segue sua conta.'},nativeFlowMessage:{buttons:[{name:'cta_url',buttonParamsJson:'{quebrado'}]}}}),'Segue sua conta.\n[Enviado com documento: veja no WhatsApp do celular]\nOpções: cta_url');
// lista dentro de botão nativo (single_select)
assert.match(F.texto({interactiveMessage:{body:{text:'Escolha'},nativeFlowMessage:{buttons:[{name:'single_select',buttonParamsJson:JSON.stringify({title:'Serviços',sections:[{rows:[{title:'2ª via'},{title:'Falta de energia'}]}]})}]}}}),/Opções: Serviços: 2ª via · Falta de energia$/);
// carrossel sem corpo usa os títulos dos cartões
assert.equal(F.texto({interactiveMessage:{carouselMessage:{cards:[{header:{title:'Plano A'}},{body:{text:'Plano B'}}]}}}),'Plano A\nPlano B');
// botões antigos, lista, modelo com botões e enquete
assert.equal(F.texto({buttonsMessage:{contentText:'Confirma?',footerText:'Celpe',buttons:[{buttonText:{displayText:'Sim'}},{buttonText:{displayText:'Não'}}]}}),'Confirma?\nCelpe\nOpções: Sim · Não');
assert.equal(F.texto({listMessage:{title:'Menu',description:'Como ajudar?',buttonText:'Ver opções',sections:[{rows:[{title:'Fatura',description:'2ª via'},{title:'Outros'}]}]}}),'Menu\nComo ajudar?\nVer opções: Fatura — 2ª via · Outros');
assert.equal(F.texto({templateMessage:{hydratedTemplate:{hydratedTitleText:'Aviso',hydratedContentText:'Conta vence amanhã.',hydratedButtons:[{urlButton:{displayText:'Pagar',url:'https://exemplo.test/p'}},{callButton:{displayText:'Ligar',phoneNumber:'116'}},{quickReplyButton:{displayText:'Já paguei'}}]}}}),'Aviso\nConta vence amanhã.\nOpções: Pagar (https://exemplo.test/p) · Ligar (116) · Já paguei');
assert.equal(F.texto({templateMessage:{interactiveMessageTemplate:{body:{text:'Modelo interativo'}}}}),'Modelo interativo');
assert.equal(F.texto({pollCreationMessageV3:{name:'Melhor dia?',options:[{optionName:'Seg'},{optionName:'Ter'}]}}),'Enquete: Melhor dia?\nOpções: Seg · Ter');
assert.equal(F.texto({interactiveResponseMessage:{nativeFlowResponseMessage:{paramsJson:'{"id":"a1"}'}}}),'a1');
// título igual ao corpo não repete; formato desconhecido ou vazio devolve vazio (cai no aviso antigo)
assert.equal(F.texto({buttonsMessage:{headerText:'Oi',contentText:'Oi'}}),'Oi');
assert.equal(F.texto({interactiveMessage:{}}),'');assert.equal(F.texto({stickerMessage:{}}),'');assert.equal(F.texto(),'');
assert(F.texto({interactiveMessage:{body:{text:'x'.repeat(5000)}}}).length<=3000);
// estrutura padronizada para o chat desenhar o cartão
const e=F.estrutura({interactiveMessage:{header:{title:'Neoenergia'},body:{text:'Fatura disponível.'},footer:{text:'116'},nativeFlowMessage:{buttons:[{name:'cta_url',buttonParamsJson:'{"display_text":"Ver fatura","url":"https://exemplo.test/f"}'},{name:'cta_copy',buttonParamsJson:'{"display_text":"Copiar Pix","copy_code":"000201"}'},{name:'quick_reply',buttonParamsJson:'{"display_text":"Atendente","id":"a"}'},{name:'single_select',buttonParamsJson:'{"title":"Serviços","sections":[{"rows":[{"title":"2ª via"}]}]}'}]}}});
assert.deepEqual(e,{tipo:'interativa',titulo:'Neoenergia',corpo:'Fatura disponível.',rodape:'116',opcoes:[{rotulo:'Ver fatura',tipo:'link',valor:'https://exemplo.test/f'},{rotulo:'Copiar Pix',tipo:'copiar',valor:'000201'},{rotulo:'Atendente',tipo:'resposta'},{rotulo:'Serviços',tipo:'lista',linhas:['2ª via']}]});
assert.deepEqual(F.estrutura({listMessage:{title:'Menu',buttonText:'Ver opções',sections:[{rows:[{title:'Fatura',description:'2ª via'}]}]}}),{tipo:'lista',titulo:'Menu',rotulo_opcoes:'Ver opções',opcoes:[{rotulo:'Fatura',tipo:'item',descricao:'2ª via'}]});
// contato (vCard) e localização viram cartão; o texto deles continua sendo a frase do motor (aqui vazio)
const vcard='BEGIN:VCARD\nVERSION:3.0\nFN:João da Silva\nTEL;type=CELL;waid=5587999991111:+55 87 99999-1111\nTEL;type=WORK:(87) 3333-4444\nEND:VCARD';
assert.deepEqual(F.estrutura({contactMessage:{displayName:'João',vcard}}),{tipo:'contato',contatos:[{nome:'João',telefones:['+5587999991111','(87) 3333-4444']}]});
assert.deepEqual(F.estrutura({contactsArrayMessage:{displayName:'2 contatos',contacts:[{vcard},{displayName:'Sem número'}]}}),{tipo:'contato',titulo:'2 contatos',contatos:[{nome:'João da Silva',telefones:['+5587999991111','(87) 3333-4444']},{nome:'Sem número',telefones:[]}]});
assert.deepEqual(F.estrutura({locationMessage:{degreesLatitude:-8.0714,degreesLongitude:-39.1247,name:'Loja',address:'Rua A, 10'}}),{tipo:'localizacao',local:{lat:-8.0714,lng:-39.1247,nome:'Loja',endereco:'Rua A, 10'}});
assert.equal(F.texto({contactMessage:{displayName:'João',vcard}}),'');assert.equal(F.texto({locationMessage:{degreesLatitude:1,degreesLongitude:1}}),'');
assert.equal(F.estrutura({locationMessage:{}}),null,'localização sem coordenadas não vira cartão');assert.equal(F.estrutura({conversation:'oi'}),null);assert.equal(F.estrutura({interactiveMessage:{}}),null);
// limpar: o que vem de fora (conector) é conferido e aparado
assert.equal(F.limpar(null),null);assert.equal(F.limpar({tipo:'script',corpo:'x'}),null);assert.equal(F.limpar({tipo:'lista'}),null);
const sujo=F.limpar({tipo:'botoes',corpo:'x'.repeat(9000),estranho:'<b>',opcoes:[{rotulo:'A',tipo:'inventado',valor:{a:1}},null,'texto',{rotulo:''},...Array.from({length:50},(_,i)=>({rotulo:'o'+i}))],contatos:'não é lista',local:{lat:999,lng:0}});
assert.equal(sujo.corpo.length,3000);assert.equal('estranho'in sujo,false);assert.equal(sujo.opcoes.length,27);assert.equal(sujo.opcoes[0].tipo,'resposta');assert.equal(sujo.opcoes[0].valor,'[object Object]');assert.equal('contatos'in sujo,false);assert.equal('local'in sujo,false);
assert.deepEqual(F.limpar(e),e,'limpar não muda o que já está certo');
});

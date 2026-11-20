'use strict';
// Mensagens de empresa do WhatsApp viram texto legível (1.3.4). Formatos montados à mão conforme o que o
// Baileys entrega; a mensagem real da Celpe não está disponível aqui (o servidor guardou só o aviso antigo).
const test=require('node:test'),assert=require('node:assert/strict'),F=require('../lib/vendor/whatsapp-formatos');
test('mensagens de empresa do WhatsApp viram texto legível',()=>{
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
});

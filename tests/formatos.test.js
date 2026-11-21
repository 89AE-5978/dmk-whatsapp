'use strict';
// Mensagens de empresa do WhatsApp viram texto legível (1.3.4). Formatos montados à mão conforme o que o
// Baileys entrega; a mensagem real da Celpe não está disponível aqui (o servidor guardou só o aviso antigo).
const test=require('node:test'),assert=require('node:assert/strict'),F=require('../lib/vendor/whatsapp-formatos');
test('mensagens de empresa, contato e localização: texto, estrutura e envio nativo',()=>{
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
// envio nativo (experimental): pedido conferido e mensagem montada
assert.equal(F.limparEnvio(null),null);assert.equal(F.limparEnvio({body:'x',items:[]}),null);assert.equal(F.limparEnvio({body:'',items:[{id:'o1',label:'A'}]}),null);
assert.equal(F.limparEnvio({body:'x',items:[{id:'tem espaço',label:'A'},{id:'o2',label:''}]}),null,'ids e rótulos inválidos são descartados');
const b3=F.limparEnvio({style:'buttons',body:'Escolha',items:[{id:'o1',label:'Sim'},{id:'o2',label:'Não'}]});assert.equal(b3.style,'buttons');
const cb=F.conteudoEnvio(b3).viewOnceMessage.message.interactiveMessage;assert.equal(cb.body.text,'Escolha');assert.deepEqual(cb.nativeFlowMessage.buttons.map(x=>[x.name,JSON.parse(x.buttonParamsJson)]),[['quick_reply',{display_text:'Sim',id:'o1'}],['quick_reply',{display_text:'Não',id:'o2'}]]);
assert.equal(F.limparEnvio({style:'buttons',body:'x',items:[1,2,3,4].map(n=>({id:'o'+n,label:'Op '+n}))}).style,'list','mais de 3 botões vira lista');
assert.equal(F.limparEnvio({style:'buttons',body:'x',items:[{id:'o1',label:'Um rótulo comprido demais para botão'}]}).style,'list');
const l=F.limparEnvio({style:'list',body:'Como ajudar?',button:'Abrir o menu de opções agora',items:[{id:'o1',label:'2ª via'},{id:'o2',label:'Quero falar com um atendente humano'},...Array.from({length:12},(_,i)=>({id:'x'+i,label:'L'+i}))]});
assert.equal(l.items.length,10);assert.equal(l.button,'Abrir o menu de opçõ');const sel=JSON.parse(F.conteudoEnvio(l).viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson);
assert.equal(sel.title,l.button);assert.deepEqual(sel.sections[0].rows.slice(0,2),[{id:'o1',title:'2ª via',description:''},{id:'o2',title:'Quero falar com um aten…',description:'Quero falar com um atendente humano'}]);
assert.equal(F.NOS_ENVIO[0].tag,'biz');assert.equal(F.NOS_ENVIO[0].content[0].content[0].attrs.name,'mixed');
// o que mandamos, se voltar para nós, é lido pelo mesmo leitor (ida e volta)
assert.deepEqual(F.estrutura(F.conteudoEnvio(b3).viewOnceMessage.message),{tipo:'interativa',corpo:'Escolha',opcoes:[{rotulo:'Sim',tipo:'resposta'},{rotulo:'Não',tipo:'resposta'}]});
});

// ---- 1.3.12: enquete, localização e contato ----
test('envio nativo: enquete, localização e contato são conferidos e montados', () => {
  const F = require('../lib/vendor/whatsapp-formatos');
  assert.equal(F.limparNativo({ type: 'poll', name: 'Qual horário?', options: ['Manhã', 'Tarde', 'Manhã'] }).options.length, 2, 'opções repetidas saem');
  assert.equal(F.limparNativo({ type: 'poll', name: 'x', options: ['só uma'] }), null, 'enquete precisa de 2 opções');
  assert.equal(F.limparNativo({ type: 'poll', name: '', options: ['a', 'b'] }), null);
  assert.deepEqual(F.conteudoNativo(F.limparNativo({ type: 'poll', name: 'Horário', options: ['Manhã', 'Tarde'], multiple: true })), { poll: { name: 'Horário', values: ['Manhã', 'Tarde'], selectableCount: 0 } });
  assert.equal(F.conteudoNativo(F.limparNativo({ type: 'poll', name: 'H', options: ['a', 'b'] })).poll.selectableCount, 1, 'sem multiple: escolhe uma');
  assert.deepEqual(F.conteudoNativo(F.limparNativo({ type: 'location', lat: -8.28, lng: -35.97, name: 'Loja DMK' })).location, { degreesLatitude: -8.28, degreesLongitude: -35.97, name: 'Loja DMK' });
  assert.equal(F.limparNativo({ type: 'location', lat: 200, lng: 0 }), null);
  const c = F.conteudoNativo(F.limparNativo({ type: 'contact', name: 'Suporte DMK', phone: '+55 (87) 9179-7853' }));
  assert.match(c.contacts.contacts[0].vcard, /FN:Suporte DMK\nTEL;type=CELL;type=VOICE;waid=558791797853:\+558791797853/);
  assert.equal(F.limparNativo({ type: 'contact', name: 'x', phone: '123' }), null);
  assert.equal(F.limparNativo({ type: 'outra' }), null);
});

test('voto em enquete vira texto com as opções escolhidas', () => {
  const F = require('../lib/vendor/whatsapp-formatos'), crypto = require('node:crypto');
  const enquete = { name: 'Qual horário?', options: [{ optionName: 'Manhã' }, { optionName: 'Tarde' }] };
  const h = (t) => crypto.createHash('sha256').update(t).digest();
  assert.equal(F.textoVoto(enquete, [h('Tarde')], crypto), 'Enquete "Qual horário?": Tarde');
  assert.equal(F.textoVoto(enquete, [h('Manhã'), h('Tarde')], crypto), 'Enquete "Qual horário?": Manhã, Tarde');
  assert.equal(F.textoVoto(enquete, [], crypto), 'Enquete "Qual horário?": retirou o voto');
});

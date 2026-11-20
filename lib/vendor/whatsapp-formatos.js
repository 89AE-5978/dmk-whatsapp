'use strict';
// Mensagens "de empresa" do WhatsApp (conector 1.3.4; o mesmo arquivo vive no DMK Prisma, mod 1.523): interativas, com botões, listas, modelos e enquetes — o formato
// que concessionárias, bancos e lojas usam (ex.: a Celpe/Neoenergia) —, além de contatos e localizações.
// Antes viravam "Visualização deste formato indisponível". Aqui cada uma vira:
//   estrutura(m): um objeto pequeno e padronizado (título, corpo, rodapé, opções, contatos, local) para o chat
//                 desenhar como cartão;
//   texto(m):     o mesmo conteúdo em texto simples, para sistemas que só mostram texto, busca e citação.
// limpar(r) confere e apara uma estrutura recebida de fora (o conector é outro serviço): nada passa sem conferir.
// Funções puras (recebem o conteúdo já desembrulhado da mensagem) para testar sem o Baileys.
const limpo=v=>String(v??'').replace(/\r/g,'').trim();
const json=v=>{try{const o=JSON.parse(String(v||''));return o&&typeof o==='object'?o:{}}catch{return {}}};
const anexo=h=>h?.imageMessage?'imagem':h?.videoMessage?'vídeo':h?.documentMessage?'documento':h?.locationMessage?'localização':'';
const TIPOS_BOTAO={cta_url:'link',cta_copy:'copiar',cta_call:'ligar',quick_reply:'resposta',single_select:'lista'};
// Botão de fluxo nativo: o rótulo e o destino vêm num JSON em texto.
function botaoNativo(b){const p=json(b?.buttonParamsJson),rotulo=limpo(p.display_text||p.title||b?.name);if(!rotulo)return null;const linhas=(p.sections||[]).flatMap(s=>(s.rows||[]).map(r=>limpo(r.title))).filter(Boolean),valor=limpo(p.url||p.copy_code||p.phone_number);return {rotulo,tipo:TIPOS_BOTAO[b?.name]||(p.url?'link':p.copy_code?'copiar':p.phone_number?'ligar':linhas.length?'lista':'resposta'),valor,linhas}}
const interativa=(i,tipo='interativa')=>{const h=i.header||{},cartoes=(i.carouselMessage?.cards||[]).map(c=>limpo(c.header?.title||c.body?.text)).filter(Boolean);return {tipo,titulo:h.title||h.subtitle,corpo:i.body?.text||(cartoes.length?cartoes.join('\n'):''),rodape:i.footer?.text,midia:anexo(h),opcoes:(i.nativeFlowMessage?.buttons||[]).map(botaoNativo)}};
function modelo(t){if(t.interactiveMessageTemplate)return interativa(t.interactiveMessageTemplate,'modelo');const h=t.hydratedTemplate||t.hydratedFourRowTemplate||t.fourRowTemplate;if(!h)return null;return {tipo:'modelo',titulo:h.hydratedTitleText,corpo:h.hydratedContentText,rodape:h.hydratedFooterText,midia:anexo(h),opcoes:(h.hydratedButtons||[]).map(b=>{const u=b.urlButton,c=b.callButton,q=b.quickReplyButton;return u?{rotulo:u.displayText,tipo:'link',valor:u.url}:c?{rotulo:c.displayText,tipo:'ligar',valor:c.phoneNumber}:{rotulo:q?.displayText,tipo:'resposta'}})}}
// Cartão de contato (vCard): nome e telefones (o número do WhatsApp vem no parâmetro waid quando existe).
function contato(c){const v=String(c?.vcard||''),tel=[...v.matchAll(/^TEL[^:\n]*:(.+)$/gim)].map(m=>{const w=/waid=(\d{8,15})/i.exec(m[0]);return w?'+'+w[1]:limpo(m[1])}).filter(Boolean);return {nome:limpo(c?.displayName)||limpo((/^FN:(.+)$/im.exec(v)||[])[1])||'Contato',telefones:[...new Set(tel)]}}
function bruta(m={}){
 if(m.interactiveMessage)return interativa(m.interactiveMessage);
 if(m.templateMessage)return modelo(m.templateMessage);
 if(m.buttonsMessage){const b=m.buttonsMessage;return {tipo:'botoes',titulo:b.headerText||b.text,corpo:b.contentText,rodape:b.footerText,midia:anexo(b),opcoes:(b.buttons||[]).map(x=>({rotulo:x.buttonText?.displayText,tipo:'resposta'}))}}
 if(m.listMessage){const l=m.listMessage;return {tipo:'lista',titulo:l.title,corpo:l.description,rodape:l.footerText,rotulo_opcoes:l.buttonText,opcoes:(l.sections||[]).flatMap(s=>(s.rows||[]).map(r=>({rotulo:r.title,descricao:r.description,tipo:'item'})))}}
 const enquete=m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3;if(enquete)return {tipo:'enquete',titulo:'Enquete: '+limpo(enquete.name),opcoes:(enquete.options||[]).map(o=>({rotulo:o.optionName,tipo:'item'}))};
 if(m.contactMessage)return {tipo:'contato',contatos:[contato(m.contactMessage)]};
 if(m.contactsArrayMessage)return {tipo:'contato',titulo:m.contactsArrayMessage.displayName,contatos:(m.contactsArrayMessage.contacts||[]).map(contato)};
 const local=m.locationMessage||m.liveLocationMessage;if(local)return {tipo:'localizacao',local:{lat:Number(local.degreesLatitude),lng:Number(local.degreesLongitude),nome:local.name,endereco:local.address}};
 return null;
}
const TIPOS=['interativa','botoes','lista','modelo','enquete','contato','localizacao'],TIPOS_OPCAO=['link','copiar','ligar','resposta','lista','item'];
function limpar(r){if(!r||typeof r!=='object'||!TIPOS.includes(r.tipo))return null;const t=(v,n)=>limpo(v).slice(0,n),out={tipo:r.tipo};
 for(const [k,n] of [['titulo',200],['corpo',3000],['rodape',300],['midia',20],['rotulo_opcoes',60]]){const v=t(r[k],n);if(v)out[k]=v}
 if(out.titulo&&out.titulo===out.corpo)delete out.titulo;
 const opcoes=(Array.isArray(r.opcoes)?r.opcoes:[]).slice(0,30).map(o=>{if(!o||typeof o!=='object')return null;const rotulo=t(o.rotulo,120);if(!rotulo)return null;const x={rotulo,tipo:TIPOS_OPCAO.includes(o.tipo)?o.tipo:'resposta'},valor=t(o.valor,500),descricao=t(o.descricao,200),linhas=(Array.isArray(o.linhas)?o.linhas:[]).slice(0,20).map(l=>t(l,80)).filter(Boolean);if(valor)x.valor=valor;if(descricao)x.descricao=descricao;if(linhas.length)x.linhas=linhas;return x}).filter(Boolean);if(opcoes.length)out.opcoes=opcoes;
 const contatos=(Array.isArray(r.contatos)?r.contatos:[]).slice(0,10).map(c=>c&&typeof c==='object'?{nome:t(c.nome,120)||'Contato',telefones:(Array.isArray(c.telefones)?c.telefones:[]).slice(0,5).map(x=>t(x,30)).filter(Boolean)}:null).filter(Boolean);if(contatos.length)out.contatos=contatos;
 const l=r.local;if(l&&typeof l==='object'&&Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&Math.abs(Number(l.lat))<=90&&Math.abs(Number(l.lng))<=180&&(Number(l.lat)||Number(l.lng))){out.local={lat:Number(l.lat),lng:Number(l.lng)};for(const k of ['nome','endereco']){const v=t(l[k],200);if(v)out.local[k]=v}}
 return Object.keys(out).length>1?out:null}
const estrutura=m=>limpar(bruta(m));
// Texto simples das mensagens de empresa. Contato e localização devolvem vazio aqui: o motor já tem a frase deles.
function texto(m={}){const r=estrutura(m);if(!r||['contato','localizacao'].includes(r.tipo)){if(m.interactiveResponseMessage){const x=m.interactiveResponseMessage,p=json(x.nativeFlowResponseMessage?.paramsJson);return limpo(x.body?.text||p.id||p.display_text||p.title)}return ''}
 const partes=[r.titulo,r.corpo,r.rodape].filter(Boolean);if(r.midia)partes.push('[Enviado com '+r.midia+': veja no WhatsApp do celular]');
 if(r.opcoes)partes.push((r.rotulo_opcoes||'Opções')+': '+r.opcoes.map(o=>o.rotulo+(o.valor?' ('+o.valor+')':'')+(o.descricao?' — '+o.descricao:'')+(o.linhas?': '+o.linhas.join(' · '):'')).join(' · '));
 return partes.join('\n').slice(0,3000)}
module.exports={texto,estrutura,limpar};

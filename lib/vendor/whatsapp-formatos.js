'use strict';
// Mensagens "de empresa" do WhatsApp (conector 1.3.4; o mesmo arquivo vive no DMK Prisma, mod 1.523): interativas, com botões, listas, modelos e enquetes — o formato
// que concessionárias, bancos e lojas usam (ex.: a Celpe/Neoenergia). Antes viravam "Visualização deste formato
// indisponível". Aqui elas são convertidas em texto legível: título, corpo, rodapé e as opções oferecidas.
// Função pura (recebe o conteúdo já desembrulhado da mensagem) para poder ser testada sem o Baileys.
const limpo=v=>String(v??'').replace(/\r/g,'').trim();
const json=v=>{try{const o=JSON.parse(String(v||''));return o&&typeof o==='object'?o:{}}catch{return {}}};
const anexo=h=>h?.imageMessage?'imagem':h?.videoMessage?'vídeo':h?.documentMessage?'documento':h?.locationMessage?'localização':'';
// Botão de fluxo nativo: o rótulo e o destino vêm num JSON em texto.
function botaoNativo(b){const p=json(b?.buttonParamsJson),rotulo=limpo(p.display_text||p.title||b?.name);if(!rotulo)return '';const destino=limpo(p.url||p.copy_code||p.phone_number);const linhas=(p.sections||[]).flatMap(s=>(s.rows||[]).map(r=>limpo(r.title))).filter(Boolean);return rotulo+(destino?' ('+destino+')':'')+(linhas.length?': '+linhas.join(' · '):'')}
function montar({titulo,corpo,rodape,opcoes=[],midia,rotuloOpcoes='Opções'}){const partes=[limpo(titulo),limpo(corpo),limpo(rodape)].filter((v,i,a)=>v&&a.indexOf(v)===i),lista=opcoes.map(limpo).filter(Boolean);if(midia)partes.push('[Enviado com '+midia+': veja no WhatsApp do celular]');if(lista.length)partes.push(rotuloOpcoes+': '+lista.join(' · '));return partes.join('\n').slice(0,3000)}
function interativa(i){const h=i.header||{},cartoes=(i.carouselMessage?.cards||[]).map(c=>limpo(c.header?.title||c.body?.text)).filter(Boolean);return montar({titulo:h.title||h.subtitle,corpo:i.body?.text||(cartoes.length?cartoes.join('\n'):''),rodape:i.footer?.text,midia:anexo(h),opcoes:(i.nativeFlowMessage?.buttons||[]).map(botaoNativo)})}
function modelo(t){const h=t.hydratedTemplate||t.hydratedFourRowTemplate||t.fourRowTemplate;if(t.interactiveMessageTemplate)return interativa(t.interactiveMessageTemplate);if(!h)return '';return montar({titulo:h.hydratedTitleText,corpo:h.hydratedContentText||h.content?.namespace,rodape:h.hydratedFooterText,midia:anexo(h),opcoes:(h.hydratedButtons||[]).map(b=>{const u=b.urlButton,c=b.callButton,q=b.quickReplyButton;return u?limpo(u.displayText)+(u.url?' ('+limpo(u.url)+')':''):c?limpo(c.displayText)+(c.phoneNumber?' ('+limpo(c.phoneNumber)+')':''):limpo(q?.displayText)})})}
function texto(m={}){
 if(m.interactiveMessage)return interativa(m.interactiveMessage);
 if(m.templateMessage)return modelo(m.templateMessage);
 if(m.buttonsMessage){const b=m.buttonsMessage;return montar({titulo:b.headerText||b.text,corpo:b.contentText,rodape:b.footerText,midia:anexo(b),opcoes:(b.buttons||[]).map(x=>x.buttonText?.displayText)})}
 if(m.listMessage){const l=m.listMessage;return montar({titulo:l.title,corpo:l.description,rodape:l.footerText,rotuloOpcoes:limpo(l.buttonText)||'Opções',opcoes:(l.sections||[]).flatMap(s=>(s.rows||[]).map(r=>limpo(r.title)+(limpo(r.description)?' — '+limpo(r.description):'')))})}
 if(m.interactiveResponseMessage){const r=m.interactiveResponseMessage,p=json(r.nativeFlowResponseMessage?.paramsJson);return limpo(r.body?.text||p.id||p.display_text||p.title)}
 const enquete=m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3;if(enquete)return montar({titulo:'Enquete: '+limpo(enquete.name),opcoes:(enquete.options||[]).map(o=>o.optionName)});
 return '';
}
module.exports={texto};

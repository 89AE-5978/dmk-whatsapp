'use strict';

// Conteúdo cifrável recente para getMessage do Baileys. Fica só em memória,
// separado por sessão; não grava texto, anexos ou chaves em logs/arquivos.
function createRetryCache({limit=500,ttlMs=30*60*1000,now=Date.now}={}){
  const entries=new Map();
  function identity(key){
    const jid=String(key?.remoteJid||'').toLowerCase().replace(/:\d+@/,'@');
    if(!key?.id || !/@(?:s\.whatsapp\.net|lid)$/.test(jid))return '';
    // Mesmo ID em outro destinatário/direção não é a mesma mensagem.
    return JSON.stringify([jid,String(key.id),key.fromMe===true]);
  }
  function prune(){
    const time=now();
    for(const [key,value] of entries)if(value.until<=time)entries.delete(key);
    while(entries.size>limit)entries.delete(entries.keys().next().value);
  }
  // O pedido de reenvio pode chegar pelo LID do contato (…@lid) mesmo quando enviamos pelo número
  // (…@s.whatsapp.net) e vice-versa. Nesse caso vale o mesmo ID/direção, se existir só um.
  function porId(key){
    const id=String(key?.id||''),jid=String(key?.remoteJid||'');if(!id)return undefined;
    const lid=/@lid$/i.test(jid);let achado,total=0;
    for(const [k,v] of entries){const [j,i,f]=JSON.parse(k);if(i===id&&f===(key.fromMe===true)&&(/@lid$/.test(j)!==lid)){achado=v;total++}}
    return total===1?achado.content:undefined;
  }
  return {
    put(message){
      const key=identity(message?.key);
      if(!key || !message?.message)return;
      prune();entries.delete(key);
      entries.set(key,{content:message.message,until:now()+ttlMs});prune();
    },
    get(key){prune();return entries.get(identity(key))?.content??porId(key);},
    remove(key){entries.delete(identity(key));},
    clear(){entries.clear();}
  };
}
module.exports={createRetryCache};

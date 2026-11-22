/**
 * PDV ARTE MIX 1.1.4.6
 * Motor Baileys multi-sessão isolado do restante do PDV.
 *
 * A autenticação é gravada em dados/whatsapp-baileys/<client_key>.
 * Essa pasta fica dentro de dados/ justamente para ser preservada pelos
 * atualizadores e backups do sistema.
 */
const fs=require('fs');
const path=require('path');
const QRCode=require('qrcode');
const {createRetryCache}=require('./whatsapp-retry-cache');

const onlyDigits=v=>String(v||'').replace(/\D/g,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const silentLogger={
  trace(){},debug(){},info(){},warn(){},error(){},fatal(){},
  child(){return this;}
};
// DMK WhatsApp (1.3.1): o socket usava silentLogger e escondia, entre outros, "failed to decrypt message" —
// a mensagem chegava, não abria e sumia sem rastro. Este logger mostra só avisos e erros, numa linha curta,
// sem objetos (que traziam chaves de criptografia) e sem repetir a mesma frase mais de uma vez por minuto.
function compactLogger(label){
  const seen=new Map();
  const out=(level)=>(obj,msg)=>{
    const text=String(typeof obj==='string'?obj:msg||obj?.msg||'').slice(0,160);if(!text)return;
    const err=obj&&typeof obj==='object'?String(obj.err?.message||obj.error?.message||obj.error||'').slice(0,160):'';
    const k=level+text+err,now=Date.now();if(now-(seen.get(k)||0)<60000)return;seen.set(k,now);
    if(seen.size>500)seen.clear();
    console[level==='warn'?'warn':'error'](`[BAILEYS:${label}] ${level==='warn'?'aviso':'erro'}: ${text}${err?' ('+err+')':''}`);
  };
  const l={trace(){},debug(){},info(){},warn:out('warn'),error:out('error'),fatal:out('error'),child(){return l;},level:'warn'};
  return l;
}

function messageContent(raw){
  let m=raw?.message||{};
  // Baileys pode encapsular mensagens em ephemeral/view-once.
  for(let i=0;i<4;i++){
    if(m?.ephemeralMessage?.message){m=m.ephemeralMessage.message;continue;}
    if(m?.viewOnceMessage?.message){m=m.viewOnceMessage.message;continue;}
    if(m?.viewOnceMessageV2Extension?.message){m=m.viewOnceMessageV2Extension.message;continue;}
    if(m?.viewOnceMessageV2?.message){m=m.viewOnceMessageV2.message;continue;}
    if(m?.documentWithCaptionMessage?.message){m=m.documentWithCaptionMessage.message;continue;}
    break;
  }
  return m||{};
}

function messageText(raw){
  const m=messageContent(raw);
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    (m.contactMessage?'Contato recebido: '+(m.contactMessage.displayName||'sem nome'):'') ||
    (m.contactsArrayMessage?'Contatos recebidos: '+(m.contactsArrayMessage.displayName||'lista de contatos'):'') ||
    (m.locationMessage?'Localização recebida: '+String(m.locationMessage.name||m.locationMessage.address||'consulte no WhatsApp'):'') ||
    // DMK WhatsApp (1.3.4): mensagens de empresa (interativas, botões, listas, modelos, enquetes) viram texto legível.
    require('./whatsapp-formatos').texto(m) ||
    ''
  ).trim();
}

function supportedInboundMessage(raw){
  const m=messageContent(raw);
  return !!(
    m.conversation || m.extendedTextMessage ||
    m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage ||
    Object.keys(m).some(k=>!['protocolMessage','reactionMessage','senderKeyDistributionMessage','messageContextInfo','keepInChatMessage'].includes(k))
  );
}

function isDirectIncomingJid(jid){
  const value=String(jid||'').toLowerCase();
  if(!value || value==='status@broadcast' || value.endsWith('@g.us') || value.endsWith('@broadcast') || value.endsWith('@newsletter') || value.includes('newsletter'))return false;
  return value.endsWith('@s.whatsapp.net') || value.endsWith('@lid');
}

function mediaDescriptor(raw){
  const m=messageContent(raw);
  const choices=[
    ['imageMessage','image'],
    ['stickerMessage','image'],
    ['videoMessage','video'],
    ['audioMessage','audio'],
    ['documentMessage','document']
  ];
  for(const [key,type] of choices){
    if(m[key]){
      const x=m[key];
      return {
        key,type,
        mimetype:String(x.mimetype|| (key==='stickerMessage'?'image/webp':'application/octet-stream')),
        filename:String(x.fileName||x.title||''),
        caption:String(x.caption||''),
        // DMK WhatsApp (1.3.16): áudio gravado na hora (mensagem de voz) e duração, para o chat mostrar a
        // bolha certa; figurinha também fica marcada, que é imagem mas não é foto.
        ...(key==='audioMessage'&&x.ptt?{voz:true}:{}),
        ...(key==='stickerMessage'?{figurinha:true}:{}),
        ...(Number(x.seconds)>0?{segundos:Number(x.seconds)}:{})
      };
    }
  }
  return null;
}

// DMK WhatsApp (1.3.11): só para o modo diagnóstico — a ESTRUTURA de uma mensagem (nomes dos campos, até 5 níveis),
// nunca os valores. Serve para ver onde o WhatsApp está pondo a citação de uma resposta.
function estruturaDe(o,nivel=0){
  if(!o||typeof o!=='object'||nivel>5||o instanceof Uint8Array||typeof o.toNumber==='function')return '';
  const partes=[];
  for(const k of Object.keys(o)){
    const v=o[k];if(v==null||(Array.isArray(v)&&!v.length))continue;
    const filho=Array.isArray(v)?estruturaDe(v[0],nivel+1):estruturaDe(v,nivel+1);
    partes.push(k+(filho?'{'+filho+'}':''));
  }
  return partes.join(',');
}
function quotedDescriptor(raw){
  const m=messageContent(raw);
  const carriers=[
    m.extendedTextMessage,
    m.imageMessage,
    m.videoMessage,
    m.audioMessage,
    m.documentMessage
  ].filter(Boolean);
  const ctx=carriers.map(x=>x?.contextInfo).find(Boolean);
  const id=String(ctx?.stanzaId||'');
  if(!id)return null;
  const quoted=ctx?.quotedMessage||{};
  const qr={message:quoted};
  const md=mediaDescriptor(qr);
  let body=messageText(qr);
  if(!body&&md)body=({image:'📷 Imagem',video:'🎥 Vídeo',audio:'🎧 Áudio',document:'📎 Documento'})[md.type]||'Mensagem';
  return {
    messageId:id,
    participant:String(ctx?.participant||ctx?.remoteJid||''),
    body:String(body||'Mensagem').slice(0,500),
    type:md?.type||'text'
  };
}

function statusCodeFromError(err){
  return Number(
    err?.output?.statusCode ||
    err?.statusCode ||
    err?.data?.statusCode ||
    err?.cause?.output?.statusCode ||
    0
  );
}

// DMK WhatsApp (1.3.0): saveMessage guarda o conteúdo de cada envio confirmado (bytes do proto) para o
// reenvio sobreviver a reinícios; minSendIntervalMs espaça os envios da MESMA sessão (fila por sessão).
function createBaileysManager({runtimeMap,authRoot,onMessage,onStatus,onMessageStatus,onReaction,onDelete,loadModule,loadMessage,saveMessage,diagnostic=()=>false,minSendIntervalMs=0,sendTimeoutMs=30000}){
  if(!(runtimeMap instanceof Map))throw new Error('runtimeMap obrigatório.');
  const root=path.resolve(authRoot||'./dados/whatsapp-baileys');
  fs.mkdirSync(root,{recursive:true});
  const starts=new Map(),generations=new Map(),retryCaches=new Map();
  let modulePromise=null;
  let versionCache={version:null,source:'',at:0};
  const reconnectAttempts=new Map();
  const deafRestarts=new Map(); // DMK WhatsApp (1.3.8): reaberturas seguidas por "conectado sem receber"
  const noQrAttempts=new Map();
  const VERSION_CACHE_MS=6*60*60*1000;

  function withTimeout(promise,ms,label='Operação') {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(`${label} excedeu ${ms} ms.`)),ms);
      })
    ]).finally(()=>clearTimeout(timer));
  }

  function validVersion(v){
    return Array.isArray(v) && v.length>=3 && v.slice(0,3).every(n=>Number.isFinite(Number(n)) && Number(n)>=0);
  }

  function normalizeVersion(v){
    return validVersion(v)?v.slice(0,3).map(Number):null;
  }

  async function fetchLiveWaWebVersion(){
    if(typeof fetch!=='function')throw new Error('Node sem fetch global para consultar a versão do WhatsApp Web.');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),7000);
    try{
      const r=await fetch('https://web.whatsapp.com/sw.js',{
        method:'GET',
        redirect:'follow',
        cache:'no-store',
        signal:controller.signal,
        headers:{
          'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'sec-fetch-site':'none',
          'accept':'*/*'
        }
      });
      if(!r.ok)throw new Error(`WhatsApp Web respondeu HTTP ${r.status}.`);
      const text=await r.text();
      const m=text.match(/client_revision[^0-9]{0,24}(\d{6,})/i);
      if(!m)throw new Error('client_revision não encontrado no sw.js do WhatsApp Web.');
      return [2,3000,Number(m[1])];
    }finally{
      clearTimeout(timer);
    }
  }

  async function resolveWaVersion(mod,{force=false}={}){
    const now=Date.now();
    if(!force && validVersion(versionCache.version) && now-versionCache.at<VERSION_CACHE_MS)return versionCache;

    const attempts=[
      async()=>({version:await fetchLiveWaWebVersion(),source:'whatsapp-web-live'}),
      async()=>{
        if(typeof mod.fetchLatestWaWebVersion!=='function')throw new Error('helper fetchLatestWaWebVersion indisponível');
        const x=await withTimeout(mod.fetchLatestWaWebVersion(),8000,'fetchLatestWaWebVersion');
        const version=normalizeVersion(x?.version);
        if(!version)throw new Error('versão inválida em fetchLatestWaWebVersion');
        return {version,source:'baileys-live-helper'};
      },
      async()=>{
        if(typeof mod.fetchLatestBaileysVersion!=='function')throw new Error('helper fetchLatestBaileysVersion indisponível');
        const x=await withTimeout(mod.fetchLatestBaileysVersion(),8000,'fetchLatestBaileysVersion');
        const version=normalizeVersion(x?.version);
        if(!version)throw new Error('versão inválida em fetchLatestBaileysVersion');
        return {version,source:'baileys-release-helper'};
      }
    ];

    const errors=[];
    for(const fn of attempts){
      try{
        const got=await fn();
        versionCache={...got,at:now};
        console.log(`[BAILEYS] WhatsApp Web ${got.version.join('.')} via ${got.source}.`);
        return versionCache;
      }catch(e){errors.push(String(e?.message||e));}
    }

    console.warn('[BAILEYS] Não foi possível consultar a revisão atual do WhatsApp Web. Usando a revisão embutida da biblioteca.',errors.join(' | '));
    versionCache={version:null,source:'library-default',at:now};
    return versionCache;
  }

  function resetVersionCache(){
    versionCache={version:null,source:'',at:0};
  }

  function normalizarModuloBaileys(raw){
    // Dependendo da combinação Node/CommonJS/ESM, o Baileys 6.x pode chegar como:
    // mod.makeWASocket, mod.default, mod.default.makeWASocket ou mod.default.default.
    // Normalizamos todos os formatos para que o restante do PDV use uma API única.
    const layers=[];
    let cur=raw;
    for(let i=0;i<4 && cur;i++){
      if(!layers.includes(cur))layers.push(cur);
      cur=(cur && (typeof cur==='object'||typeof cur==='function'))?cur.default:null;
    }

    const pick=(name)=>{
      for(const layer of layers){
        if(layer && (typeof layer==='object'||typeof layer==='function') && layer[name]!==undefined)return layer[name];
      }
      return undefined;
    };
    const pickFn=(name)=>{
      const v=pick(name);
      return typeof v==='function'?v:null;
    };

    let makeWASocket=pickFn('makeWASocket');
    if(!makeWASocket){
      for(const layer of layers){
        if(typeof layer==='function'){makeWASocket=layer;break;}
      }
    }

    const api={
      makeWASocket,
      useMultiFileAuthState:pickFn('useMultiFileAuthState'),
      downloadMediaMessage:pickFn('downloadMediaMessage'),
      makeCacheableSignalKeyStore:pickFn('makeCacheableSignalKeyStore'),
      fetchLatestWaWebVersion:pickFn('fetchLatestWaWebVersion'),
      fetchLatestBaileysVersion:pickFn('fetchLatestBaileysVersion'),
      jidNormalizedUser:pickFn('jidNormalizedUser'),
      generateWAMessageFromContent:pickFn('generateWAMessageFromContent'),
      decryptPollVote:pickFn('decryptPollVote'), // DMK WhatsApp (1.3.12): voto de enquete // DMK WhatsApp (1.3.4): lista/botões nativos
      proto:pick('proto'), // DMK WhatsApp: codificar/decodificar o conteúdo guardado para reenvio
      Browsers:pick('Browsers'),
      DisconnectReason:pick('DisconnectReason')
    };

    if(typeof api.makeWASocket!=='function'){
      const keys=[...new Set(layers.flatMap(layer=>{
        try{return (layer&&(typeof layer==='object'||typeof layer==='function'))?Object.keys(layer):[];}catch{return [];}
      }))].slice(0,30);
      throw new Error(`Baileys incompatível: makeWASocket não foi encontrado. Exports detectados: ${keys.join(', ')||'nenhum'}.`);
    }
    if(typeof api.useMultiFileAuthState!=='function'){
      throw new Error('Baileys incompatível: useMultiFileAuthState não foi encontrado.');
    }
    return api;
  }

  async function lib(){
    if(!modulePromise){
      modulePromise=(loadModule?Promise.resolve().then(loadModule):import('@whiskeysockets/baileys'))
        .then(normalizarModuloBaileys)
        .catch(err=>{
          modulePromise=null;
          if(/Baileys incompatível/i.test(String(err?.message||'')))throw err;
          const e=new Error('Motor Baileys não pôde ser carregado. Verifique a instalação da dependência @whiskeysockets/baileys.');
          e.cause=err;
          throw e;
        });
    }
    return modulePromise;
  }

  function authDir(account){
    // client_key é gerado pelo próprio PDV, mas ainda removemos qualquer caractere estranho.
    const safe=String(account?.client_key||`wa-${account?.id||'session'}`).replace(/[^a-zA-Z0-9._-]/g,'_');
    const dir=path.resolve(root,safe);if(!dir.startsWith(root+path.sep))throw new Error('Pasta da sessão WhatsApp inválida.');return dir;
  }

  async function notify(account,status,extra={}){
    if(typeof onStatus==='function'){
      try{await onStatus(account,status,extra);}catch(e){console.warn('[BAILEYS] Falha ao salvar status:',e.message);}
    }
  }

  function isLidJid(jid){
    return /@lid$/i.test(String(jid||''));
  }

  function isPnJid(jid){
    return /@s\.whatsapp\.net$/i.test(String(jid||''));
  }

  function normalizeDirectJid(value){
    const raw=String(value||'').trim();
    if(!raw)return '';
    if(/@(?:lid|s\.whatsapp\.net)$/i.test(raw))return raw;
    const digits=onlyDigits(raw);
    return digits?`${digits}@s.whatsapp.net`:'';
  }

  async function resolveIncomingIdentity(sock,msg){
    const key=msg?.key||{};
    const raw=String(key.remoteJid||'');
    const directCandidates=[
      key.remoteJidAlt,key.senderPn,key.participantPn,msg?.senderPn,msg?.participantPn
    ].map(x=>String(x||'')).filter(Boolean);

    let jid=directCandidates.find(isPnJid)||raw;
    if(isLidJid(raw) && !isPnJid(jid)){
      try{
        const mapped=await sock?.signalRepository?.lidMapping?.getPNForLID?.(raw);
        if(mapped)jid=String(mapped);
      }catch(e){
        console.warn('[BAILEYS] Não foi possível resolver LID para número:',e.message);
      }
    }

    const normalized=typeof sock?.jidNormalizedUser==='function'?sock.jidNormalizedUser(jid):jid;
    jid=String(normalized||jid||raw);
    const phone=isPnJid(jid)?onlyDigits(jid.split('@')[0].split(':')[0]):'';
    return {jid:jid||raw,phone,rawJid:raw};
  }

  // Números do Brasil: aceita sem 55 e testa com e sem o 9 extra, porque muitas contas antigas
  // estão registradas no WhatsApp sem ele. Sem essa consulta o Baileys "envia" para um JID que
  // não existe e a mensagem nunca chega, mesmo com a sessão conectada.
  function phoneCandidates(digits){
    let n=onlyDigits(digits);
    if(n.length===10||n.length===11)n='55'+n;
    const list=[n];
    if(/^55\d{2}9\d{8}$/.test(n))list.push(n.slice(0,4)+n.slice(5));
    else if(/^55\d{2}[6-9]\d{7}$/.test(n))list.push(n.slice(0,4)+'9'+n.slice(4));
    return list;
  }

  async function resolveOutgoingJid(sock,value){
    const raw=String(value||'').trim();
    if(/@(?:lid|s\.whatsapp\.net)$/i.test(raw)){
      let jid=raw;
      if(isLidJid(jid)){
        try{
          const pn=await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
          if(pn)jid=String(pn);
        }catch{}
      }
      return jid;
    }
    const digits=onlyDigits(raw);
    if(digits.length<10||digits.length>15)throw Object.assign(new Error('Número de WhatsApp inválido. Informe DDD e número.'),{statusCode:400,operational:true});
    const candidates=phoneCandidates(digits);
    const cache=sock&&(sock.__dmkJidCache||(sock.__dmkJidCache=new Map()));
    const key=candidates[0];
    const cached=cache?.get(key);
    if(cached&&cached.until>Date.now())return cached.jid;
    if(typeof sock?.onWhatsApp!=='function')return `${key}@s.whatsapp.net`;
    let found=null;
    try{
      const rows=await withTimeout(sock.onWhatsApp(...candidates),15000,'Consulta do número no WhatsApp');
      found=(rows||[]).find(r=>r?.exists&&r?.jid)||null;
    }catch(e){
      // Sem resposta da consulta: mantém o comportamento anterior para não travar o envio.
      console.warn('[BAILEYS] Não foi possível conferir o número:',e.message);
      return `${key}@s.whatsapp.net`;
    }
    if(!found)throw Object.assign(new Error('Este número não tem WhatsApp. Confira o DDD e o número.'),{statusCode:400,operational:true});
    const jid=String(found.jid);
    cache.set(key,{jid,until:Date.now()+6*3600000});
    if(cache.size>2000)cache.delete(cache.keys().next().value);
    return jid;
  }

  async function downloadMedia(mod,sock,msg){
    if(typeof mod.downloadMediaMessage!=='function')return null;
    try{
      return await mod.downloadMediaMessage(msg,'buffer',{},sock?.updateMediaMessage?{logger:silentLogger,reuploadRequest:sock.updateMediaMessage}:{logger:silentLogger});
    }catch(e){
      console.warn('[BAILEYS] Não foi possível baixar mídia recebida:',e.message);
      return null;
    }
  }

  function start(account){
    const id=Number(account?.id);if(starts.has(id))return starts.get(id);
    const pending=performStart(account).finally(()=>{if(starts.get(id)===pending)starts.delete(id)});starts.set(id,pending);return pending;
  }
  async function performStart(account){
    const id=Number(account?.id);
    if(!id)throw new Error('Conta WhatsApp inválida.');
    const existing=runtimeMap.get(id);
    if(existing)return existing;

    const mod=await lib();
    const makeWASocket=mod.makeWASocket;

    const dir=authDir(account);
    fs.mkdirSync(dir,{recursive:true});
    const {state,saveCreds}=await mod.useMultiFileAuthState(dir);
    const resolvedVersion=await resolveWaVersion(mod);
    // Preserva reenvios em uma reconexão transitória, nunca após logout/reset.
    let retryCache=retryCaches.get(id);
    // 24 h e 3.000 mensagens: o celular do cliente pode pedir o reenvio horas depois (internet lenta ou aparelho
    // desligado). Sem o conteúdo para reenviar, a mensagem fica como "Aguardando mensagem" no aparelho dele.
    if(!retryCache){retryCache=createRetryCache({limit:3000,ttlMs:24*60*60*1000});retryCaches.set(id,retryCache);}

    const runtime={
      engine:'BAILEYS',client:null,sock:null,status:'INICIANDO',qrDataUrl:null,
      lastError:null,phone:String(account.phone||''),displayName:String(account.display_name||''),
      manualStop:false,accountId:id,generation:generations.get(id)||0,authDir:dir,startedAt:Date.now(),
      protocolVersion:resolvedVersion.version?resolvedVersion.version.join('.'):'biblioteca',
      versionSource:resolvedVersion.source||'library-default',reconnectAttempt:reconnectAttempts.get(id)||0,
      recentMessages:new Map(),presenceMap:new Map()
    };
    runtime.mod=mod; // DMK WhatsApp: usado no envio para guardar o conteúdo do reenvio
    // DMK WhatsApp (1.3.5): a credencial muda a cada mensagem (chaves de sessão, pré-chaves, contadores). Se o
    // serviço para (pausar, reiniciar, ATUALIZAR) com gravações pela metade ou na fila, a sessão volta com chaves
    // antigas: aparece "Conectado", mas as mensagens que chegam não abrem mais — é o "parou de sincronizar depois
    // de atualizar". Aqui cada gravação de chave é acompanhada e flushAuth() espera todas antes de soltar a sessão.
    runtime.keyWrites=new Set();runtime.authWrites=Promise.resolve();
    const chaves=state.keys&&typeof state.keys.set==='function'
      ?{...state.keys,get:(...a)=>state.keys.get(...a),set:(...a)=>{const w=Promise.resolve().then(()=>state.keys.set(...a));runtime.keyWrites.add(w);w.catch(()=>{}).finally(()=>runtime.keyWrites.delete(w));return w}}
      :state.keys;
    runtime.flushAuth=async(ms=6000)=>{
      const fim=Date.now()+ms;
      // Mensagens que já tinham chegado ainda podem gravar chaves por alguns instantes: só termina depois de uma
      // passada inteira sem nenhuma gravação pendente.
      for(;;){
        await runtime.authWrites.catch(()=>{});
        const pendentes=[...runtime.keyWrites];
        if(pendentes.length)await Promise.allSettled(pendentes);
        await sleep(120);
        if(!runtime.keyWrites.size||Date.now()>fim)break;
      }
      if(!runtime.discardAuth)await Promise.resolve().then(()=>saveCreds()).catch(()=>{runtime.lastError='Falha ao salvar a sessão WhatsApp.'});
      runtime.authClosed=true; // socket antigo não grava mais nada por cima da credencial do próximo
    };
    runtimeMap.set(id,runtime);
    await notify(account,'INICIANDO');

    const socketOptions={
      auth:chaves && mod.makeCacheableSignalKeyStore
        ?{...state,keys:mod.makeCacheableSignalKeyStore(chaves,silentLogger)}:{...state,keys:chaves},
      // O WhatsApp solicita este conteúdo quando o destinatário precisa de reenvio.
      // Depois de reiniciar ou atualizar o sistema a memória começa vazia: o texto enviado é recuperado do
      // histórico do atendimento (loadMessage), para o pedido de reenvio não ficar sem resposta.
      getMessage:async key=>{
        if(runtimeMap.get(id)!==runtime||runtime.manualStop)return undefined;
        const cached=retryCache.get(key);if(cached||typeof loadMessage!=='function')return cached;
        try{
          const stored=await loadMessage(account,key);
          // DMK WhatsApp: o conteúdo guardado em disco vem como bytes do proto; volta a ser a mensagem original
          // (texto ou anexo com as mesmas chaves de mídia), não uma cópia só com o texto.
          if(stored instanceof Uint8Array&&mod.proto?.Message?.decode)return mod.proto.Message.decode(stored);
          return stored&&typeof stored==='object'?stored:undefined;
        }catch{return undefined}
      },
      logger:compactLogger(account.label||id),
      syncFullHistory:false,
      markOnlineOnConnect:false,
      generateHighQualityLinkPreview:false,
      connectTimeoutMs:60000,
      defaultQueryTimeoutMs:60000,
      keepAliveIntervalMs:25000,
      retryRequestDelayMs:1200,
      maxMsgRetryCount:5,
      qrTimeout:60000
    };
    if(validVersion(resolvedVersion.version))socketOptions.version=resolvedVersion.version;
    // WEB_BROWSER é mais compatível com pareamento recente do WhatsApp do que perfis Desktop.
    if(mod.Browsers?.ubuntu)socketOptions.browser=mod.Browsers.ubuntu('Chrome');

    let sock;
    try{
      sock=makeWASocket(socketOptions);
    }catch(e){
      runtimeMap.delete(id);
      runtime.status='ERRO';
      runtime.lastError=`Falha ao abrir socket Baileys: ${String(e?.message||e)}`;
      await notify(account,'ERRO',{error:runtime.lastError});
      throw e;
    }
    runtime.client=sock; // compatibilidade com trechos antigos que esperam client
    runtime.sock=sock;

    let qrWatchdog=setTimeout(async()=>{
      if(runtimeMap.get(id)!==runtime || runtime.manualStop || runtime.status==='CONECTADO' || runtime.qrDataUrl)return;
      const tries=(noQrAttempts.get(id)||0)+1;
      noQrAttempts.set(id,tries);
      runtime.lastError=tries<2
        ?'O WhatsApp ainda não entregou o QR. Atualizando a revisão do protocolo e tentando novamente.'
        :'O WhatsApp não entregou o QR. Verifique a internet da VPS, a data/hora do servidor e tente Reiniciar a instância.';
      runtime.status=tries<2?'RECONECTANDO':'ERRO';
      await notify(account,runtime.status,{error:runtime.lastError});
      if(tries<2){
        resetVersionCache();
        runtime.manualStop=true; // evita duas reconexões: watchdog + evento close.
        runtimeMap.delete(id);
        try{sock.end?.(new Error('PDV: reinício de pareamento sem QR'));}catch{}
        await runtime.flushAuth?.();
        await sleep(1200);
        if((generations.get(id)||0)===runtime.generation)start(account).catch(e=>console.error(`[BAILEYS:${account.label}] nova tentativa de QR:`,e.message));
      }
    },35000);
    runtime.qrWatchdog=qrWatchdog;qrWatchdog.unref?.();

    // Antes a gravação era pulada se a sessão já estivesse parando (manualStop) ou reconectando — justamente quando
    // a última alteração da credencial precisa ir para o disco. Só é descartada quando a credencial vai ser apagada.
    sock.ev.on('creds.update',()=>{runtime.authWrites=runtime.authWrites.then(()=>{if(!runtime.discardAuth&&!runtime.authClosed)return saveCreds()}).catch(()=>{runtime.lastError='Falha ao salvar a sessão WhatsApp.'})});

    sock.ev.on('connection.update',async update=>{
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      // DMK WhatsApp (1.3.8): o servidor avisa quando terminou de entregar o que estava pendente. É o sinal de que a
      // sessão está recebendo de verdade — "open" sozinho não garante (ver vigia abaixo).
      if(update.receivedPendingNotifications){runtime.receiving=true;clearTimeout(runtime.deafTimer);deafRestarts.delete(id)}
      try{
        if(update.qr){
          clearTimeout(qrWatchdog);
          noQrAttempts.set(id,0);
          runtime.status='AGUARDANDO_QR';
          runtime.qrDataUrl=await QRCode.toDataURL(update.qr,{width:320,margin:2});
          runtime.qrText=update.qr; // DMK WhatsApp: texto do QR para mostrar no terminal
          runtime.lastError=null;
          await notify(account,'AGUARDANDO_QR');
        }

        if(update.connection==='connecting'){
          runtime.status=runtime.qrDataUrl?'AGUARDANDO_QR':'INICIANDO';
          await notify(account,runtime.status);
        }

        if(update.connection==='open'){
          clearTimeout(qrWatchdog);
          reconnectAttempts.set(id,0);
          noQrAttempts.set(id,0);
          runtime.reconnectAttempt=0;
          runtime.status='CONECTADO';runtime.connectedAt=Date.now();
          // Vigia do "conectado mas surdo": se em 90 s o servidor não confirmar a entrega das pendências nem entregar
          // mensagem alguma, a conexão abriu pela metade (envia, não recebe). Reabre só o socket, sem QR — no máximo
          // 2 vezes seguidas; se continuar, fica marcado para o painel mostrar e não entra em loop.
          clearTimeout(runtime.deafTimer);
          runtime.deafTimer=setTimeout(()=>{
            if(runtimeMap.get(id)!==runtime||runtime.manualStop||runtime.status!=='CONECTADO'||runtime.receiving)return;
            const n=(deafRestarts.get(id)||0)+1;deafRestarts.set(id,n);
            if(n>2){console.error(`[BAILEYS:${account.label}] conectado, mas o WhatsApp não está entregando mensagens a este aparelho (2 reaberturas não resolveram).`);return}
            console.warn(`[BAILEYS:${account.label}] conectado há 90 s sem sinal de recebimento: reabrindo a conexão (${n}/2).`);
            try{sock.end?.(new Error('DMK: conectado sem recebimento, reabrindo'))}catch{}
          },90000);
          runtime.deafTimer.unref?.();
          runtime.qrDataUrl=null;
          runtime.lastError=null;
          const userId=String(sock.user?.id||'').split('@')[0].split(':')[0];
          runtime.phone=onlyDigits(userId)||runtime.phone;
          runtime.displayName=String(sock.user?.name||runtime.displayName||'');
          await notify(account,'CONECTADO',{phone:runtime.phone,displayName:runtime.displayName,ready:true});
          console.log(`✅ WhatsApp Baileys "${account.label}" conectado: ${runtime.phone}`);
        }

        if(update.connection==='close'){
          clearTimeout(qrWatchdog);
          const err=update.lastDisconnect?.error;
          const code=statusCodeFromError(err);
          const loggedOut=code===Number(mod.DisconnectReason?.loggedOut||401);
          // DMK WhatsApp: 440 = a MESMA credencial foi aberta em outro lugar (outra VPS, cópia da pasta dados,
          // serviço duplicado). Reconectar sozinho faz os dois se derrubarem em loop e embaralha a criptografia:
          // a mensagem "vai", mas o celular do cliente fica em "Aguardando mensagem". Para e avisa.
          const replaced=code===Number(mod.DisconnectReason?.connectionReplaced||440);
          if(replaced&&!loggedOut){
            runtime.manualStop=true;
            runtime.lastError='Esta sessão foi aberta em outro lugar com a mesma credencial (código 440). Desligue a outra cópia (outra VPS ou serviço duplicado) e use Reiniciar.';
            runtime.status='SUBSTITUIDA';runtime.qrDataUrl=null;
            await notify(account,runtime.status,{error:runtime.lastError});
            if(runtimeMap.get(id)===runtime)runtimeMap.delete(id);
            runtimeMap.set(id,{...runtime,sock:null,client:null});
            console.error(`[BAILEYS:${account.label}] ${runtime.lastError}`);
            return;
          }
          if(loggedOut){runtime.manualStop=true;runtime.discardAuth=true;retryCache.clear();retryCaches.delete(id);await runtime.authWrites;fs.rmSync(dir,{recursive:true,force:true});}
          if(code===405)resetVersionCache(); // client_too_old: força revisão atual no próximo socket.
          const detail=String(err?.message||err||'').trim();
          runtime.lastError=detail?`Código ${code||'sem código'}: ${detail}`:(code?`WhatsApp encerrou a conexão (código ${code}).`:'Conexão encerrada pelo WhatsApp.');
          // DMK WhatsApp (1.3.3): toda queda vai para o journal com o código — reconexão em loop ficava invisível.
          console.warn(`[BAILEYS:${account.label}] conexão encerrada: ${runtime.lastError}${loggedOut?' — desconectado no celular, precisa de QR':' — reconectando'}`);
          runtime.status=loggedOut?'DESCONECTADO':'RECONECTANDO';
          runtime.qrDataUrl=null;
          await notify(account,runtime.status,{error:runtime.lastError});

          // O socket fechado não pode ser reutilizado. Retiramos do mapa antes de reconectar.
          if(runtimeMap.get(id)===runtime)runtimeMap.delete(id);
          if(!runtime.manualStop && !loggedOut && Number(account.enabled)!==0){
            const attempt=(reconnectAttempts.get(id)||0)+1;
            reconnectAttempts.set(id,attempt);
            const delay=Math.min(30000,2000*Math.pow(2,Math.min(attempt-1,4)));
            await runtime.flushAuth?.();
            await sleep(delay);
            if((generations.get(id)||0)===runtime.generation&&!runtime.manualStop)start(account).catch(e=>console.error(`[BAILEYS:${account.label}] reconexão:`,e.message));
          }
        }
      }catch(e){
        runtime.lastError=e.message;
        runtime.status='ERRO';
        await notify(account,'ERRO',{error:e.message});
      }
    });

    // Status de entrega/leitura das mensagens enviadas pelo operador.
    sock.ev.on('messages.update',async updates=>{
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      for(const item of updates||[]){
        try{
          const key=item?.key||{};
          // Revogação recebida do WhatsApp. Em versões atuais do Baileys,
          // REVOKE pode chegar como messages.update com message === null.
          if(key?.id && item?.update?.message===null){
            retryCache.remove(key);
            if(typeof onDelete==='function')await onDelete(account,{
              messageId:String(key.id),key,source:'messages.update'
            },runtime);
            continue;
          }
          const status=item?.update?.status;
          if(!key?.fromMe || !key?.id || status===undefined || status===null)continue;
          if(typeof onMessageStatus==='function')await onMessageStatus(account,{messageId:String(key.id),status,key,update:item.update},runtime);
        }catch(e){console.warn(`[BAILEYS:${account.label}] atualização de mensagem:`,e.message);}
      }
    });

    // Reação é um evento próprio do Baileys e não entra em messages.upsert.
    sock.ev.on('messages.reaction',async rows=>{
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      for(const item of rows||[]){
        try{
          const target=item?.key||{};
          const reaction=item?.reaction||{};
          if(!target?.id)continue;
          if(typeof onReaction==='function')await onReaction(account,{
            messageId:String(target.id),
            emoji:String(reaction?.text||''),
            targetKey:target,
            reactionKey:reaction?.key||null,
            fromMe:!!reaction?.key?.fromMe,
            actorJid:String(reaction?.key?.participant||reaction?.key?.remoteJid||'')
          },runtime);
        }catch(e){console.warn(`[BAILEYS:${account.label}] reação:`,e.message);}
      }
    });

    // Algumas compilações também expõem a revogação por messages.delete.
    sock.ev.on('messages.delete',async event=>{
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      try{
        if(event?.all)return; // limpeza local de conversa não representa uma mensagem revogada.
        for(const key of event?.keys||[]){
          if(key?.id && typeof onDelete==='function')await onDelete(account,{
            messageId:String(key.id),key,source:'messages.delete'
          },runtime);
        }
      }catch(e){console.warn(`[BAILEYS:${account.label}] exclusão:`,e.message);}
    });

    // Presença recebida do contato. O WhatsApp normalmente expira "composing" em poucos segundos.
    sock.ev.on('presence.update',packet=>{
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      try{
        const now=Date.now(),id=String(packet?.id||'');
        for(const [participant,data] of Object.entries(packet?.presences||{})){
          const state=String(data?.lastKnownPresence||data?.presence||'');
          const key=String(participant||id||'');
          if(key){runtime.presenceMap.set(key,{state,at:now});
            if(/@lid$/i.test(key))Promise.resolve(sock?.signalRepository?.lidMapping?.getPNForLID?.(key)).then(pn=>{if(pn)runtime.presenceMap.set(String(pn),{state,at:now})}).catch(()=>{});}
        }
        if(id && !Object.keys(packet?.presences||{}).length){
          const state=String(packet?.lastKnownPresence||packet?.presence||'');
          if(state)runtime.presenceMap.set(id,{state,at:now});
        }
        // "digitando/gravando" expira rápido; "online/offline" vale até a próxima mudança (máx. 10 min)
        for(const [k,v] of runtime.presenceMap){const fixo=/^(available|unavailable)$/.test(String(v?.state||''));if(now-Number(v?.at||0)>(fixo?600000:30000))runtime.presenceMap.delete(k);}
      }catch{}
    });

    // Diagnóstico: o nó bruto "message" que o servidor do WhatsApp entrega, ANTES de decifrar. Se aparece aqui e não
    // aparece como upsert, a mensagem chegou e se perdeu ao decifrar/processar; se nem aqui aparece, não chegou.
    // DMK WhatsApp (1.3.8): o WhatsApp passou a mandar o status (story) dos contatos num nó <status> solto. O Baileys
    // 7.0.0-rc14 não tem tratador para ele e nunca confirma (ack). O servidor fica esperando a confirmação, SEGURA as
    // mensagens novas da sessão ("Conectado", mas sem receber nada) e uns 50 minutos depois derruba a conexão com
    // "Stream Errored (ack)". Ao reconectar ele reenvia o mesmo <status> e o ciclo recomeça.
    // Baileys issue #2858 (correção ainda não publicada lá). Aqui o nó é confirmado na hora, sem ser lido.
    // Se uma versão futura da biblioteca já registrar o tratador, este não é registrado (não confirma duas vezes).
    try{
      const ws=sock.ws;
      if(ws?.on&&typeof sock.sendNode==='function'&&!(ws.listenerCount?.('CB:status')>0)){
        ws.on('CB:status',node=>{
          const a=node?.attrs||{};if(!a.id||!a.from)return;
          const attrs={id:String(a.id),to:String(a.from),class:'status'};
          if(a.participant)attrs.participant=String(a.participant);
          if(a.recipient)attrs.recipient=String(a.recipient);
          if(a.type)attrs.type=String(a.type);
          runtime.statusAcks=(runtime.statusAcks||0)+1;
          if(diagnostic())console.log(`[DIAG:${account.label}] nó status confirmado (tipo=${a.type||'-'}, offline=${a.offline?'sim':'não'})`);
          Promise.resolve().then(()=>sock.sendNode({tag:'ack',attrs})).catch(e=>console.warn(`[BAILEYS:${account.label}] confirmação de status não enviada: ${String(e?.message||e).slice(0,80)}`));
        });
      }
      // Quando o servidor derruba o stream ele diz o motivo; para "ack", diz qual confirmação faltou (classe e tipo).
      ws?.on?.('CB:stream:error',node=>{const r=Array.isArray(node?.content)?node.content[0]:null;console.warn(`[BAILEYS:${account.label}] o WhatsApp encerrou o stream: motivo=${r?.tag||'-'} classe=${r?.attrs?.class||'-'} tipo=${r?.attrs?.type||'-'} código=${node?.attrs?.code||'-'}`)});
      // Qualquer mensagem entregue prova que o canal de recebimento está vivo.
      ws?.on?.('CB:message',()=>{runtime.receiving=true;runtime.lastNodeAt=Date.now()});
    }catch{}
    try{sock.ws?.on?.('CB:message',node=>{if(diagnostic())console.log(`[DIAG:${account.label}] nó message de=${String(node?.attrs?.from||'').replace(/^[^@]*/,'*')} tipo=${node?.attrs?.type||'-'} offline=${node?.attrs?.offline?'sim':'não'} conteúdo=${(Array.isArray(node?.content)?node.content.map(c=>c?.tag+(c?.attrs?.type?':'+c.attrs.type:'')):[]).join(',').slice(0,80)}`)})}catch{}
    sock.ev.on('messages.upsert',async packet=>{
      // DMK WhatsApp (1.3.2): modo diagnóstico (arquivo dados/diagnostico existe) — uma linha por pacote recebido do
      // WhatsApp, só com o formato: tipo do pacote, servidor do endereço, se é nosso, stub e chaves do conteúdo. Sem texto.
      if(diagnostic()){
        for(const m of packet?.messages||[]){
          const srv=(j)=>{const v=String(j||'');return v?v.replace(/^[^@]*/,'*'):'-'};
          if(m?.message&&!m?.key?.fromMe)console.log(`[DIAG:${account.label}] estrutura recebida: ${estruturaDe(m.message).slice(0,600)}`);
          console.log(`[DIAG:${account.label}] upsert tipo=${packet?.type} jid=${srv(m?.key?.remoteJid)} alt=${srv(m?.key?.remoteJidAlt)} meu=${!!m?.key?.fromMe} stub=${m?.messageStubType??'-'}${m?.messageStubParameters?.length?'('+String(m.messageStubParameters[0]).slice(0,60)+')':''} conteudo=${Object.keys(messageContent(m)).join(',').slice(0,80)||'vazio'} atual=${runtimeMap.get(id)===runtime&&!runtime.manualStop}`);
        }
      }
      if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
      // append inclui envios próprios: serve ao reenvio, sem duplicar o atendimento.
      for(const msg of packet?.messages||[]){
        retryCache.put(msg);
        // Mensagens recebidas também precisam estar à mão para serem citadas em uma resposta.
        if(typeof msg?.key?.id==='string'&&msg.key.id&&msg.message)rememberMessage(runtime,msg);
      }
      // type=notify representa mensagem nova; append/histórico não entra no atendimento.
      if(packet?.type && packet.type!=='notify')return;
      for(const msg of packet?.messages||[]){
        try{
          // Mensagem escrita no próprio celular (fora do sistema): segue marcada com fromMe para
          // quem recebe decidir se guarda no histórico. Envios feitos pelo sistema chegam como append.
          const fromMe=!!msg?.key?.fromMe;
          const rawRemoteJid=String(msg?.key?.remoteJid||'');
          if(!isDirectIncomingJid(rawRemoteJid))continue;
          // DMK WhatsApp (1.3.1): mensagem que não pôde ser decifrada chega como "stub" CIPHERTEXT, sem conteúdo.
          // O Baileys já pede o reenvio ao celular; se ele conseguir, a mensagem chega de novo, normal. Aqui só
          // conta e avisa (antes era descartada em silêncio) — o Testar do painel mostra o total.
          if(Number(msg?.messageStubType)===2){
            // Cópia de mensagem enviada por outro aparelho da própria conta (fromMe) que não abriu: não é mensagem de
            // cliente perdida, então não conta como falha de recebimento nem vai para o aviso.
            if(msg?.key?.fromMe)continue;
            runtime.decryptFailures=(runtime.decryptFailures||0)+1;runtime.lastDecryptFailureAt=Date.now();
            console.warn(`[BAILEYS:${account.label}] mensagem recebida não pôde ser decifrada (${String(msg?.messageStubParameters?.[0]||'sem detalhe').slice(0,80)}). O WhatsApp vai pedir o reenvio ao celular.`);
            continue;
          }
          // DMK WhatsApp (1.3.9): mensagens de controle (sincronização entre os aparelhos da conta, chaves de grupo,
          // reações — tratadas em outro evento) não são conversa: saem sem aviso. O aviso fica só para formato novo.
          // DMK WhatsApp (1.3.12): voto em enquete nossa. A biblioteca entrega o voto cifrado; aqui ele é
          // decifrado com a chave guardada no envio da enquete e vira uma mensagem de texto ("Enquete X: opção").
          const voto=messageContent(msg).pollUpdateMessage;
          if(voto){
            try{
              const F=require('./whatsapp-formatos'),chaveEnquete=voto.pollCreationMessageKey||{};
              const original=retryCache.get(chaveEnquete)||(typeof loadMessage==='function'?await loadMessage(account,chaveEnquete):null);
              const enqueteMsg=original instanceof Uint8Array&&mod.proto?.Message?.decode?mod.proto.Message.decode(original):original?.message||original;
              const enquete=enqueteMsg?.pollCreationMessageV3||enqueteMsg?.pollCreationMessageV2||enqueteMsg?.pollCreationMessage;
              const segredo=enqueteMsg?.messageContextInfo?.messageSecret;
              if(enquete&&segredo&&typeof mod.decryptPollVote==='function'){
                const eu=mod.jidNormalizedUser?.(sock.user?.id)||String(sock.user?.id||'');
                const autorEnquete=chaveEnquete.fromMe?eu:String(chaveEnquete.participant||chaveEnquete.remoteJid||'');
                const votante=msg.key?.fromMe?eu:String(msg.key?.participant||msg.key?.remoteJid||'');
                const aberto=mod.decryptPollVote(voto.vote,{pollEncKey:segredo,pollCreatorJid:autorEnquete,pollMsgId:String(chaveEnquete.id||''),voterJid:votante});
                const texto=F.textoVoto(enquete,aberto?.selectedOptions||[],require('node:crypto'));
                if(typeof onMessage==='function')await onMessage(account,{
                  remoteJid:rawRemoteJid,sourceJid:String(msg?.key?.remoteJidAlt||''),phone:onlyDigits(String(msg?.key?.remoteJidAlt||rawRemoteJid).split('@')[0]),
                  name:String(msg?.pushName||''),messageId:String(msg?.key?.id||''),text:texto,fromMe:!!msg?.key?.fromMe,
                  rich:{tipo:'enquete',titulo:texto},timestamp:Number(msg?.messageTimestamp||Math.floor(Date.now()/1000)),raw:msg
                },runtime);
              }else console.warn(`[BAILEYS:${account.label}] voto em enquete recebido, mas a enquete original não está mais guardada (7 dias).`);
            }catch(e){console.warn(`[BAILEYS:${account.label}] voto em enquete não pôde ser lido: ${String(e?.message||e).slice(0,90)}`)}
            continue;
          }
          if(!supportedInboundMessage(msg)&&Object.keys(messageContent(msg)).every(k=>['protocolMessage','reactionMessage','senderKeyDistributionMessage','messageContextInfo','keepInChatMessage'].includes(k)))continue;
          if(!supportedInboundMessage(msg)){console.warn(`[BAILEYS:${account.label}] mensagem recebida em formato não tratado: ${Object.keys(messageContent(msg)).join(',').slice(0,80)||'vazia'}`);continue;}
          runtime.decryptedCount=(runtime.decryptedCount||0)+1;
          const msgId=String(msg?.key?.id||'');
          if(msgId){
            runtime.recentMessages.set(msgId,msg);
            while(runtime.recentMessages.size>500){const first=runtime.recentMessages.keys().next().value;runtime.recentMessages.delete(first);}
          }
          const identity=await resolveIncomingIdentity(sock,msg);
          const media=mediaDescriptor(msg);
          const buffer=media ? await downloadMedia(mod,sock,msg) : null;
          if(runtimeMap.get(id)!==runtime||runtime.manualStop)return;
          runtime.lastReceivedAt=Date.now();
          const unavailable=Boolean(media&&!buffer?.length);
          const text=messageText(msg)||(!media?'Conteúdo recebido pelo WhatsApp ('+Object.keys(messageContent(msg)).filter(k=>k!=='messageContextInfo').join(', ').slice(0,100)+'). Visualização deste formato indisponível.':unavailable?'Anexo recebido no WhatsApp, mas indisponível para baixar. Consulte a conversa no celular.':'');
          if(typeof onMessage==='function'){
            await onMessage(account,{
              remoteJid:identity.jid||rawRemoteJid,
              sourceJid:identity.rawJid||rawRemoteJid,
              phone:identity.phone||'',
              name:fromMe?'':String(msg?.pushName||''),
              fromMe,
              messageId:String(msg?.key?.id||''),
              text,
              botEligible:!!(messageContent(msg).conversation||messageContent(msg).extendedTextMessage||messageContent(msg).buttonsResponseMessage||messageContent(msg).templateButtonReplyMessage||messageContent(msg).listResponseMessage),
              media:media?{...media,buffer,unavailable}:null,
              // DMK WhatsApp (1.3.4): mensagem de empresa, contato ou localização também vai estruturada, para o chat desenhar o cartão.
              rich:require('./whatsapp-formatos').estrutura(messageContent(msg))||undefined,
              timestamp:Number(msg?.messageTimestamp||Math.floor(Date.now()/1000)),
              reply:quotedDescriptor(msg),
              raw:msg
            },runtime);
            runtime.lastProcessedAt=Date.now();runtime.lastReceiveError=unavailable?'Há anexo recebido que não pôde ser baixado. Confira a mensagem no celular.':'';
          }
        }catch(e){runtime.lastReceiveError='Mensagem recebida, mas o atendimento não confirmou a gravação. Confira banco e armazenamento antes de repetir.';console.error(`[BAILEYS:${account.label}] mensagem:`,e.message);}
      }
    });

    return runtime;
  }

  async function stop(account,{logout=false,deleteAuth=false}={}){
    const id=Number(account?.id||account);
    generations.set(id,(generations.get(id)||0)+1);
    await starts.get(id)?.catch(()=>{});
    const runtime=runtimeMap.get(id);
    if(runtime){
      runtime.manualStop=true;runtime.discardAuth=logout||deleteAuth;deafRestarts.delete(id);
      clearTimeout(runtime.qrWatchdog);clearTimeout(runtime.unavailableTimer);clearTimeout(runtime.deafTimer);
      await runtime.authWrites;
      try{
        if(logout && typeof runtime.sock?.logout==='function') await withTimeout(runtime.sock.logout(),5000,'Encerramento do WhatsApp');
        else if(typeof runtime.sock?.end==='function') runtime.sock.end(new Error('PDV: sessão desconectada pelo operador'));
        else runtime.sock?.ws?.close?.();
      }catch(e){console.warn('[BAILEYS] Encerramento:',e.message);try{runtime.sock?.end?.(new Error('PDV: encerramento local da sessão'));}catch{}}
      // DMK WhatsApp (1.3.5): socket fechado, espera a credencial e as chaves chegarem inteiras ao disco.
      if(!runtime.authClosed)await runtime.flushAuth?.();
      runtimeMap.delete(id);
    }
    // DMK WhatsApp: pausar/reiniciar NÃO apaga o conteúdo de reenvio — o celular do cliente pode pedir o
    // reenvio depois que a sessão volta. Só some quando a credencial é apagada (logout/troca de número).
    if(logout||deleteAuth){retryCaches.get(id)?.clear();retryCaches.delete(id);}
    reconnectAttempts.delete(id);
    noQrAttempts.delete(id);
    if(deleteAuth && account && typeof account==='object'){
      fs.rmSync(authDir(account),{recursive:true,force:true});
    }
  }

  function rememberMessage(runtime,msg){
    const id=String(msg?.key?.id||'');if(!id)return;
    runtime.recentMessages.delete(id);runtime.recentMessages.set(id,msg);
    while(runtime.recentMessages.size>2000)runtime.recentMessages.delete(runtime.recentMessages.keys().next().value);
  }
  // Mensagem citada na resposta. Usa a original quando ainda está em memória; depois de reiniciar, monta a
  // citação com o identificador e o texto guardados no atendimento (replyQuote), que é o que o WhatsApp exibe.
  function quotedFor(runtime,jid,options){
    const replyId=String(options?.replyToExternalId||'').trim();if(!replyId)return null;
    // DMK WhatsApp (1.3.10): a mensagem guardada vem endereçada pelo LID do contato (é assim que o WhatsApp a
    // entrega hoje), mas o envio vai para o número. Com endereços diferentes a biblioteca marcava a citação como
    // "de outra conversa" e o celular mostrava a resposta como mensagem comum, sem o balão citado. A citação passa
    // a usar o mesmo endereço do envio.
    const known=runtime.recentMessages?.get(replyId);
    if(known){const key={id:known.key?.id,fromMe:known.key?.fromMe===true,remoteJid:jid};return {key,message:known.message,messageTimestamp:known.messageTimestamp};}
    const q=options?.replyQuote;if(!q||typeof q!=='object')return null;
    const body=String(q.body||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ').slice(0,500)||'Mensagem';
    return {key:{remoteJid:jid,id:replyId,fromMe:q.fromMe===true},message:{conversation:body}};
  }

  // DMK WhatsApp (1.3.0): envios da MESMA sessão saem um por vez, com um intervalo mínimo entre eles
  // (rajada de envios é o que mais derruba/limita um número). Sessões diferentes não esperam umas pelas outras.
  async function confirmedSend(account,runtime,jid,content,options){
    const prev=runtime.sendChain||Promise.resolve();let release;const mine=new Promise(r=>{release=r});
    runtime.sendChain=prev.then(()=>mine);
    await prev;
    try{
      const wait=(runtime.lastSendAt||0)+Math.max(0,Number(minSendIntervalMs)||0)-Date.now();if(wait>0)await sleep(wait);
      if(runtimeMap.get(Number(account.id))!==runtime||runtime.manualStop||runtime.status!=='CONECTADO')throw Object.assign(new Error(`WhatsApp "${account.label}" não está conectado.`),{statusCode:503,operational:true});
      return await sendNow(account,runtime,jid,content,options);
    }finally{runtime.lastSendAt=Date.now();release();}
  }
  async function sendNow(account,runtime,jid,content,options){
    let result;
    // DMK WhatsApp (1.3.4): lista/botões nativos não passam pelo sendMessage da biblioteca (ela não conhece o
    // formato); a mensagem é montada aqui e entregue pelo relayMessage, com os nós extras que o WhatsApp exige.
    const enviar=()=>{if(!content?.dmkInterativa)return runtime.sock.sendMessage(jid,content,options);const F=require('./whatsapp-formatos'),msg=runtime.mod.generateWAMessageFromContent(jid,F.conteudoEnvio(content.dmkInterativa),{userJid:runtime.sock.user?.id});return Promise.resolve(runtime.sock.relayMessage(jid,msg.message,{messageId:msg.key.id,additionalNodes:F.NOS_ENVIO})).then(()=>msg)};
    try{result=await withTimeout(Promise.resolve().then(enviar),Math.max(1,Math.min(60000,Number(sendTimeoutMs)||30000)),'Envio WhatsApp')}
    catch(cause){
      runtime.lastSendError='Envio não confirmado. A mensagem pode ter sido enviada; confira a conversa antes de repetir.';
      // DMK WhatsApp: socket "zumbi" (aparece conectado, mas não responde). Dois envios seguidos sem resposta
      // derrubam só ESTE socket; ele reconecta sozinho com a credencial salva, sem pedir QR.
      if(/excedeu/.test(String(cause?.message||''))&&(runtime.sendTimeouts=(runtime.sendTimeouts||0)+1)>=2){
        runtime.sendTimeouts=0;console.warn(`[BAILEYS:${account.label}] dois envios sem resposta: reabrindo a conexão.`);
        try{runtime.sock?.end?.(new Error('DMK: conexão sem resposta, reabrindo'))}catch{}
      }
      throw Object.assign(new Error(runtime.lastSendError),{status:504,statusCode:504,operational:true,uncertain:true,cause})
    }
    runtime.sendTimeouts=0;
    const externalId=typeof result?.key?.id==='string'?result.key.id.trim():'';
    if(!externalId){runtime.lastSendError='O WhatsApp não retornou o identificador do envio. Confira a conversa antes de repetir.';throw Object.assign(new Error(runtime.lastSendError),{status:424,statusCode:424,operational:true,uncertain:true})}
    runtime.lastSendConfirmedAt=Date.now();runtime.lastSendError='';
    if(runtimeMap.get(Number(account.id))===runtime&&!runtime.manualStop){retryCaches.get(Number(account.id))?.put(result);rememberMessage(runtime,result)}
    // DMK WhatsApp: guarda o conteúdo exato (proto) em disco para responder pedidos de reenvio depois de reiniciar.
    if(typeof saveMessage==='function'&&result.message&&runtime.mod?.proto?.Message?.encode){
      try{await saveMessage(account,{key:result.key,bytes:runtime.mod.proto.Message.encode(result.message).finish()})}catch(e){console.warn('[BAILEYS] reenvio não guardado:',e.message)}
    }
    return {message:result,providerKey:result.key,externalId,uncertain:false};
  }

  async function sendText(account,number,text,options={}){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')throw new Error(`WhatsApp "${account.label}" não está conectado.`);
    const jid=await resolveOutgoingJid(runtime.sock,number);
    // DMK WhatsApp (1.3.4): lista/botões nativos, quando o sistema pede (options.interactive). O texto recebido já
    // traz as opções numeradas e é a reserva: se a biblioteca não tiver as funções, segue em texto. Experimental:
    // o WhatsApp não garante esse formato fora da API oficial.
    const nativa=options.interactive?require('./whatsapp-formatos').limparEnvio(options.interactive):null;
    if(nativa){if(typeof runtime.mod?.generateWAMessageFromContent==='function'&&typeof runtime.sock?.relayMessage==='function'){const out=await confirmedSend(account,runtime,jid,{dmkInterativa:nativa},{});return {...out,native:true}}console.warn(`[BAILEYS:${account.label}] biblioteca sem suporte a lista/botões nativos: enviando em texto.`)}
    const quoted=quotedFor(runtime,jid,options);
    // DMK WhatsApp (1.3.12): enquete, localização e contato saem pelo envio oficial da biblioteca.
    const nativo=options.native?require('./whatsapp-formatos').limparNativo(options.native):null;
    const out=await confirmedSend(account,runtime,jid,nativo?require('./whatsapp-formatos').conteudoNativo(nativo):{text:String(text||'')},quoted?{quoted}:{});
    if(diagnostic()&&options?.replyToExternalId){
      const srv=(j)=>{const v=String(j||'');return v?v.replace(/^[^@]*/,'*'):'-'},orig=runtime.recentMessages?.get(String(options.replyToExternalId));
      console.log(`[DIAG:${account.label}] resposta citada enviada: para=${srv(jid)} original=${orig?'em memória':'NÃO está em memória (citação montada pelo texto)'} endereço_original=${srv(orig?.key?.remoteJid)} alt=${srv(orig?.key?.remoteJidAlt)} minha=${quoted?.key?.fromMe} estrutura=${estruturaDe(out?.message?.message).slice(0,400)}`);
    }
    return out;
  }

  async function sendMedia(account,number,filePath,mimetype,filename,caption='',options={}){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')throw new Error(`WhatsApp "${account.label}" não está conectado.`);
    const jid=await resolveOutgoingJid(runtime.sock,number);
    const buffer=fs.readFileSync(filePath);
    const mime=String(mimetype||'application/octet-stream').toLowerCase();
    let content;
    if(mime.startsWith('image/'))content={image:buffer,caption:String(caption||'')};
    else if(mime.startsWith('video/'))content={video:buffer,mimetype,caption:String(caption||'')};
    // DMK WhatsApp (1.3.16): áudio vai como ARQUIVO por padrão; com options.voz vai como mensagem de voz
    // (aquela bolha com o play e a onda). O WhatsApp só mostra assim quando é ogg/opus.
    else if(mime.startsWith('audio/'))content={audio:buffer,mimetype,ptt:options?.voz===true};
    else content={document:buffer,mimetype,fileName:String(filename||'arquivo'),caption:String(caption||'')};
    const quoted=quotedFor(runtime,jid,options);
    return confirmedSend(account,runtime,jid,content,quoted?{quoted}:{});
  }

  async function markRead(account,number,messageKeys=[]){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')return {ok:false,supported:true};
    const jid=await resolveOutgoingJid(runtime.sock,number);
    const keys=[];
    for(const item of messageKeys||[]){
      const id=String(item?.id||item?.messageId||item||'');
      if(!id)continue;
      const original=runtime.recentMessages?.get(id);
      keys.push(original?.key||{remoteJid:jid,id,fromMe:false});
    }
    if(keys.length && typeof runtime.sock.readMessages==='function')await runtime.sock.readMessages(keys);
    return {ok:true,supported:true,count:keys.length};
  }

  async function setPresence(account,number,state='composing'){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')return {ok:false,supported:true};
    const jid=await resolveOutgoingJid(runtime.sock,number);
    if(typeof runtime.sock.sendPresenceUpdate!=='function')return {ok:false,supported:false};
    await runtime.sock.sendPresenceUpdate(String(state||'composing'),jid);
    return {ok:true,supported:true};
  }

  async function getPresence(account,number,{subscribe=true}={}){
    const runtime=runtimeMap.get(Number(account.id));
    if(!runtime||runtime.status!=='CONECTADO')return {supported:true,state:'',at:0};
    const Identity=require('./chat-contact-identity'),raw=String(number||''),keys=new Set([Identity.jid(normalizeDirectJid(raw))]);
    if(subscribe){
      // O WhatsApp só entrega "online/digitando" do contato a quem está disponível. Fica disponível apenas
      // enquanto alguém está com um atendimento aberto e volta a indisponível 90 s depois (celular volta a notificar).
      try{const now=Date.now();runtime.presenceViewAt=now;
        if(now-(runtime.availableAt||0)>45000){runtime.availableAt=now;await withTimeout(runtime.sock.sendPresenceUpdate?.('available'),3000,'Disponível')}
        clearTimeout(runtime.unavailableTimer);runtime.unavailableTimer=setTimeout(()=>{if(runtimeMap.get(Number(account.id))===runtime&&runtime.status==='CONECTADO'){runtime.availableAt=0;Promise.resolve(runtime.sock?.sendPresenceUpdate?.('unavailable')).catch(()=>{})}},90000);runtime.unavailableTimer.unref?.();
      }catch{}
      try{const resolved=await resolveOutgoingJid(runtime.sock,number);keys.add(Identity.jid(resolved));
        try{const lid=await withTimeout(runtime.sock.signalRepository?.lidMapping?.getLIDForPN?.(resolved),2000,'LID');if(lid)keys.add(Identity.jid(String(lid)))}catch{}
        const map=runtime.presenceSubscriptions||(runtime.presenceSubscriptions=new Map()),at=map.get(resolved)||0;
        if(Date.now()-at>60000){map.set(resolved,Date.now());await withTimeout(runtime.sock.presenceSubscribe?.(resolved),3000,'Presença');while(map.size>500)map.delete(map.keys().next().value)}
      }catch{}
    }
    const now=Date.now();
    let melhor=null; // a informação mais recente entre número e LID
    for(const [key,value] of runtime.presenceMap||[]){const fixo=/^(available|unavailable)$/.test(String(value?.state||''));if(now-Number(value?.at||0)>(fixo?600000:15000))continue;if(keys.has(Identity.jid(key))&&(!melhor||Number(value?.at||0)>=Number(melhor.at||0)))melhor=value}
    return melhor?{supported:true,state:String(melhor.state||''),at:Number(melhor.at||0)}:{supported:true,state:'',at:0};
  }

  // Confere o número no WhatsApp sem enviar nada: devolve o JID oficial e o LID quando o WhatsApp informa.
  async function checkNumber(account,number){
    const runtime=runtimeMap.get(Number(account.id));
    if(!runtime||runtime.status!=='CONECTADO'||typeof runtime.sock?.onWhatsApp!=='function')return {supported:false,exists:null,jid:'',lid:''};
    const raw=String(number||'').trim();let lid='';
    if(isLidJid(raw)){lid=raw;try{const pn=await withTimeout(runtime.sock.signalRepository?.lidMapping?.getPNForLID?.(raw),3000,'LID');if(!pn)return {supported:true,exists:true,jid:'',lid};number=String(pn)}catch{return {supported:true,exists:true,jid:'',lid}}}
    const digits=onlyDigits(String(number).split('@')[0].split(':')[0]);if(digits.length<10||digits.length>15)return {supported:true,exists:false,jid:'',lid};
    const rows=await withTimeout(runtime.sock.onWhatsApp(...phoneCandidates(digits)),15000,'Consulta do número no WhatsApp'),found=(rows||[]).find(r=>r?.exists&&r?.jid);
    if(!found)return {supported:true,exists:false,jid:'',lid};
    if(!lid){try{lid=String(found.lid||await withTimeout(runtime.sock.signalRepository?.lidMapping?.getLIDForPN?.(String(found.jid)),3000,'LID')||'')}catch{}}
    return {supported:true,exists:true,jid:String(found.jid),lid:isLidJid(lid)?lid:''};
  }

  async function profilePhoto(account,number){
    const runtime=runtimeMap.get(Number(account.id));if(!runtime||runtime.status!=='CONECTADO'||typeof runtime.sock?.profilePictureUrl!=='function')return {supported:false,url:''};
    try{const target=await withTimeout(resolveOutgoingJid(runtime.sock,number),3000,'Identidade da foto'),url=await withTimeout(runtime.sock.profilePictureUrl(target,'image'),3000,'Foto do contato');return {supported:true,url:require('./chat-contact-profile').safePhoto(url)}}catch{return {supported:true,url:''}}
  }

  async function react(account,number,externalMessageId,emoji){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')throw new Error(`WhatsApp "${account.label}" não está conectado.`);
    const jid=await resolveOutgoingJid(runtime.sock,number);
    const original=runtime.recentMessages?.get(String(externalMessageId||''));
    const key=original?.key || {remoteJid:jid,id:String(externalMessageId||''),fromMe:false};
    if(!key.id)throw new Error('Mensagem sem ID para reação.');
    await runtime.sock.sendMessage(jid,{react:{text:String(emoji||''),key}});
    return {ok:true};
  }

  async function deleteMessage(account,number,externalMessageId,providerKey=null){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')throw new Error(`WhatsApp "${account.label}" não está conectado.`);
    const jid=await resolveOutgoingJid(runtime.sock,number);
    const original=runtime.recentMessages?.get(String(externalMessageId||''));
    const key=original?.key || providerKey || {remoteJid:jid,id:String(externalMessageId||''),fromMe:true};
    if(!key?.id)throw new Error('Mensagem sem ID do WhatsApp para apagar.');
    const normalized={...key,remoteJid:key.remoteJid||jid,fromMe:true};
    await runtime.sock.sendMessage(normalized.remoteJid||jid,{delete:normalized});
    retryCaches.get(Number(account.id))?.remove(normalized);
    return {ok:true,supported:true,key:normalized};
  }

  // Mod 1.179: edição de mensagem enviada por este número (o WhatsApp aceita até 15 minutos depois do envio).
  async function editMessage(account,number,externalMessageId,text){
    let runtime=runtimeMap.get(Number(account.id));
    if(!runtime && Number(account.enabled)!==0)runtime=await start(account);
    if(!runtime || runtime.status!=='CONECTADO')throw new Error(`WhatsApp "${account.label}" não está conectado.`);
    const jid=await resolveOutgoingJid(runtime.sock,number);
    const original=runtime.recentMessages?.get(String(externalMessageId||''));
    const key={...(original?.key||{remoteJid:jid,id:String(externalMessageId||'')}),fromMe:true};
    if(!key.id)throw new Error('Mensagem sem ID do WhatsApp para editar.');
    await runtime.sock.sendMessage(key.remoteJid||jid,{text:String(text||''),edit:key});
    return {ok:true,supported:true};
  }

  function health(){return [...runtimeMap.values()].map(r=>({id:r.accountId,status:r.status,started_at:new Date(r.startedAt).toISOString(),uptime_seconds:Math.floor((Date.now()-r.startedAt)/1000),connected_seconds:r.status==='CONECTADO'&&r.connectedAt?Math.floor((Date.now()-r.connectedAt)/1000):null,reconnect_attempts:r.reconnectAttempt||0,last_received_at:r.lastReceivedAt?new Date(r.lastReceivedAt).toISOString():null,last_processed_at:r.lastProcessedAt?new Date(r.lastProcessedAt).toISOString():null,last_send_confirmed_at:r.lastSendConfirmedAt?new Date(r.lastSendConfirmedAt).toISOString():null,receive_error:r.lastReceiveError||'',send_error:r.lastSendError||''}))}
  return {health,start,stop,sendText,sendMedia,react,deleteMessage,editMessage,markRead,setPresence,getPresence,profilePhoto,checkNumber,authDir,resetVersionCache};
}

module.exports={createBaileysManager};

'use strict';
const ready=new WeakMap(),busy=new WeakMap();
function safePhoto(value){try{const u=new URL(String(value||''));if(u.protocol!=='https:'||u.username||u.password)return '';if(!['whatsapp.net','whatsapp.com','fbcdn.net'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return '';return u.href}catch{return ''}}
async function schema(db){if(!ready.has(db))ready.set(db,db.exec('CREATE TABLE IF NOT EXISTS chat_contact_profiles(contact_id INTEGER PRIMARY KEY REFERENCES chat_contacts(id) ON DELETE CASCADE,url TEXT NOT NULL DEFAULT \'\',checked_at INTEGER NOT NULL DEFAULT 0,next_check_at INTEGER NOT NULL DEFAULT 0)').catch(e=>{ready.delete(db);throw e}));await ready.get(db)}
async function attach(db,rows,load){await schema(db);if(!rows.length)return;const ids=[...new Set(rows.map(r=>r.contact_id).filter(Boolean))];if(!ids.length)return;const saved=await db.all('SELECT * FROM chat_contact_profiles WHERE contact_id IN ('+ids.map(()=>'?').join(',')+')',ids),map=new Map(saved.map(r=>[r.contact_id,r]));for(const row of rows)row.contact_avatar_url=safePhoto(map.get(row.contact_id)?.url);if(!load)return;
 const queue=busy.get(db)||new Set();busy.set(db,queue);let count=0;
 for(const row of rows){const old=map.get(row.contact_id);if(row.channel!=='WHATSAPP'||row.client_avatar_url||!row.whatsapp_account_id||Date.now()<Number(old?.next_check_at||0)||queue.has(row.contact_id)||queue.size>=2||count++>=2)continue;queue.add(row.contact_id);Promise.resolve().then(()=>load(row)).then(async photo=>{const now=Date.now(),url=safePhoto(photo?.url),delay=photo?.supported===false?30000:url?86400000:3600000;await db.run('INSERT INTO chat_contact_profiles(contact_id,url,checked_at,next_check_at) VALUES(?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET url=excluded.url,checked_at=excluded.checked_at,next_check_at=excluded.next_check_at',[row.contact_id,url,now,now+delay])}).catch(()=>{}).finally(()=>queue.delete(row.contact_id));
 }
}
module.exports={schema,attach,safePhoto};

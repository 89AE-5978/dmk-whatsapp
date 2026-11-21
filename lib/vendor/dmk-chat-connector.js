"use strict";
// Uma sessão central, autorizações independentes e contatos explicitamente delegados.
const crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const fail = (m, status = 400) => Object.assign(Error(m), { status });
const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const phone = (v) => String(v || "").replace(/\D/g, "");
const peer = (v) => {
  const s = String(v || "");
  if (/^\d{1,30}@lid$/.test(s)) return s;
  if (/^\d{10,15}$/.test(s)) return s + "@s.whatsapp.net";
  if (/^\d{10,15}@(s\.whatsapp\.net|c\.us)$/.test(s))
    return s.split("@")[0] + "@s.whatsapp.net";
  throw fail(
    "Use o telefone completo com DDI e DDD. LID sem telefone confirmado não pode ser delegado.",
  );
};
module.exports = function ({
  store,
  save,
  dataDir,
  send,
  status,
  actions = {},
  onAction,
  // DMK WhatsApp (1.3.0): distribuição de atendimento. Quando informado, decide quem recebe cada conversa
  // (lead novo: todos; conversa assumida: só quem assumiu) e quem pode responder. Ver lib/atendimento.js.
  route = null,
  now = Date.now,
}) {
  store.dmk_connectors ||= [];
  store.dmk_connector_delivery ||= [];
  const list = store.dmk_connectors,
    running = new Map(),
    limits = new Map();
  let sending = 0;
  const root = path.join(dataDir, "dmk-connector-media");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const mediaBudget = 256 * 1024 * 1024;
  let mediaBytes = fs
    .readdirSync(root)
    .reduce(
      (n, name) => n + Math.max(4096, fs.statSync(path.join(root, name)).size),
      0,
    );
  function removeMedia(name) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) {
      const size = Math.max(4096, fs.statSync(file).size);
      fs.rmSync(file, { force: true });
      mediaBytes = Math.max(0, mediaBytes - size);
    }
  }

  for (const g of list)
    for (const s of g.sends || [])
      if (s.state === "ENVIANDO") s.state = "INCERTO";
  const active = (g) =>
    g &&
    !g.revoked_at &&
    g.expires_at > now() &&
    (g.token_hash || (g.code_hash && g.code_expires > now()));
  const safe = (g) => ({
    id: g.id,
    label: g.label,
    installation: g.installation,
    scope: g.scope || "PHONES",
    tipo: g.tipo || "atendimento", // DMK WhatsApp: "avisos" envia sem assumir a conversa (lib/atendimento.js)
    phones: (g.peers || []).map((x) => x.split("@")[0]),
    history_pending: !!g.history && !g.history.done,
    sync_error: g.sync_error || "",
    revoked_at: g.revoked_at || null,
    expires_at: g.expires_at,
    paired: !!g.token_hash,
    code_expires: g.token_hash ? null : g.code_expires || null,
    pending: g.events.length,
    last_seen_at: g.last_seen_at || null,
    last_events_at: g.last_events_at || null,
    paired_at: g.paired_at || null,
  });
  function rate(key, max = 120) {
    const b = limits.get(key);
    if (!b || b.until < now()) {
      if (limits.size > 5000) limits.clear();
      limits.set(key, { n: 1, until: now() + 60000 });
      return;
    }
    if (++b.n > max) throw fail("Muitas solicitações. Aguarde um minuto.", 429);
  }
  function grant(b) {
    const label = String(b.label || "").trim(),
      installation = String(b.installation || "").trim();
    if (
      !label ||
      label.length > 100 ||
      !installation ||
      installation.length > 150
    )
      throw fail("Informe nome e identificação da instalação.");
    const values = Array.isArray(b.phones) ? b.phones : [];
    const shared = b.scope === "SHARED";
    if (shared && b.shared_confirmed !== true)
      throw fail(
        "Confirme que esta instalação poderá ler e responder todas as conversas do WhatsApp central.",
        409,
      );
    if (!shared && (!values.length || values.length > 100))
      throw fail("Selecione de 1 a 100 telefones autorizados.");
    const peers = shared ? [] : [...new Set(values.map(peer))];
    if (list.some((g) => active(g) && g.peers.some((p) => peers.includes(p))))
      throw fail(
        "Um contato já está delegado. Revogue a autorização anterior antes de transferir.",
        409,
      );
    if (list.length >= 500) throw fail("Limite de autorizações atingido.", 409);
    const code = crypto.randomBytes(24).toString("hex"),
      g = {
        id: crypto.randomUUID(),
        label,
        installation,
        peers,
        scope: shared ? "SHARED" : "PHONES",
        ...(b.tipo === "avisos" ? { tipo: "avisos" } : {}),
        ...(shared
          ? {
              history: {
                cutoff: now(),
                conversation: "",
                message: 0,
                done: false,
              },
              shared_confirmed_at: now(),
            }
          : {}),
        code_hash: hash(code),
        code_expires: now() + 600000,
        expires_at: now() + 90 * 86400000,
        events: [],
        sends: [],
        seq: 0,
        received: [],
      };
    list.push(g);
    save();
    return { ...safe(g), code, code_expires: g.code_expires };
  }
  function revoke(id) {
    const g = list.find((x) => x.id === id);
    if (!g) throw fail("Conector não encontrado.", 404);
    route?.liberarDe?.(g.id); // conversas que esse sistema atendia voltam para todos
    g.revoked_at = now();
    delete g.token_hash;
    delete g.code_hash;
    for (const e of g.events) if (e.media_file) removeMedia(e.media_file);
    g.events = [];
    save();
    return { ok: true };
  }
  function remove(id) {
    const g = list.find((x) => x.id === id);
    if (!g) throw fail("Conector não encontrado.", 404);
    revoke(id);
    list.splice(list.indexOf(g), 1);
    save();
    return { ok: true };
  }
  const allowed = (g, p) => g.scope === "SHARED" || g.peers.includes(p);
  const hasShared = () =>
    list.some((g) => active(g) && g.token_hash && g.scope === "SHARED");
  function remember(g, id, outgoing) {
    g.received ||= [];
    if (!g.received.includes(id)) g.received.push(id);
    if (g.received.length > 5000)
      g.received.splice(0, g.received.length - 5000);
    if (outgoing) {
      g.outgoing_ids ||= [];
      if (!g.outgoing_ids.includes(id)) g.outgoing_ids.push(id);
      if (g.outgoing_ids.length > 10000)
        g.outgoing_ids.splice(0, g.outgoing_ids.length - 10000);
    }
  }
  // Histórico vem apenas do chat Baileys já retido na central, em lotes com ACK.
  function fillHistory(g) {
    if (
      !g.history ||
      g.history.done ||
      g.events.some((e) => e.data.historical) ||
      g.events.length > 960
    )
      return;
    let count = 0;
    const cursor = g.history;
    for (const c of [...(store.sales_chats || [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (
        c.id < cursor.conversation ||
        c.expires_at <= now() ||
        c.external?.channel !== "WHATSAPP" ||
        c.external?.provider !== "BAILEYS"
      )
        continue;
      let to;
      try {
        to = peer(c.external.peer);
      } catch {
        continue;
      }
      for (const m of c.messages) {
        if (c.id === cursor.conversation && m.id <= cursor.message) continue;
        if (Date.parse(m.created_at) > cursor.cutoff) continue;
        cursor.conversation = c.id;
        cursor.message = m.id;
        if (
          !m.external_id ||
          !["staff", "visitor"].includes(m.role) ||
          g.received.includes(m.external_id)
        )
          continue;
        const data = {
          channel: "WHATSAPP",
          provider: "BAILEYS",
          peer: to,
          phone: to.endsWith("@lid") ? "" : to.split("@")[0],
          name: c.name,
          messageId: m.external_id,
          text: m.text || "",
          timestamp: Date.parse(m.created_at) / 1000,
          outgoing: m.role === "staff",
          historical: true,
        };
        const event = enqueue(g, "message", data),
          file = (store.sales_chat_media || []).find(
            (x) => x.id === m.attachment?.id && x.conversation_id === c.id,
          );
        if (
          file &&
          /^[a-f0-9-]{36}$/.test(file.id) &&
          file.size <= 10 * 1024 * 1024 &&
          fs.existsSync(path.join(dataDir, "chat-media", file.id))
        ) {
          event.history_media = { id: file.id, conversation_id: c.id };
          data.media = {
            mimetype: file.mime,
            filename: file.name,
            size: file.size,
          };
        } else if (m.attachment)
          data.text += " [Anexo histórico indisponível; consulte a central.]";
        remember(g, m.external_id, data.outgoing);
        if (++count === 30) {
          save();
          return;
        }
      }
    }
    cursor.done = true;
    g.sync_error = "";
    save();
  }
  function auth(req) {
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail("Autorização inválida.", 401);
    const g = list.find((x) => x.token_hash === hash(token));
    if (!active(g)) throw fail("Conector expirado ou revogado.", 401);
    rate(g.id, 600);
    g.last_seen_at = now();
    return g;
  }
  function enqueue(g, type, data) {
    if (g.events.length >= 1000)
      throw fail(
        "Fila do conector cheia. Reconecte o destino ou revogue a autorização.",
        503,
      );
    const e = { id: ++g.seq, type, data, at: now() };
    g.events.push(e);
    return e;
  }
  async function receive(m, sharedOnly = false) {
    const candidates = [phone(m.phone), m.peer, m.source]
      .map((v) => {
        try {
          return peer(v);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    const id = String(m.messageId || "");
    if (!id || !candidates.length) return false;
    // null = todos os destinos de sempre; Set = só estes (conversa em atendimento por um sistema).
    const only = route?.alvos ? route.alvos(candidates[0], m) : null;
    const targets = list.filter(
      (g) =>
        active(g) &&
        (!only || only.has(g.id)) &&
        (g.scope === "SHARED" ||
          (!sharedOnly && g.peers.some((p) => candidates.includes(p)))),
    );
    let handled = false;
    for (const g of targets) {
      g.received ||= [];
      if (g.received.includes(id)) continue;
      try {
        const { media, ...data } = m;
        data.peer = candidates[0];
        const e = enqueue(g, "message", data);
        if (media?.buffer?.length) {
          if (media.buffer.length > 10 * 1024 * 1024) {
            data.text =
              (data.text || "") +
              " [Anexo acima de 10 MB; consulte a central.]";
          } else if (
            mediaBytes + Math.max(4096, media.buffer.length) >
            mediaBudget
          ) {
            data.text =
              (data.text || "") +
              " [Limite da fila de anexos atingido; consulte a central.]";
          } else {
            e.media_file = crypto.randomUUID();
            try {
              fs.writeFileSync(path.join(root, e.media_file), media.buffer, {
                mode: 0o600,
                flag: "wx",
              });
              mediaBytes += Math.max(4096, media.buffer.length);
            } catch (error) {
              g.events = g.events.filter((x) => x !== e);
              fs.rmSync(path.join(root, e.media_file), { force: true });
              throw error;
            }
            data.media = {
              mimetype: media.mimetype,
              filename: String(media.filename || "anexo").slice(0, 150),
              size: media.buffer.length,
            };
          }
        }
        remember(g, id, m.outgoing);
        handled = true;
      } catch (error) {
        g.sync_error =
          "Sincronização pendente. A fila deste conector será recuperada do histórico disponível na central.";
        if (g.scope === "SHARED")
          g.history = {
            cutoff: now(),
            conversation: "",
            message: 0,
            done: false,
          };
        handled = true;
      }
    }
    if (handled) save();
    return handled;
  }
  function delivery(m) {
    let routed = false;
    for (const g of list)
      if (
        active(g) &&
        (g.sends.some((s) => s.externalId === m.messageId) ||
          (g.scope === "SHARED" && g.outgoing_ids?.includes(m.messageId)))
      ) {
        if (g.events.length < 1000) enqueue(g, "delivery", m);
        else {
          g.pending_delivery ||= {};
          g.pending_delivery[m.messageId] = m;
          const ids = Object.keys(g.pending_delivery);
          if (ids.length > 2000) delete g.pending_delivery[ids[0]];
        }
        routed = true;
      }
    if (routed) {
      save();
      return true;
    }
    if (
      !list.some(
        (g) =>
          active(g) &&
          (g.scope === "SHARED" || g.sends.some((s) => s.state === "ENVIANDO")),
      )
    )
      return false;
    // O ACK do WhatsApp pode chegar antes da resolução do envio.
    store.dmk_connector_delivery = store.dmk_connector_delivery.filter(
      (e) => e.at > now() - 86400000,
    );
    store.dmk_connector_delivery.push({ at: now(), data: m });
    if (store.dmk_connector_delivery.length > 2000)
      store.dmk_connector_delivery.splice(
        0,
        store.dmk_connector_delivery.length - 2000,
      );
    save();
    return false;
  }
  async function dispatch(g, b) {
    const to = peer(b.to);
    if (!allowed(g, to))
      throw fail("Contato não autorizado neste conector.", 403);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(b.request_id || ""))
      throw fail("Informe request_id único.");
    const text = String(b.text || "");
    if (text.length > 16000 || (!text && !b.media))
      throw fail("Mensagem vazia ou acima do limite.");
    let media;
    if (b.media) {
      const m = b.media;
      if (
        typeof m.base64 !== "string" ||
        m.base64.length > 14 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(m.base64)
      )
        throw fail("Anexo inválido.", 413);
      media = {
        buffer: Buffer.from(m.base64, "base64"),
        mimetype: String(m.mimetype || ""),
        filename: path.basename(String(m.filename || "anexo")),
      };
      if (
        !media.buffer.length ||
        media.buffer.length > 10 * 1024 * 1024 ||
        !/^(image\/(jpeg|png|webp)|audio\/[a-z0-9.+-]+|video\/mp4|application\/pdf|application\/octet-stream)$/.test(
          media.mimetype,
        )
      )
        throw fail("Tipo ou tamanho do anexo não permitido.", 413);
    }
    // Resposta citada (opcional): identificador da mensagem original, autoria e texto exibido na citação.
    let reply = null;
    if (b.reply && typeof b.reply === "object") {
      const rid = String(b.reply.id || "").trim();
      if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(rid))
        throw fail("Mensagem citada inválida.");
      reply = { id: rid, from_me: b.reply.from_me === true, body: String(b.reply.body || "").slice(0, 500) };
    }
    // DMK WhatsApp (1.3.4): lista/botões nativos (opcional, experimental). `text` continua obrigatório e já traz as
    // opções numeradas: é o que vai quando o envio nativo não é possível. Só vale sem anexo.
    const interactive = !b.media ? require("./whatsapp-formatos").limparEnvio(b.interactive) : null;
    if (b.interactive && !interactive) throw fail("Lista ou botões inválidos: informe body e de 1 a 10 itens com id e label.");
    const base = reply ? { to, text, media: b.media || null, reply } : { to, text, media: b.media || null };
    const fingerprint = hash(JSON.stringify(interactive ? { ...base, interactive } : base)),
      old = g.sends.find((s) => s.request_id === b.request_id);
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw fail("request_id reutilizado com conteúdo diferente.", 409);
      if (old.state === "ENVIADO") return { externalId: old.externalId };
      throw Object.assign(fail("Envio pendente ou incerto. Confira a central antes de repetir.",409),{uncertain:true});
    }
    if (status().status !== "CONECTADO")
      throw fail("WhatsApp central não conectado.", 503);
    // Responder um lead é assumi-lo. Conversa de outro sistema: recusa (409) sem enviar nada.
    route?.antesDeEnviar?.(g, to);
    if (g.sends.length >= 5000)
      throw fail(
        "Limite de envios da autorização atingido. Renove o conector.",
        409,
      );
    const s = {
      request_id: b.request_id,
      fingerprint,
      state: "ENVIANDO",
      at: now(),
    };
    g.sends.push(s);
    save();
    try {
      const out = await send(to, text, media, reply, interactive);
      if (!out?.externalId || out.uncertain) throw Error("Não confirmado");
      s.state = "ENVIADO";
      s.externalId = out.externalId;
      await receive(
        {
          channel: "WHATSAPP",
          provider: "BAILEYS",
          peer: to,
          phone: to.endsWith("@lid") ? "" : to.split("@")[0],
          messageId: out.externalId,
          text,
          media,
          outgoing: true,
          timestamp: now() / 1000,
        },
        true,
      );
      const pending = store.dmk_connector_delivery.filter(
        (e) => e.data.messageId === out.externalId,
      );
      store.dmk_connector_delivery = store.dmk_connector_delivery.filter(
        (e) => e.data.messageId !== out.externalId,
      );
      for (const event of pending) delivery(event.data);
      await route?.enviado?.(g, to, { externalId: out.externalId, text, media, reply });
      save();
      return { externalId: out.externalId };
    } catch (error) {
      // DMK WhatsApp (1.3.0): erro definitivo (número sem WhatsApp, sessão desconectada) não deixa o
      // request_id preso como "incerto" — antes disso o sistema repetia o mesmo ID e ficava travado em 409.
      // Só fica INCERTO quando o WhatsApp pode ter recebido (tempo esgotado, sem identificador).
      if (s.state === "ENVIADO") { save(); return { externalId: s.externalId }; }
      const definitive = !error?.uncertain && (error?.operational || /não está conectado/i.test(String(error?.message || "")));
      if (definitive) {
        g.sends.splice(g.sends.indexOf(s), 1);
        save();
        throw fail(String(error.message || "Envio recusado."), Number(error.statusCode || error.status) || 503);
      }
      s.state = "INCERTO";
      save();
      throw Object.assign(fail("Envio não confirmado. Confira o chat central antes de tentar outro envio.",409),{uncertain:true});
    }
  }
  // Mod 1.181: reação, mensagem apagada e editada valem em todos os chats compartilhados que já têm a mensagem.
  const MESSAGE_ID = /^[A-Za-z0-9_.:@-]{4,128}$/;
  const outgoingKnown = (id) =>
    list.some(
      (g) =>
        g.outgoing_ids?.includes(id) ||
        (g.sends || []).some((s) => s.externalId === id),
    );
  function relay(type, m, except) {
    const id = String(m?.messageId || "");
    if (!MESSAGE_ID.test(id)) return false;
    let to = "";
    try {
      to = peer(m.peer);
    } catch {}
    let routed = false;
    for (const g of list) {
      if (g === except || !active(g) || !g.token_hash) continue;
      // Destinos antigos recusam eventos desconhecidos: só recebe quem declarou suporte em X-DMK-Features.
      if (!(g.features || []).includes("actions")) continue;
      if (g.scope !== "SHARED" && !(to && g.peers.includes(to))) continue;
      const known =
        (g.received || []).includes(id) ||
        g.outgoing_ids?.includes(id) ||
        (g.sends || []).some((s) => s.externalId === id);
      if (!known || g.events.length >= 1000) continue;
      const data = { peer: to, messageId: id };
      if (type === "reaction") {
        data.emoji = String(m.emoji || "").slice(0, 16);
        data.fromMe = m.fromMe === true;
      }
      if (type === "edit") data.text = String(m.text || "").slice(0, 16000);
      enqueue(g, type, data);
      routed = true;
    }
    if (routed) save();
    return routed;
  }
  // 1.369: conversa excluída na central some também nos PDVs que usam este WhatsApp.
  // peers: contatos das conversas excluídas; all: todas as conversas do conector.
  // Só recebe quem declarou suporte (X-DMK-Features: purge); PDVs antigos não são afetados.
  function relayPurge({ peers = [], all = false } = {}) {
    const wanted = [];
    for (const p of peers) {
      try {
        const to = peer(p);
        if (to && !wanted.includes(to)) wanted.push(to);
      } catch {}
    }
    if (!all && !wanted.length) return 0;
    let routed = 0;
    for (const g of list) {
      if (!active(g) || !g.token_hash || !(g.features || []).includes("purge")) continue;
      const targets = all ? [null] : wanted.filter((to) => g.scope === "SHARED" || g.peers.includes(to));
      for (const to of targets) {
        if (g.events.length >= 1000) break;
        enqueue(g, "purge", all ? { all: true } : { peer: to });
        routed++;
      }
    }
    if (routed) save();
    return routed;
  }
  async function act(g, kind, b) {
    if (!actions[kind]) throw fail("Recurso indisponível na central.", 501);
    const to = peer(b.to);
    if (!allowed(g, to))
      throw fail("Contato não autorizado neste conector.", 403);
    route?.podeAgir?.(g, to); // conversa em atendimento por outro sistema: 409
    const id = String(b.messageId || "");
    if (["react", "remove", "edit"].includes(kind) && !MESSAGE_ID.test(id))
      throw fail("Informe messageId.");
    if (kind === "react") {
      const emoji = String(b.emoji || "");
      if ([...emoji].length > 8) throw fail("Reação inválida.");
      await actions.react(to, id, emoji);
      const m = { peer: to, messageId: id, emoji, fromMe: true };
      relay("reaction", m, g);
      await onAction?.("reaction", m);
    } else if (kind === "remove" || kind === "edit") {
      if (!outgoingKnown(id))
        throw fail(
          "Só dá para apagar ou editar mensagens enviadas por este número.",
          409,
        );
      const text = String(b.text || "");
      if (kind === "edit" && (!text.trim() || text.length > 16000))
        throw fail("Informe o novo texto.");
      await (kind === "edit"
        ? actions.edit(to, id, text)
        : actions.remove(to, id));
      const m = { peer: to, messageId: id, ...(kind === "edit" ? { text } : {}) };
      relay(kind === "edit" ? "edit" : "revoke", m, g);
      await onAction?.(kind === "edit" ? "edit" : "revoke", m);
    } else if (kind === "presence") {
      const state = ["composing", "recording", "paused", "available"].includes(
        b.state,
      )
        ? b.state
        : "composing";
      await actions.presence(to, state);
    } else if (kind === "read") {
      const ids = (Array.isArray(b.messageIds) ? b.messageIds : [])
        .map(String)
        .filter((x) => MESSAGE_ID.test(x))
        .slice(0, 50);
      if (ids.length) await actions.read(to, ids);
    }
    return { ok: true };
  }
  async function admin(req, p, json, body) {
    const base = "/api/reseller/communications/connectors";
    if (p !== base && !p.startsWith(base + "/")) return false;
    if (req.actor?.role !== "ADMIN")
      throw fail("Somente administradores gerenciam conectores.", 403);
    if (req.method === "GET" && p === base)
      json({ connectors: list.map(safe) });
    else if (req.method === "POST" && p === base)
      json(grant(await body(req)), 201);
    else if (req.method === "POST" && p.endsWith("/delete"))
      json(remove(p.slice(base.length + 1, -7)));
    else if (
      req.method === "POST" &&
      (p.endsWith("/revoke") || p.endsWith("/disconnect"))
    )
      json(
        revoke(p.slice(base.length + 1, p.endsWith("/disconnect") ? -11 : -7)),
      );
    else throw fail("Rota não encontrada.", 404);
    return true;
  }
  async function input(req) {
    let n = 0,
      parts = [];
    for await (const c of req) {
      n += c.length;
      if (n > 15 * 1024 * 1024) throw fail("Solicitação acima do limite.", 413);
      parts.push(c);
    }
    try {
      const b = JSON.parse(Buffer.concat(parts));
      if (!b || typeof b !== "object" || Array.isArray(b)) throw Error();
      return b;
    } catch {
      throw fail("JSON inválido.");
    }
  }
  async function publicHandle(req, p, json, _body, res) {
    const base = "/api/public/dmk-connector/v1";
    if (!p.startsWith(base + "/")) return false;
    rate("ip:" + req.socket?.remoteAddress, 1200);
    if (p === base + "/exchange" && req.method === "POST") {
      rate("exchange:" + req.socket?.remoteAddress, 20);
      const b = await input(req),
        g = list.find((g) => g.code_hash === hash(b.code || ""));
      if (!active(g) || g.code_expires < now())
        throw fail("Código inválido, utilizado ou expirado.", 401);
      if (g.scope === "SHARED" && b.protocol !== 2)
        throw fail(
          "Atualize o sistema de destino para usar o canal compartilhado.",
          409,
        );
      const token = crypto.randomBytes(32).toString("hex");
      g.token_hash = hash(token);
      g.paired_at = now(); // DMK WhatsApp (1.3.6): desde quando o sistema está ligado (ver soEnvia em lib/atendimento.js)
      delete g.code_hash;
      save();
      json({ token, connector: safe(g) });
      return true;
    }
    const g = auth(req);
    if (req.method === "GET" && p === base + "/events") {
      // DMK WhatsApp (1.3.6): quando este sistema BUSCOU mensagens pela última vez. É diferente de last_seen_at,
      // que muda em qualquer pedido (inclusive só enviar). Gravado no máximo a cada 30 s.
      if (!g.last_events_at || now() - g.last_events_at > 30000) { g.last_events_at = now(); save(); }
      const features = String(req.headers?.["x-dmk-features"] || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^[a-z]{1,20}$/.test(x))
        .slice(0, 10);
      if (features.join() !== (g.features || []).join()) {
        g.features = features;
        save();
      }
      fillHistory(g);
      if (g.events.length < 900 && g.pending_delivery) {
        for (const [id, event] of Object.entries(g.pending_delivery).slice(
          0,
          30,
        )) {
          enqueue(g, "delivery", event);
          delete g.pending_delivery[id];
        }
        save();
      }
      const events = g.events.some((e) => e.data.historical)
        ? g.events.filter((e) => e.data.historical)
        : g.events;
      json({
        history_pending: !!g.history && !g.history.done,
        sync_error: g.sync_error || "",
        events: events
          .slice(0, 30)
          .map(({ media_file, history_media, ...e }) => e),
        status: { status: status().status, phone: status().phone || "" },
      });
      return true;
    }
    if (req.method === "POST" && p === base + "/ack") {
      const b = await input(req);
      if (
        !Array.isArray(b.ids) ||
        b.ids.length > 30 ||
        b.ids.some(
          (id) =>
            !Number.isSafeInteger(id) || !g.events.some((e) => e.id === id),
        )
      )
        throw fail("Confirme somente eventos consultados.");
      for (const e of g.events.filter((e) => b.ids.includes(e.id)))
        if (e.media_file) removeMedia(e.media_file);
      g.events = g.events.filter((e) => !b.ids.includes(e.id));
      save();
      json({ ok: true });
      return true;
    }
    if (req.method === "POST" && p === base + "/send") {
      if (sending >= 5)
        throw fail("Fila de envio ocupada. Aguarde antes de enviar.", 429);
      sending++;
      let b;
      try {
        b = await input(req);
      } catch (e) {
        sending--;
        throw e;
      }
      const prior = running.get("send") || Promise.resolve(),
        work = prior
          .catch(() => {})
          .then(() => {
            if (!active(g)) throw fail("Conector revogado.", 401);
            return dispatch(g, b);
          });
      running.set("send", work);
      try {
        json(await work);
      } catch(error) {
        if(!error.uncertain)throw error;
        json({error:error.message,delivery_uncertain:true},error.status||409);
      } finally {
        sending--;
        if (running.get("send") === work) running.delete("send");
      }
      return true;
    }
    const kind = {
      "/react": "react",
      "/delete": "remove",
      "/edit": "edit",
      "/presence": "presence",
      "/read": "read",
    }[p.slice(base.length)];
    if (req.method === "POST" && kind) {
      rate("act:" + g.id, kind === "presence" ? 600 : 240);
      json(await act(g, kind, await input(req)));
      return true;
    }
    // Mod 1.181: "digitando…"/"gravando…" do cliente, lido da sessão central para o chat conectado mostrar.
    if (req.method === "GET" && p === base + "/presence") {
      rate("presence:" + g.id, 900);
      if (!actions.getPresence) throw fail("Recurso indisponível na central.", 501);
      const to = peer(new URL(req.url, "http://x").searchParams.get("to"));
      if (!allowed(g, to))
        throw fail("Contato não autorizado neste conector.", 403);
      const r = (await actions.getPresence(to)) || {};
      json({ state: ["composing", "recording"].includes(r.state) ? r.state : "", at: Number(r.at) || 0 });
      return true;
    }
    // Mod 1.181: foto de perfil do contato (lida pela sessão central; 204 quando não há foto).
    if (req.method === "GET" && p === base + "/photo") {
      rate("photo:" + g.id, 300);
      const to = peer(new URL(req.url, "http://x").searchParams.get("to"));
      if (!allowed(g, to))
        throw fail("Contato não autorizado neste conector.", 403);
      const f = actions.photo ? await actions.photo(to) : null;
      // ?format=url: só o endereço da foto no WhatsApp (o PDV mostra direto no navegador)
      if (new URL(req.url, "http://x").searchParams.get("format") === "url") {
        json({ url: f?.url || "" });
        return true;
      }
      if (!f?.data?.length) {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
        return true;
      }
      res.writeHead(200, { "Content-Type": f.type, "Content-Length": f.data.length, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
      res.end(f.data);
      return true;
    }
    // DMK WhatsApp (1.3.0): rotas de atendimento (assumir, finalizar, conversas, histórico, arquivos).
    if (route?.handle && (await route.handle(g, req, p.slice(base.length), json, res, input))) return true;
    const m = new RegExp("^" + base + "/media/(\\d+)$").exec(p);
    if (req.method === "GET" && m) {
      const e = g.events.find((e) => e.id === Number(m[1]));
      let file = e?.media_file ? path.join(root, e.media_file) : null;
      if (
        e?.history_media &&
        store.sales_chat_media?.some(
          (m) =>
            m.id === e.history_media.id &&
            m.conversation_id === e.history_media.conversation_id,
        )
      )
        file = path.join(dataDir, "chat-media", e.history_media.id);
      if (!file || !fs.existsSync(file))
        throw fail("Anexo não encontrado.", 404);
      const b = fs.readFileSync(file);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(b);
      return true;
    }
    throw fail("Rota não encontrada.", 404);
  }
  // Aviso de atendimento (assumida/liberada) só para quem declarou X-DMK-Features: routing.
  // Destinos antigos recusam eventos desconhecidos; para eles basta parar de receber a conversa.
  function notify(type, data, filter = () => true) {
    let n = 0;
    for (const g of list) {
      if (!active(g) || !g.token_hash || !(g.features || []).includes("routing") || !filter(g)) continue;
      if (g.events.length >= 1000) continue;
      enqueue(g, type, data);
      n++;
    }
    if (n) save();
    return n;
  }
  // DMK WhatsApp: muda o tipo da conexão (atendimento | avisos) sem trocar a credencial.
  function setTipo(id, tipo) {
    const g = list.find((x) => x.id === id);
    if (!g) throw fail("Conector não encontrado.", 404);
    if (!["atendimento", "avisos"].includes(tipo)) throw fail('Tipo inválido: use "atendimento" ou "avisos".');
    if (tipo === "avisos") g.tipo = "avisos"; else delete g.tipo;
    save();
    return safe(g);
  }
  // DMK WhatsApp (1.3.8): tira da fila de uma conexão os eventos que ela nunca vai ler (ver lib/atendimento.js).
  function dropEvents(id, keep) {
    const g = list.find((x) => x.id === id);
    if (!g) return 0;
    const antes = g.events.length;
    for (const e of g.events) if (!keep(e) && e.media_file) removeMedia(e.media_file); // o anexo da fila sai junto
    g.events = g.events.filter(keep);
    if (g.events.length !== antes) save();
    return antes - g.events.length;
  }
  return {
    dropEvents,
    notify,
    setTipo,
    grantById: (id) => list.find((g) => g.id === id && active(g)) || null,
    grant,
    revoke,
    remove,
    hasShared,
    receive,
    delivery,
    relayReaction: (m) => relay("reaction", m),
    relayRevoke: (m) => relay("revoke", m),
    relayPurge,
    relayEdit: (m) => relay("edit", m),
    admin,
    publicHandle,
    list: () => list.map(safe),
  };
};

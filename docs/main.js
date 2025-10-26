// main.js — PoC Streamer.bot client (mimic jbs_dashboard behavior)
// - auto scheme (ws/wss), endpoint '/', subscribe '*', immediate:true
// - resolve action by GUID or name (case-insensitive optional)
// - doAction with fallback raw WS frame
// - debug logging + socket event hooks
(() => {
  "use strict";

  const $ = (s, r=document) => r.querySelector(s);

  // UI elements
  const logEl = $("#log");
  const statusEl = $("#conn-status");
  const btnDo = $("#btn-doaction");
  const connForm = $("#conn-form");
  const hostInput = $("#host");
  const portInput = $("#port");
  const pwdInput  = $("#password");
  const actionInput = $("#action-input");
  const payloadInput = $("#payload-json");
  const caseInsensitiveInput = $("#case-insensitive");

  // localStorage keys
  const LS_PWD_KEY = "poc_sb_password_v1";

  // state
  let client = null;
  let connected = false;

  // helpers
  function log(...args){
    try {
      const msg = args.map(v => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join(' ');
      const t = new Date().toISOString().replace('T',' ').replace('Z','');
      logEl.textContent += `[${t}] ${msg}\n`;
      logEl.scrollTop = logEl.scrollHeight;
      // keep console in sync for easier debugging
      console.log(...args);
    } catch(e){ console.log("log fail", e); }
  }

  function setStatus(cls, text){
    statusEl.classList.remove('on','off','err');
    statusEl.classList.add(cls);
    statusEl.textContent = text;
  }

  // persist password convenience
  function savePwd(pwd){
    try { localStorage.setItem(LS_PWD_KEY, pwd || ""); } catch {}
  }
  function loadPwd(){
    try { return localStorage.getItem(LS_PWD_KEY) || ""; } catch { return ""; }
  }

  // small GUID detection
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---------- Create / connect client (mimic jbs_dashboard) ----------
  async function connect(){
    const host = (hostInput.value || "127.0.0.1").trim();
    const port = parseInt(portInput.value || "8080", 10) || 8080;
    // priority: input field > querystring pwd > localStorage
    const qs = new URLSearchParams(location.search);
    const pwdQs = qs.get("pwd") || qs.get("password") || "";
    const pwdField = (pwdInput.value || "").trim();
    const password = pwdField || pwdQs || loadPwd() || undefined;

    // store the password for convenience (so dashboard reconnects on reload)
    if (pwdField) savePwd(pwdField);

    // choose scheme according to page protocol to avoid mixed content
    // const scheme = (location.protocol === 'https:') ? 'wss' : 'ws';

    // if existing client, try to disconnect cleanly
    if (client && typeof client.disconnect === 'function') {
      try { client.disconnect(); } catch (err) { /* ignore */ }
      client = null;
      connected = false;
      setStatus('off', 'Déconnecté');
    }

    try {
      // instantiate StreamerbotClient with options similar to jbs_dashboard
      client = new StreamerbotClient({
        host,
        port,
        endpoint: '/',        // explicit endpoint like jbs_dashboard
        password,
        subscribe: '*',       // auto-subscribe to everything (helpful)
        //scheme,               // 'wss' if page served via https
        immediate: true,      // connect immediately
        autoReconnect: true,
        retries: -1,
        log: false,
        // lifecycle handlers (the lib also supports onConnect/onDisconnect/onError)
        onConnect: (info) => {
          connected = true;
          setStatus('on', `Connecté (${host}:${port})`);
          btnDo.disabled = false;
          log('✅ onConnect:', info || '(no info)');
        },
        onDisconnect: (evt) => {
          connected = false;
          setStatus('off', 'Déconnecté');
          btnDo.disabled = true;
          log('❌ onDisconnect', evt || '');
        },
        onError: (err) => {
          connected = false;
          setStatus('err', 'Erreur WS');
          btnDo.disabled = true;
          log('⚠️ onError', err);
        }
      });

      // The lib may connect automatically due to immediate:true.
      // If connect() is available and needed, call it to be explicit.
      if (typeof client.connect === 'function') {
        try {
          await client.connect();
        } catch (e) {
          // some builds auto-connect and throw if called twice; ignore if so
          log('Info: client.connect() threw (ignored):', e);
        }
      }

      // attach low-level socket diagnostics (if exposed)
      try {
        const sock = client.socket;
        if (sock) {
          // avoid double-binding on reconnects
          if (!sock._poc_debug) {
            sock._poc_debug = true;
            sock.addEventListener('open', () => {
              try { log('Socket open — url:', sock.url || sock._url || '(not available)'); } catch {}
            });
            sock.addEventListener('close', (ev) => {
              log(`Socket close code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`);
            });
            sock.addEventListener('error', (ev) => {
              log('Socket error event:', ev);
            });
            // message debug optional:
            // sock.addEventListener('message', (m) => log('raw sock msg', m.data));
          }
        } else {
          log('Note: client.socket not exposed by this build (no low-level socket hooks).');
        }
      } catch(e){
        log('Low-level socket diagnostics unavailable:', e);
      }

      log(`Tentative de connexion → ${scheme}://${host}:${port} (endpoint: /)`);
    } catch(err){
      setStatus('err','Erreur WS');
      log('❌ Échec connexion (instanciation):', err);
    }
  }

  // ---------- Resolve action ID (accept GUID or name) ----------
  async function resolveActionId(input, caseInsensitive){
    const s = (input || "").trim();
    if (!s) throw new Error("Action ID/Nom requis");

    if (GUID_RE.test(s)) {
      return s; // already GUID
    }

    if (!client || typeof client.getActions !== 'function') {
      throw new Error("Client non initialisé ou getActions() indisponible");
    }

    // fetch actions list (note: may be large)
    let actions;
    try {
      const res = await client.getActions();
      // res can be { actions: [...] } or an array depending on version — normalize
      actions = (res && res.actions) ? res.actions : res;
    } catch(e){
      log('Erreur getActions():', e);
      throw new Error('Impossible de récupérer la liste des actions');
    }

    if (!Array.isArray(actions)) throw new Error('Liste d\'actions invalide depuis client');

    let match;
    if (caseInsensitive) {
      const t = s.toLowerCase();
      match = actions.find(a => (a.name || '').toLowerCase() === t);
    } else {
      match = actions.find(a => a.name === s);
    }

    if (!match) throw new Error(`Action introuvable par nom: "${s}"`);
    return match.id;
  }

  // ---------- raw fallback: send WebSocket frame "DoAction" ----------
  // Some server/client combos accept a raw "DoAction" request over WS.
  // This function tries to send the raw JSON frame if client.doAction fails or is absent.
  function sendRawDoAction(actionId, args) {
    try {
      // Build the raw request body following Streamer.bot websocket protocol.
      // Example frame: { request: "DoAction", id: "SomeId", action: { id: "GUID" }, args: { ... } }
      const frame = {
        request: "DoAction",
        id: "DoAction", // arbitrary request id
        action: { id: actionId },
        args: args || {}
      };
      const payload = JSON.stringify(frame);

      // Attempt to use client.socket if available, else client.rawSend or client.send
      if (client && client.socket && typeof client.socket.send === 'function') {
        client.socket.send(payload);
        log('Fallback raw DoAction envoyé via socket:', frame);
        return true;
      }

      // some builds expose low-level send methods
      if (client && typeof client.send === 'function') {
        client.send(payload);
        log('Fallback raw DoAction envoyé via client.send:', frame);
        return true;
      }
      if (client && typeof client.rawSend === 'function') {
        client.rawSend(payload);
        log('Fallback raw DoAction envoyé via client.rawSend:', frame);
        return true;
      }

      log('Aucune méthode low-level disponible pour envoyer la frame brute DoAction.');
      return false;
    } catch (e) {
      log('Erreur sendRawDoAction():', e);
      return false;
    }
  }

  // ---------- perform the action (prefers client.doAction, fallback raw) ----------
  async function doAction(){
    if (!client || !connected && !(client && client.immediate)) {
      // even if immediate was true, onConnect might not yet fired; still attempt if socket present
      log('Pas connecté (ou client pas prêt). Tente quand même si socket exposée.');
    }

    const actionInputVal = (actionInput.value || "").trim();
    if (!actionInputVal) { log('❌ Action ID/Nom requis'); return; }

    // parse payload JSON
    let obj;
    try {
      obj = JSON.parse((payloadInput.value || "{}"));
      if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('payload doit être un objet JSON');
    } catch(e){
      log('❌ JSON invalide dans Payload:', e.message || e);
      return;
    }

    // send everything inside a single payload field (stringified) — generic approach
    const args = { payload: JSON.stringify(obj) };

    // resolve action ID (if name given)
    let actionId;
    try {
      actionId = await resolveActionId(actionInputVal, !!caseInsensitiveInput.checked);
    } catch(e) {
      log('❌ Impossible de résoudre action:', e.message || e);
      return;
    }

    // attempt high-level API first
    try {
      if (typeof client.doAction === 'function') {
        log('➡️ doAction (high-level) →', { actionId, argsPreview: obj });
        const res = await client.doAction(actionId, args);
        log('⬅️ doAction response ←', res);
        return;
      } else {
        log('Info: client.doAction() non disponible, utilisation du fallback raw.');
      }
    } catch (err) {
      log('⚠️ client.doAction() a levé:', err);
      // fallthrough to fallback raw
    }

    // fallback: raw WS frame
    const fallbackOk = sendRawDoAction(actionId, args);
    if (!fallbackOk) {
      log('❌ Fallback DoAction a échoué — aucune méthode d\'envoi disponible.');
    }
  }

  // ---------- UI wiring ----------
  // submit form to connect (prevents password input warning)
  if (connForm) {
    connForm.addEventListener('submit', (e) => {
      e.preventDefault();
      connect();
    });
  }

  if (btnDo) btnDo.addEventListener('click', (e) => { e.preventDefault(); doAction(); });

  // quick QS helpers (prefill)
  try {
    const qs = new URLSearchParams(location.search);
    const host = qs.get('host'); if (host) hostInput.value = host;
    const port = qs.get('port'); if (port) portInput.value = port;
    const action = qs.get('action'); if (action) actionInput.value = action;
    const pwd = qs.get('pwd') || qs.get('password'); if (pwd) { pwdInput.value = pwd; savePwd(pwd); }
    // if password in localStorage populate field
    const saved = loadPwd(); if (saved && !pwdInput.value) pwdInput.value = saved;
  } catch(e){ /* ignore */ }

  // expose for debug in console
  window.POC_SB = {
    getClient: () => client,
    connect,
    doAction,
    sendRawDoAction
  };

  // initial UI state
  setStatus('off', 'Déconnecté');
  btnDo.disabled = true;

  log('main.js ready — waiting for connect.');
})();

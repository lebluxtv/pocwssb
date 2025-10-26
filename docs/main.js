(() => {
  "use strict";
  const $ = (s, r=document) => r.querySelector(s);
  const logEl = $("#log"), statusEl = $("#conn-status");
  const btnDo = $("#btn-doaction");
  let client = null, connected = false;

  // ======== helpers ========
  function log(...args){
    const msg = args.map(v => typeof v === 'string' ? v : JSON.stringify(v, null, 2)).join(' ');
    const t = new Date().toISOString().replace('T',' ').replace('Z','');
    logEl.textContent += `[${t}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(cls, text){
    statusEl.classList.remove('on','off','err');
    statusEl.classList.add(cls);
    statusEl.textContent = text;
  }
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ======== connexion ========
  async function connect(){
    const host = $("#host").value.trim() || "127.0.0.1";
    const port = parseInt($("#port").value, 10) || 8080;
    const password = $("#password").value || undefined;

    try{
      if (client) client.disconnect?.();
      client = new StreamerbotClient({ host, port, password, type:'ws', autoConnect:false });

      client.on('open', () => {
        connected = true;
        setStatus('on','Connecté');
        btnDo.disabled = false;
        log('✅ WebSocket ouvert');
      });
      client.on('close', () => {
        connected = false;
        setStatus('off','Déconnecté');
        btnDo.disabled = true;
        log('❌ WebSocket fermé');
      });
      client.on('error', (e) => {
        setStatus('err','Erreur WS');
        log('⚠️ WebSocket error:', String(e));
      });

      log(`Connexion à ws://${host}:${port}`);
      await client.connect();
    }catch(err){
      setStatus('err','Erreur WS');
      log('❌ Échec connexion:', err);
    }
  }

  // Résout l'entrée utilisateur (GUID ou nom) vers un ID d'action
  async function resolveActionId(input, caseInsensitive){
    const s = (input || "").trim();
    if (!s) throw new Error("Action ID/Nom requis");

    if (GUID_RE.test(s)) return s; // déjà un GUID

    // sinon, chercher par nom
    log(`Recherche de l'action par nom: "${s}"`);
    const { actions } = await client.getActions(); // retourne [{id,name}, ...]
    let match;
    if (caseInsensitive){
      const target = s.toLowerCase();
      match = actions.find(a => (a.name || "").toLowerCase() === target);
    } else {
      match = actions.find(a => a.name === s);
    }
    if (!match) throw new Error(`Action introuvable par nom: "${s}"`);
    log(`Action trouvée → id=${match.id}, name="${match.name}"`);
    return match.id;
  }

  // ======== doAction ========
  async function doAction(){
    if (!connected || !client){ log('Pas connecté'); return; }
    const actionInput = $("#action-input").value;
    const caseInsensitive = $("#case-insensitive").checked;

    let obj;
    try{
      obj = JSON.parse($("#payload-json").value || "{}");
      if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('payload doit être un objet JSON');
    }catch(e){ log('❌ JSON invalide:', e.message); return; }

    // Tout est envoyé dans "payload" (string JSON)
    const args = { payload: JSON.stringify(obj) };

    try{
      const actionId = await resolveActionId(actionInput, caseInsensitive);
      log('➡️ DoAction →', { actionId, argsPreview: obj });
      const res = await client.doAction(actionId, args);   // signature correcte
      log('⬅️ DoAction ←', res);
    }catch(e){
      log('❌ DoAction a échoué:', e.message || e);
    }
  }

  // ======== listeners ========
  $("#conn-form").addEventListener("submit", e => { e.preventDefault(); connect(); });
  btnDo.addEventListener("click", doAction);

  // QS helpers ?host=&port=&action=
  try{
    const qs = new URLSearchParams(location.search);
    const host = qs.get('host'); if (host) $("#host").value = host;
    const port = qs.get('port'); if (port) $("#port").value = port;
    const action = qs.get('action'); if (action) $("#action-input").value = action;
  }catch{}
})();

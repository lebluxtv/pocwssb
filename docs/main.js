(() => {
  "use strict";
  const $ = (s, r=document) => r.querySelector(s);
  const logEl = $("#log"), statusEl = $("#conn-status");
  const btnConnect = $("#btn-connect"), btnDo = $("#btn-doaction");
  let client = null, connected = false;

  function log(...args){
    const msg = args.map(v => typeof v === 'string' ? v : JSON.stringify(v, null, 2)).join(' ');
    const t = new Date().toISOString().replace('T',' ').replace('Z','');
    logEl.textContent += `[${t}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(cls, text){
    statusEl.classList.remove('on','off','err'); statusEl.classList.add(cls);
    statusEl.textContent = text;
  }

  async function connect(){
    const host = $("#host").value.trim() || "127.0.0.1";
    const port = parseInt($("#port").value, 10) || 8080;
    const password = $("#password").value || undefined;

    // NOTE: depuis une page HTTPS (GitHub Pages), ws:// sera BLOQUÉ.
    // Teste en HTTP local ou mets un proxy WSS (hors scope PoC).
    try{
      if (client) client.disconnect?.();
      client = new StreamerbotClient({ host, port, password, type:'ws', autoConnect:false });

      client.on('open', () => { connected = true; setStatus('on','Connecté'); btnDo.disabled = false; log('WS ouvert'); });
      client.on('close', () => { connected = false; setStatus('off','Déconnecté'); btnDo.disabled = true; log('WS fermé'); });
      client.on('error', (e) => { setStatus('err','Erreur WS'); log('WS error:', String(e)); });

      log(`Connexion à ws://${host}:${port}`);
      await client.connect();
    }catch(err){ setStatus('err','Erreur WS'); log('Échec connexion:', err); }
  }

  async function doAction(){
    if (!connected || !client){ log('Pas connecté'); return; }
    const actionId = $("#action-id").value.trim();
    if (!actionId){ log('❌ Action ID requis'); return; }

    let obj;
    try{
      obj = JSON.parse($("#payload-json").value || "{}");
      if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('payload doit être un objet JSON');
    }catch(e){ log('❌ JSON invalide:', e.message); return; }

    // On envoie TOUT dans un seul champ "payload" (string) → ultra générique
    const args = { payload: JSON.stringify(obj) };

    try{
      log('DoAction →', { actionId, argsPreview: obj });
      const res = await client.doAction({ id: actionId }, args);
      log('DoAction ←', res);
    }catch(e){ log('❌ DoAction a échoué:', e.message || e); }
  }

  btnConnect.addEventListener('click', connect);
  btnDo.addEventListener('click', doAction);

  // QS helpers ?host=&port=&actionId=
  try{
    const qs = new URLSearchParams(location.search);
    const host = qs.get('host'); if (host) $("#host").value = host;
    const port = qs.get('port'); if (port) $("#port").value = port;
    const aid  = qs.get('actionId'); if (aid) $("#action-id").value = aid;
  }catch{}
})();

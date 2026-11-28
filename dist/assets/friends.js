// Freundschaften zwischen registrierten Mitgliedern: Suche, Freundschaftsanfragen, Freundesliste.
// Gemeinsam genutzt von der Startseite (index.html, „Freundschaften“) und vom Pause-Menü im Spiel.
// Liegt in /assets/ (öffentlich), die Daten kommen aber nur mit Anmeldung (/api/friends …).

export async function friendsApi(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler bei der Anfrage.');
  return data;
}

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
.fr{color:#fff;text-align:left}
.fr-search{position:relative;display:flex;align-items:center;gap:10px;padding:4px 6px 4px 14px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22)}
.fr-search:focus-within{border-color:#ff8de9;box-shadow:0 0 0 3px rgba(255,141,233,.18)}
.fr-search svg{flex:0 0 18px;width:18px;height:18px;fill:none;stroke:#cfc6e6;stroke-width:2.2;stroke-linecap:round}
.fr-search input{flex:1;min-width:0;padding:9px 4px;font:inherit;font-size:16px;color:#fff;background:transparent;border:0;outline:none}
.fr-search input::placeholder{color:#9d92bd}
.fr-msg{min-height:1.35em;margin:8px 2px 4px;font-size:13.5px;color:#9d92bd}
.fr-msg.ok{color:#86efac}.fr-msg.err{color:#fca5a5}
.fr-sec{margin:16px 0 6px;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ff9be9}
.fr-list{display:flex;flex-direction:column;gap:6px}
.fr-row{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.fr-row.inc{background:rgba(255,141,233,.12);border-color:rgba(255,141,233,.4)}
.fr-ava{flex:0 0 34px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;background:linear-gradient(160deg,#2a1650,#7a2c8f 55%,#ff8a3d);position:relative}
.fr-ava i{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;border:2px solid #1d1033;background:#6b6585}
.fr-ava i.on{background:#4ade80}
.fr-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fr-name b{font-size:15.5px}
.fr-name small{display:block;font-size:12px;opacity:.7}
.fr-rank{margin-left:6px;padding:1px 7px;font-size:11px;font-weight:700;border-radius:999px;background:rgba(255,255,255,.18)}
.fr-rank.Sysadmin{background:#dc2626}.fr-rank.Admin{background:#d97706}.fr-rank.Spieler{background:#2563eb}
.fr-btns{display:flex;gap:6px;flex:0 0 auto}
.fr-btn{padding:7px 12px;font:inherit;font-size:13px;font-weight:700;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.28);border-radius:9px;cursor:pointer;white-space:nowrap}
.fr-btn:hover:not(:disabled){background:rgba(255,255,255,.2)}
.fr-btn.go{background:#7c3aed;border-color:#a78bfa}.fr-btn.go:hover:not(:disabled){background:#8b5cf6}
.fr-btn.yes{background:#16a34a;border-color:#4ade80}.fr-btn.yes:hover:not(:disabled){background:#22c55e}
.fr-btn.no{background:rgba(220,38,38,.6);border-color:#f87171}.fr-btn.no:hover:not(:disabled){background:#dc2626}
.fr-btn:disabled{opacity:.55;cursor:default}
.fr-empty{padding:10px 2px;font-size:14px;opacity:.7}
`;
  document.head.appendChild(st);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const waitText = (ms) => { const min = Math.max(1, Math.ceil(ms / 60000)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} Std.${m ? ' ' + m + ' Min.' : ''}` : `${m} Min.`; };

// Baut die Freundes-Ansicht in root. opts.onChange(data) meldet jede neue Übersicht (z. B. für Zähler).
export function renderFriends(root, { onChange = () => {} } = {}) {
  injectStyle();
  root.textContent = '';
  const wrap = el('div', 'fr');
  const search = el('label', 'fr-search');
  search.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
  const input = el('input');
  input.type = 'search'; input.placeholder = 'Mitglied suchen (Accountname) …'; input.maxLength = 16; input.autocomplete = 'off'; input.spellcheck = false;
  search.append(input);
  const msg = el('div', 'fr-msg');
  const results = el('div', 'fr-list');
  const body = el('div');
  wrap.append(search, msg, results, body);
  root.append(wrap);

  let data = null, timer = 0, seq = 0, alive = true;
  const say = (t, kind = '') => { msg.textContent = t || ''; msg.className = 'fr-msg' + (kind ? ' ' + kind : ''); };

  const avatar = (name, online) => { const a = el('div', 'fr-ava', (name || '?').charAt(0).toUpperCase()); if (online !== undefined) { const i = el('i', online ? 'on' : ''); i.title = online ? 'online' : 'offline'; a.append(i); } return a; };
  const nameCell = (name, rank, sub) => { const n = el('div', 'fr-name'); const b = el('b', '', name); n.append(b); if (rank) n.append(el('span', 'fr-rank ' + rank, rank)); if (sub) n.append(el('small', '', sub)); return n; };
  const btn = (label, cls, fn) => { const b = el('button', 'fr-btn ' + (cls || ''), label); b.type = 'button'; if (fn) b.addEventListener('click', fn); else b.disabled = true; return b; };

  async function act(path, payload, okText) {
    try {
      const r = await friendsApi(path, 'POST', payload);
      if (okText) say(typeof okText === 'function' ? okText(r) : okText, 'ok');
      await refresh();
      if (input.value.trim().length >= 2) runSearch();
    } catch (e) { say(e.message, 'err'); }
  }
  const respond = (req, accept) => act('/api/friends/respond', { id: req.id, accept }, accept ? `Du bist jetzt mit ${req.from.name} befreundet.` : `Anfrage von ${req.from.name} abgelehnt.`);

  function drawBody() {
    body.textContent = '';
    if (!data) return;
    if (data.incoming.length) {
      body.append(el('div', 'fr-sec', 'Freundschaftsanfragen'));
      const l = el('div', 'fr-list');
      for (const r of data.incoming) {
        const row = el('div', 'fr-row inc');
        const bs = el('div', 'fr-btns');
        bs.append(btn('Annehmen', 'yes', () => respond(r, true)), btn('Ablehnen', 'no', () => respond(r, false)));
        row.append(avatar(r.from.name), nameCell(r.from.name, '', 'möchte mit dir befreundet sein'), bs);
        l.append(row);
      }
      body.append(l);
    }
    body.append(el('div', 'fr-sec', `Deine Freunde (${data.friends.length})`));
    const fl = el('div', 'fr-list');
    if (!data.friends.length) fl.append(el('div', 'fr-empty', 'Noch keine Freunde. Suche oben nach dem Accountnamen eines Mitglieds und schicke eine Freundschaftsanfrage.'));
    for (const f of data.friends) {
      const row = el('div', 'fr-row');
      const bs = el('div', 'fr-btns');
      let armed = false;
      const rm = btn('Entfernen', '', () => {
        if (!armed) { armed = true; rm.textContent = 'Wirklich?'; rm.classList.add('no'); setTimeout(() => { if (alive) { armed = false; rm.textContent = 'Entfernen'; rm.classList.remove('no'); } }, 3500); return; }
        act('/api/friends/remove', { userId: f.id }, `${f.name} ist nicht mehr in deiner Freundesliste.`);
      });
      bs.append(rm);
      const since = f.since ? 'befreundet seit ' + new Date(f.since).toLocaleDateString('de-DE') : '';
      row.append(avatar(f.name, !!f.online), nameCell(f.name, f.rank, (f.online ? 'online · ' : 'offline · ') + since), bs);
      fl.append(row);
    }
    body.append(fl);
    if (data.outgoing.length) {
      body.append(el('div', 'fr-sec', 'Gesendete Anfragen'));
      const ol = el('div', 'fr-list');
      for (const r of data.outgoing) {
        const row = el('div', 'fr-row');
        const bs = el('div', 'fr-btns');
        bs.append(btn('Zurückziehen', '', () => act('/api/friends/cancel', { id: r.id }, `Anfrage an ${r.to.name} zurückgezogen.`)));
        row.append(avatar(r.to.name), nameCell(r.to.name, '', 'wartet auf Antwort · gesendet am ' + new Date(r.createdAt).toLocaleDateString('de-DE')), bs);
        ol.append(row);
      }
      body.append(ol);
    }
  }

  async function refresh() {
    try {
      data = await friendsApi('/api/friends');
      if (!alive) return;
      drawBody();
      onChange(data);
    } catch (e) { if (alive) say(e.message, 'err'); }
  }

  function drawResults(list, q) {
    results.textContent = '';
    if (!list.length) { results.append(el('div', 'fr-empty', `Kein Mitglied gefunden, dessen Name „${q}“ enthält.`)); return; }
    for (const u of list) {
      const row = el('div', 'fr-row');
      const bs = el('div', 'fr-btns');
      if (u.relation === 'friend') bs.append(btn('Befreundet ✓', 'yes'));
      else if (u.relation === 'outgoing') bs.append(btn('Anfrage gesendet'));
      else if (u.relation === 'incoming') {
        const req = { id: u.requestId, from: { id: u.id, name: u.name } };
        bs.append(btn('Annehmen', 'yes', () => respond(req, true)), btn('Ablehnen', 'no', () => respond(req, false)));
      } else if (u.relation === 'blocked') { const b = btn(`Gesperrt · noch ${waitText(u.waitMs)}`); b.title = `${u.name} hat deine Anfrage abgelehnt. Eine neue Anfrage ist erst 24 Stunden danach möglich.`; bs.append(b); }
      else bs.append(btn('Anfrage senden', 'go', () => act('/api/friends/request', { userId: u.id }, `Freundschaftsanfrage an ${u.name} gesendet.`)));
      row.append(avatar(u.name, !!u.online), nameCell(u.name, u.rank, u.online ? 'online' : ''), bs);
      results.append(row);
    }
  }

  async function runSearch() {
    const q = input.value.replace(/[^A-Za-z0-9]/g, '');
    const my = ++seq;
    if (q.length < 2) { results.textContent = ''; return; }
    try {
      const r = await friendsApi('/api/members/search?q=' + encodeURIComponent(q));
      if (alive && my === seq) drawResults(r.users || [], q);
    } catch (e) { if (alive) say(e.message, 'err'); }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    say('');
    if (input.value.replace(/[^A-Za-z0-9]/g, '').length < 2) { results.textContent = ''; if (input.value.trim()) say('Mindestens 2 Zeichen eingeben.'); return; }
    timer = setTimeout(runSearch, 250);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); runSearch(); } });

  refresh();
  return { refresh, focus: () => input.focus(), dispose() { alive = false; clearTimeout(timer); } };
}

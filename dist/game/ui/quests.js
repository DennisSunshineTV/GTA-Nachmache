// Quest-Übersicht (Tab "Quests" in der Vollbildkarte): alle Aufträge der Hauptgeschichte mit Status.
// Abgeschlossene Quests sind grün hinterlegt, die laufende ist rosa markiert, noch gesperrte sind abgedunkelt.
import { fmtMoney } from '../util.js';

const BADGE = { done: 'Abgeschlossen ✓', active: 'Läuft', open: 'Verfügbar', locked: 'Gesperrt' };

function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// host: Container-Element, onWaypoint({x, z}): Wegpunkt auf der Karte setzen
export function renderQuests(game, host, { onWaypoint } = {}) {
  const list = game.missions?.questList?.() || [];
  host.textContent = '';
  const wrap = el('div', 'qwrap');

  const done = list.filter((q) => q.state === 'done').length;
  const head = el('div', 'qhead');
  head.append(el('h2', '', 'Quests'), el('div', 'qcount', `${done} von ${list.length} abgeschlossen`));
  const bar = el('div', 'qbar');
  const fill = el('i');
  fill.style.width = `${list.length ? Math.round((done / list.length) * 100) : 0}%`;
  bar.append(fill);
  wrap.append(head, bar);

  if (!list.length) wrap.append(el('p', 'qempty', 'Noch keine Quests vorhanden.'));

  for (const q of list) {
    const row = el('div', `qrow ${q.state}`);
    row.dataset.quest = q.id;
    row.dataset.state = q.state;
    row.append(el('div', 'qnr', q.state === 'done' ? '✓' : String(q.nr)));

    const body = el('div', 'qbody');
    const title = el('div', 'qtitle');
    title.append(el('span', '', q.title), el('span', 'qbadge', BADGE[q.state]));
    body.append(title);
    body.append(el('div', 'qmeta', `${q.giver ? `Auftraggeber: ${q.giver} · ` : ''}Belohnung: ${fmtMoney(q.reward)}`));
    if (q.desc) body.append(el('div', 'qdesc', q.desc));
    if (q.state === 'active' && q.objective) body.append(el('div', 'qobj', `Aktuelles Ziel: ${q.objective}`));
    if (q.state === 'open') body.append(el('div', 'qobj', 'Bereit: Gehe zum rosa „M“ auf der Karte, um die Quest zu starten.'));
    if (q.state === 'locked') body.append(el('div', 'qlock', `Gesperrt – schließe zuerst „${q.prev}“ ab.`));
    row.append(body);

    if (q.target && onWaypoint) {
      const b = el('button', 'qbtn', 'Wegpunkt');
      b.type = 'button';
      b.title = 'Ziel auf der Karte markieren';
      b.addEventListener('click', () => onWaypoint(q.target));
      row.append(b);
    }
    wrap.append(row);
  }
  host.append(wrap);
}

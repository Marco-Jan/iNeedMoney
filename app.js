'use strict';

const STORAGE_KEY = 'inneedmoney.v1';
const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const TAGE = ['Mo','Di','Mi','Do','Fr','Sa','So'];

let state = { saldo: 0, posten: [], transaktionen: [], abgegriffen: {} };

const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = c => fmt.format(c / 100);
const zuCent = euro => Math.round(parseFloat(euro, 10) * 100);

function heute() {
  const d = new Date();
  return { tag: d.getDate(), monatsKey: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') };
}

function heuteISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function lade() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) { /* korrupte Daten ignorieren */ }
}

function speichere() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Posten, deren Tag im laufenden Monat bereits fällig war und noch nicht abgezogen wurde
function faelligePosten(monatsKey) {
  const h = heute();
  const schon = state.abgegriffen[monatsKey] || [];
  return state.posten.filter(p => p.tag <= h.tag && !schon.includes(p.id));
}

// Posten, deren Tag im laufenden Monat noch in der Zukunft liegt
function offenePosten() {
  const h = heute();
  return state.posten.filter(p => p.tag > h.tag);
}

// Fällige Posten automatisch abziehen (einmal pro Monat pro Posten)
function abrechnen() {
  const h = heute();
  const faellig = faelligePosten(h.monatsKey);
  if (!faellig.length) return;
  for (const p of faellig) {
    state.saldo -= p.betrag;
    state.transaktionen.unshift({ id: Date.now() + Math.random(), typ: 'posten', betrag: p.betrag, datum: heuteISO(), name: p.name });
  }
  const schon = state.abgegriffen[h.monatsKey] || [];
  state.abgegriffen[h.monatsKey] = schon.concat(faellig.map(p => p.id));
  speichere();
}

function transaktion(typ, betrag, name) {
  state.transaktionen.unshift({ id: Date.now() + Math.random(), typ, betrag, datum: heuteISO(), name });
  if (state.transaktionen.length > 200) state.transaktionen.length = 200;
}

// Kurze Hinweis-Meldung (Toast) – alle Warnungen laufen darüber
function toast(msg) {
  const box = document.getElementById('toast');
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { box.hidden = true; }, 3000);
}

// ---- Rendering ----

function rendSaldo() {
  document.getElementById('saldo').textContent = eur(state.saldo);
  const h = heute();
  const offen = offenePosten();
  const summe = offen.reduce((s, p) => s + p.betrag, 0);
  document.getElementById('saldo-hinweis').textContent =
    'Noch offen im Monat: ' + eur(summe) + (offen.length ? ' (' + offen.length + ' Posten)' : '');
}

function rendPosten() {
  const ul = document.getElementById('posten-liste');
  ul.innerHTML = '';
  for (const p of state.posten.slice().sort((a, b) => a.tag - b.tag)) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p.name + ' · am ' + p.tag + '.';
    const betrag = document.createElement('span');
    betrag.className = 'betrag';
    betrag.textContent = eur(p.betrag);
    const btn = document.createElement('button');
    btn.className = 'entfernen';
    btn.type = 'button';
    btn.textContent = 'Löschen';
    btn.onclick = () => {
      if (confirm('Posten „' + p.name + '“ löschen?')) {
        state.posten = state.posten.filter(x => x.id !== p.id);
        speichere();
        rendAlle();
      }
    };
    li.append(span, betrag, btn);
    ul.appendChild(li);
  }
}

function rendPostenUebersicht() {
  const ul = document.getElementById('posten-uebersicht');
  ul.innerHTML = '';
  const h = heute();
  const schon = state.abgegriffen[h.monatsKey] || [];
  const posten = state.posten.slice().sort((a, b) => a.tag - b.tag);
  for (const p of posten) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p.name + ' · am ' + p.tag + '.';
    const betrag = document.createElement('span');
    betrag.className = 'betrag';
    betrag.textContent = eur(p.betrag);
    if (p.tag <= h.tag && schon.includes(p.id)) {
      li.classList.add('abgezogen');
      span.textContent += ' ✓';
    }
    li.append(span, betrag);
    ul.appendChild(li);
  }
}

function rendHistorie() {
  const ul = document.getElementById('historie');
  ul.innerHTML = '';
  for (const t of state.transaktionen.slice(0, 10)) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = t.datum + ' · ' + (t.name || (t.typ === 'einzahlung' ? 'Einzahlung' : 'Ausgabe'));
    const betrag = document.createElement('span');
    betrag.className = 'betrag';
    betrag.textContent = (t.typ === 'einzahlung' ? '+' : '−') + eur(t.betrag);
    li.append(span, betrag);
    ul.appendChild(li);
  }
}

function rendAusgaben() {
  const ul = document.getElementById('ausgaben-liste');
  const summeEl = document.getElementById('ausgaben-summe');
  if (!ul) return;
  ul.innerHTML = '';
  const ausgaben = state.transaktionen.filter(t => t.typ === 'ausgabe').slice(0, 5);
  for (const t of ausgaben) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = t.datum + (t.name ? ' · ' + t.name : '');
    const betrag = document.createElement('span');
    betrag.className = 'betrag';
    betrag.textContent = '−' + eur(t.betrag);
    li.append(span, betrag);
    ul.appendChild(li);
  }
  const alle = state.transaktionen.filter(t => t.typ === 'ausgabe');
  summeEl.textContent = alle.length
    ? 'Gesamt: ' + eur(alle.reduce((s, t) => s + t.betrag, 0)) + ' (' + alle.length + ' Ausgaben)'
    : 'Noch keine Ausgaben erfasst.';
}

let kalMonat = new Date().getMonth(); // 0-11, aktueller Anzeigemonat

function rendKalender() {
  const jetzt = new Date();
  const jahr = jetzt.getFullYear();
  const d = new Date(jahr, kalMonat, 1);
  document.getElementById('kal-monat').textContent = MONATE[kalMonat] + ' ' + jahr;

  const grid = document.getElementById('kal-grid');
  grid.innerHTML = '';
  for (const t of TAGE) {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = t;
    grid.appendChild(tag);
  }
  // Montag zuerst: 0=Mo … 6=So
  const offset = (d.getDay() + 6) % 7;
  const tageImMonat = new Date(jahr, kalMonat + 1, 0).getDate();
  const h = heute();
  const istAktuellerMonat = kalMonat === jetzt.getMonth();

  for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('div'));
  for (let tag = 1; tag <= tageImMonat; tag++) {
    const zelle = document.createElement('div');
    zelle.className = 'tag-zer';
    if (istAktuellerMonat && tag === h.tag) zelle.classList.add('heute');
    zelle.textContent = tag;
    for (const p of state.posten.filter(x => x.tag === tag)) {
      const span = document.createElement('span');
      span.className = istAktuellerMonat && tag <= h.tag ? 'posten posten-ab' : 'posten';
      span.textContent = p.name + ' ' + eur(p.betrag);
      zelle.appendChild(span);
    }
    grid.appendChild(zelle);
  }

  const offen = offenePosten();
  document.getElementById('kal-offen').textContent = offen.length
    ? 'Noch anstehend: ' + eur(offen.reduce((s, p) => s + p.betrag, 0))
    : 'Keine offenen Posten mehr diesen Monat.';
}

function rendAlle() {
  rendSaldo();
  rendPosten();
  rendPostenUebersicht();
  rendHistorie();
  rendAusgaben();
  rendKalender();
}

// ---- Formulare ----

document.getElementById('form-einzahlung').addEventListener('submit', e => {
  e.preventDefault();
  const betrag = zuCent(document.getElementById('ein-betrag').value);
  if (!betrag || betrag <= 0) return;
  state.saldo += betrag;
  transaktion('einzahlung', betrag, '');
  speichere();
  e.target.reset();
  rendAlle();
  overlaySchliessen();
});

document.getElementById('form-ausgabe').addEventListener('submit', e => {
  e.preventDefault();
  const betrag = zuCent(document.getElementById('aus-betrag').value);
  if (!betrag || betrag <= 0) return;
  const notiz = document.getElementById('aus-notiz').value.trim();
  const warnBox = document.getElementById('ausgabe-warnung');

  const offen = offenePosten();
  const summe = offen.reduce((s, p) => s + p.betrag, 0);
  const nachAbzug = state.saldo - betrag;

  if (betrag > state.saldo) {
    warnBox.textContent = 'Achtung: Dein Saldo (' + eur(state.saldo) + ') reicht nicht für diesen Betrag.';
    warnBox.hidden = false;
    return;
  }
  // Regel: Betrag > 1/3 der Summe der noch offenen Posten (künftige Tage im laufenden Monat)
  if (summe > 0 && betrag > Math.floor(summe / 3)) {
    warnBox.textContent = 'Achtung: ' + eur(betrag) + ' sind mehr als ein Drittel der noch offenen Posten (' +
      eur(summe) + '). So eine Ausgabe könnte deinen Sparplan gefährden.';
    warnBox.hidden = false;
    if (!confirm('Trotz Warnung ausgeben?')) return;
  }
  state.saldo -= betrag;
  transaktion('ausgabe', betrag, notiz);
  speichere();
  e.target.reset();
  warnBox.hidden = true;
  rendAlle();
  overlaySchliessen();
});

document.getElementById('form-posten').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('post-name').value.trim();
  const betrag = zuCent(document.getElementById('post-betrag').value);
  const tag = parseInt(document.getElementById('post-tag').value, 10);
  if (!name || !betrag || betrag <= 0 || !(tag >= 1 && tag <= 31)) return;
  state.posten.push({ id: Date.now() + Math.random(), name, betrag, tag });
  speichere();
  e.target.reset();
  abrechnen(); // falls Tag bereits im laufenden Monat liegt
  rendAlle();
  overlaySchliessen();
});

document.getElementById('kal-prev').addEventListener('click', () => { kalMonat = (kalMonat + 11) % 12; rendKalender(); });
document.getElementById('kal-next').addEventListener('click', () => { kalMonat = (kalMonat + 1) % 12; rendKalender(); });

// ---- Overlay (Kacheln) ----

const OVERLAY_TITEL = {
  einzel: 'Einzahlen',
  ausgabe: 'Spontane Ausgabe',
  posten: 'Posten (monatlich)',
  kalender: 'Kalender',
  ausgaben: 'Alle Ausgaben',
};

function overlayOeffnen(name) {
  const overlay = document.getElementById('overlay');
  const titel = document.getElementById('overlay-titel');
  titel.textContent = OVERLAY_TITEL[name] || '';
  for (const body of overlay.querySelectorAll('.overlay-body')) {
    body.hidden = body.getAttribute('data-body') !== name;
  }
  overlay.hidden = false;
}

function overlaySchliessen() {
  document.getElementById('overlay').hidden = true;
  const warnBox = document.getElementById('ausgabe-warnung');
  if (warnBox) warnBox.hidden = true;
}

document.querySelectorAll('.kachel').forEach(k => {
  k.addEventListener('click', () => overlayOeffnen(k.getAttribute('data-oeffnet')));
});
document.getElementById('overlay-schliessen').addEventListener('click', overlaySchliessen);
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) overlaySchliessen();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('overlay').hidden) overlaySchliessen();
});

// ---- Reset ----

document.getElementById('reset-knopf').addEventListener('click', () => {
  if (!confirm('Wirklich ALLES zurücksetzen? Saldo, Posten und Historie werden gelöscht.')) return;
  state = { saldo: 0, posten: [], transaktionen: [], abgegriffen: {} };
  speichere();
  rendAlle();
});

// ---- Start ----
lade();
abrechnen();
rendAlle();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

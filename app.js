'use strict';

/*
  iNeedMoney - Spar-App
  Aufbau: 1) Logik (ohne DOM, testbar)  2) UI (nur wenn ein document existiert)
*/

const STORAGE_KEY = 'inneedmoney.v1';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_HISTORIE = 300;

let state = { saldo: 0, posten: [], transaktionen: [] };

// ---------------------------------------------------------------- Hilfsmittel

const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = cent => fmt.format(cent / 100);

// Akzeptiert "12,50", "12.50", "1.234,56" und " 12 " -> Integer-Cent, sonst NaN
function zuCent(eingabe) {
  if (typeof eingabe === 'number') return Math.round(eingabe * 100);
  let s = String(eingabe == null ? '' : eingabe).trim().replace(/\s|€/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s)) return NaN;
  const zahl = parseFloat(s);
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : NaN;
}

function monatsKeyVon(datum) {
  return datum.getFullYear() + '-' + String(datum.getMonth() + 1).padStart(2, '0');
}

// Datums-Werkzeug: durchgehend lokale Daten, nie UTC - sonst rutschen
// Termine je nach Zeitzone um einen Tag.
function isoVon(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}

function datumVon(iso) {
  const [j, m, t] = String(iso).split('-').map(Number);
  return new Date(j, (m || 1) - 1, t || 1);
}

function tageZwischen(a, b) {
  return Math.round((b - a) / 86400000);
}

function heute() {
  const d = new Date();
  return { tag: d.getDate(), monatsKey: monatsKeyVon(d), datum: d };
}

function heuteISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}

function neueId() {
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function summe(liste) {
  return liste.reduce((s, x) => s + x.betrag, 0);
}

// ---------------------------------------------------------------------- Daten

function lade() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const geladen = JSON.parse(raw);
    if (geladen && typeof geladen === 'object') state = normalisiere(geladen);
  } catch (e) {
    // korrupte Daten: mit leerem Stand weiterarbeiten, nichts überschreiben
  }
}

/*
  Einen Posten auf das aktuelle Schema bringen.

  Alte Stände (vor den Wiederholungen) kennen nur { tag } und merken sich in
  "abgegriffen" pro Monat, was schon abgezogen wurde. Daraus wird hier ein
  Monats-Rhythmus mit Startdatum und Zähler - ohne dass etwas doppelt
  abgebucht wird: war der Posten diesen Monat schon dran, steht der Zähler
  bereits auf dem nächsten Monat.
*/
function postenNormalisieren(p, abgegriffen) {
  const zahl = v => (Number.isFinite(v) ? Math.round(v) : 0);
  const id = String(p.id != null ? p.id : neueId());
  const istWoche = p.rhythmus === 'woche';
  const tag = Math.min(31, Math.max(1, Math.round(Number.isFinite(p.tag) ? p.tag : 1)));
  const intervall = Math.min(52, Math.max(1,
    Math.round(Number.isFinite(p.intervall) ? p.intervall : 1)));

  const neu = {
    id,
    name: String(p.name || 'Posten'),
    betrag: zahl(p.betrag),
    rhythmus: istWoche ? 'woche' : 'monat',
    intervall,
    tag,
    start: /^\d{4}-\d{2}-\d{2}$/.test(String(p.start)) ? String(p.start) : null,
  };

  if (Number.isFinite(p.naechster) && neu.start) {
    // Schon im neuen Schema
    neu.naechster = Math.max(0, Math.round(p.naechster));
    return neu;
  }

  // Migration aus dem alten Monats-Schema
  const jetzt = new Date();
  const monatsKey = monatsKeyVon(jetzt);
  const schon = abgegriffen && Array.isArray(abgegriffen[monatsKey])
    ? abgegriffen[monatsKey].map(String) : [];
  const indiesem = effektiverTag(tag, jetzt.getFullYear(), jetzt.getMonth());
  neu.start = neu.start || isoVon(new Date(jetzt.getFullYear(), jetzt.getMonth(), indiesem));
  // bereits abgezogen -> Start gilt als erledigt, nächster Termin ist Index 1
  neu.naechster = schon.includes(id) ? 1 : 0;
  return neu;
}

// Fremde/alte Datenstände auf ein sicheres Schema bringen
function normalisiere(roh) {
  const zahl = v => (Number.isFinite(v) ? Math.round(v) : 0);
  return {
    saldo: zahl(roh.saldo),
    posten: Array.isArray(roh.posten) ? roh.posten
      .filter(p => p && Number.isFinite(p.betrag))
      .map(p => postenNormalisieren(p, roh.abgegriffen)) : [],
    transaktionen: Array.isArray(roh.transaktionen) ? roh.transaktionen
      .filter(t => t && Number.isFinite(t.betrag))
      .slice(0, MAX_HISTORIE)
      .map(t => ({
        id: String(t.id != null ? t.id : neueId()),
        typ: t.typ === 'einzahlung' || t.typ === 'posten' ? t.typ : 'ausgabe',
        betrag: zahl(t.betrag),
        datum: String(t.datum || heuteISO()),
        name: String(t.name || ''),
      })) : [],
  };
}

function speichere() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Speichern fehlgeschlagen – Speicher voll?');
  }
}

function transaktion(typ, betrag, name) {
  state.transaktionen.unshift({ id: neueId(), typ, betrag, datum: heuteISO(), name: name || '' });
  if (state.transaktionen.length > MAX_HISTORIE) state.transaktionen.length = MAX_HISTORIE;
}

// ---------------------------------------------------------------------- Logik

/*
  Der Tag, an dem ein monatlicher Posten in einem konkreten Monat fällig wird.
  Ein Posten am 31. rutscht im Februar auf den 28./29., sonst würde er
  in kurzen Monaten nie abgezogen.
*/
function tageImMonat(jahr, monat) {
  return new Date(jahr, monat + 1, 0).getDate();
}

function effektiverTag(tag, jahr, monat) {
  return Math.min(tag, tageImMonat(jahr, monat));
}

/*
  Wiederholung
  ------------
  Ein Posten wiederholt sich entweder alle N Monate (am selben Tag im Monat)
  oder alle N Wochen (ab einem Starttermin).

  Wochen-Rhythmen lassen sich nicht auf Monate abbilden - "alle 4 Wochen"
  wandert durchs Jahr und kommt 13-mal vor, nicht 12-mal. Deshalb zählt jeder
  Posten seine Termine über einen Index ab seinem Start durch:

      termin(k) = k-ter Termin seit p.start,   p.naechster = Index des
                                               nächsten noch nicht gebuchten

  Beim Monats-Rhythmus wird dabei immer vom Startmonat aus gerechnet, nie vom
  zuletzt gebuchten Termin: sonst würde ein Posten am 31., der im Februar auf
  den 28. gerutscht ist, ab da dauerhaft auf dem 28. hängen bleiben.
*/
function terminFuerIndex(p, k) {
  const basis = datumVon(p.start);
  if (p.rhythmus === 'woche') {
    const d = new Date(basis.getFullYear(), basis.getMonth(), basis.getDate());
    d.setDate(d.getDate() + k * p.intervall * 7);
    return d;
  }
  const zielMonat = basis.getMonth() + k * p.intervall;
  const anker = new Date(basis.getFullYear(), zielMonat, 1);
  return new Date(anker.getFullYear(), anker.getMonth(),
    effektiverTag(p.tag, anker.getFullYear(), anker.getMonth()));
}

// Nächster noch nicht abgezogener Termin
function naechsterTermin(p) {
  return terminFuerIndex(p, p.naechster);
}

// Index des ersten Termins, der nicht vor "ab" liegt - ohne Schleife ab 0
function indexAb(p, ab) {
  const basis = datumVon(p.start);
  if (ab <= basis) return 0;
  let schaetzung;
  if (p.rhythmus === 'woche') {
    schaetzung = Math.floor(tageZwischen(basis, ab) / (p.intervall * 7));
  } else {
    const monate = (ab.getFullYear() - basis.getFullYear()) * 12 + (ab.getMonth() - basis.getMonth());
    schaetzung = Math.floor(monate / p.intervall);
  }
  let k = Math.max(0, schaetzung - 1);
  // höchstens ein paar Schritte, die Schätzung liegt nie weit daneben
  while (k < schaetzung + 3 && terminFuerIndex(p, k) < ab) k++;
  return k;
}

// Alle Termine eines Postens im Zeitraum [von, bis] (beide einschließlich)
function termineImZeitraum(p, von, bis) {
  const raus = [];
  let k = indexAb(p, von);
  for (let i = 0; i < 400; i++) { // harte Obergrenze gegen kaputte Daten
    const d = terminFuerIndex(p, k);
    if (d > bis) break;
    if (d >= von) raus.push({ posten: p, datum: d, index: k });
    k++;
  }
  return raus;
}

// Termine, die diesen Monat noch kommen (ab morgen bis Monatsende)
function offeneTermine() {
  const jetzt = new Date();
  const morgen = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1);
  const monatsEnde = new Date(jetzt.getFullYear(), jetzt.getMonth(),
    tageImMonat(jetzt.getFullYear(), jetzt.getMonth()));
  if (morgen > monatsEnde) return [];
  const raus = [];
  for (const p of state.posten) {
    // Nur was noch nicht gebucht ist - sonst zaehlt ein bereits abgezogener
    // Termin weiter als "offen" und die Ansichten widersprechen sich.
    raus.push(...termineImZeitraum(p, morgen, monatsEnde).filter(t => t.index >= p.naechster));
  }
  return raus.sort((a, b) => a.datum - b.datum);
}

// Posten mit mindestens einem offenen Termin in diesem Monat
function offenePosten() {
  const gesehen = new Set();
  return offeneTermine().filter(t => {
    if (gesehen.has(t.posten.id)) return false;
    gesehen.add(t.posten.id);
    return true;
  }).map(t => t.posten);
}

function summeOffen() {
  return offeneTermine().reduce((s, t) => s + t.posten.betrag, 0);
}

// Warnschwelle: ein Drittel der noch offenen Posten
function warnschwelle() {
  return Math.floor(summeOffen() / 3);
}

/*
  Alles abziehen, was seit dem letzten Öffnen fällig geworden ist.
  Auch mehrere Termine pro Posten: wer die App zwei Monate nicht öffnet, bei
  dem ist das Geld trotzdem abgebucht worden. Jeder Abzug wird mit seinem
  echten Termin in die Historie geschrieben, nicht mit dem heutigen Datum.
*/
function abrechnen() {
  const jetzt = new Date();
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  let gebucht = 0;
  for (const p of state.posten) {
    for (let i = 0; i < 400; i++) {
      const termin = terminFuerIndex(p, p.naechster);
      if (termin > bis) break;
      state.saldo -= p.betrag;
      state.transaktionen.unshift({
        id: neueId(), typ: 'posten', betrag: p.betrag,
        datum: isoVon(termin), name: p.name,
      });
      p.naechster++;
      gebucht++;
    }
  }
  if (gebucht) {
    state.transaktionen.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
    if (state.transaktionen.length > MAX_HISTORIE) state.transaktionen.length = MAX_HISTORIE;
    speichere();
  }
  return gebucht;
}

function einzahlen(betrag, notiz) {
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  state.saldo += betrag;
  transaktion('einzahlung', betrag, notiz);
  speichere();
  return { ok: true };
}

/*
  Prüft eine spontane Ausgabe, ohne sie zu buchen.
  -> { ok:false, fehler } bei zu wenig Saldo
  -> { ok:true, warnung } wenn Betrag > 1/3 der offenen Posten
*/
function pruefeAusgabe(betrag) {
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  if (betrag > state.saldo) {
    return { ok: false, fehler: 'Dein Konto (' + eur(state.saldo) + ') reicht für ' + eur(betrag) + ' nicht aus.' };
  }
  const offen = offenePosten();
  const summeOffen = summe(offen);
  if (summeOffen > 0 && betrag > Math.floor(summeOffen / 3)) {
    return {
      ok: true,
      warnung: eur(betrag) + ' ist mehr als ein Drittel deiner noch offenen Posten (' + eur(summeOffen) +
        ' in ' + offen.length + (offen.length === 1 ? ' Posten' : ' Posten') + '). Das könnte deinen Sparplan kippen.',
    };
  }
  return { ok: true, warnung: null };
}

function ausgeben(betrag, notiz) {
  const p = pruefeAusgabe(betrag);
  if (!p.ok) return p;
  state.saldo -= betrag;
  transaktion('ausgabe', betrag, notiz);
  speichere();
  return { ok: true, warnung: p.warnung };
}

/*
  Erster Termin eines Monats-Postens: immer dieser Monat.
  Liegt der Tag schon hinter uns, zieht abrechnen() ihn sofort ab - genau wie
  vor den Wiederholungen. Wer das nicht will, legt den Posten mit dem
  nächsten Monat als Start an.
*/
function ersterMonatsTermin(tag) {
  const jetzt = new Date();
  return isoVon(new Date(jetzt.getFullYear(), jetzt.getMonth(),
    effektiverTag(tag, jetzt.getFullYear(), jetzt.getMonth())));
}

function postenSpeichern({ id, name, betrag, rhythmus, intervall, tag, start }) {
  if (!name) return { ok: false, fehler: 'Bitte einen Namen eingeben.' };
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };

  const art = rhythmus === 'woche' ? 'woche' : 'monat';
  const n = Number.isFinite(intervall) ? Math.round(intervall) : 1;
  if (n < 1 || n > 52) return { ok: false, fehler: 'Die Wiederholung muss zwischen 1 und 52 liegen.' };

  let neu;
  if (art === 'woche') {
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return { ok: false, fehler: 'Bitte einen ersten Termin wählen.' };
    }
    neu = { name, betrag, rhythmus: 'woche', intervall: n, tag: datumVon(start).getDate(), start };
  } else {
    if (!Number.isFinite(tag) || tag < 1 || tag > 31) {
      return { ok: false, fehler: 'Der Tag muss zwischen 1 und 31 liegen.' };
    }
    neu = {
      name, betrag, rhythmus: 'monat', intervall: n, tag,
      start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : ersterMonatsTermin(tag),
    };
  }

  if (id) {
    const vorhanden = state.posten.find(p => p.id === id);
    if (!vorhanden) return { ok: false, fehler: 'Dieser Posten existiert nicht mehr.' };
    /*
      Beim Bearbeiten den Zähler so setzen, dass bereits gebuchte Termine
      nicht noch einmal abgezogen werden - sonst bucht eine Änderung am
      Betrag rückwirkend die ganze Vergangenheit nach.
    */
    Object.assign(vorhanden, neu);
    const jetzt = new Date();
    vorhanden.naechster = indexAb(vorhanden,
      new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1));
  } else {
    state.posten.push(Object.assign({ id: neueId(), naechster: 0 }, neu));
  }
  speichere();
  abrechnen(); // falls der erste Termin schon erreicht ist
  return { ok: true, bearbeitet: Boolean(id) };
}

// Wiederholung als Text, z. B. "alle 4 Wochen" oder "monatlich am 28."
function rhythmusText(p) {
  if (p.rhythmus === 'woche') {
    return (p.intervall === 1 ? 'wöchentlich' : 'alle ' + p.intervall + ' Wochen');
  }
  return (p.intervall === 1 ? 'monatlich' : 'alle ' + p.intervall + ' Monate') + ' am ' + p.tag + '.';
}

function postenLoeschen(id) {
  const vorher = state.posten.length;
  state.posten = state.posten.filter(p => p.id !== id);
  speichere();
  return { ok: state.posten.length < vorher };
}

function monatsBilanz(monatsKey) {
  const key = monatsKey || heute().monatsKey;
  const imMonat = state.transaktionen.filter(t => String(t.datum).slice(0, 7) === key);
  const nach = typ => summe(imMonat.filter(t => t.typ === typ));
  return {
    einzahlungen: nach('einzahlung'),
    ausgaben: nach('ausgabe'),
    posten: nach('posten'),
    frei: state.saldo - summeOffen(),
  };
}

function zuruecksetzen() {
  state = { saldo: 0, posten: [], transaktionen: [] };
  speichere();
}

function exportDaten() {
  return JSON.stringify({ version: 1, exportiert: heuteISO(), daten: state }, null, 2);
}

function importDaten(text) {
  let roh;
  try {
    roh = JSON.parse(text);
  } catch (e) {
    return { ok: false, fehler: 'Die Datei ist kein gültiges Backup.' };
  }
  const daten = roh && roh.daten ? roh.daten : roh;
  if (!daten || typeof daten !== 'object' || !('saldo' in daten)) {
    return { ok: false, fehler: 'Die Datei enthält keine iNeedMoney-Daten.' };
  }
  state = normalisiere(daten);
  speichere();
  return { ok: true };
}

// Für den Logik-Test ohne Browser
if (typeof globalThis !== 'undefined') {
  globalThis.Logik = {
    get state() { return state; },
    zuCent, eur, warnschwelle, offenePosten, offeneTermine, summeOffen, abrechnen,
    effektiverTag, tageImMonat, terminFuerIndex, naechsterTermin, termineImZeitraum,
    indexAb, rhythmusText, isoVon, datumVon,
    einzahlen, ausgeben, pruefeAusgabe, postenSpeichern, postenLoeschen,
    monatsBilanz, zuruecksetzen, exportDaten, importDaten, lade, normalisiere,
  };
}

// ------------------------------------------------------------------------- UI

const istBrowser = typeof document !== 'undefined' && typeof document.querySelector === 'function';

function el(id) {
  const n = document.getElementById(id);
  if (!n) console.warn('iNeedMoney: Element #' + id + ' fehlt im HTML.');
  return n;
}

let toast = function () {}; // im Browser unten ersetzt

if (istBrowser) {
  const knoten = {};
  const IDS = ['saldo', 'saldo-hinweis', 'monat-ein', 'monat-aus', 'monat-posten', 'monat-frei',
    'monat-frei-hinweis', 'posten-uebersicht', 'posten-uebersicht-leer', 'historie', 'historie-leer',
    'overlay', 'overlay-titel', 'overlay-schliessen', 'form-einzahlung', 'ein-betrag', 'ein-notiz',
    'form-ausgabe', 'aus-betrag', 'aus-notiz', 'ausgabe-warnung', 'ausgabe-schwelle',
    'form-posten', 'post-id', 'post-name', 'post-betrag', 'post-tag', 'post-submit', 'post-abbrechen',
    'post-intervall', 'post-einheit', 'post-tag-feld', 'post-start-feld', 'post-start', 'post-vorschau',
    'posten-liste', 'posten-liste-leer', 'kal-prev', 'kal-next', 'kal-monat', 'kal-grid', 'kal-offen',
    'kal-liste', 'kal-liste-leer',
    'ausgaben-liste', 'ausgaben-leer', 'ausgaben-summe', 'export-knopf', 'import-datei', 'import-label', 'reset-knopf',
    'frage', 'frage-text', 'frage-ja', 'frage-nein', 'toast'];
  for (const id of IDS) knoten[id] = el(id);

  // -------------------------------------------------------------- Rückmeldung

  toast = function (text, art) {
    const box = knoten['toast'];
    if (!box) return;
    box.textContent = text;
    box.className = 'toast' + (art ? ' toast-' + art : '');
    box.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { box.hidden = true; }, 3500);
  };

  // Toast wegtippen, falls er stört
  knoten['toast'].addEventListener('click', () => {
    clearTimeout(toast._t);
    knoten['toast'].hidden = true;
  });

  // Eigener Bestätigungs-Dialog statt confirm() - blockiert nichts
  let frageAntwort = null;
  function frage(text, jaLabel) {
    return new Promise(aufloesen => {
      knoten['frage-text'].textContent = text;
      knoten['frage-ja'].textContent = jaLabel || 'Ja';
      knoten['frage'].hidden = false;
      knoten['frage-ja'].focus();
      frageAntwort = antwort => {
        knoten['frage'].hidden = true;
        frageAntwort = null;
        aufloesen(antwort);
      };
    });
  }
  knoten['frage-ja'].addEventListener('click', () => frageAntwort && frageAntwort(true));
  knoten['frage-nein'].addEventListener('click', () => frageAntwort && frageAntwort(false));
  knoten['frage'].addEventListener('click', e => {
    if (e.target === e.currentTarget && frageAntwort) frageAntwort(false);
  });

  // --------------------------------------------------------------- Rendering

  function zeile(text, betragText, klasse, unterText) {
    const li = document.createElement('li');
    const links = document.createElement('span');
    links.className = 'z-text';
    const haupt = document.createElement('span');
    haupt.className = 'z-haupt';
    haupt.textContent = text;
    links.appendChild(haupt);
    if (unterText) {
      const unten = document.createElement('span');
      unten.className = 'z-unter';
      unten.textContent = unterText;
      links.appendChild(unten);
    }
    const rechts = document.createElement('span');
    rechts.className = 'betrag' + (klasse ? ' ' + klasse : '');
    rechts.textContent = betragText;
    li.append(links, rechts);
    return li;
  }

  function rendSaldo() {
    knoten['saldo'].textContent = eur(state.saldo);
    knoten['saldo'].classList.toggle('negativ', state.saldo < 0);
    // Termine zählen, nicht Posten: "alle 4 Wochen" kann zweimal im Monat fallen
    const termine = offeneTermine();
    knoten['saldo-hinweis'].textContent = termine.length
      ? 'Noch offen diesen Monat: ' + eur(summeOffen()) + ' · ' +
        termine.length + (termine.length === 1 ? ' Termin' : ' Termine')
      : (state.posten.length ? 'Diesen Monat steht nichts mehr an.' : 'Noch keine Posten angelegt.');
  }

  function rendMonat() {
    const b = monatsBilanz();
    knoten['monat-ein'].textContent = eur(b.einzahlungen);
    knoten['monat-aus'].textContent = eur(b.ausgaben);
    knoten['monat-posten'].textContent = eur(b.posten);
    knoten['monat-frei'].textContent = eur(b.frei);
    knoten['monat-frei'].classList.toggle('minus', b.frei < 0);
    knoten['monat-frei'].classList.toggle('plus', b.frei > 0);
    knoten['monat-frei-hinweis'].textContent = b.frei < 0
      ? 'Die offenen Posten übersteigen dein Konto – hier fehlt Geld.'
      : 'Konto minus noch offene Posten. Das kannst du frei ausgeben.';
  }

  function rendPostenUebersicht() {
    const ul = knoten['posten-uebersicht'];
    ul.innerHTML = '';
    const posten = state.posten.slice()
      .sort((a, b) => naechsterTermin(a) - naechsterTermin(b));
    for (const p of posten) {
      const naechst = naechsterTermin(p);
      const li = zeile(p.name, eur(p.betrag), null,
        rhythmusText(p) + ' · nächster ' + datumHuebsch(isoVon(naechst)));
      const marke = document.createElement('span');
      const diesenMonat = istImAktuellenMonat(naechst);
      marke.className = 'marke ' + (diesenMonat ? 'marke-offen' : 'marke-ruhig');
      marke.textContent = diesenMonat ? 'diesen Monat' : 'später';
      li.querySelector('.z-text').appendChild(marke);
      ul.appendChild(li);
    }
    knoten['posten-uebersicht-leer'].hidden = posten.length > 0;
  }

  function istImAktuellenMonat(d) {
    const jetzt = new Date();
    return d.getFullYear() === jetzt.getFullYear() && d.getMonth() === jetzt.getMonth();
  }

  function rendPostenListe() {
    const ul = knoten['posten-liste'];
    ul.innerHTML = '';
    const posten = state.posten.slice()
      .sort((a, b) => naechsterTermin(a) - naechsterTermin(b));
    for (const p of posten) {
      const li = zeile(p.name, eur(p.betrag), null,
        rhythmusText(p) + ' · nächster ' + datumHuebsch(isoVon(naechsterTermin(p))));
      const aktionen = document.createElement('span');
      aktionen.className = 'aktionen';

      const bearbeiten = document.createElement('button');
      bearbeiten.type = 'button';
      bearbeiten.className = 'icon-knopf';
      bearbeiten.textContent = 'Ändern';
      bearbeiten.addEventListener('click', () => postenBearbeiten(p));

      const loeschen = document.createElement('button');
      loeschen.type = 'button';
      loeschen.className = 'icon-knopf entfernen';
      loeschen.textContent = 'Löschen';
      loeschen.addEventListener('click', async () => {
        if (!await frage('Posten „' + p.name + '“ wirklich löschen?', 'Löschen')) return;
        postenLoeschen(p.id);
        if (knoten['post-id'].value === p.id) postenFormularLeeren();
        rendAlle();
        toast('Posten gelöscht.');
      });

      aktionen.append(bearbeiten, loeschen);
      li.appendChild(aktionen);
      ul.appendChild(li);
    }
    knoten['posten-liste-leer'].hidden = posten.length > 0;
  }

  function rendHistorie() {
    const ul = knoten['historie'];
    ul.innerHTML = '';
    const letzte = state.transaktionen.slice(0, 12);
    for (const t of letzte) {
      const bezeichnung = t.name || (t.typ === 'einzahlung' ? 'Einzahlung'
        : t.typ === 'posten' ? 'Posten' : 'Ausgabe');
      const vorzeichen = t.typ === 'einzahlung' ? '+' : '−';
      const art = t.typ === 'posten' ? 'Posten' : t.typ === 'einzahlung' ? 'Einzahlung' : 'Ausgabe';
      ul.appendChild(zeile(bezeichnung, vorzeichen + ' ' + eur(t.betrag),
        t.typ === 'einzahlung' ? 'plus' : 'minus',
        datumHuebsch(t.datum) + ' · ' + art));
    }
    knoten['historie-leer'].hidden = letzte.length > 0;
  }

  function rendAusgaben() {
    const ul = knoten['ausgaben-liste'];
    ul.innerHTML = '';
    const alle = state.transaktionen.filter(t => t.typ === 'ausgabe');
    for (const t of alle.slice(0, 50)) {
      ul.appendChild(zeile(datumHuebsch(t.datum) + (t.name ? ' · ' + t.name : ''), '− ' + eur(t.betrag), 'minus'));
    }
    knoten['ausgaben-leer'].hidden = alle.length > 0;
    knoten['ausgaben-summe'].textContent = alle.length
      ? 'Gesamt: ' + eur(summe(alle)) + ' in ' + alle.length + (alle.length === 1 ? ' Ausgabe' : ' Ausgaben')
      : '';
  }

  function datumHuebsch(iso) {
    const teile = String(iso).split('-');
    return teile.length === 3 ? teile[2] + '.' + teile[1] + '.' + teile[0] : String(iso);
  }

  // Kalender mit echtem Jahr, nicht nur Monatsindex
  const jetzt = new Date();
  let kalJahr = jetzt.getFullYear();
  let kalMonat = jetzt.getMonth();

  function kalVerschieben(delta) {
    const d = new Date(kalJahr, kalMonat + delta, 1);
    kalJahr = d.getFullYear();
    kalMonat = d.getMonth();
    rendKalender();
  }

  function rendKalender() {
    knoten['kal-monat'].textContent = MONATE[kalMonat] + ' ' + kalJahr;
    const grid = knoten['kal-grid'];
    grid.innerHTML = '';
    for (const t of TAGE) {
      const kopf = document.createElement('div');
      kopf.className = 'tag';
      kopf.textContent = t;
      grid.appendChild(kopf);
    }
    const ersterTag = new Date(kalJahr, kalMonat, 1);
    const offset = (ersterTag.getDay() + 6) % 7; // Montag zuerst
    const anzahlTage = tageImMonat(kalJahr, kalMonat);
    const h = heute();
    const heuteDatum = new Date();
    const istAktuell = kalJahr === heuteDatum.getFullYear() && kalMonat === heuteDatum.getMonth();
    /*
      "bezahlt" heisst: dieser Termin wurde schon gebucht. Das steht im
      Zaehler des Postens (index < p.naechster) - nicht "Tag liegt in der
      Vergangenheit", sonst widerspricht der Kalender der Startseite.
    */
    const istBezahlt = t => t.index < t.posten.naechster;

    // Alle Termine dieses Monats, nach Tag gruppiert
    const monatsStart = new Date(kalJahr, kalMonat, 1);
    const monatsEnde = new Date(kalJahr, kalMonat, anzahlTage);
    const termine = [];
    for (const p of state.posten) termine.push(...termineImZeitraum(p, monatsStart, monatsEnde));
    const proTag = {};
    for (const t of termine) {
      const d = t.datum.getDate();
      (proTag[d] = proTag[d] || []).push(t);
    }

    for (let i = 0; i < offset; i++) {
      const leer = document.createElement('div');
      leer.className = 'tag-leer';
      grid.appendChild(leer);
    }
    for (let tag = 1; tag <= anzahlTage; tag++) {
      const zelle = document.createElement('div');
      zelle.className = 'tag-zelle';
      if (istAktuell && tag === h.tag) zelle.classList.add('heute');
      const nummer = document.createElement('span');
      nummer.className = 'tag-nr';
      nummer.textContent = tag;
      zelle.appendChild(nummer);

      const hier = proTag[tag] || [];
      if (hier.length) {
        /*
          In eine Zelle von 1/7 Bildschirmbreite passt kein Name - der wurde
          vorher zu "Versicher..." abgeschnitten. Die Zelle zeigt deshalb nur
          Punkte, die Namen stehen in der Liste unter dem Kalender.
        */
        const punkte = document.createElement('span');
        punkte.className = 'kal-punkte';
        for (const t of hier.slice(0, 4)) {
          const punkt = document.createElement('span');
          punkt.className = 'kal-punkt' + (istBezahlt(t) ? ' kal-punkt-ab' : '');
          punkte.appendChild(punkt);
        }
        zelle.appendChild(punkte);
        zelle.classList.add('hat-posten');
        if (hier.every(istBezahlt)) zelle.classList.add('tag-bezahlt');
        zelle.title = hier.map(t => t.posten.name + ' ' + eur(t.posten.betrag)).join(', ');
        const betragKlein = document.createElement('span');
        betragKlein.className = 'kal-betrag';
        betragKlein.textContent = Math.round(hier.reduce((x, t) => x + t.posten.betrag, 0) / 100);
        zelle.appendChild(betragKlein);
      }
      grid.appendChild(zelle);
    }

    // Lesbare Liste unter dem Gitter - hier stehen die vollen Namen
    const liste = knoten['kal-liste'];
    liste.innerHTML = '';
    for (const t of termine.slice().sort((a, b) => a.datum - b.datum)) {
      const bezahlt = istBezahlt(t);
      const li = zeile(t.posten.name, eur(t.posten.betrag), bezahlt ? 'bezahlt' : null,
        'am ' + t.datum.getDate() + '. · ' + rhythmusText(t.posten));
      const marke = document.createElement('span');
      marke.className = 'marke ' + (bezahlt ? 'marke-ok' : 'marke-offen');
      marke.textContent = bezahlt ? 'bezahlt' : 'offen';
      li.querySelector('.z-text').appendChild(marke);
      liste.appendChild(li);
    }
    knoten['kal-liste-leer'].hidden = termine.length > 0;
    knoten['kal-liste-leer'].textContent = state.posten.length
      ? 'In diesem Monat steht nichts an.'
      : 'Noch keine Posten angelegt.';

    const offenSumme = summeOffen();
    knoten['kal-offen'].textContent = istAktuell
      ? (offenSumme ? 'Noch anstehend diesen Monat: ' + eur(offenSumme)
        : 'Keine offenen Posten mehr diesen Monat.')
      : 'Summe in diesem Monat: ' + eur(termine.reduce((x, t) => x + t.posten.betrag, 0));
  }

  function rendSchwelle() {
    const s = warnschwelle();
    knoten['ausgabe-schwelle'].textContent = s > 0
      ? 'Ab ' + eur(s + 1) + ' bekommst du eine Warnung (ein Drittel der offenen Posten).'
      : 'Aktuell keine offenen Posten – es wird nicht gewarnt.';
  }

  function rendAlle() {
    rendSaldo();
    rendMonat();
    rendPostenUebersicht();
    rendPostenListe();
    rendHistorie();
    rendAusgaben();
    rendKalender();
    rendSchwelle();
  }

  // ---------------------------------------------------------------- Overlays

  const OVERLAY_TITEL = {
    einzahlung: 'Einzahlen',
    ausgabe: 'Spontane Ausgabe',
    posten: 'Wiederkehrende Posten',
    kalender: 'Kalender',
    ausgaben: 'Alle Ausgaben',
    einstellungen: 'Einstellungen',
  };

  function overlayOeffnen(name) {
    const overlay = knoten['overlay'];
    knoten['overlay-titel'].textContent = OVERLAY_TITEL[name] || '';
    for (const body of overlay.querySelectorAll('.overlay-body')) {
      body.hidden = body.getAttribute('data-body') !== name;
    }
    overlay.hidden = false;
    document.body.classList.add('fixiert');
    if (name === 'ausgabe') rendSchwelle();
    const ersterInput = overlay.querySelector('.overlay-body:not([hidden]) input:not([type="hidden"]):not([type="file"])');
    if (ersterInput) setTimeout(() => ersterInput.focus(), 50);
  }

  function overlaySchliessen() {
    knoten['overlay'].hidden = true;
    document.body.classList.remove('fixiert');
    knoten['ausgabe-warnung'].hidden = true;
    postenFormularLeeren();
  }

  for (const k of document.querySelectorAll('.kachel')) {
    k.addEventListener('click', () => overlayOeffnen(k.getAttribute('data-oeffnet')));
  }
  knoten['overlay-schliessen'].addEventListener('click', overlaySchliessen);
  knoten['overlay'].addEventListener('click', e => {
    if (e.target === e.currentTarget) overlaySchliessen();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!knoten['frage'].hidden && frageAntwort) frageAntwort(false);
    else if (!knoten['overlay'].hidden) overlaySchliessen();
  });

  // ------------------------------------------------- Aufklappbare Cards

  /*
    Der Auf-/Zu-Zustand gehoert nicht zu den Spardaten und liegt deshalb in
    einem eigenen Schluessel - ein Backup-Import soll ihn nicht mitbringen.
  */
  const UI_KEY = 'inneedmoney.ui.v1';

  function ladeUiStand() {
    try {
      const roh = JSON.parse(localStorage.getItem(UI_KEY));
      return roh && typeof roh === 'object' ? roh : {};
    } catch (e) {
      return {};
    }
  }

  function speichereUiStand(stand) {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(stand));
    } catch (e) { /* ohne gemerkten Zustand laeuft die App auch */ }
  }

  const uiStand = ladeUiStand();

  for (const card of document.querySelectorAll('[data-card]')) {
    const name = card.getAttribute('data-card');
    const kopf = card.querySelector('.card-kopf');
    if (!kopf) {
      console.warn('iNeedMoney: Card "' + name + '" hat keinen .card-kopf.');
      continue;
    }
    const setzen = (offen, merken) => {
      card.setAttribute('data-offen', offen ? 'true' : 'false');
      kopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
      if (merken) {
        uiStand[name] = offen;
        speichereUiStand(uiStand);
      }
    };
    setzen(uiStand[name] !== false, false); // Standard: offen
    kopf.addEventListener('click', () => {
      setzen(card.getAttribute('data-offen') !== 'true', true);
    });
  }

  // --------------------------------------------------------------- Formulare

  knoten['form-einzahlung'].addEventListener('submit', e => {
    e.preventDefault();
    const betrag = zuCent(knoten['ein-betrag'].value);
    const r = einzahlen(betrag, knoten['ein-notiz'].value.trim());
    if (!r.ok) return toast(r.fehler, 'warn');
    e.target.reset();
    rendAlle();
    overlaySchliessen();
    toast(eur(betrag) + ' eingezahlt.', 'ok');
  });

  knoten['form-ausgabe'].addEventListener('submit', async e => {
    e.preventDefault();
    const betrag = zuCent(knoten['aus-betrag'].value);
    const notiz = knoten['aus-notiz'].value.trim();
    const warnBox = knoten['ausgabe-warnung'];

    const pruefung = pruefeAusgabe(betrag);
    if (!pruefung.ok) {
      warnBox.textContent = pruefung.fehler;
      warnBox.hidden = false;
      return;
    }
    if (pruefung.warnung) {
      warnBox.textContent = pruefung.warnung;
      warnBox.hidden = false;
      if (!await frage(pruefung.warnung + '\n\nTrotzdem ausgeben?', 'Trotzdem ausgeben')) return;
    }
    const r = ausgeben(betrag, notiz);
    if (!r.ok) return toast(r.fehler, 'warn');
    e.target.reset();
    warnBox.hidden = true;
    rendAlle();
    overlaySchliessen();
    toast(eur(betrag) + ' ausgegeben.', 'ok');
  });

  /*
    Monats- und Wochen-Rhythmus brauchen verschiedene Angaben: beim Monat den
    Tag, bei der Woche einen Starttermin. Es wird immer nur das passende Feld
    gezeigt, damit das Formular nicht nach Fragebogen aussieht.
  */
  function rhythmusFelderUmschalten() {
    const istWoche = knoten['post-einheit'].value === 'woche';
    knoten['post-tag-feld'].hidden = istWoche;
    knoten['post-start-feld'].hidden = !istWoche;
    rendVorschau();
  }

  // Zeigt die nächsten drei Termine - "alle 4 Wochen" ist sonst schwer vorstellbar
  function rendVorschau() {
    const istWoche = knoten['post-einheit'].value === 'woche';
    const intervall = parseInt(knoten['post-intervall'].value, 10);
    const tag = parseInt(knoten['post-tag'].value, 10);
    const start = knoten['post-start'].value;
    const feld = knoten['post-vorschau'];

    if (!Number.isFinite(intervall) || intervall < 1) { feld.textContent = ''; return; }
    if (istWoche && !start) { feld.textContent = 'Wähle einen ersten Termin.'; return; }
    if (!istWoche && !(tag >= 1 && tag <= 31)) { feld.textContent = ''; return; }

    const entwurf = istWoche
      ? { rhythmus: 'woche', intervall, tag: datumVon(start).getDate(), start }
      : { rhythmus: 'monat', intervall, tag, start: ersterMonatsTermin(tag) };

    const termine = [0, 1, 2].map(k => datumHuebsch(isoVon(terminFuerIndex(entwurf, k))));
    feld.textContent = rhythmusText(entwurf) + ' · nächste Termine: ' + termine.join(', ') + ' …';
  }

  knoten['post-einheit'].addEventListener('change', rhythmusFelderUmschalten);
  for (const id of ['post-intervall', 'post-tag', 'post-start']) {
    knoten[id].addEventListener('input', rendVorschau);
  }

  function postenBearbeiten(p) {
    knoten['post-id'].value = p.id;
    knoten['post-name'].value = p.name;
    knoten['post-betrag'].value = (p.betrag / 100).toFixed(2).replace('.', ',');
    knoten['post-einheit'].value = p.rhythmus;
    knoten['post-intervall'].value = p.intervall;
    knoten['post-tag'].value = p.tag;
    knoten['post-start'].value = p.start;
    rhythmusFelderUmschalten();
    knoten['post-submit'].textContent = 'Änderung speichern';
    knoten['post-abbrechen'].hidden = false;
    knoten['post-name'].focus();
    // Das Formular steht über der Liste - bei vielen Posten sieht man den
    // Wechsel sonst gar nicht, wenn man weiter unten auf "Ändern" tippt.
    knoten['form-posten'].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast('„' + p.name + '“ wird bearbeitet.');
  }

  function postenFormularLeeren() {
    knoten['post-id'].value = '';
    knoten['form-posten'].reset();
    knoten['post-einheit'].value = 'monat';
    knoten['post-intervall'].value = '1';
    rhythmusFelderUmschalten();
    knoten['post-submit'].textContent = 'Posten hinzufügen';
    knoten['post-abbrechen'].hidden = true;
  }

  knoten['post-abbrechen'].addEventListener('click', postenFormularLeeren);

  knoten['form-posten'].addEventListener('submit', e => {
    e.preventDefault();
    const istWoche = knoten['post-einheit'].value === 'woche';
    const r = postenSpeichern({
      id: knoten['post-id'].value || null,
      name: knoten['post-name'].value.trim(),
      betrag: zuCent(knoten['post-betrag'].value),
      rhythmus: istWoche ? 'woche' : 'monat',
      intervall: parseInt(knoten['post-intervall'].value, 10),
      tag: parseInt(knoten['post-tag'].value, 10),
      start: istWoche ? knoten['post-start'].value : null,
    });
    if (!r.ok) return toast(r.fehler, 'warn');
    postenFormularLeeren();
    rendAlle();
    toast(r.bearbeitet ? 'Posten geändert.' : 'Posten angelegt.', 'ok');
  });

  knoten['kal-prev'].addEventListener('click', () => kalVerschieben(-1));
  knoten['kal-next'].addEventListener('click', () => kalVerschieben(1));

  // ----------------------------------------------------- Backup & Reset

  knoten['export-knopf'].addEventListener('click', () => {
    const blob = new Blob([exportDaten()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ineedmoney-backup-' + heuteISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup erstellt.', 'ok');
  });

  // Das Label ist optisch ein Knopf - per Tastatur soll es sich auch so verhalten
  knoten['import-label'].addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      knoten['import-datei'].click();
    }
  });

  knoten['import-datei'].addEventListener('change', async e => {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    e.target.value = '';
    if (!await frage('Backup einlesen? Deine aktuellen Daten werden dabei ersetzt.', 'Einlesen')) return;
    const leser = new FileReader();
    leser.onload = () => {
      const r = importDaten(String(leser.result));
      if (!r.ok) return toast(r.fehler, 'warn');
      abrechnen();
      rendAlle();
      overlaySchliessen();
      toast('Backup eingelesen.', 'ok');
    };
    leser.onerror = () => toast('Datei konnte nicht gelesen werden.', 'warn');
    leser.readAsText(datei);
  });

  knoten['reset-knopf'].addEventListener('click', async () => {
    if (!await frage('Wirklich ALLES zurücksetzen? Konto, Posten und Historie werden gelöscht.', 'Alles löschen')) return;
    zuruecksetzen();
    rendAlle();
    overlaySchliessen();
    toast('Alles zurückgesetzt.');
  });

  // ------------------------------------------------------------------ Start

  lade();
  const abgezogen = abrechnen();
  rendAlle();
  if (abgezogen) {
    toast(abgezogen + (abgezogen === 1 ? ' fälliger Posten' : ' fällige Posten') + ' abgezogen.');
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

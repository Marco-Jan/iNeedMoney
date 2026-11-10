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

let state = { saldo: 0, posten: [], transaktionen: [], artikel: [], einkauf: [] };

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
    artikel: Array.isArray(roh.artikel) ? roh.artikel
      .filter(a => a && typeof a === 'object')
      .map(artikelNormalisieren) : [],
    einkauf: Array.isArray(roh.einkauf) ? roh.einkauf
      .filter(z => z && typeof z === 'object')
      .map(einkaufPosNormalisieren) : [],
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
  // Termine zählen, nicht Posten - dieselbe Summe wie warnschwelle() und die
  // Startseite. Ein 14-Tage-Posten, der zweimal im Monat fällt, zählt zweimal.
  const termine = offeneTermine();
  const offen = summeOffen();
  if (offen > 0 && betrag > warnschwelle()) {
    return {
      ok: true,
      warnung: eur(betrag) + ' ist mehr als ein Drittel deiner noch offenen Posten (' + eur(offen) +
        ' in ' + termine.length + (termine.length === 1 ? ' Termin' : ' Terminen') + '). Das könnte deinen Sparplan kippen.',
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
  state = { saldo: 0, posten: [], transaktionen: [], artikel: [], einkauf: [] };
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

// ------------------------------------------------- Vorrat, Artikel & Einkauf

/*
  Artikel = eine Ware, die du kaufst (Milch, Kaffee ...). Der Artikel ist
  gleichzeitig Vorratszähler und Preisgedächtnis:

    { id, ean, name, einheit, menge, mindest,
      letzterPreis, bestPreis, bestLaden, bestDatum, preise: [...] }

  Warum beides in einem Objekt und nicht zwei Listen: ein Barcode-Scan soll
  mit einem Treffer sowohl „wie viel habe ich noch" als auch „was war der
  billigste Preis" beantworten. Zwei Listen müssten dafür synchron bleiben.

  `ean` ist der Barcode. Offline gibt es keine Produktdatenbank — der Name
  wird beim ersten Scan einmal eingetippt und ab dann wiedererkannt. Das ist
  Absicht: eine Online-Abfrage wäre die einzige Alternative und würde die
  Offline-Anforderung brechen.
*/

const MAX_PREISE = 20;        // Preis-Historie pro Artikel
const EINHEITEN = ['Stk', 'kg', 'g', 'l', 'ml', 'Pck', 'Fl'];

function artikelNormalisieren(a) {
  const zahl = v => (Number.isFinite(v) ? Math.round(v) : 0);
  const preise = Array.isArray(a.preise) ? a.preise
    .filter(p => p && Number.isFinite(p.preis) && p.preis > 0)
    .slice(0, MAX_PREISE)
    .map(p => ({
      preis: zahl(p.preis),
      datum: String(p.datum || heuteISO()),
      laden: String(p.laden || ''),
    })) : [];
  // Bestpreis immer aus der Historie ableiten, nicht blind übernehmen —
  // sonst bleibt ein importierter Unsinnswert für immer stehen.
  const guenstigste = preise.length
    ? preise.reduce((x, p) => (p.preis < x.preis ? p : x))
    : null;
  return {
    id: String(a.id != null ? a.id : neueId()),
    ean: String(a.ean || '').replace(/\D/g, '').slice(0, 14),
    name: String(a.name || 'Artikel'),
    einheit: EINHEITEN.includes(a.einheit) ? a.einheit : 'Stk',
    menge: Math.max(0, zahl(a.menge)),
    mindest: Math.max(0, zahl(a.mindest)),
    letzterPreis: preise.length ? preise[0].preis
      : (Number.isFinite(a.letzterPreis) && a.letzterPreis > 0 ? zahl(a.letzterPreis) : null),
    bestPreis: guenstigste ? guenstigste.preis : null,
    bestLaden: guenstigste ? guenstigste.laden : '',
    bestDatum: guenstigste ? guenstigste.datum : null,
    preise,
  };
}

function einkaufPosNormalisieren(z) {
  const zahl = v => (Number.isFinite(v) ? Math.round(v) : 0);
  return {
    id: String(z.id != null ? z.id : neueId()),
    artikelId: z.artikelId != null ? String(z.artikelId) : null,
    name: String(z.name || 'Position'),
    menge: Math.max(1, zahl(z.menge) || 1),
    preis: Math.max(0, zahl(z.preis)),   // Preis pro Einheit in Cent
  };
}

// -- Artikel / Vorrat --------------------------------------------------------

function artikelNachEan(ean) {
  const sauber = String(ean || '').replace(/\D/g, '');
  if (!sauber) return null;
  return state.artikel.find(a => a.ean === sauber) || null;
}

function artikelNachId(id) {
  return state.artikel.find(a => a.id === String(id)) || null;
}

/*
  Suche nach dem Namen - genau, nur Gross-/Kleinschreibung und Rand-Leerzeichen
  werden ignoriert. Die Vorschlagsliste im Einkauf bietet Namen an; wer einen
  davon tippt, muss denselben Artikel treffen wie ein Scan, sonst entstehen
  stille Doppel-Artikel ohne Preisgedaechtnis.
*/
function artikelNachName(name) {
  const sauber = String(name || '').trim().toLowerCase();
  if (!sauber) return null;
  return state.artikel.find(a => a.name.trim().toLowerCase() === sauber) || null;
}

function artikelSpeichern({ id, ean, name, einheit, menge, mindest }) {
  const sauber = String(name || '').trim();
  if (!sauber) return { ok: false, fehler: 'Bitte einen Namen eingeben.' };

  const eanSauber = String(ean || '').replace(/\D/g, '').slice(0, 14);
  const doppelt = eanSauber ? artikelNachEan(eanSauber) : null;
  if (doppelt && doppelt.id !== String(id || '')) {
    return { ok: false, fehler: 'Dieser Barcode gehört schon zu „' + doppelt.name + '".' };
  }

  const vorhanden = id ? artikelNachId(id) : null;
  if (id && !vorhanden) return { ok: false, fehler: 'Artikel nicht gefunden.' };

  const entwurf = artikelNormalisieren({
    ...(vorhanden || {}),
    id: vorhanden ? vorhanden.id : null,
    ean: eanSauber,
    name: sauber,
    einheit: einheit || (vorhanden ? vorhanden.einheit : 'Stk'),
    menge: Number.isFinite(menge) ? menge : (vorhanden ? vorhanden.menge : 0),
    mindest: Number.isFinite(mindest) ? mindest : (vorhanden ? vorhanden.mindest : 0),
  });

  if (vorhanden) Object.assign(vorhanden, entwurf);
  else state.artikel.push(entwurf);
  speichere();
  return { ok: true, artikel: vorhanden || entwurf, bearbeitet: !!vorhanden };
}

function artikelLoeschen(id) {
  const vor = state.artikel.length;
  state.artikel = state.artikel.filter(a => a.id !== String(id));
  // Positionen auf der Einkaufsliste nicht mitlöschen, nur lösen — sonst
  // verschwindet mitten im Einkauf eine Zeile aus der Liste.
  for (const z of state.einkauf) if (z.artikelId === String(id)) z.artikelId = null;
  speichere();
  return { ok: state.artikel.length < vor };
}

function vorratAendern(id, delta) {
  const a = artikelNachId(id);
  if (!a) return { ok: false, fehler: 'Artikel nicht gefunden.' };
  if (!Number.isFinite(delta)) return { ok: false, fehler: 'Ungültige Menge.' };
  a.menge = Math.max(0, a.menge + Math.round(delta));
  speichere();
  return { ok: true, menge: a.menge };
}

// Alles, was auf oder unter dem Mindestbestand liegt (Mindestbestand 0 = egal)
function nachkaufen() {
  return state.artikel.filter(a => a.mindest > 0 && a.menge <= a.mindest);
}

/*
  Preis-Urteil gegen das eigene Gedächtnis — das ersetzt den Prospekt:
  nicht „was ist gerade im Angebot", sondern „ist das billig für dich".
*/
function preisUrteil(artikelId, preis) {
  const a = artikelNachId(artikelId);
  if (!a || !Number.isFinite(preis) || preis <= 0) return null;
  if (a.bestPreis == null) return { stufe: 'neu', text: 'Erster erfasster Preis.' };
  const best = a.bestPreis;
  if (preis <= best) return { stufe: 'best', text: 'Bestpreis! Günstiger als je zuvor (bisher ' + eur(best) + ').' };
  if (preis <= Math.round(best * 1.1)) return { stufe: 'gut', text: 'Guter Preis, nahe am Bestpreis ' + eur(best) + '.' };
  if (preis <= Math.round(best * 1.25)) return { stufe: 'ok', text: 'Normal. Bestpreis war ' + eur(best) + '.' };
  const prozent = Math.round((preis / best - 1) * 100);
  return { stufe: 'teuer', text: 'Teuer: ' + prozent + ' % über deinem Bestpreis von ' + eur(best) + '.' };
}

function preisErfassen(artikelId, preis, laden, datum) {
  const a = artikelNachId(artikelId);
  if (!a) return { ok: false, fehler: 'Artikel nicht gefunden.' };
  if (!Number.isFinite(preis) || preis <= 0) return { ok: false, fehler: 'Bitte einen Preis größer als 0 eingeben.' };
  const urteil = preisUrteil(artikelId, preis);
  a.preise.unshift({ preis: Math.round(preis), datum: String(datum || heuteISO()), laden: String(laden || '') });
  if (a.preise.length > MAX_PREISE) a.preise.length = MAX_PREISE;
  Object.assign(a, artikelNormalisieren(a));
  speichere();
  return { ok: true, urteil };
}

// -- Einkaufsliste & Budget --------------------------------------------------

function einkaufHinzu({ artikelId, name, ean, menge, preis }) {
  let a = artikelId ? artikelNachId(artikelId) : (ean ? artikelNachEan(ean) : null);
  const bezeichnung = String(name || (a ? a.name : '')).trim();
  if (!a && !bezeichnung) return { ok: false, fehler: 'Bitte einen Namen eingeben.' };
  // Kein Barcode, aber der Name ist bekannt -> an den bestehenden Artikel haengen
  if (!a && !ean) a = artikelNachName(bezeichnung);

  // Unbekannter Barcode mit Namen -> gleich als Artikel anlegen, damit der
  // nächste Scan ihn kennt und eine Preis-Historie entstehen kann.
  if (!a && ean) {
    const neu = artikelSpeichern({ ean, name: bezeichnung });
    if (!neu.ok) return neu;
    a = neu.artikel;
  }

  const anzahl = Math.max(1, Math.round(Number.isFinite(menge) ? menge : 1));
  const eigenerPreis = Number.isFinite(preis) && preis > 0;
  const stueckpreis = eigenerPreis ? Math.round(preis)
    : (a && a.letzterPreis ? a.letzterPreis : 0);

  // Gleicher Artikel schon auf der Liste -> Menge erhöhen statt doppelt listen
  const schon = a ? state.einkauf.find(z => z.artikelId === a.id) : null;
  if (schon) {
    schon.menge += anzahl;
    if (eigenerPreis) schon.preis = stueckpreis;
    speichere();
    return { ok: true, position: schon, zusammengelegt: true };
  }

  const pos = einkaufPosNormalisieren({
    artikelId: a ? a.id : null,
    name: a ? a.name : bezeichnung,
    menge: anzahl,
    preis: stueckpreis,
  });
  state.einkauf.push(pos);
  speichere();
  return { ok: true, position: pos, geschaetzt: stueckpreis > 0 && !eigenerPreis };
}

function einkaufAendern(id, { menge, preis }) {
  const z = state.einkauf.find(x => x.id === String(id));
  if (!z) return { ok: false, fehler: 'Position nicht gefunden.' };
  if (Number.isFinite(menge)) z.menge = Math.max(1, Math.round(menge));
  if (Number.isFinite(preis)) z.preis = Math.max(0, Math.round(preis));
  speichere();
  return { ok: true, position: z };
}

function einkaufEntfernen(id) {
  const vor = state.einkauf.length;
  state.einkauf = state.einkauf.filter(z => z.id !== String(id));
  speichere();
  return { ok: state.einkauf.length < vor };
}

function einkaufLeeren() {
  state.einkauf = [];
  speichere();
  return { ok: true };
}

function einkaufSumme() {
  return state.einkauf.reduce((x, z) => x + z.preis * z.menge, 0);
}

/*
  Der Kern der Budget-Planung: die Einkaufsliste wird wie eine geplante
  spontane Ausgabe behandelt und durch dieselbe Prüfung geschickt wie jede
  andere Ausgabe. Dadurch gilt exakt dieselbe Warnschwelle (1/3 der noch
  offenen Posten) — es gibt keine zweite, abweichende Regel.
*/
function einkaufBudget() {
  const gesamt = einkaufSumme();
  const basis = {
    summe: gesamt,
    positionen: state.einkauf.length,
    stueck: state.einkauf.reduce((x, z) => x + z.menge, 0),
    ohnePreis: state.einkauf.filter(z => z.preis <= 0).length,
    frei: state.saldo - summeOffen(),
    schwelle: warnschwelle(),
    saldo: state.saldo,
    offen: summeOffen(),
  };
  if (gesamt <= 0) {
    return {
      ...basis, ok: true, fehler: null, warnung: null,
      hinweis: state.einkauf.length
        ? 'Noch keine Preise eingetragen – die Summe ist deshalb 0.'
        : 'Die Einkaufsliste ist leer.',
    };
  }
  const pruefung = pruefeAusgabe(gesamt);
  return {
    ...basis,
    ok: pruefung.ok,
    fehler: pruefung.fehler || null,
    warnung: pruefung.warnung || null,
    hinweis: pruefung.ok && gesamt > basis.frei
      ? 'Der Einkauf geht an deine reservierten Posten – es fehlen dann ' + eur(gesamt - basis.frei) + '.'
      : null,
  };
}

/*
  Einkauf abschließen: bucht EINE Ausgabe über die Summe, schreibt die Preise
  in die Historie der Artikel und erhöht den Vorrat.

  `echteSumme` (optional) ist der Betrag vom Kassenzettel. Weicht er von der
  Liste ab, wird er gebucht — die Preise der Positionen bleiben aber wie
  eingetragen, denn welche Position sich geändert hat, weiß nur der Nutzer.
*/
function einkaufAbschliessen(echteSumme, laden) {
  if (!state.einkauf.length) return { ok: false, fehler: 'Die Einkaufsliste ist leer.' };
  const geplant = einkaufSumme();
  const betrag = Number.isFinite(echteSumme) && echteSumme > 0 ? Math.round(echteSumme) : geplant;
  if (betrag <= 0) return { ok: false, fehler: 'Bitte Preise eintragen oder die bezahlte Summe angeben.' };

  const pruefung = pruefeAusgabe(betrag);
  if (!pruefung.ok) return pruefung;

  const notiz = 'Einkauf' + (laden ? ' ' + String(laden).trim() : '') +
    ' · ' + state.einkauf.length + (state.einkauf.length === 1 ? ' Position' : ' Positionen');
  const r = ausgeben(betrag, notiz);
  if (!r.ok) return r;

  const urteile = [];
  for (const z of state.einkauf) {
    if (!z.artikelId) continue;
    const a = artikelNachId(z.artikelId);
    if (!a) continue;
    if (z.preis > 0) {
      // Urteil VOR dem Eintragen holen - danach ist der neue Preis selbst
      // der Bestpreis und jeder Einkauf waere ein "Bestpreis".
      const vorher = preisUrteil(a.id, z.preis);
      a.preise.unshift({ preis: z.preis, datum: heuteISO(), laden: String(laden || '') });
      if (a.preise.length > MAX_PREISE) a.preise.length = MAX_PREISE;
      Object.assign(a, artikelNormalisieren(a));
      if (vorher) urteile.push({ name: a.name, preis: z.preis, ...vorher });
    }
    a.menge += z.menge;
  }

  state.einkauf = [];
  speichere();
  return { ok: true, betrag, geplant, warnung: pruefung.warnung || null, urteile };
}

// Einkaufsliste aus allem füllen, was auf dem Mindestbestand oder darunter liegt
function einkaufAusVorrat() {
  const fehlt = nachkaufen();
  let dazu = 0;
  for (const a of fehlt) {
    if (state.einkauf.some(z => z.artikelId === a.id)) continue;
    const r = einkaufHinzu({ artikelId: a.id, menge: Math.max(1, a.mindest - a.menge + 1) });
    if (r.ok) dazu++;
  }
  return { ok: true, dazu, gefunden: fehlt.length };
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
    EINHEITEN,
    artikelNachEan, artikelNachId, artikelSpeichern, artikelLoeschen,
    vorratAendern, nachkaufen, preisUrteil, preisErfassen, artikelNachName,
    einkaufHinzu, einkaufAendern, einkaufEntfernen, einkaufLeeren,
    einkaufSumme, einkaufBudget, einkaufAbschliessen, einkaufAusVorrat,
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
  const IDS = ['kopf-datum', 'balken-start',
    'saldo', 'saldo-hinweis', 'monat-ein', 'monat-aus', 'monat-posten', 'monat-frei',
    'monat-frei-hinweis', 'posten-uebersicht', 'posten-uebersicht-leer', 'historie', 'historie-leer',
    'overlay', 'overlay-titel', 'overlay-schliessen', 'form-einzahlung', 'ein-betrag', 'ein-notiz', 'ein-danach',
    'form-ausgabe', 'aus-betrag', 'aus-notiz', 'ausgabe-warnung', 'ausgabe-schwelle',
    'aus-danach', 'aus-balken', 'aus-submit',
    'form-posten', 'post-id', 'post-name', 'post-betrag', 'post-tag', 'post-submit', 'post-abbrechen',
    'post-intervall', 'post-einheit', 'post-tag-feld', 'post-start-feld', 'post-start', 'post-vorschau',
    'posten-liste', 'posten-liste-leer', 'kal-prev', 'kal-next', 'kal-monat', 'kal-grid', 'kal-offen',
    'kal-liste', 'kal-liste-leer', 'kal-titel', 'kal-alle',
    'ausgaben-liste', 'ausgaben-leer', 'ausgaben-summe', 'verlauf-filter',
    'export-knopf', 'import-datei', 'import-label', 'reset-knopf', 'thema-wahl',
    'seg-einkauf', 'einkauf-budget', 'einkauf-warnung', 'form-einkauf', 'ek-name', 'ek-scan', 'ek-vorschlaege',
    'ek-menge', 'ek-preis', 'ek-urteil', 'ek-aus-vorrat', 'einkauf-liste', 'einkauf-leer',
    'einkauf-summe', 'ek-echt', 'ek-laden', 'ek-buchen', 'ek-leeren', 'ek-fuss', 'ek-buchen-summe',
    'vorrat-hinweis', 'form-artikel', 'art-id', 'art-name', 'art-ean', 'art-scan', 'art-einheit',
    'art-menge', 'art-mindest', 'art-submit', 'art-abbrechen', 'vorrat-liste', 'vorrat-leer',
    'scanner', 'scanner-video', 'scanner-status', 'scanner-manuell', 'scanner-ean', 'scanner-ok', 'scanner-zu',
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

  const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WOCHENTAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  function tagesAnfang(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function datumHuebsch(iso) {
    const teile = String(iso).split('-');
    return teile.length === 3 ? teile[2] + '.' + teile[1] + '.' + teile[0] : String(iso);
  }

  // "heute", "morgen", "in 4 Tagen" - sagt mehr als ein nacktes Datum
  function inTagenText(datum) {
    const n = tageZwischen(tagesAnfang(new Date()), datum);
    return n <= 0 ? 'heute' : n === 1 ? 'morgen' : 'in ' + n + ' Tagen';
  }

  // Wie zeile(), aber mit dem Datum als kleiner Kachel davor
  function terminZeile(datum, text, betragText, klasse, unterText) {
    const li = zeile(text, betragText, klasse, unterText);
    const kachel = document.createElement('span');
    kachel.className = 'tag-kachel';
    const nr = document.createElement('span');
    nr.className = 'tag-kachel-nr';
    nr.textContent = datum.getDate();
    const wt = document.createElement('span');
    wt.className = 'tag-kachel-wt';
    wt.textContent = WOCHENTAGE[datum.getDay()];
    kachel.append(nr, wt);
    li.prepend(kachel);
    return li;
  }

  /*
    Balken aus Teilen [klasse, wert]. Die Breite kommt als flex-grow direkt
    aus dem Betrag in Cent. Teile ohne Wert fallen weg; ein leerer Balken
    wird per CSS (:empty) als graue Linie gezeichnet.
  */
  function balkenSetzen(box, teile) {
    box.innerHTML = '';
    for (const [klasse, wert] of teile) {
      if (!(wert > 0)) continue;
      const teil = document.createElement('span');
      teil.className = 'balken-teil ' + klasse;
      teil.style.flexGrow = String(wert);
      box.appendChild(teil);
    }
  }

  function rendStart() {
    const jetzt = new Date();
    knoten['kopf-datum'].textContent = WOCHENTAGE_LANG[jetzt.getDay()] + ', ' +
      jetzt.getDate() + '. ' + MONATE[jetzt.getMonth()];

    const b = monatsBilanz();
    const offen = summeOffen();
    // Termine zählen, nicht Posten: "alle 4 Wochen" kann zweimal im Monat fallen
    const termine = offeneTermine();

    knoten['monat-frei'].textContent = eur(b.frei);
    knoten['monat-frei'].classList.toggle('negativ', b.frei < 0);
    balkenSetzen(knoten['balken-start'], [['frei', Math.max(0, b.frei)], ['reserviert', offen]]);

    knoten['saldo'].textContent = eur(state.saldo);
    knoten['saldo'].classList.toggle('negativ', state.saldo < 0);
    knoten['saldo-hinweis'].textContent = termine.length
      ? 'Reserviert ' + eur(offen) + ' · ' + termine.length + (termine.length === 1 ? ' Termin' : ' Termine')
      : (state.posten.length ? 'Diesen Monat steht nichts mehr an' : 'Noch keine Posten angelegt');

    knoten['monat-frei-hinweis'].hidden = b.frei >= 0;
    knoten['monat-frei-hinweis'].textContent = b.frei < 0
      ? 'Die offenen Posten übersteigen dein Konto – es fehlen ' + eur(-b.frei) + '.'
      : '';

    knoten['monat-ein'].textContent = (b.einzahlungen > 0 ? '+' : '') + eur(b.einzahlungen);
    knoten['monat-aus'].textContent = eur(b.ausgaben);
    knoten['monat-posten'].textContent = eur(b.posten);
  }

  // Die nächsten noch nicht gebuchten Termine über alle Posten, auch über das Monatsende hinaus
  function kommendeTermine(anzahl) {
    const von = tagesAnfang(new Date());
    von.setDate(von.getDate() + 1);
    const bis = new Date(von.getFullYear(), von.getMonth(), von.getDate() + 92);
    const raus = [];
    for (const p of state.posten) {
      raus.push(...termineImZeitraum(p, von, bis).filter(t => t.index >= p.naechster));
    }
    return raus.sort((a, b) => a.datum - b.datum).slice(0, anzahl);
  }

  function rendPostenUebersicht() {
    const ul = knoten['posten-uebersicht'];
    ul.innerHTML = '';
    const termine = kommendeTermine(3);
    for (const t of termine) {
      ul.appendChild(terminZeile(t.datum, t.posten.name, eur(t.posten.betrag), null,
        inTagenText(t.datum) + ' · ' + rhythmusText(t.posten)));
    }
    knoten['posten-uebersicht-leer'].hidden = termine.length > 0;
    knoten['posten-uebersicht-leer'].textContent = state.posten.length
      ? 'In den nächsten Wochen steht nichts an.'
      : 'Noch keine Posten angelegt.';
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
      bearbeiten.setAttribute('aria-label', 'Ändern – ' + p.name);
      bearbeiten.addEventListener('click', () => postenBearbeiten(p));

      const loeschen = document.createElement('button');
      loeschen.type = 'button';
      loeschen.className = 'icon-knopf entfernen';
      loeschen.textContent = 'Löschen';
      loeschen.setAttribute('aria-label', 'Löschen – ' + p.name);
      loeschen.addEventListener('click', async () => {
        if (!await frage('Posten „' + p.name + '“ wirklich löschen?', 'Löschen')) return;
        postenLoeschen(p.id);
        rendAlle();
        toast('Posten gelöscht.');
      });

      aktionen.append(bearbeiten, loeschen);
      li.appendChild(aktionen);
      ul.appendChild(li);
    }
    knoten['posten-liste-leer'].hidden = posten.length > 0;
  }

  function tagLabel(iso) {
    const heuteTag = tagesAnfang(new Date());
    const n = tageZwischen(datumVon(iso), heuteTag);
    if (n === 0) return 'Heute';
    if (n === 1) return 'Gestern';
    return WOCHENTAGE[datumVon(iso).getDay()] + ', ' + datumHuebsch(iso);
  }

  // Buchungen nach Tag gruppiert in eine Liste schreiben
  function buchungenSchreiben(ul, buchungen) {
    ul.innerHTML = '';
    let letzterTag = null;
    for (const t of buchungen) {
      if (t.datum !== letzterTag) {
        letzterTag = t.datum;
        const kopf = document.createElement('li');
        kopf.className = 'gruppe';
        kopf.textContent = tagLabel(t.datum);
        ul.appendChild(kopf);
      }
      const art = t.typ === 'posten' ? 'Posten' : t.typ === 'einzahlung' ? 'Einzahlung' : 'Ausgabe';
      const plus = t.typ === 'einzahlung';
      ul.appendChild(zeile(t.name || art, (plus ? '+' : '−') + eur(t.betrag), plus ? 'plus' : 'minus', art));
    }
  }

  function rendHistorie() {
    const letzte = state.transaktionen.slice(0, 5);
    buchungenSchreiben(knoten['historie'], letzte);
    knoten['historie-leer'].hidden = letzte.length > 0;
  }

  // Verlauf: alle Buchungen, wahlweise auf eine Art gefiltert
  let verlaufFilter = 'alle';

  function rendVerlauf() {
    const alle = verlaufFilter === 'alle' ? state.transaktionen
      : state.transaktionen.filter(t => t.typ === verlaufFilter);
    buchungenSchreiben(knoten['ausgaben-liste'], alle);
    knoten['ausgaben-leer'].hidden = alle.length > 0;
    knoten['ausgaben-leer'].textContent = state.transaktionen.length
      ? 'Keine Buchungen dieser Art.'
      : 'Noch keine Buchungen.';
    const anzahl = alle.length + (alle.length === 1 ? ' Buchung' : ' Buchungen');
    knoten['ausgaben-summe'].textContent = !alle.length ? ''
      : (verlaufFilter === 'alle' ? anzahl : anzahl + ' · zusammen ' + eur(summe(alle)));
    for (const b of knoten['verlauf-filter'].querySelectorAll('[data-filter]')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-filter') === verlaufFilter ? 'true' : 'false');
    }
  }

  for (const b of knoten['verlauf-filter'].querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => {
      verlaufFilter = b.getAttribute('data-filter');
      rendVerlauf();
    });
  }

  // Kalender mit echtem Jahr, nicht nur Monatsindex
  const jetzt = new Date();
  let kalJahr = jetzt.getFullYear();
  let kalMonat = jetzt.getMonth();
  let kalTag = null;   // angetippter Tag filtert die Liste, null = ganzer Monat

  function kalVerschieben(delta) {
    const d = new Date(kalJahr, kalMonat + delta, 1);
    kalJahr = d.getFullYear();
    kalMonat = d.getMonth();
    kalTag = null;
    rendKalender();
  }

  function rendKalender() {
    knoten['kal-monat'].textContent = MONATE[kalMonat] + ' ' + kalJahr;
    const grid = knoten['kal-grid'];
    grid.innerHTML = '';
    for (const t of TAGE) {
      const kopf = document.createElement('div');
      kopf.className = 'tag';
      kopf.setAttribute('aria-hidden', 'true');
      kopf.textContent = t;
      grid.appendChild(kopf);
    }
    const ersterTag = new Date(kalJahr, kalMonat, 1);
    const offset = (ersterTag.getDay() + 6) % 7; // Montag zuerst
    const anzahlTage = tageImMonat(kalJahr, kalMonat);
    const heuteDatum = tagesAnfang(new Date());
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
    termine.sort((a, b) => a.datum - b.datum);
    const proTag = {};
    for (const t of termine) {
      const d = t.datum.getDate();
      (proTag[d] = proTag[d] || []).push(t);
    }

    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('div'));

    for (let tag = 1; tag <= anzahlTage; tag++) {
      const hier = proTag[tag] || [];
      const zelle = document.createElement('button');
      zelle.type = 'button';
      zelle.className = 'tag-zelle';
      if (istAktuell && tag === heuteDatum.getDate()) zelle.classList.add('heute');
      if (new Date(kalJahr, kalMonat, tag) < heuteDatum) zelle.classList.add('vorbei');
      if (hier.length) zelle.classList.add('hat-posten');
      if (tag === kalTag) zelle.classList.add('gewaehlt');
      zelle.setAttribute('aria-pressed', tag === kalTag ? 'true' : 'false');
      zelle.setAttribute('aria-label', tag + '. ' + MONATE[kalMonat] +
        (hier.length ? ': ' + hier.map(t => t.posten.name + ' ' + eur(t.posten.betrag)).join(', ') : ''));

      const nummer = document.createElement('span');
      nummer.className = 'tag-nr';
      nummer.textContent = tag;
      /*
        In eine Zelle von 1/7 Bildschirmbreite passt kein Name. Ein Punkt
        zeigt, dass etwas ansteht; die Namen stehen in der Liste darunter.
        Der Punkt ist immer da (notfalls unsichtbar), damit die Zahlen in
        allen Zellen auf derselben Höhe sitzen.
      */
      const punkt = document.createElement('span');
      punkt.className = 'kal-punkt' + (!hier.length ? ' kal-punkt-leer'
        : (hier.every(istBezahlt) ? ' kal-punkt-ab' : ''));
      zelle.append(nummer, punkt);

      zelle.addEventListener('click', () => {
        kalTag = kalTag === tag ? null : tag;
        rendKalender();
      });
      grid.appendChild(zelle);
    }

    // Lesbare Liste unter dem Gitter - hier stehen die vollen Namen
    const gezeigt = kalTag == null ? termine : (proTag[kalTag] || []);
    const liste = knoten['kal-liste'];
    liste.innerHTML = '';
    for (const t of gezeigt) {
      const bezahlt = istBezahlt(t);
      const li = terminZeile(t.datum, t.posten.name, eur(t.posten.betrag), bezahlt ? 'bezahlt' : null,
        rhythmusText(t.posten));
      const marke = document.createElement('span');
      marke.className = 'marke ' + (bezahlt ? 'marke-ok' : 'marke-offen');
      marke.textContent = bezahlt ? 'bezahlt' : 'offen';
      li.appendChild(marke);
      liste.appendChild(li);
    }
    knoten['kal-titel'].textContent = kalTag == null
      ? 'Termine im ' + MONATE[kalMonat]
      : 'Am ' + kalTag + '. ' + MONATE[kalMonat];
    knoten['kal-alle'].hidden = kalTag == null;
    knoten['kal-liste-leer'].hidden = gezeigt.length > 0;
    knoten['kal-liste-leer'].textContent = kalTag != null ? 'An diesem Tag steht nichts an.'
      : (state.posten.length ? 'In diesem Monat steht nichts an.' : 'Noch keine Posten angelegt.');

    const offenSumme = summeOffen();
    knoten['kal-offen'].textContent = istAktuell
      ? (offenSumme ? 'Noch offen ' + eur(offenSumme) : 'Nichts mehr offen')
      : 'Summe ' + eur(termine.reduce((x, t) => x + t.posten.betrag, 0));
  }

  knoten['kal-alle'].addEventListener('click', () => {
    kalTag = null;
    rendKalender();
  });

  /*
    Ausgabe: schon beim Tippen zeigen, was danach frei bleibt, und die
    Warnung einblenden. Die Prüfung ist dieselbe pruefeAusgabe() wie beim
    Buchen - es gibt keine zweite Regel. Der Knopf heißt bei einer Warnung
    „Trotzdem ausgeben“; das ersetzt den früheren Bestätigungs-Dialog.
  */
  function rendAusgabeLive() {
    const betrag = zuCent(knoten['aus-betrag'].value);
    const gueltig = Number.isFinite(betrag) && betrag > 0;
    const offen = summeOffen();
    const frei = state.saldo - offen;
    const danach = frei - (gueltig ? betrag : 0);
    const pruefung = gueltig ? pruefeAusgabe(betrag) : null;
    const kritisch = !!pruefung && (!pruefung.ok || !!pruefung.warnung);
    const gezeigt = gueltig ? Math.max(0, Math.min(betrag, frei)) : 0;

    knoten['aus-danach'].textContent = eur(danach);
    knoten['aus-danach'].classList.toggle('negativ', danach < 0);
    balkenSetzen(knoten['aus-balken'], [
      ['frei', Math.max(0, frei) - gezeigt],
      [kritisch ? 'warn' : 'neutral', gezeigt],
      ['reserviert', offen],
    ]);

    const meldung = pruefung ? (pruefung.fehler || pruefung.warnung || '') : '';
    knoten['ausgabe-warnung'].textContent = meldung;
    knoten['ausgabe-warnung'].hidden = !meldung;
    knoten['aus-submit'].textContent = pruefung && pruefung.ok && pruefung.warnung
      ? 'Trotzdem ausgeben' : 'Ausgeben';

    const s = warnschwelle();
    knoten['ausgabe-schwelle'].textContent = s > 0
      ? 'Ab ' + eur(s + 1) + ' bekommst du eine Warnung (ein Drittel der offenen Posten).'
      : 'Aktuell keine offenen Posten – es wird nicht gewarnt.';
  }

  function rendEinzahlungLive() {
    const betrag = zuCent(knoten['ein-betrag'].value);
    const gueltig = Number.isFinite(betrag) && betrag > 0;
    knoten['ein-danach'].textContent = 'Konto danach: ' + eur(state.saldo + (gueltig ? betrag : 0));
  }

  knoten['aus-betrag'].addEventListener('input', rendAusgabeLive);
  knoten['ein-betrag'].addEventListener('input', rendEinzahlungLive);

  function rendAlle() {
    rendStart();
    rendPostenUebersicht();
    rendPostenListe();
    rendHistorie();
    rendVerlauf();
    rendKalender();
    rendAusgabeLive();
    rendEinzahlungLive();
    rendEinkaufSegment();
    rendEinheiten();
    rendEinkauf();
    rendVorrat();
    rendEkUrteil();
  }

  // ------------------------------------------- Einkauf, Vorrat & Barcode (UI)

  /*
    Barcode-Scanner über die BarcodeDetector-API des Browsers. Das ist eine
    eingebaute Schnittstelle (Chrome/Android), keine Bibliothek — damit bleibt
    „offline, keine Abhängigkeiten" erfüllt. Fehlt sie (iOS, Firefox, Desktop),
    bleibt das Feld zum Eintippen: der Scanner ist eine Abkürzung, kein
    Nadelöhr.

    Offline gibt es keine Produktdatenbank. Ein Barcode wird deshalb nur mit
    DEINEN Artikeln abgeglichen; unbekannte fragen einmal nach dem Namen.
  */

  let scannerZiel = null;      // Funktion, die den gefundenen Code bekommt
  let scannerStrom = null;     // MediaStream, muss beim Schließen enden
  let scannerLaeuft = false;

  const scannerMoeglich = () => typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function scannerStatus(text) {
    knoten['scanner-status'].textContent = text;
  }

  async function scannerOeffnen(ziel) {
    scannerZiel = ziel;
    knoten['scanner-ean'].value = '';
    knoten['scanner'].hidden = false;
    document.body.classList.add('fixiert');

    if (!scannerMoeglich()) {
      scannerStatus('Dieser Browser kann keine Barcodes lesen – Nummer bitte eintippen.');
      knoten['scanner-ean'].focus();
      return;
    }

    scannerStatus('Kamera wird geöffnet …');
    try {
      scannerStrom = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
    } catch (e) {
      scannerStatus('Kein Zugriff auf die Kamera – Nummer bitte eintippen.');
      knoten['scanner-ean'].focus();
      return;
    }
    // Während des Kamera-Starts kann längst wieder geschlossen worden sein
    if (knoten['scanner'].hidden) return scannerKameraAus();

    const video = knoten['scanner-video'];
    video.srcObject = scannerStrom;
    try {
      await video.play();
    } catch (e) { /* manche Browser spielen erst nach Interaktion */ }
    scannerStatus('Barcode in den Rahmen halten …');
    scannerSuchen();
  }

  async function scannerSuchen() {
    if (scannerLaeuft) return;
    scannerLaeuft = true;
    const detector = new window.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
    });
    const video = knoten['scanner-video'];
    while (!knoten['scanner'].hidden && scannerStrom) {
      try {
        const treffer = await detector.detect(video);
        const code = treffer.find(t => t.rawValue && /^\d{6,14}$/.test(t.rawValue.replace(/\D/g, '')));
        if (code) {
          const ean = code.rawValue.replace(/\D/g, '');
          scannerUebernehmen(ean);
          break;
        }
      } catch (e) { /* einzelne Frames dürfen fehlschlagen */ }
      await new Promise(w => setTimeout(w, 200));
    }
    scannerLaeuft = false;
  }

  function scannerKameraAus() {
    if (scannerStrom) {
      for (const spur of scannerStrom.getTracks()) spur.stop();
      scannerStrom = null;
    }
    const video = knoten['scanner-video'];
    if (video) video.srcObject = null;
  }

  function scannerSchliessen() {
    knoten['scanner'].hidden = true;
    scannerKameraAus();
    scannerZiel = null;
    // Das Haupt-Overlay bleibt offen -> Scrollsperre nur lösen, wenn es zu ist
    if (knoten['overlay'].hidden) document.body.classList.remove('fixiert');
  }

  function scannerUebernehmen(ean) {
    const ziel = scannerZiel;
    scannerSchliessen();
    if (ziel) ziel(String(ean).replace(/\D/g, ''));
  }

  knoten['scanner-zu'].addEventListener('click', scannerSchliessen);
  knoten['scanner'].addEventListener('click', e => {
    if (e.target === e.currentTarget) scannerSchliessen();
  });
  knoten['scanner-manuell'].addEventListener('submit', e => {
    e.preventDefault();
    const ean = knoten['scanner-ean'].value.replace(/\D/g, '');
    if (!ean) return scannerStatus('Bitte eine Nummer eingeben.');
    scannerUebernehmen(ean);
  });

  // --------------------------------------------------------------- Einkauf

  let ekEan = '';   // Barcode der gerade erfassten Position (nur UI-Zustand)

  // Der Artikel, auf den sich das Einkaufs-Formular gerade bezieht
  function ekArtikel() {
    return (ekEan ? artikelNachEan(ekEan) : null) || artikelNachName(knoten['ek-name'].value);
  }

  function rendVorschlaege() {
    const dl = knoten['ek-vorschlaege'];
    dl.innerHTML = '';
    for (const a of state.artikel.slice().sort((x, y) => x.name.localeCompare(y.name, 'de'))) {
      const o = document.createElement('option');
      o.value = a.name;
      o.label = a.bestPreis ? 'Bestpreis ' + eur(a.bestPreis) : '';
      dl.appendChild(o);
    }
  }

  function rendEkUrteil() {
    const feld = knoten['ek-urteil'];
    const a = ekArtikel();
    const preis = zuCent(knoten['ek-preis'].value);
    feld.className = 'fussnote';
    if (!a) {
      feld.textContent = ekEan ? 'Barcode ' + ekEan + ' – noch unbekannt, wird neu angelegt.' : '';
      return;
    }
    if (!(preis > 0)) {
      feld.textContent = a.bestPreis
        ? a.name + ': Bestpreis ' + eur(a.bestPreis) +
          (a.bestLaden ? ' bei ' + a.bestLaden : '') + ' · Vorrat ' + a.menge + ' ' + a.einheit
        : a.name + ': noch kein Preis erfasst · Vorrat ' + a.menge + ' ' + a.einheit;
      return;
    }
    const u = preisUrteil(a.id, preis);
    if (!u) { feld.textContent = ''; return; }
    feld.className = 'fussnote urteil urteil-' + u.stufe;
    feld.textContent = u.text;
  }

  function rendBudget() {
    const b = einkaufBudget();
    const kasten = knoten['einkauf-budget'];
    kasten.innerHTML = '';

    // Derselbe Kasten wie im Ausgabe-Blatt: was bleibt danach frei?
    const nachher = b.frei - b.summe;
    const kopf = document.createElement('div');
    kopf.className = 'budget-kopf';
    const label = document.createElement('span');
    label.textContent = 'Danach frei verfügbar';
    const wert = document.createElement('span');
    wert.className = 'budget-wert' + (nachher < 0 ? ' negativ' : '');
    wert.textContent = eur(nachher);
    kopf.append(label, wert);

    const balken = document.createElement('div');
    balken.className = 'balken';
    balken.setAttribute('aria-hidden', 'true');
    const gezeigt = Math.max(0, Math.min(b.summe, b.frei));
    balkenSetzen(balken, [
      ['frei', Math.max(0, b.frei) - gezeigt],
      [b.fehler || b.warnung ? 'warn' : 'neutral', gezeigt],
      ['reserviert', b.offen],
    ]);

    const fuss = document.createElement('span');
    fuss.className = 'budget-fuss';
    fuss.textContent = 'Einkauf ' + eur(b.summe) + ' · jetzt frei ' + eur(b.frei) +
      (b.offen ? ' · reserviert ' + eur(b.offen) : '');
    kasten.append(kopf, balken, fuss);

    knoten['ek-fuss'].hidden = state.einkauf.length === 0;
    knoten['ek-buchen-summe'].textContent = eur(b.summe);

    const warnBox = knoten['einkauf-warnung'];
    // „Liste ist leer“ steht schon unter der Liste - hier nicht noch einmal
    const meldung = state.einkauf.length ? (b.fehler || b.warnung || b.hinweis) : null;
    warnBox.textContent = meldung || '';
    warnBox.hidden = !meldung;
    warnBox.classList.toggle('warnung-sanft', !b.fehler && !b.warnung && !!b.hinweis);

    knoten['einkauf-summe'].textContent = b.positionen
      ? b.positionen + (b.positionen === 1 ? ' Position' : ' Positionen') + ' · ' +
        b.stueck + ' Stück · Summe ' + eur(b.summe) +
        (b.ohnePreis ? ' · ' + b.ohnePreis + ' ohne Preis' : '')
      : '';
  }

  function rendEinkauf() {
    const ul = knoten['einkauf-liste'];
    ul.innerHTML = '';
    for (const z of state.einkauf) {
      const a = z.artikelId ? artikelNachId(z.artikelId) : null;
      // Unter dem Namen: Stückpreis und das Urteil in zwei, drei Worten
      const u = a && z.preis > 0 ? preisUrteil(a.id, z.preis) : null;
      const kurz = !u ? '' : {
        best: 'Bestpreis',
        gut: 'guter Preis',
        ok: 'normal',
        neu: 'erster Preis',
        teuer: a.bestPreis ? Math.round((z.preis / a.bestPreis - 1) * 100) + ' % über Bestpreis' : 'teuer',
      }[u.stufe];

      const li = zeile(z.name, eur(z.preis * z.menge), null,
        z.preis > 0 ? eur(z.preis) + (kurz ? ' · ' + kurz : '') : 'noch kein Preis');
      if (u) li.querySelector('.z-unter').classList.add('urteil-' + u.stufe);

      const aktionen = document.createElement('span');
      aktionen.className = 'aktionen';

      const preisFeld = document.createElement('input');
      preisFeld.type = 'text';
      preisFeld.inputMode = 'decimal';
      preisFeld.className = 'inline-preis';
      preisFeld.value = z.preis > 0 ? (z.preis / 100).toFixed(2).replace('.', ',') : '';
      preisFeld.placeholder = 'Preis';
      preisFeld.setAttribute('aria-label', 'Preis für ' + z.name);
      // 'change' statt 'input': bei jedem Tastendruck neu zu rendern würde
      // den Fokus aus dem Feld reißen.
      preisFeld.addEventListener('change', () => {
        einkaufAendern(z.id, { preis: zuCent(preisFeld.value) });
        rendAlle();
      });

      const knopf = (text, label, tun) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-knopf';
        b.textContent = text;
        b.setAttribute('aria-label', label + ' – ' + z.name);
        b.addEventListener('click', tun);
        return b;
      };

      const stepper = document.createElement('span');
      stepper.className = 'stepper';
      const zahl = document.createElement('span');
      zahl.className = 'stepper-zahl';
      zahl.textContent = z.menge;
      const weniger = knopf('−', 'Menge verringern', () => {
        if (z.menge <= 1) einkaufEntfernen(z.id);
        else einkaufAendern(z.id, { menge: z.menge - 1 });
        rendAlle();
      });
      const mehr = knopf('+', 'Menge erhöhen', () => {
        einkaufAendern(z.id, { menge: z.menge + 1 });
        rendAlle();
      });
      // Im Stepper tragen die Knöpfe keinen eigenen Rahmen
      weniger.className = '';
      mehr.className = '';
      stepper.append(weniger, zahl, mehr);

      aktionen.append(
        preisFeld,
        stepper,
        knopf('✕', 'Von der Liste nehmen', () => {
          einkaufEntfernen(z.id);
          rendAlle();
        }),
      );
      li.appendChild(aktionen);
      ul.appendChild(li);
    }
    knoten['einkauf-leer'].hidden = state.einkauf.length > 0;
    rendBudget();
    rendVorschlaege();
  }

  function ekFormularLeeren() {
    ekEan = '';
    knoten['form-einkauf'].reset();
    knoten['ek-menge'].value = '1';
    rendEkUrteil();
  }

  knoten['ek-scan'].addEventListener('click', () => scannerOeffnen(ean => {
    ekEan = ean;
    const a = artikelNachEan(ean);
    if (a) {
      knoten['ek-name'].value = a.name;
      if (a.letzterPreis) knoten['ek-preis'].value = (a.letzterPreis / 100).toFixed(2).replace('.', ',');
      toast(a.name + ' erkannt.', 'ok');
      knoten['ek-preis'].focus();
    } else {
      knoten['ek-name'].value = '';
      toast('Barcode unbekannt – bitte Namen eintippen.');
      knoten['ek-name'].focus();
    }
    rendEkUrteil();
  }));

  for (const id of ['ek-name', 'ek-preis']) {
    knoten[id].addEventListener('input', rendEkUrteil);
  }

  knoten['form-einkauf'].addEventListener('submit', e => {
    e.preventDefault();
    const r = einkaufHinzu({
      name: knoten['ek-name'].value.trim(),
      ean: ekEan,
      menge: parseInt(knoten['ek-menge'].value, 10),
      preis: zuCent(knoten['ek-preis'].value),
    });
    if (!r.ok) return toast(r.fehler, 'warn');
    ekFormularLeeren();
    rendAlle();
    knoten['ek-name'].focus();
    toast(r.zusammengelegt ? 'Menge erhöht.' : 'Auf die Liste gesetzt.', 'ok');
  });

  knoten['ek-aus-vorrat'].addEventListener('click', () => {
    const r = einkaufAusVorrat();
    rendAlle();
    if (!r.gefunden) return toast('Nichts unter dem Mindestbestand.');
    toast(r.dazu ? r.dazu + (r.dazu === 1 ? ' Artikel ergänzt.' : ' Artikel ergänzt.') : 'Steht alles schon auf der Liste.',
      r.dazu ? 'ok' : null);
  });

  knoten['ek-buchen'].addEventListener('click', async () => {
    const echt = zuCent(knoten['ek-echt'].value);
    const laden = knoten['ek-laden'].value.trim();
    const geplant = einkaufSumme();
    const betrag = echt > 0 ? echt : geplant;

    if (!state.einkauf.length) return toast('Die Einkaufsliste ist leer.', 'warn');
    if (betrag <= 0) return toast('Bitte Preise eintragen oder die bezahlte Summe angeben.', 'warn');

    const pruefung = pruefeAusgabe(betrag);
    if (!pruefung.ok) return toast(pruefung.fehler, 'warn');
    if (pruefung.warnung &&
      !await frage(pruefung.warnung + '\n\nEinkauf trotzdem buchen?', 'Trotzdem buchen')) return;
    if (echt > 0 && Math.abs(echt - geplant) > 0 && geplant > 0 &&
      !await frage('Die Liste kommt auf ' + eur(geplant) + ', bezahlt wurden ' + eur(echt) +
        '. Gebucht wird der bezahlte Betrag. Weiter?', 'Buchen')) return;

    const r = einkaufAbschliessen(betrag, laden);
    if (!r.ok) return toast(r.fehler, 'warn');

    knoten['ek-echt'].value = '';
    ekFormularLeeren();
    rendAlle();

    const best = r.urteile.filter(u => u.stufe === 'best').length;
    const teuer = r.urteile.filter(u => u.stufe === 'teuer').length;
    const anhang = best ? ' · ' + best + '× Bestpreis' : (teuer ? ' · ' + teuer + '× über Bestpreis' : '');
    toast(eur(r.betrag) + ' gebucht, Vorrat aufgefüllt' + anhang + '.', 'ok');
  });

  knoten['ek-leeren'].addEventListener('click', async () => {
    if (!state.einkauf.length) return toast('Die Einkaufsliste ist schon leer.');
    if (!await frage('Einkaufsliste leeren? Es wird nichts gebucht.', 'Leeren')) return;
    einkaufLeeren();
    rendAlle();
    toast('Liste geleert.');
  });

  // ---------------------------------------------------------------- Vorrat

  function rendEinheiten() {
    const sel = knoten['art-einheit'];
    if (sel.options.length) return;   // nur einmal füllen
    for (const e of EINHEITEN) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = e;
      sel.appendChild(o);
    }
  }

  function rendVorrat() {
    const ul = knoten['vorrat-liste'];
    ul.innerHTML = '';
    const artikel = state.artikel.slice().sort((a, b) => {
      const aFehlt = a.mindest > 0 && a.menge <= a.mindest;
      const bFehlt = b.mindest > 0 && b.menge <= b.mindest;
      if (aFehlt !== bFehlt) return aFehlt ? -1 : 1;   // Fehlendes nach oben
      return a.name.localeCompare(b.name, 'de');
    });

    for (const a of artikel) {
      const unten = [];
      if (a.bestPreis) unten.push('Bestpreis ' + eur(a.bestPreis) + (a.bestLaden ? ' · ' + a.bestLaden : ''));
      if (a.letzterPreis && a.letzterPreis !== a.bestPreis) unten.push('zuletzt ' + eur(a.letzterPreis));
      if (a.mindest > 0) unten.push('mind. ' + a.mindest);
      if (a.ean) unten.push('Barcode ' + a.ean);

      const li = zeile(a.name, a.menge + ' ' + a.einheit, null,
        unten.join(' · ') || 'noch kein Preis erfasst');

      if (a.mindest > 0 && a.menge <= a.mindest) {
        const marke = document.createElement('span');
        marke.className = 'marke marke-offen';
        marke.textContent = a.menge === 0 ? 'leer' : 'nachkaufen';
        li.querySelector('.z-text').appendChild(marke);
      }

      const aktionen = document.createElement('span');
      aktionen.className = 'aktionen';
      const knopf = (text, label, klasse, tun) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-knopf' + (klasse ? ' ' + klasse : '');
        b.textContent = text;
        b.setAttribute('aria-label', label + ' – ' + a.name);
        b.addEventListener('click', tun);
        return b;
      };

      aktionen.append(
        knopf('−', 'Bestand verringern', null, () => { vorratAendern(a.id, -1); rendAlle(); }),
        knopf('+', 'Bestand erhöhen', null, () => { vorratAendern(a.id, 1); rendAlle(); }),
        knopf('Liste', 'Auf die Einkaufsliste', null, () => {
          const r = einkaufHinzu({ artikelId: a.id, menge: 1 });
          rendAlle();
          toast(r.ok ? a.name + ' auf die Liste.' : r.fehler, r.ok ? 'ok' : 'warn');
        }),
        knopf('Ändern', 'Artikel bearbeiten', null, () => artikelBearbeiten(a)),
        knopf('✕', 'Artikel löschen', 'gefahr-knopf', async () => {
          if (!await frage('„' + a.name + '" löschen? Vorrat und Preis-Historie gehen verloren.', 'Löschen')) return;
          artikelLoeschen(a.id);
          rendAlle();
          toast('Artikel gelöscht.');
        }),
      );
      li.appendChild(aktionen);
      ul.appendChild(li);
    }

    knoten['vorrat-leer'].hidden = artikel.length > 0;

    const fehlt = nachkaufen();
    knoten['vorrat-hinweis'].textContent = !state.artikel.length
      ? 'Lege Artikel an, die du regelmäßig kaufst. Jeder Einkauf merkt sich dann den Preis – so siehst du, ob ein Angebot wirklich günstig ist.'
      : (fehlt.length
        ? fehlt.length + (fehlt.length === 1 ? ' Artikel ist' : ' Artikel sind') +
          ' auf dem Mindestbestand: ' + fehlt.map(a => a.name).join(', ') + '.'
        : state.artikel.length + ' Artikel im Vorrat, nichts fehlt.');
  }

  function artikelBearbeiten(a) {
    overlayOeffnen('vorrat', 'Artikel ändern');
    knoten['art-id'].value = a.id;
    knoten['art-name'].value = a.name;
    knoten['art-ean'].value = a.ean;
    knoten['art-einheit'].value = a.einheit;
    knoten['art-menge'].value = a.menge;
    knoten['art-mindest'].value = a.mindest;
    knoten['art-submit'].textContent = 'Änderung speichern';
  }

  function artikelFormularLeeren() {
    knoten['art-id'].value = '';
    knoten['form-artikel'].reset();
    knoten['art-einheit'].value = 'Stk';
    knoten['art-menge'].value = '0';
    knoten['art-mindest'].value = '0';
    knoten['art-submit'].textContent = 'Artikel anlegen';
  }

  knoten['art-abbrechen'].addEventListener('click', () => overlaySchliessen());

  knoten['art-scan'].addEventListener('click', () => scannerOeffnen(ean => {
    const schon = artikelNachEan(ean);
    if (schon && schon.id !== knoten['art-id'].value) {
      artikelBearbeiten(schon);
      return toast('Barcode gehört zu „' + schon.name + '" – zum Bearbeiten geöffnet.');
    }
    knoten['art-ean'].value = ean;
    knoten['art-name'].focus();
  }));

  knoten['form-artikel'].addEventListener('submit', e => {
    e.preventDefault();
    const r = artikelSpeichern({
      id: knoten['art-id'].value || null,
      name: knoten['art-name'].value.trim(),
      ean: knoten['art-ean'].value,
      einheit: knoten['art-einheit'].value,
      menge: parseInt(knoten['art-menge'].value, 10),
      mindest: parseInt(knoten['art-mindest'].value, 10),
    });
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast(r.bearbeitet ? 'Artikel geändert.' : 'Artikel angelegt.', 'ok');
  });

  // ---------------------------------------------------------------- Overlays

  /*
    Die Formulare liegen in einem Blatt, das von unten hochfährt. Jedes
    Element mit data-oeffnet="name" öffnet den Inhalt data-body="name".
  */
  const OVERLAY_TITEL = {
    einzahlung: 'Einzahlen',
    ausgabe: 'Ausgabe',
    posten: 'Neuer Posten',
    vorrat: 'Neuer Artikel',
    einstellungen: 'Einstellungen',
  };

  function overlayOeffnen(name, titel) {
    const overlay = knoten['overlay'];
    knoten['overlay-titel'].textContent = titel || OVERLAY_TITEL[name] || '';
    for (const body of overlay.querySelectorAll('.overlay-body')) {
      body.hidden = body.getAttribute('data-body') !== name;
    }
    overlay.hidden = false;
    document.body.classList.add('fixiert');
    if (name === 'ausgabe') rendAusgabeLive();
    if (name === 'einzahlung') rendEinzahlungLive();
    const ersterInput = overlay.querySelector('.overlay-body:not([hidden]) input:not([type="hidden"]):not([type="file"])');
    if (ersterInput) setTimeout(() => ersterInput.focus(), 50);
  }

  function overlaySchliessen() {
    // Ein offener Scanner gehoert zum Blatt - er darf nicht dahinter
    // weiterlaufen und die Kamera belegen.
    if (!knoten['scanner'].hidden) scannerSchliessen();
    knoten['overlay'].hidden = true;
    document.body.classList.remove('fixiert');
    // Beim nächsten Öffnen soll kein halb getippter Betrag mehr dastehen
    knoten['form-einzahlung'].reset();
    knoten['form-ausgabe'].reset();
    postenFormularLeeren();
    artikelFormularLeeren();
    rendAusgabeLive();
    rendEinzahlungLive();
  }

  for (const k of document.querySelectorAll('[data-oeffnet]')) {
    k.addEventListener('click', () => overlayOeffnen(k.getAttribute('data-oeffnet')));
  }
  knoten['overlay-schliessen'].addEventListener('click', overlaySchliessen);
  knoten['overlay'].addEventListener('click', e => {
    if (e.target === e.currentTarget) overlaySchliessen();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!knoten['frage'].hidden && frageAntwort) frageAntwort(false);
    else if (!knoten['scanner'].hidden) scannerSchliessen();
    else if (!knoten['overlay'].hidden) overlaySchliessen();
  });

  // ------------------------------------------------------------ Navigation

  // Jede Ansicht ist ein <section data-ansicht>, die Leiste unten schaltet um
  function tabZeigen(name) {
    for (const a of document.querySelectorAll('[data-ansicht]')) {
      a.hidden = a.getAttribute('data-ansicht') !== name;
    }
    for (const t of document.querySelectorAll('.tab')) {
      if (t.getAttribute('data-tab') === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  // data-tab tragen die Leiste und Abkürzungen wie „Alle Posten“
  for (const t of document.querySelectorAll('[data-tab]')) {
    t.addEventListener('click', () => tabZeigen(t.getAttribute('data-tab')));
  }

  // Einkauf: Liste und Vorrat teilen sich eine Ansicht
  function einkaufTeilZeigen(name) {
    for (const p of document.querySelectorAll('[data-panel]')) {
      p.hidden = p.getAttribute('data-panel') !== name;
    }
    for (const b of knoten['seg-einkauf'].querySelectorAll('[data-seg]')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-seg') === name ? 'true' : 'false');
    }
  }

  for (const b of knoten['seg-einkauf'].querySelectorAll('[data-seg]')) {
    b.addEventListener('click', () => einkaufTeilZeigen(b.getAttribute('data-seg')));
  }

  // Die Umschalter zeigen gleich, wie viel drinsteckt
  function rendEinkaufSegment() {
    const fehlt = nachkaufen().length;
    for (const b of knoten['seg-einkauf'].querySelectorAll('[data-seg]')) {
      b.textContent = b.getAttribute('data-seg') === 'liste'
        ? 'Liste' + (state.einkauf.length ? ' · ' + state.einkauf.length : '')
        : 'Vorrat' + (fehlt ? ' · ' + fehlt + ' nachkaufen' : '');
    }
  }

  // ------------------------------------------------- UI-Zustand & Farbschema

  /*
    Was nur die Oberfläche betrifft (das gewählte Farbschema), gehört nicht
    zu den Spardaten und liegt in einem eigenen Schlüssel - ein Backup-Import
    soll es nicht mitbringen.
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

  /*
    Farbschema: „system“ folgt dem Gerät (kein Attribut am <html>), „hell“ und
    „dunkel“ erzwingen eines über data-thema. Ein kleines Skript im <head>
    setzt das Attribut schon vor dem ersten Zeichnen; hier kommen die
    Knöpfe und die Farbe der Browser-Leiste dazu.
  */
  function themaAnwenden() {
    const thema = uiStand.thema === 'hell' || uiStand.thema === 'dunkel' ? uiStand.thema : 'system';
    const wurzel = document.documentElement;
    if (thema === 'system') wurzel.removeAttribute('data-thema');
    else wurzel.setAttribute('data-thema', thema);
    for (const b of knoten['thema-wahl'].querySelectorAll('button')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-thema') === thema ? 'true' : 'false');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    const grund = getComputedStyle(wurzel).getPropertyValue('--bg').trim();
    if (meta && grund) meta.setAttribute('content', grund);
  }

  for (const b of knoten['thema-wahl'].querySelectorAll('button')) {
    b.addEventListener('click', () => {
      uiStand.thema = b.getAttribute('data-thema');
      speichereUiStand(uiStand);
      themaAnwenden();
    });
  }

  // Wechselt das Gerät sein Schema, muss die Browser-Leiste mitziehen
  if (window.matchMedia) {
    const abfrage = window.matchMedia('(prefers-color-scheme: dark)');
    if (abfrage.addEventListener) abfrage.addEventListener('change', themaAnwenden);
    else if (abfrage.addListener) abfrage.addListener(themaAnwenden);
  }
  themaAnwenden();

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

  knoten['form-ausgabe'].addEventListener('submit', e => {
    e.preventDefault();
    const betrag = zuCent(knoten['aus-betrag'].value);
    const notiz = knoten['aus-notiz'].value.trim();

    /*
      Die Warnung steht schon beim Tippen im Blatt und der Knopf heißt dann
      „Trotzdem ausgeben“ - ein zweiter Dialog würde nur dasselbe fragen.
      Ein Fehler (leer, zu viel) wird im selben Kasten gezeigt.
    */
    const pruefung = pruefeAusgabe(betrag);
    if (!pruefung.ok) {
      knoten['ausgabe-warnung'].textContent = pruefung.fehler;
      knoten['ausgabe-warnung'].hidden = false;
      knoten['aus-betrag'].focus();
      return;
    }
    const r = ausgeben(betrag, notiz);
    if (!r.ok) return toast(r.fehler, 'warn');
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

    const [optMonat, optWoche] = knoten['post-einheit'].options;
    optMonat.text = intervall === 1 ? 'Monat' : 'Monate';
    optWoche.text = intervall === 1 ? 'Woche' : 'Wochen';

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
    overlayOeffnen('posten', 'Posten ändern');
    knoten['post-id'].value = p.id;
    knoten['post-name'].value = p.name;
    knoten['post-betrag'].value = (p.betrag / 100).toFixed(2).replace('.', ',');
    knoten['post-einheit'].value = p.rhythmus;
    knoten['post-intervall'].value = p.intervall;
    knoten['post-tag'].value = p.tag;
    knoten['post-start'].value = p.start;
    rhythmusFelderUmschalten();
    knoten['post-submit'].textContent = 'Änderung speichern';
  }

  function postenFormularLeeren() {
    knoten['post-id'].value = '';
    knoten['form-posten'].reset();
    knoten['post-einheit'].value = 'monat';
    knoten['post-intervall'].value = '1';
    rhythmusFelderUmschalten();
    knoten['post-submit'].textContent = 'Posten hinzufügen';
  }

  knoten['post-abbrechen'].addEventListener('click', () => overlaySchliessen());

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
    rendAlle();
    overlaySchliessen();
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

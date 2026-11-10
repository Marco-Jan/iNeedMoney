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

let state = { saldo: 0, posten: [], transaktionen: [], artikel: [], einkauf: [], wuensche: [], sparziel: null };

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
        typ: ['einzahlung', 'posten', 'sparen', 'entnahme', 'korrektur'].includes(t.typ) ? t.typ : 'ausgabe',
        betrag: zahl(t.betrag),
        datum: String(t.datum || heuteISO()),
        name: String(t.name || ''),
        ...(t.art === 'einkauf' || t.art === 'wunsch' ? { art: t.art } : {}),
        ...(t.gewarnt === true ? { gewarnt: true } : {}),
        ...(t.typ === 'korrektur' && t.plus === true ? { plus: true } : {}),
      })) : [],
    artikel: Array.isArray(roh.artikel) ? roh.artikel
      .filter(a => a && typeof a === 'object')
      .map(artikelNormalisieren) : [],
    einkauf: Array.isArray(roh.einkauf) ? roh.einkauf
      .filter(z => z && typeof z === 'object')
      .map(einkaufPosNormalisieren) : [],
    sparziel: sparzielNormalisieren(roh.sparziel),
    wuensche: Array.isArray(roh.wuensche) ? roh.wuensche
      .filter(w => w && typeof w === 'object' && Number.isFinite(w.betrag) && w.betrag > 0)
      .slice(0, MAX_WUENSCHE)
      .map(wunschNormalisieren) : [],
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

/*
  `extra` trägt bei Ausgaben zwei optionale Angaben für die Musteranzeige:
    art: 'einkauf' | 'wunsch'   woher die Ausgabe kam (ohne = spontan erfasst)
    gewarnt: true               sie wurde trotz Warnung gebucht
*/
function transaktion(typ, betrag, name, extra) {
  state.transaktionen.unshift(Object.assign(
    { id: neueId(), typ, betrag, datum: heuteISO(), name: name || '' }, extra || {}));
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
  Tagesbudget
  -----------
  Die Drittel-Regel allein hat ein Loch: sind alle Posten des Monats bezahlt,
  ist die Schwelle 0 und es wird gar nicht mehr gewarnt - ausgerechnet am
  Monatsende, wenn es eng wird. Deshalb gibt es eine zweite Regel, die am
  freien Geld hängt:

      Tagesbudget = frei verfügbar / Tage bis Monatsende (heute zählt mit)

  Gewarnt wird, wenn eine Ausgabe mehr als BUDGET_TAGE_WARNUNG Tagesbudgets
  kostet, oder wenn sie mehr ist als das freie Geld überhaupt.
*/
const BUDGET_TAGE_WARNUNG = 3;

function restTage() {
  const jetzt = new Date();
  return tageImMonat(jetzt.getFullYear(), jetzt.getMonth()) - jetzt.getDate() + 1;
}

function freiVerfuegbar() {
  return state.saldo - summeOffen();
}

function tagesbudget() {
  return Math.floor(Math.max(0, freiVerfuegbar()) / restTage());
}

// Ein Betrag in Tagen Budget: "3,1" oder ab zehn Tagen gerundet "12"
function budgetTageText(betrag) {
  const budget = tagesbudget();
  if (!(budget > 0) || !(betrag > 0)) return null;
  const tage = betrag / budget;
  return tage >= 10 ? String(Math.round(tage)) : tage.toFixed(1).replace('.', ',');
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
/*
  Kontostand von Hand richtigstellen, wenn App und echtes Konto auseinander
  gelaufen sind (vergessene Buchung, Tippfehler). Der Unterschied wird als
  eigene Buchungsart 'korrektur' festgehalten - sie zählt weder als Ausgabe
  noch als Einzahlung, damit Monatszahlen und Musteranzeige ehrlich bleiben.
  `plus: true` heißt: das Konto wurde nach oben korrigiert.
*/
function saldoKorrigieren(neuerSaldo, notiz) {
  if (!Number.isFinite(neuerSaldo)) return { ok: false, fehler: 'Bitte den richtigen Kontostand eingeben.' };
  const neu = Math.round(neuerSaldo);
  const differenz = neu - state.saldo;
  if (differenz === 0) return { ok: false, fehler: 'Das ist schon dein Kontostand.' };
  state.saldo = neu;
  transaktion('korrektur', Math.abs(differenz), String(notiz || '').trim() || 'Kontostand korrigiert',
    differenz > 0 ? { plus: true } : {});
  speichere();
  return { ok: true, differenz, saldo: neu };
}

function pruefeAusgabe(betrag, grundbedarf) {
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  if (betrag > state.saldo) {
    return { ok: false, fehler: 'Dein Konto (' + eur(state.saldo) + ') reicht für ' + eur(betrag) + ' nicht aus.' };
  }
  /*
    Drei Gründe für eine Warnung. `gruende` nennt sie als Kürzel (für Tests
    und die Oberfläche), `warnung` ist der fertige Text oder null.
  */
  const gruende = [];
  const texte = [];
  const frei = freiVerfuegbar();
  const budget = tagesbudget();
  /*
    Grundbedarf (Lebensmittel aus dem Vorrat) ist kein Impulskauf: dieser
    Anteil zählt für die Budget- und die Drittel-Regel nicht mit. Die Regel
    „mehr als frei verfügbar“ gilt weiter für den ganzen Betrag - auch Brot
    darf nicht unbemerkt das Geld für die Miete nehmen.
  */
  const gedeckt = Math.max(0, Math.min(betrag, Number.isFinite(grundbedarf) ? Math.round(grundbedarf) : 0));
  const rest = betrag - gedeckt;

  if (betrag > Math.max(0, frei)) {
    // Mehr als das freie Geld: der Rest ginge an reservierte Posten
    gruende.push('reserviert');
    texte.push(eur(betrag) + ' ist mehr, als du frei hast (' + eur(Math.max(0, frei)) +
      '). Es fehlen dann ' + eur(betrag - frei) + ' für deine offenen Posten.');
  } else if (budget > 0 && rest > budget * BUDGET_TAGE_WARNUNG) {
    gruende.push('budget');
    texte.push(eur(rest) + ' sind ' + budgetTageText(rest) + ' Tage deines Budgets (' +
      eur(budget) + ' pro Tag bis Monatsende).');
  }

  // Termine zählen, nicht Posten - dieselbe Summe wie warnschwelle() und die
  // Startseite. Ein 14-Tage-Posten, der zweimal im Monat fällt, zählt zweimal.
  const termine = offeneTermine();
  const offen = summeOffen();
  if (offen > 0 && rest > warnschwelle()) {
    gruende.push('drittel');
    texte.push(eur(rest) + ' ist mehr als ein Drittel deiner noch offenen Posten (' + eur(offen) +
      ' in ' + termine.length + (termine.length === 1 ? ' Termin' : ' Terminen') + '). Das könnte deinen Sparplan kippen.');
  }
  if (gedeckt > 0 && (gruende.includes('budget') || gruende.includes('drittel'))) {
    texte.unshift('Neben ' + eur(gedeckt) + ' Grundbedarf sind es ' + eur(rest) + ' für anderes.');
  }
  return { ok: true, warnung: texte.length ? texte.join(' ') : null, gruende, grundbedarf: gedeckt };
}

function ausgeben(betrag, notiz, art, grundbedarf) {
  const p = pruefeAusgabe(betrag, grundbedarf);
  if (!p.ok) return p;
  state.saldo -= betrag;
  const extra = {};
  if (art === 'einkauf' || art === 'wunsch') extra.art = art;
  if (p.warnung) extra.gewarnt = true;
  transaktion('ausgabe', betrag, notiz, extra);
  speichere();
  return { ok: true, warnung: p.warnung, gruende: p.gruende };
}

/*
  Das eigene Muster: wie oft und wie viel ging diesen Monat spontan raus, und
  wie oft trotz Warnung? Ein gebuchter Einkauf von der Liste zählt nicht als
  spontan, ein nach der Abkühlzeit gekaufter Wunsch auch nicht - der war ja
  gerade überlegt.
*/
function monatsMuster(monatsKey) {
  const key = monatsKey || heute().monatsKey;
  const imMonat = state.transaktionen.filter(t => t.typ === 'ausgabe' && String(t.datum).slice(0, 7) === key);
  const spontan = imMonat.filter(t => !t.art);
  const trotz = spontan.filter(t => t.gewarnt);
  const verworfen = state.wuensche.filter(w => w.status === 'verworfen' && String(w.entschieden).slice(0, 7) === key);
  return {
    anzahl: spontan.length,
    summe: summe(spontan),
    trotzWarnung: trotz.length,
    summeTrotz: summe(trotz),
    verworfen: verworfen.length,
    gespart: summe(verworfen),
  };
}

/*
  Wunschliste mit Abkühlzeit
  --------------------------
  Gegen Impulskäufe hilft vor allem Zeit zwischen Wunsch und Kauf. Ein Wunsch
  wird geparkt und kann erst nach ABKUEHL_STUNDEN gekauft werden; verwerfen
  geht jederzeit. Was verworfen wird, zählt als gespart.

      { id, name, betrag, erstellt (Zeitstempel in ms),
        status: 'offen' | 'gekauft' | 'verworfen', entschieden (ISO-Datum) }

  Alle Funktionen nehmen optional `jetzt` (ms) entgegen, damit der Test die
  Uhr vorstellen kann.
*/
const ABKUEHL_STUNDEN = 48;
const MAX_WUENSCHE = 200;
const STUNDE_MS = 3600000;

function wunschNormalisieren(w) {
  const status = w.status === 'gekauft' || w.status === 'verworfen' ? w.status : 'offen';
  return {
    id: String(w.id != null ? w.id : neueId()),
    name: String(w.name || 'Wunsch'),
    betrag: Math.round(w.betrag),
    erstellt: Number.isFinite(w.erstellt) ? Math.round(w.erstellt) : Date.now(),
    status,
    entschieden: status === 'offen' ? null : String(w.entschieden || heuteISO()),
  };
}

function wunschNachId(id) {
  return state.wuensche.find(w => w.id === String(id)) || null;
}

function wunschSpeichern({ name, betrag }, jetzt) {
  const sauber = String(name || '').trim();
  if (!sauber) return { ok: false, fehler: 'Bitte eintragen, was du haben willst.' };
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  const wunsch = wunschNormalisieren({
    name: sauber, betrag, erstellt: Number.isFinite(jetzt) ? jetzt : Date.now(),
  });
  state.wuensche.unshift(wunsch);
  // Alte, längst entschiedene Wünsche fallen hinten raus - offene nie
  if (state.wuensche.length > MAX_WUENSCHE) {
    const offen = state.wuensche.filter(w => w.status === 'offen');
    const rest = state.wuensche.filter(w => w.status !== 'offen');
    state.wuensche = offen.concat(rest).slice(0, Math.max(MAX_WUENSCHE, offen.length));
  }
  speichere();
  return { ok: true, wunsch };
}

// Volle Stunden, bis der Wunsch gekauft werden darf (0 = Wartezeit vorbei)
function wunschRestStunden(w, jetzt) {
  const zeit = Number.isFinite(jetzt) ? jetzt : Date.now();
  return Math.max(0, Math.ceil((w.erstellt + ABKUEHL_STUNDEN * STUNDE_MS - zeit) / STUNDE_MS));
}

function wunschReif(w, jetzt) {
  return wunschRestStunden(w, jetzt) === 0;
}

// Offene Wünsche, die ältesten (also am ehesten reifen) zuerst
function offeneWuensche() {
  return state.wuensche.filter(w => w.status === 'offen').sort((a, b) => a.erstellt - b.erstellt);
}

function wunschVerwerfen(id) {
  const w = wunschNachId(id);
  if (!w || w.status !== 'offen') return { ok: false, fehler: 'Diesen Wunsch gibt es nicht mehr.' };
  w.status = 'verworfen';
  w.entschieden = heuteISO();
  speichere();
  return { ok: true, gespart: w.betrag };
}

/*
  Kaufen bucht eine ganz normale Ausgabe über ausgeben() - mit derselben
  Prüfung und denselben Warnungen. Vor Ablauf der Wartezeit geht es nicht.
*/
function wunschKaufen(id, jetzt) {
  const w = wunschNachId(id);
  if (!w || w.status !== 'offen') return { ok: false, fehler: 'Diesen Wunsch gibt es nicht mehr.' };
  const rest = wunschRestStunden(w, jetzt);
  if (rest > 0) {
    return { ok: false, fehler: 'Noch ' + rest + (rest === 1 ? ' Stunde' : ' Stunden') + ' Abkühlzeit.' };
  }
  const r = ausgeben(w.betrag, w.name, 'wunsch');
  if (!r.ok) return r;
  w.status = 'gekauft';
  w.entschieden = heuteISO();
  speichere();
  return { ok: true, betrag: w.betrag, warnung: r.warnung };
}

/*
  Sparziel: ein eigener Topf
  --------------------------
  Zurückgelegtes Geld verlässt das Konto und damit „frei verfügbar" - es
  sieht nicht mehr ausgebbar aus. Genau das ist der Zweck.

      state.sparziel = { name, ziel, gespart } | null     (Beträge in Cent)

  Bewegungen stehen als eigene Buchungsarten in der Historie: 'sparen'
  (Konto -> Topf) und 'entnahme' (Topf -> Konto). Sie sind weder Ausgabe
  noch Einzahlung und tauchen deshalb in keiner Monatszahl auf.
*/
function sparzielNormalisieren(z) {
  if (!z || typeof z !== 'object' || !Number.isFinite(z.ziel) || z.ziel <= 0) return null;
  return {
    name: String(z.name || 'Sparziel'),
    ziel: Math.round(z.ziel),
    gespart: Number.isFinite(z.gespart) && z.gespart > 0 ? Math.round(z.gespart) : 0,
  };
}

// Anlegen oder Name/Zielbetrag ändern - was schon im Topf liegt, bleibt
function sparzielSetzen({ name, ziel }) {
  const sauber = String(name || '').trim();
  if (!sauber) return { ok: false, fehler: 'Bitte eintragen, wofür du sparst.' };
  if (!Number.isFinite(ziel) || ziel <= 0) return { ok: false, fehler: 'Bitte einen Zielbetrag größer als 0 eingeben.' };
  const neu = !state.sparziel;
  state.sparziel = { name: sauber, ziel: Math.round(ziel), gespart: state.sparziel ? state.sparziel.gespart : 0 };
  speichere();
  return { ok: true, neu };
}

function sparzielStand() {
  const z = state.sparziel;
  if (!z) return null;
  return {
    name: z.name,
    ziel: z.ziel,
    gespart: z.gespart,
    rest: Math.max(0, z.ziel - z.gespart),
    anteil: Math.min(1, z.gespart / z.ziel),
    erreicht: z.gespart >= z.ziel,
  };
}

/*
  Zurücklegen geht nur aus dem freien Geld. Mehr würde Geld in den Topf
  schieben, das für offene Posten gebraucht wird - das Sparziel sähe gut aus
  und der Strom platzt.
*/
function sparzielEinzahlen(betrag) {
  if (!state.sparziel) return { ok: false, fehler: 'Lege zuerst ein Sparziel an.' };
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  const frei = Math.max(0, freiVerfuegbar());
  if (betrag > frei) {
    return { ok: false, fehler: 'Du kannst höchstens ' + eur(frei) + ' zurücklegen – der Rest ist für offene Posten reserviert.' };
  }
  const vorher = state.sparziel.gespart >= state.sparziel.ziel;
  state.saldo -= betrag;
  state.sparziel.gespart += betrag;
  transaktion('sparen', betrag, state.sparziel.name);
  speichere();
  return { ok: true, erreicht: !vorher && state.sparziel.gespart >= state.sparziel.ziel };
}

function sparzielEntnehmen(betrag) {
  if (!state.sparziel) return { ok: false, fehler: 'Es gibt kein Sparziel.' };
  if (!Number.isFinite(betrag) || betrag <= 0) return { ok: false, fehler: 'Bitte einen Betrag größer als 0 eingeben.' };
  if (betrag > state.sparziel.gespart) {
    return { ok: false, fehler: 'Im Topf liegen nur ' + eur(state.sparziel.gespart) + '.' };
  }
  state.sparziel.gespart -= betrag;
  state.saldo += betrag;
  transaktion('entnahme', betrag, state.sparziel.name);
  speichere();
  return { ok: true };
}

// Auflösen: was im Topf liegt, geht zurück aufs Konto - es verschwindet nie
function sparzielAufloesen() {
  if (!state.sparziel) return { ok: false, fehler: 'Es gibt kein Sparziel.' };
  const zurueck = state.sparziel.gespart;
  if (zurueck > 0) {
    state.saldo += zurueck;
    transaktion('entnahme', zurueck, state.sparziel.name);
  }
  state.sparziel = null;
  speichere();
  return { ok: true, zurueck };
}

// Was in den letzten 30 Tagen netto pro Tag in den Topf ging (Cent, nie negativ)
function sparRateProTag() {
  const d = new Date();
  const ab = isoVon(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 30));
  const netto = state.transaktionen.reduce((s, t) => {
    if (String(t.datum) < ab) return s;
    return s + (t.typ === 'sparen' ? t.betrag : t.typ === 'entnahme' ? -t.betrag : 0);
  }, 0);
  return Math.max(0, netto) / 30;
}

/*
  Eine Ausgabe gegen das Sparziel stellen. Mit Spar-Tempo: "so lange sparst
  du dafür". Ohne (noch nichts zurückgelegt): als Anteil an dem, was fehlt.
  Kein "verschiebt dein Ziel um ..." - das wäre nur wahr, wenn das Geld sonst
  sicher im Topf gelandet wäre.
*/
function sparzielVergleich(betrag) {
  const s = sparzielStand();
  if (!s || s.erreicht || !Number.isFinite(betrag) || betrag <= 0) return null;
  if (betrag >= s.rest) return 'Damit wäre „' + s.name + '“ auf einen Schlag erreicht.';
  const rate = sparRateProTag();
  const tage = rate > 0 ? Math.round(betrag / rate) : 0;
  if (tage >= 1) {
    return 'Dafür sparst du etwa ' + tage + (tage === 1 ? ' Tag' : ' Tage') + ' für „' + s.name + '“.';
  }
  const prozent = Math.round(betrag / s.rest * 100);
  return prozent >= 1 ? 'Das sind ' + prozent + ' % von dem, was dir für „' + s.name + '“ noch fehlt.' : null;
}

// Was die Wunschliste bisher gebracht hat
function wunschBilanz() {
  const verworfen = state.wuensche.filter(w => w.status === 'verworfen');
  return {
    verworfen: verworfen.length,
    gespart: summe(verworfen),
    gekauft: state.wuensche.filter(w => w.status === 'gekauft').length,
    offen: state.wuensche.filter(w => w.status === 'offen').length,
  };
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
  state = { saldo: 0, posten: [], transaktionen: [], artikel: [], einkauf: [], wuensche: [], sparziel: null };
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
    // Grundbedarf (z. B. Lebensmittel): Käufe davon lösen keine Impuls-Warnung aus
    grundbedarf: a.grundbedarf === true,
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

function artikelSpeichern({ id, ean, name, einheit, menge, mindest, grundbedarf }) {
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
    grundbedarf: typeof grundbedarf === 'boolean' ? grundbedarf : (vorhanden ? vorhanden.grundbedarf : false),
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

// Der Teil der Einkaufsliste, der Grundbedarf ist (in Cent)
function einkaufGrundbedarf() {
  return state.einkauf.reduce((x, z) => {
    const a = z.artikelId ? artikelNachId(z.artikelId) : null;
    return x + (a && a.grundbedarf ? z.preis * z.menge : 0);
  }, 0);
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
    grundbedarf: einkaufGrundbedarf(),
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
  const pruefung = pruefeAusgabe(gesamt, einkaufGrundbedarf());
  return {
    ...basis,
    ok: pruefung.ok,
    fehler: pruefung.fehler || null,
    warnung: pruefung.warnung || null,
    // „Geht an reservierte Posten“ steckt inzwischen in pruefeAusgabe() selbst
    hinweis: null,
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

  const grund = einkaufGrundbedarf();
  const pruefung = pruefeAusgabe(betrag, grund);
  if (!pruefung.ok) return pruefung;

  const notiz = 'Einkauf' + (laden ? ' ' + String(laden).trim() : '') +
    ' · ' + state.einkauf.length + (state.einkauf.length === 1 ? ' Position' : ' Positionen');
  const r = ausgeben(betrag, notiz, 'einkauf', grund);
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

/*
  Sofortkauf im Laden: scannen, Preis bestätigen, fertig. Bucht EINEN Artikel
  direkt vom Konto, merkt sich den Preis, füllt den Vorrat und streicht ihn
  von der Einkaufsliste, falls er dort steht.

  Grundbedarf wird als geplanter Einkauf gebucht und warnt nur, wenn das
  freie Geld nicht reicht. Alles andere ist eine spontane Ausgabe wie jede
  andere - mit allen Warnungen und in der Musteranzeige.
*/
function sofortKauf({ artikelId, ean, name, preis, menge, grundbedarf, laden }) {
  const eanSauber = String(ean || '').replace(/\D/g, '').slice(0, 14);
  const bezeichnung = String(name || '').trim();
  let a = (artikelId ? artikelNachId(artikelId) : null) ||
    (eanSauber ? artikelNachEan(eanSauber) : null) || artikelNachName(bezeichnung);
  if (!a && !bezeichnung) return { ok: false, fehler: 'Bitte einen Namen eingeben.' };

  const stueckpreis = Number.isFinite(preis) && preis > 0 ? Math.round(preis)
    : (a && a.letzterPreis ? a.letzterPreis : 0);
  if (stueckpreis <= 0) return { ok: false, fehler: 'Bitte den Preis eingeben.' };
  const anzahl = Math.max(1, Math.round(Number.isFinite(menge) ? menge : 1));
  const betrag = stueckpreis * anzahl;
  const grund = typeof grundbedarf === 'boolean' ? grundbedarf : !!(a && a.grundbedarf);

  // Erst prüfen, dann anlegen: ein abgelehnter Kauf hinterlässt keinen Artikel
  const pruefung = pruefeAusgabe(betrag, grund ? betrag : 0);
  if (!pruefung.ok) return pruefung;

  if (!a) {
    const neu = artikelSpeichern({ ean: eanSauber, name: bezeichnung, grundbedarf: grund });
    if (!neu.ok) return neu;
    a = neu.artikel;
  } else {
    a.grundbedarf = grund;
    if (!a.ean && eanSauber && !artikelNachEan(eanSauber)) a.ean = eanSauber;
  }

  const urteil = preisUrteil(a.id, stueckpreis);
  const r = ausgeben(betrag, (anzahl > 1 ? anzahl + '× ' : '') + a.name,
    grund ? 'einkauf' : undefined, grund ? betrag : 0);
  if (!r.ok) return r;

  a.preise.unshift({ preis: stueckpreis, datum: heuteISO(), laden: String(laden || '') });
  if (a.preise.length > MAX_PREISE) a.preise.length = MAX_PREISE;
  a.menge += anzahl;
  Object.assign(a, artikelNormalisieren(a));

  const pos = state.einkauf.find(z => z.artikelId === a.id);
  if (pos) {
    pos.menge -= anzahl;
    if (pos.menge <= 0) state.einkauf = state.einkauf.filter(z => z !== pos);
  }
  speichere();
  return { ok: true, betrag, artikel: a, grundbedarf: grund, warnung: r.warnung || null, urteil, vonListe: !!pos };
}

/*
  Eigener Barcode-Leser (EAN-13 und EAN-8)
  ----------------------------------------
  Die BarcodeDetector-API gibt es nur in manchen Browsern (nicht in Safari,
  nicht in Firefox, nicht überall unter Android). Damit der Scanner überall
  und offline geht, liest die App den Strichcode zusätzlich selbst - ohne
  Bibliothek: eine Bildzeile wird in helle und dunkle Läufe zerlegt und
  gegen die Strichmuster der Ziffern gehalten.

  Aufbau EAN-13: Rand (3 Läufe) · 6 Ziffern à 4 Läufe · Mitte (5) ·
  6 Ziffern à 4 · Rand (3) = 59 Läufe über 95 Module. Die erste der 13
  Ziffern steht nicht als Striche da, sondern steckt darin, welche der
  linken Ziffern „gespiegelt“ (G statt L) gedruckt sind.
*/
const EAN_BREITEN = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112']
  .map(s => s.split('').map(Number));
const EAN_PARITAET = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function eanGueltig(code) {
  const s = String(code || '');
  if (!/^(\d{8}|\d{13})$/.test(s)) return false;
  let summeZ = 0;
  for (let i = 0; i < s.length - 1; i++) {
    summeZ += Number(s[i]) * ((s.length - 2 - i) % 2 === 0 ? 3 : 1);
  }
  return (10 - summeZ % 10) % 10 === Number(s[s.length - 1]);
}

// Vier Läufe -> Ziffer. `mitG`: auch die gespiegelte Form zulassen (linke Hälfte EAN-13)
function eanZiffer(l, ab, mitG) {
  const breite = l[ab] + l[ab + 1] + l[ab + 2] + l[ab + 3];
  const modul = breite / 7;
  let beste = null;
  for (let z = 0; z < 10; z++) {
    const b = EAN_BREITEN[z];
    let fL = 0, fG = 0;
    for (let k = 0; k < 4; k++) {
      fL += Math.abs(l[ab + k] - b[k] * modul);
      fG += Math.abs(l[ab + k] - b[3 - k] * modul);
    }
    if (!beste || fL < beste.fehler) beste = { ziffer: z, g: false, fehler: fL };
    if (mitG && fG < beste.fehler) beste = { ziffer: z, g: true, fehler: fG };
  }
  // mehr als gut anderthalb Module daneben: lieber nichts als etwas Falsches
  return beste && beste.fehler <= modul * 1.6 ? beste : null;
}

// Versucht, ab Lauf `i` (dunkel) einen Code mit `n` Ziffern pro Hälfte zu lesen
function eanAb(l, i, n) {
  const laeufe = 3 + n * 4 + 5 + n * 4 + 3;
  if (i + laeufe > l.length) return null;
  let breite = 0;
  for (let k = 0; k < laeufe; k++) breite += l[i + k];
  const modul = breite / (3 + n * 7 + 5 + n * 7 + 3);
  if (modul < 1) return null;
  const schmal = k => l[k] > modul * 0.3 && l[k] < modul * 2.2;
  // Ränder und Mitte müssen aus einzelnen Modulen bestehen, davor Ruhe
  if (i > 0 && l[i - 1] < modul * 3) return null;
  const mitte = i + 3 + n * 4;
  const ende = mitte + 5 + n * 4;
  for (const k of [i, i + 1, i + 2, mitte, mitte + 1, mitte + 2, mitte + 3, mitte + 4, ende, ende + 1, ende + 2]) {
    if (!schmal(k)) return null;
  }
  let code = '';
  let paritaet = '';
  for (let z = 0; z < n; z++) {
    const r = eanZiffer(l, i + 3 + z * 4, n === 6);
    if (!r) return null;
    code += r.ziffer;
    paritaet += r.g ? 'G' : 'L';
  }
  for (let z = 0; z < n; z++) {
    const r = eanZiffer(l, mitte + 5 + z * 4, false);
    if (!r) return null;
    code += r.ziffer;
  }
  if (n === 6) {
    const erste = EAN_PARITAET.indexOf(paritaet);
    if (erste < 0) return null;
    code = erste + code;
  }
  return eanGueltig(code) ? code : null;
}

function eanAusLaeufen(l, ersterDunkel) {
  for (let i = ersterDunkel ? 0 : 1; i < l.length; i += 2) {
    const code = eanAb(l, i, 6) || eanAb(l, i, 4);
    if (code) return code;
  }
  return null;
}

/*
  Eine Bildzeile (Helligkeiten 0..255) -> Barcode oder null. Die Schwelle
  zwischen hell und dunkel wird für jede Stelle aus ihrer Umgebung bestimmt,
  damit Schatten und ungleichmäßiges Licht nicht stören. Probiert auch die
  umgekehrte Richtung (Packung steht auf dem Kopf).
*/
function eanAusZeile(werte) {
  const n = werte.length;
  if (n < 100) return null;
  const fenster = Math.max(12, Math.round(n / 24));
  const laeufe = [];
  let ersterDunkel = false;
  let vorher = null;
  // Gleitendes Minimum/Maximum über Blöcke - grob, aber schnell genug pro Bild
  const bloecke = Math.ceil(n / fenster);
  const bMin = new Array(bloecke).fill(255);
  const bMax = new Array(bloecke).fill(0);
  for (let i = 0; i < n; i++) {
    const b = (i / fenster) | 0;
    if (werte[i] < bMin[b]) bMin[b] = werte[i];
    if (werte[i] > bMax[b]) bMax[b] = werte[i];
  }
  for (let i = 0; i < n; i++) {
    const b = (i / fenster) | 0;
    let lo = 255, hi = 0;
    for (let k = Math.max(0, b - 2); k <= Math.min(bloecke - 1, b + 2); k++) {
      if (bMin[k] < lo) lo = bMin[k];
      if (bMax[k] > hi) hi = bMax[k];
    }
    // Zu wenig Kontrast in der Umgebung: das ist Fläche, kein Strich
    const dunkel = hi - lo >= 40 && werte[i] < (lo + hi) / 2;
    if (dunkel === vorher) laeufe[laeufe.length - 1]++;
    else {
      if (vorher === null) ersterDunkel = dunkel;
      laeufe.push(1);
      vorher = dunkel;
    }
  }
  if (laeufe.length < 43) return null;
  const letzterDunkel = ersterDunkel === (laeufe.length % 2 === 1);
  return eanAusLaeufen(laeufe, ersterDunkel) || eanAusLaeufen(laeufe.slice().reverse(), letzterDunkel);
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
    BUDGET_TAGE_WARNUNG, ABKUEHL_STUNDEN,
    restTage, freiVerfuegbar, tagesbudget, budgetTageText,
    wunschSpeichern, wunschRestStunden, wunschReif, offeneWuensche,
    wunschVerwerfen, wunschKaufen, wunschBilanz, monatsMuster,
    sparzielSetzen, sparzielStand, sparzielEinzahlen, sparzielEntnehmen, sparzielAufloesen,
    sparRateProTag, sparzielVergleich,
    einkaufGrundbedarf, sofortKauf,
    saldoKorrigieren, eanGueltig, eanAusZeile,
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
    'tagesbudget', 'aus-budget', 'aus-parken', 'muster', 'install-bereich', 'install-einst',
    'form-korrektur', 'korr-betrag', 'korr-notiz', 'korr-info',
    'wunsch-liste', 'wunsch-leer', 'wunsch-bilanz', 'form-wunsch', 'wun-name', 'wun-betrag',
    'sparziel-karte', 'sparziel-leer', 'sparziel-aendern', 'sparziel-name', 'sparziel-stand',
    'sparziel-balken', 'sparziel-rest', 'form-sparen', 'sp-betrag', 'sp-info', 'sp-entnehmen',
    'form-sparziel', 'sz-name', 'sz-ziel', 'sz-aufloesen', 'aus-ziel',
    'form-sofort', 'so-name', 'so-scan', 'so-menge', 'so-preis', 'so-grund', 'so-urteil',
    'so-warnung', 'so-danach', 'so-submit', 'art-grund',
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

    // Das eigene Muster in einem Satz - Zahlen, kein erhobener Zeigefinger
    const m = monatsMuster();
    const satz = [];
    satz.push(m.anzahl
      ? m.anzahl + (m.anzahl === 1 ? ' spontane Ausgabe' : ' spontane Ausgaben') + ' diesen Monat, zusammen ' + eur(m.summe) +
        (m.trotzWarnung ? ', davon ' + m.trotzWarnung + ' trotz Warnung (' + eur(m.summeTrotz) + ')' : '')
      : 'Diesen Monat noch keine spontane Ausgabe');
    if (m.verworfen) {
      satz.push(m.verworfen + (m.verworfen === 1 ? ' Wunsch' : ' Wünsche') + ' verworfen, ' + eur(m.gespart) + ' gespart');
    }
    knoten['muster'].textContent = satz.join('. ') + '.';

    const tage = restTage();
    knoten['tagesbudget'].textContent = b.frei > 0
      ? 'Tagesbudget ' + eur(tagesbudget()) + ' · noch ' + tage + (tage === 1 ? ' Tag' : ' Tage') + ' bis Monatsende'
      : '';
  }

  /*
    Geparkte Wünsche. Solange die Abkühlzeit läuft, ist „Kaufen“ gesperrt und
    zeigt die Reststunden; danach steht die Frage „Willst du das noch?“ da.
    Verwerfen geht immer - das ist ja der erwünschte Ausgang.
  */
  function rendWuensche() {
    const ul = knoten['wunsch-liste'];
    ul.innerHTML = '';
    const offen = offeneWuensche();
    for (const w of offen) {
      const rest = wunschRestStunden(w);
      const reif = rest === 0;
      const tage = budgetTageText(w.betrag);
      const li = zeile(w.name, eur(w.betrag), null,
        (reif ? 'Wartezeit vorbei – willst du das noch?'
          : 'noch ' + rest + (rest === 1 ? ' Stunde' : ' Stunden') + ' Abkühlzeit') +
        (tage ? ' · ' + tage + ' Tage Budget' : ''));
      if (reif) li.classList.add('reif');

      const aktionen = document.createElement('span');
      aktionen.className = 'aktionen';

      const weg = document.createElement('button');
      weg.type = 'button';
      weg.className = 'icon-knopf' + (reif ? ' haupt' : '');
      weg.textContent = reif ? 'Brauch ich nicht' : 'Verwerfen';
      weg.setAttribute('aria-label', 'Verwerfen – ' + w.name);
      weg.addEventListener('click', async () => {
        const r = wunschVerwerfen(w.id);
        rendAlle();
        if (!r.ok) return toast(r.fehler, 'warn');
        /*
          Der schönste Moment zum Sparen: gerade etwas nicht gekauft. Passt
          der Betrag ins freie Geld, wird angeboten, ihn in den Topf zu legen.
        */
        const stand = sparzielStand();
        if (stand && !stand.erreicht && r.gespart <= Math.max(0, freiVerfuegbar()) &&
          await frage(eur(r.gespart) + ' nicht ausgegeben. Gleich für „' + stand.name + '“ zurücklegen?', 'Zurücklegen')) {
          const s = sparzielEinzahlen(r.gespart);
          rendAlle();
          return toast(s.ok ? eur(r.gespart) + ' zurückgelegt.' : s.fehler, s.ok ? 'ok' : 'warn');
        }
        toast(eur(r.gespart) + ' gespart.', 'ok');
      });

      const kaufen = document.createElement('button');
      kaufen.type = 'button';
      kaufen.className = 'icon-knopf';
      kaufen.textContent = reif ? 'Trotzdem kaufen' : 'Kaufen in ' + rest + ' Std.';
      kaufen.disabled = !reif;
      kaufen.setAttribute('aria-label', (reif ? 'Kaufen – ' : 'Kaufen noch gesperrt – ') + w.name);
      kaufen.addEventListener('click', async () => {
        const pruefung = pruefeAusgabe(w.betrag);
        if (!pruefung.ok) return toast(pruefung.fehler, 'warn');
        if (!await frage((pruefung.warnung ? pruefung.warnung + '\n\n' : '') +
          '„' + w.name + '“ für ' + eur(w.betrag) + ' kaufen und als Ausgabe buchen?', 'Kaufen')) return;
        const r = wunschKaufen(w.id);
        rendAlle();
        toast(r.ok ? eur(r.betrag) + ' ausgegeben.' : r.fehler, r.ok ? 'ok' : 'warn');
      });

      aktionen.append(kaufen, weg);
      li.appendChild(aktionen);
      ul.appendChild(li);
    }
    knoten['wunsch-leer'].hidden = offen.length > 0;

    const bilanz = wunschBilanz();
    knoten['wunsch-bilanz'].textContent = bilanz.verworfen
      ? bilanz.verworfen + (bilanz.verworfen === 1 ? ' Wunsch' : ' Wünsche') + ' verworfen, ' +
        eur(bilanz.gespart) + ' gespart' + (bilanz.gekauft ? ' · ' + bilanz.gekauft + ' gekauft' : '') + '.'
      : '';
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
      const art = { posten: 'Posten', einzahlung: 'Einzahlung', sparen: 'in den Spartopf', entnahme: 'aus dem Spartopf', korrektur: 'Korrektur' }[t.typ] || 'Ausgabe';
      const plus = t.typ === 'einzahlung' || t.typ === 'entnahme' || (t.typ === 'korrektur' && t.plus === true);
      const herkunft = t.art === 'einkauf' ? 'Einkauf' : t.art === 'wunsch' ? 'geparkter Wunsch' : art;
      ul.appendChild(zeile(t.name || art, (plus ? '+' : '−') + eur(t.betrag), plus ? 'plus' : 'minus',
        herkunft + (t.gewarnt ? ' · trotz Warnung' : '')));
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

    // Den Betrag greifbar machen: wie viele Tage Budget sind das?
    const budget = tagesbudget();
    const tage = gueltig ? budgetTageText(betrag) : null;
    knoten['aus-budget'].textContent = budget > 0
      ? 'Tagesbudget ' + eur(budget) + (tage ? ' · diese Ausgabe = ' + tage + ' Tage' : '')
      : 'Du hast gerade nichts frei.';

    // ... und gegen das Sparziel stellen
    knoten['aus-ziel'].textContent = (gueltig && sparzielVergleich(betrag)) || '';

    bremseSetzen(!!pruefung && pruefung.ok && !!pruefung.warnung);

    // Ab wann gewarnt wird: die kleinere der beiden Schwellen zählt
    const drittel = warnschwelle();
    const grenzen = [];
    if (budget > 0) grenzen.push(budget * BUDGET_TAGE_WARNUNG);
    if (drittel > 0) grenzen.push(drittel);
    knoten['ausgabe-schwelle'].textContent = grenzen.length
      ? 'Gewarnt wird ab ' + eur(Math.min(...grenzen) + 1) + ': mehr als ' + BUDGET_TAGE_WARNUNG +
        ' Tage Budget oder mehr als ein Drittel der offenen Posten.'
      : 'Gewarnt wird bei jeder Ausgabe, solange nichts frei ist.';
  }

  /*
    Bremse: bei einer Warnung ist „Trotzdem ausgeben“ erst nach ein paar
    Sekunden drückbar. Reibung ist hier gewollt - ein Impulskauf lebt davon,
    dass er schnell geht. Die Uhr läuft ab der ersten Warnung und startet
    nicht neu, wenn man am Betrag weitertippt.
  */
  const BREMSE_SEKUNDEN = 10;
  let bremseBis = 0;
  let bremseTakt = null;

  function bremseAnzeigen() {
    const rest = Math.ceil((bremseBis - Date.now()) / 1000);
    const knopf = knoten['aus-submit'];
    if (bremseBis && rest > 0) {
      knopf.disabled = true;
      knopf.textContent = 'Trotzdem ausgeben in ' + rest + ' …';
      return;
    }
    clearInterval(bremseTakt);
    bremseTakt = null;
    knopf.disabled = false;
    knopf.textContent = bremseBis ? 'Trotzdem ausgeben' : 'Ausgeben';
  }

  function bremseSetzen(warnt) {
    if (!warnt) {
      bremseBis = 0;
    } else if (!bremseBis) {
      bremseBis = Date.now() + BREMSE_SEKUNDEN * 1000;
      clearInterval(bremseTakt);
      bremseTakt = setInterval(bremseAnzeigen, 250);
    }
    bremseAnzeigen();
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
    rendWuensche();
    rendSparziel();
    rendSparenLive();
    rendEinheiten();
    rendEinkauf();
    rendVorrat();
    rendEkUrteil();
  }

  // ------------------------------------------- Einkauf, Vorrat & Barcode (UI)

  /*
    Barcode-Scanner mit zwei Wegen, beide ohne Bibliothek: die eingebaute
    BarcodeDetector-API des Browsers, wo es sie gibt, und der eigene
    EAN-Leser (eanAusZeile) für alle anderen (iOS, Firefox, Desktop). Das
    Feld zum Eintippen bleibt: der Scanner ist eine Abkürzung, kein Nadelöhr.

    Offline gibt es keine Produktdatenbank. Ein Barcode wird deshalb nur mit
    DEINEN Artikeln abgeglichen; unbekannte fragen einmal nach dem Namen.
  */

  let scannerZiel = null;      // Funktion, die den gefundenen Code bekommt
  let scannerStrom = null;     // MediaStream, muss beim Schließen enden
  let scannerLaeuft = false;

  const kameraMoeglich = () => typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function scannerStatus(text) {
    knoten['scanner-status'].textContent = text;
  }

  async function scannerOeffnen(ziel) {
    scannerZiel = ziel;
    knoten['scanner-ean'].value = '';
    knoten['scanner'].hidden = false;
    document.body.classList.add('fixiert');

    if (!kameraMoeglich()) {
      scannerStatus('Keine Kamera verfügbar – Nummer bitte eintippen.');
      knoten['scanner-ean'].focus();
      return;
    }

    scannerStatus('Kamera wird geöffnet …');
    try {
      // Hohe Auflösung anfragen: mit dem Standard (640×480) sind die Striche zu fein
      scannerStrom = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (e) {
      scannerStatus('Kein Zugriff auf die Kamera – Nummer bitte eintippen.');
      knoten['scanner-ean'].focus();
      return;
    }
    // Während des Kamera-Starts kann längst wieder geschlossen worden sein
    if (knoten['scanner'].hidden) return scannerKameraAus();

    // Dauer-Autofokus, wo die Kamera das anbietet - sonst bleibt nah alles unscharf
    try {
      const spur = scannerStrom.getVideoTracks()[0];
      const kann = spur && spur.getCapabilities ? spur.getCapabilities() : {};
      if (kann.focusMode && kann.focusMode.includes('continuous')) {
        await spur.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch (e) { /* ohne Autofokus-Wunsch geht es auch */ }

    const video = knoten['scanner-video'];
    video.srcObject = scannerStrom;
    try {
      await video.play();
    } catch (e) { /* manche Browser spielen erst nach Interaktion */ }
    scannerStatus('Barcode waagrecht in den Rahmen halten …');
    scannerSuchen();
  }

  // Der eingebaute Detektor des Browsers, falls es ihn gibt und er EAN kann
  async function scannerDetektor() {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
    try {
      const gewollt = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
      const kann = await window.BarcodeDetector.getSupportedFormats();
      const formate = gewollt.filter(f => kann.includes(f));
      return formate.length ? new window.BarcodeDetector({ formats: formate }) : null;
    } catch (e) {
      return null;
    }
  }

  /*
    Der eigene Leser: das Kamerabild auf eine Zeichenfläche legen und einige
    waagrechte Zeilen aus der Bildmitte durch eanAusZeile() schicken. Je
    drei Bildzeilen werden gemittelt, das nimmt das Rauschen heraus.
  */
  const scanFlaeche = document.createElement('canvas');

  function scannerEigen(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return [];
    const b = Math.min(1280, vw);
    const h = Math.round(vh * b / vw);
    scanFlaeche.width = b;
    scanFlaeche.height = h;
    const ctx = scanFlaeche.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, b, h);
    const funde = [];
    for (let k = 0; k < 11; k++) {
      const y = Math.round(h * (0.3 + 0.04 * k));
      const px = ctx.getImageData(0, y, b, 3).data;
      const zeile = new Array(b);
      for (let x = 0; x < b; x++) {
        let hell = 0;
        for (let r = 0; r < 3; r++) {
          const p = (r * b + x) * 4;
          hell += px[p] * 2 + px[p + 1] * 5 + px[p + 2];
        }
        zeile[x] = hell / 24;
      }
      const code = eanAusZeile(zeile);
      if (code) funde.push(code);
    }
    return funde;
  }

  async function scannerSuchen() {
    if (scannerLaeuft) return;
    scannerLaeuft = true;
    const detector = await scannerDetektor();
    const video = knoten['scanner-video'];
    const gesehen = {};          // eigener Leser: erst der zweite gleiche Fund zählt
    const start = Date.now();
    let hinweisGezeigt = false;
    while (!knoten['scanner'].hidden && scannerStrom) {
      let ean = null;
      if (detector) {
        try {
          const treffer = await detector.detect(video);
          const code = treffer.find(t => t.rawValue && /^\d{6,14}$/.test(t.rawValue.replace(/\D/g, '')));
          if (code) ean = code.rawValue.replace(/\D/g, '');
        } catch (e) { /* einzelne Bilder dürfen fehlschlagen */ }
      }
      if (!ean) {
        try {
          for (const code of scannerEigen(video)) {
            gesehen[code] = (gesehen[code] || 0) + 1;
            if (gesehen[code] >= 2) { ean = code; break; }
          }
        } catch (e) { /* Bild noch nicht bereit */ }
      }
      if (ean) {
        if (navigator.vibrate) navigator.vibrate(60);
        scannerUebernehmen(ean);
        break;
      }
      if (!hinweisGezeigt && Date.now() - start > 7000) {
        hinweisGezeigt = true;
        scannerStatus('Noch nichts erkannt: näher ran, bis der Code den Rahmen füllt, waagrecht halten, auf Licht achten. Oder die Nummer eintippen.');
      }
      await new Promise(w => setTimeout(w, 120));
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
        (b.grundbedarf ? ' · davon Grundbedarf ' + eur(b.grundbedarf) : '') +
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

    const pruefung = pruefeAusgabe(betrag, einkaufGrundbedarf());
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

  // ------------------------------------------------- Scannen & gleich bezahlen

  /*
    Im Laden: scannen, Preis bestätigen, das Geld ist sofort vom Konto. Bei
    Grundbedarf ohne Umweg; bei allem anderen greifen Warnung und Bremse wie
    im Ausgabe-Blatt - der Scanner darf keine Abkürzung um die Reibung sein.
  */
  let soEan = '';
  let soArtikelId = null;    // zuletzt erkannter Artikel, für den Haken
  let soBremseBis = 0;
  let soTakt = null;

  function soArtikel() {
    return (soEan ? artikelNachEan(soEan) : null) || artikelNachName(knoten['so-name'].value);
  }

  function soBetrag() {
    const preis = zuCent(knoten['so-preis'].value);
    const menge = Math.max(1, parseInt(knoten['so-menge'].value, 10) || 1);
    return preis > 0 ? preis * menge : 0;
  }

  function soPruefung() {
    const betrag = soBetrag();
    return betrag > 0 ? pruefeAusgabe(betrag, knoten['so-grund'].checked ? betrag : 0) : null;
  }

  function soKnopf() {
    const betrag = soBetrag();
    const rest = Math.ceil((soBremseBis - Date.now()) / 1000);
    const knopf = knoten['so-submit'];
    if (soBremseBis && rest > 0) {
      knopf.disabled = true;
      knopf.textContent = 'Trotzdem kaufen in ' + rest + ' …';
      return;
    }
    clearInterval(soTakt);
    soTakt = null;
    knopf.disabled = false;
    knopf.textContent = (soBremseBis ? 'Trotzdem kaufen' : 'Kaufen') + (betrag > 0 ? ' · ' + eur(betrag) : '');
  }

  function rendSofortLive() {
    const a = soArtikel();
    // Der Haken folgt dem Artikel - aber nur beim Wechsel, nicht bei jedem Tastendruck
    const id = a ? a.id : null;
    if (id !== soArtikelId) {
      soArtikelId = id;
      if (a) knoten['so-grund'].checked = a.grundbedarf;
    }

    const preis = zuCent(knoten['so-preis'].value);
    const feld = knoten['so-urteil'];
    feld.className = 'fussnote';
    const u = a && preis > 0 ? preisUrteil(a.id, preis) : null;
    if (u) {
      feld.className = 'fussnote urteil urteil-' + u.stufe;
      feld.textContent = u.text;
    } else if (a) {
      feld.textContent = a.bestPreis
        ? a.name + ': Bestpreis ' + eur(a.bestPreis) + (a.bestLaden ? ' bei ' + a.bestLaden : '')
        : a.name + ': noch kein Preis erfasst.';
    } else {
      feld.textContent = soEan ? 'Barcode ' + soEan + ' – noch unbekannt, wird neu angelegt.' : '';
    }

    const betrag = soBetrag();
    const pruefung = soPruefung();
    const meldung = pruefung ? (pruefung.fehler || pruefung.warnung || '') : '';
    knoten['so-warnung'].textContent = meldung;
    knoten['so-warnung'].hidden = !meldung;
    knoten['so-danach'].textContent = 'Frei verfügbar ' + eur(freiVerfuegbar()) +
      (betrag > 0 ? ' · danach ' + eur(freiVerfuegbar() - betrag) : '');

    // Bremse: läuft ab der ersten Warnung, startet beim Weitertippen nicht neu
    const warnt = !!pruefung && pruefung.ok && !!pruefung.warnung;
    if (!warnt) {
      soBremseBis = 0;
    } else if (!soBremseBis) {
      soBremseBis = Date.now() + BREMSE_SEKUNDEN * 1000;
      clearInterval(soTakt);
      soTakt = setInterval(soKnopf, 250);
    }
    soKnopf();
  }

  function soScannen() {
    scannerOeffnen(ean => {
      soEan = ean;
      const a = artikelNachEan(ean);
      if (a) {
        knoten['so-name'].value = a.name;
        knoten['so-preis'].value = a.letzterPreis ? (a.letzterPreis / 100).toFixed(2).replace('.', ',') : '';
        toast(a.name + ' erkannt.', 'ok');
        knoten['so-preis'].focus();
        knoten['so-preis'].select();
      } else {
        knoten['so-name'].value = '';
        knoten['so-preis'].value = '';
        toast('Barcode unbekannt – bitte Namen und Preis eintippen.');
        knoten['so-name'].focus();
      }
      rendSofortLive();
    });
  }

  function sofortLeeren() {
    soEan = '';
    soArtikelId = null;
    soBremseBis = 0;
    clearInterval(soTakt);
    soTakt = null;
    knoten['form-sofort'].reset();
    knoten['so-menge'].value = '1';
  }

  knoten['so-scan'].addEventListener('click', soScannen);
  for (const id of ['so-name', 'so-preis', 'so-menge']) {
    knoten[id].addEventListener('input', () => {
      // Wer den Namen von Hand ändert, meint nicht mehr den gescannten Artikel
      if (id === 'so-name' && soEan && artikelNachEan(soEan)) soEan = '';
      rendSofortLive();
    });
  }
  knoten['so-grund'].addEventListener('change', rendSofortLive);

  knoten['form-sofort'].addEventListener('submit', e => {
    e.preventDefault();
    const name = knoten['so-name'].value.trim();
    const preis = zuCent(knoten['so-preis'].value);
    if (!name && !soArtikel()) {
      toast('Bitte einen Namen eingeben oder scannen.', 'warn');
      return knoten['so-name'].focus();
    }
    if (!(preis > 0)) {
      toast('Bitte den Preis eingeben.', 'warn');
      return knoten['so-preis'].focus();
    }
    const pruefung = soPruefung();
    if (pruefung && !pruefung.ok) return rendSofortLive();
    // Die Bremse gilt auch für die Enter-Taste
    if (pruefung && pruefung.warnung && (!soBremseBis || Date.now() < soBremseBis)) return rendSofortLive();

    const r = sofortKauf({
      ean: soEan,
      name,
      preis,
      menge: parseInt(knoten['so-menge'].value, 10),
      grundbedarf: knoten['so-grund'].checked,
    });
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    const anhang = r.urteil && r.urteil.stufe === 'best' ? ' · Bestpreis'
      : (r.urteil && r.urteil.stufe === 'teuer' ? ' · über deinem Bestpreis' : '');
    toast(eur(r.betrag) + ' abgezogen · frei noch ' + eur(freiVerfuegbar()) + anhang + '.', 'ok');
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

      if (a.grundbedarf) {
        const marke = document.createElement('span');
        marke.className = 'marke marke-ok';
        marke.textContent = 'Grundbedarf';
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
    knoten['art-grund'].checked = a.grundbedarf;
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
      grundbedarf: knoten['art-grund'].checked,
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
    wunsch: 'Wunsch parken',
    sparen: 'Spartopf',
    sparziel: 'Sparziel',
    posten: 'Neuer Posten',
    vorrat: 'Neuer Artikel',
    sofort: 'Gleich bezahlen',
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
    if (name === 'sparen') rendSparenLive();
    if (name === 'sparziel') sparzielFormularFuellen();
    if (name === 'einstellungen') korrekturFuellen();
    if (name === 'sofort') {
      // Gleich die Kamera: im Laden zählt jeder Handgriff
      sofortLeeren();
      rendSofortLive();
      return soScannen();
    }
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
    knoten['form-wunsch'].reset();
    knoten['form-sparen'].reset();
    knoten['form-sparziel'].reset();
    knoten['form-korrektur'].reset();
    sofortLeeren();
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

  // ---------------------------------------------------- Als App installieren

  /*
    Der Knopf steht in den Einstellungen. Chrome/Edge/Android melden über
    „beforeinstallprompt“, dass die App installierbar ist; das Ereignis wird
    aufgehoben und beim Knopfdruck ausgelöst. iOS kennt das nicht - dort
    geht es nur über „Teilen → Zum Home-Bildschirm“, also nennt der Knopf
    den Weg. Läuft die App schon installiert, verschwindet der Abschnitt.
  */
  let installEreignis = null;

  const istInstalliert = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  const istIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function rendInstall() {
    knoten['install-bereich'].hidden = istInstalliert();
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();            // kein eigener Balken des Browsers
    installEreignis = e;
  });
  window.addEventListener('appinstalled', () => {
    installEreignis = null;
    knoten['install-bereich'].hidden = true;
    toast('iNeedMoney ist installiert.', 'ok');
  });
  knoten['install-einst'].addEventListener('click', async () => {
    if (installEreignis) {
      const ereignis = installEreignis;
      installEreignis = null;      // lässt sich nur einmal auslösen
      ereignis.prompt();
      try { await ereignis.userChoice; } catch (e) { /* abgebrochen */ }
      return rendInstall();
    }
    toast(istIos()
      ? 'In Safari das Teilen-Symbol antippen, dann „Zum Home-Bildschirm“.'
      : 'Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.');
  });
  rendInstall();

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
    // Die Bremse gilt auch für die Enter-Taste, nicht nur für den Knopf
    if (pruefung.warnung && (!bremseBis || Date.now() < bremseBis)) {
      rendAusgabeLive();
      return;
    }
    const r = ausgeben(betrag, notiz);
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast(eur(betrag) + ' ausgegeben.', 'ok');
  });

  // Aus dem Ausgabe-Blatt heraus parken statt kaufen: Betrag und Zweck wandern mit
  knoten['aus-parken'].addEventListener('click', () => {
    const name = knoten['aus-notiz'].value.trim();
    if (!name) {
      toast('Wofür? Trag kurz ein, was du kaufen willst.', 'warn');
      knoten['aus-notiz'].focus();
      return;
    }
    const r = wunschSpeichern({ name, betrag: zuCent(knoten['aus-betrag'].value) });
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast('Geparkt. In ' + ABKUEHL_STUNDEN + ' Stunden entscheidest du.', 'ok');
  });

  // ---------------------------------------------------------------- Sparziel

  function rendSparziel() {
    const s = sparzielStand();
    knoten['sparziel-karte'].hidden = !s;
    knoten['sparziel-leer'].hidden = !!s;
    knoten['sparziel-aendern'].hidden = !s;
    if (!s) return;
    knoten['sparziel-name'].textContent = s.name;
    knoten['sparziel-stand'].textContent = eur(s.gespart) + ' von ' + eur(s.ziel);
    balkenSetzen(knoten['sparziel-balken'], [['frei', s.gespart], ['reserviert', s.rest]]);
    const prozent = Math.floor(s.anteil * 100);
    knoten['sparziel-rest'].textContent = s.erreicht
      ? 'Ziel erreicht.'
      : prozent + ' % geschafft · es fehlen noch ' + eur(s.rest);
  }

  function rendSparenLive() {
    const s = sparzielStand();
    knoten['sp-info'].textContent = 'Frei verfügbar ' + eur(Math.max(0, freiVerfuegbar())) +
      ' · im Topf ' + eur(s ? s.gespart : 0);
    knoten['sp-entnehmen'].hidden = !s || s.gespart <= 0;
  }

  function sparzielFormularFuellen() {
    const s = sparzielStand();
    knoten['overlay-titel'].textContent = s ? 'Sparziel ändern' : 'Sparziel anlegen';
    knoten['sz-name'].value = s ? s.name : '';
    knoten['sz-ziel'].value = s ? (s.ziel / 100).toFixed(2).replace('.', ',') : '';
    knoten['sz-aufloesen'].hidden = !s;
  }

  knoten['form-sparziel'].addEventListener('submit', e => {
    e.preventDefault();
    const r = sparzielSetzen({ name: knoten['sz-name'].value, ziel: zuCent(knoten['sz-ziel'].value) });
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast(r.neu ? 'Sparziel angelegt.' : 'Sparziel geändert.', 'ok');
  });

  knoten['sz-aufloesen'].addEventListener('click', async () => {
    const s = sparzielStand();
    if (!s) return;
    if (!await frage('Sparziel „' + s.name + '“ auflösen?' +
      (s.gespart > 0 ? ' ' + eur(s.gespart) + ' aus dem Topf gehen zurück aufs Konto.' : ''), 'Auflösen')) return;
    const r = sparzielAufloesen();
    rendAlle();
    overlaySchliessen();
    toast(r.ok ? 'Sparziel aufgelöst.' : r.fehler, r.ok ? null : 'warn');
  });

  knoten['form-sparen'].addEventListener('submit', e => {
    e.preventDefault();
    const betrag = zuCent(knoten['sp-betrag'].value);
    const r = sparzielEinzahlen(betrag);
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast(r.erreicht ? 'Ziel erreicht – ' + eur(betrag) + ' zurückgelegt.' : eur(betrag) + ' zurückgelegt.', 'ok');
  });

  // Aus dem Topf nehmen ist der Weg zurück zum Ausgeben - deshalb mit Rückfrage
  knoten['sp-entnehmen'].addEventListener('click', async () => {
    const betrag = zuCent(knoten['sp-betrag'].value);
    const s = sparzielStand();
    if (!(betrag > 0)) {
      toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
      return knoten['sp-betrag'].focus();
    }
    if (s && betrag > s.gespart) return toast('Im Topf liegen nur ' + eur(s.gespart) + '.', 'warn');
    if (!await frage(eur(betrag) + ' aus dem Topf „' + (s ? s.name : '') + '“ nehmen? Danach fehlen wieder ' +
      eur(s ? Math.max(0, s.ziel - s.gespart + betrag) : 0) + ' bis zum Ziel.', 'Herausnehmen')) return;
    const r = sparzielEntnehmen(betrag);
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast(eur(betrag) + ' zurück aufs Konto.');
  });

  knoten['form-wunsch'].addEventListener('submit', e => {
    e.preventDefault();
    const r = wunschSpeichern({
      name: knoten['wun-name'].value,
      betrag: zuCent(knoten['wun-betrag'].value),
    });
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast('Geparkt. In ' + ABKUEHL_STUNDEN + ' Stunden entscheidest du.', 'ok');
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

  // Kontostand korrigieren: das Feld zeigt den jetzigen Stand, man tippt den richtigen
  const korrekturWert = () => {
    const s = knoten['korr-betrag'].value.trim();
    const minus = /^[-−]/.test(s);
    const cent = zuCent(s.replace(/^[-−]\s*/, ''));
    return Number.isFinite(cent) ? (minus ? -cent : cent) : NaN;
  };

  function korrekturInfo() {
    const neu = korrekturWert();
    const diff = neu - state.saldo;
    knoten['korr-info'].textContent = !Number.isFinite(neu) ? 'In der App stehen gerade ' + eur(state.saldo) + '.'
      : diff === 0 ? 'Das ist der Stand in der App – nichts zu korrigieren.'
        : 'In der App stehen ' + eur(state.saldo) + '. Korrektur: ' + (diff > 0 ? '+' : '−') + eur(Math.abs(diff)) + '.';
  }

  function korrekturFuellen() {
    knoten['korr-betrag'].value = (state.saldo / 100).toFixed(2).replace('.', ',');
    knoten['korr-notiz'].value = '';
    korrekturInfo();
  }

  knoten['korr-betrag'].addEventListener('input', korrekturInfo);
  knoten['form-korrektur'].addEventListener('submit', async e => {
    e.preventDefault();
    const neu = korrekturWert();
    if (!Number.isFinite(neu)) {
      toast('Bitte den richtigen Kontostand eingeben.', 'warn');
      return knoten['korr-betrag'].focus();
    }
    const diff = neu - state.saldo;
    if (diff === 0) return toast('Das ist schon dein Kontostand.');
    if (!await frage('Kontostand von ' + eur(state.saldo) + ' auf ' + eur(neu) + ' setzen? Die Korrektur von ' +
      (diff > 0 ? '+' : '−') + eur(Math.abs(diff)) + ' steht danach im Verlauf.', 'Korrigieren')) return;
    const r = saldoKorrigieren(neu, knoten['korr-notiz'].value);
    if (!r.ok) return toast(r.fehler, 'warn');
    rendAlle();
    overlaySchliessen();
    toast('Kontostand ist jetzt ' + eur(r.saldo) + '.', 'ok');
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

  // Was seit dem letzten Blick passiert ist: abgezogene Posten, reife Wünsche
  function startMeldung(gebucht) {
    const reif = offeneWuensche().filter(w => wunschReif(w)).length;
    const teile = [];
    if (gebucht) teile.push(gebucht + (gebucht === 1 ? ' fälliger Posten' : ' fällige Posten') + ' abgezogen');
    if (reif) teile.push(reif + (reif === 1 ? ' Wunsch wartet' : ' Wünsche warten') + ' auf deine Entscheidung');
    if (teile.length) toast(teile.join(' · ') + '.');
  }
  startMeldung(abgezogen);

  /*
    Eine installierte App wird selten neu geladen, sie kommt nur wieder nach
    vorn. Dann neu abrechnen und zeichnen - sonst stehen die Reststunden der
    Wünsche und fällige Posten auf dem Stand von gestern.
  */
  let letzterTag = heuteISO();
  let reifBisher = offeneWuensche().filter(w => wunschReif(w)).length;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const gebucht = heuteISO() !== letzterTag ? abrechnen() : 0;
    letzterTag = heuteISO();
    // Ein offenes Blatt nicht unter den Fingern neu zeichnen
    if (knoten['overlay'].hidden) rendAlle();
    const reif = offeneWuensche().filter(w => wunschReif(w)).length;
    if (gebucht || reif > reifBisher) startMeldung(gebucht);
    reifBisher = reif;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

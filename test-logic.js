/*
  Logik-Test ohne Browser:  node test-logic.js
  Teil 1 prueft die Rechenlogik (Saldo, Abzuege, Warnschwelle, Backup).
  Teil 2 prueft den DOM-Vertrag: jede ID, die app.js erwartet, muss in
  index.html existieren - genau der Fehler, der die App vorher lahmgelegt hat.
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WURZEL = __dirname;
const appJs = fs.readFileSync(path.join(WURZEL, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(WURZEL, 'styles.css'), 'utf8');
const htmlIds = new Set();
{
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(indexHtml))) htmlIds.add(m[1]);
}

let fehler = 0;
function assert(bedingung, text) {
  if (bedingung) {
    console.log('  ok   ' + text);
  } else {
    console.error('  FAIL ' + text);
    fehler++;
  }
}
function block(titel) {
  console.log('\n' + titel);
}

// --------------------------------------------------- app.js ohne DOM laden

global.localStorage = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
// kein global.document: app.js laesst den UI-Teil dann bewusst aus
vm.runInThisContext(appJs, { filename: 'app.js' });

const L = global.Logik;
const gespeichert = () => JSON.parse(localStorage.getItem('inneedmoney.v1'));
const heuteTag = new Date().getDate();

block('Betrags-Eingaben');
assert(L.zuCent('100') === 10000, '"100" -> 10000 Cent');
assert(L.zuCent('12,50') === 1250, '"12,50" (Komma) -> 1250 Cent');
assert(L.zuCent('12.50') === 1250, '"12.50" (Punkt) -> 1250 Cent');
assert(L.zuCent('1.234,56') === 123456, '"1.234,56" -> 123456 Cent');
assert(L.zuCent(' 7 ') === 700, '" 7 " -> 700 Cent');
assert(Number.isNaN(L.zuCent('abc')), '"abc" -> NaN');
assert(Number.isNaN(L.zuCent('')), 'leer -> NaN');

block('Einzahlung');
L.zuruecksetzen();
assert(!L.einzahlen(0).ok, 'Einzahlung 0 wird abgelehnt');
assert(!L.einzahlen(NaN).ok, 'Einzahlung NaN wird abgelehnt');
assert(L.einzahlen(10000, 'Gehalt').ok, 'Einzahlung 100,00 EUR geht durch');
assert(L.state.saldo === 10000, 'Saldo = 10000 Cent');
assert(gespeichert().saldo === 10000, 'Saldo ist in localStorage persistiert');

block('Posten anlegen');
// Tag bewusst in der Zukunft, damit nicht sofort abgerechnet wird
const zukunftsTag = Math.min(31, heuteTag + 1);
const r1 = L.postenSpeichern({ name: 'Strom', betrag: 5600, tag: zukunftsTag });
assert(r1.ok, 'Posten "Strom" 56,00 EUR angelegt');
assert(L.state.posten.length === 1, 'ein Posten im Stand');
assert(L.state.saldo === 10000, 'kein Abzug, da Tag in der Zukunft');
assert(!L.postenSpeichern({ name: '', betrag: 100, tag: 5 }).ok, 'Posten ohne Namen wird abgelehnt');
assert(!L.postenSpeichern({ name: 'X', betrag: 100, tag: 40 }).ok, 'Tag 40 wird abgelehnt');
assert(!L.postenSpeichern({ name: 'X', betrag: -5, tag: 5 }).ok, 'negativer Betrag wird abgelehnt');

block('Warnschwelle (ein Drittel der offenen Posten)');
assert(L.offenePosten().length === 1, 'ein offener Posten');
assert(L.warnschwelle() === 1866, 'Schwelle = floor(5600/3) = 1866 Cent');
assert(L.pruefeAusgabe(1866).warnung === null, '18,66 EUR -> keine Warnung (genau Schwelle)');
assert(typeof L.pruefeAusgabe(1867).warnung === 'string', '18,67 EUR -> Warnung');
assert(!L.pruefeAusgabe(99999).ok, 'mehr als der Saldo -> Fehler, keine Buchung');
assert(L.state.saldo === 10000, 'pruefeAusgabe bucht nichts');

block('Ausgaben buchen');
const a1 = L.ausgeben(2000, 'Kaffee');
assert(a1.ok && typeof a1.warnung === 'string', '20,00 EUR gebucht, mit Warnung');
assert(L.state.saldo === 8000, 'Saldo = 8000 Cent');
const a2 = L.ausgeben(1000);
assert(a2.ok && a2.warnung === null, '10,00 EUR gebucht, ohne Warnung');
assert(L.state.saldo === 7000, 'Saldo = 7000 Cent');
assert(!L.ausgeben(0).ok && L.state.saldo === 7000, 'Ausgabe 0 wird abgelehnt');

block('Posten bearbeiten und loeschen');
const strom = L.state.posten[0];
assert(L.postenSpeichern({ id: strom.id, name: 'Strom neu', betrag: 6000, tag: zukunftsTag }).bearbeitet,
  'Posten per id bearbeitet');
assert(L.state.posten.length === 1, 'kein Duplikat entstanden');
assert(L.state.posten[0].name === 'Strom neu' && L.state.posten[0].betrag === 6000, 'Name und Betrag geaendert');
assert(!L.postenSpeichern({ id: 'gibtsnicht', name: 'X', betrag: 100, tag: 3 }).ok, 'unbekannte id wird abgelehnt');
assert(L.postenLoeschen(strom.id).ok, 'Posten geloescht');
assert(L.state.posten.length === 0, 'keine Posten mehr');
assert(L.warnschwelle() === 0, 'ohne offene Posten ist die Schwelle 0');
assert(L.pruefeAusgabe(5000).warnung === null, 'ohne offene Posten keine Warnung');

block('Faellige Posten werden genau einmal pro Monat abgezogen');
L.zuruecksetzen();
L.einzahlen(20000);
L.postenSpeichern({ name: 'Miete', betrag: 5000, tag: 1 }); // Tag 1 -> heute faellig
assert(L.state.saldo === 15000, 'Miete sofort abgezogen (Saldo 15000)');
assert(L.state.transaktionen.some(t => t.typ === 'posten' && t.name === 'Miete'), 'Abzug steht in der Historie');
assert(L.abrechnen() === 0, 'erneutes abrechnen() zieht nichts doppelt ab');
assert(L.state.saldo === 15000, 'Saldo unveraendert nach zweitem abrechnen()');
assert(L.state.posten[0].naechster === 1, 'der Zaehler steht auf dem naechsten Termin');

block('Posten am 29./30./31. in kurzen Monaten');
assert(L.tageImMonat(2026, 1) === 28, 'Februar 2026 hat 28 Tage');
assert(L.tageImMonat(2028, 1) === 29, 'Februar 2028 (Schaltjahr) hat 29 Tage');
assert(L.effektiverTag(31, 2026, 1) === 28, 'Posten am 31. rutscht im Februar auf den 28.');
assert(L.effektiverTag(31, 2028, 1) === 29, 'Posten am 31. rutscht im Schaltjahr-Februar auf den 29.');
assert(L.effektiverTag(31, 2026, 3) === 30, 'Posten am 31. rutscht im April auf den 30.');
assert(L.effektiverTag(15, 2026, 1) === 15, 'Tag 15 bleibt Tag 15');
L.zuruecksetzen();
L.einzahlen(50000);
L.postenSpeichern({ name: 'Monatsende', betrag: 1000, tag: 31 });
const heuteDatum = new Date();
const letzterHeute = L.tageImMonat(heuteDatum.getFullYear(), heuteDatum.getMonth());
const sollteAbgezogenSein = heuteDatum.getDate() >= letzterHeute;
assert(sollteAbgezogenSein ? L.state.saldo === 49000 : L.state.saldo === 50000,
  'Posten am 31. wird am letzten Monatstag faellig, davor nicht');
assert(L.offenePosten().length + L.state.transaktionen.filter(t => t.typ === 'posten').length === 1,
  'der Posten ist entweder offen oder abgezogen - nie beides und nie keines');

block('"offen" und "bezahlt" widersprechen sich nicht');
L.zuruecksetzen();
L.einzahlen(100000);
const kuenftig = Math.min(28, new Date().getDate() + 1);
L.postenSpeichern({ name: 'Spaeter', betrag: 3000, tag: kuenftig });
const spaeter = L.state.posten[0];
assert(L.offenePosten().length === 1, 'der Posten ist offen, sein Tag kommt noch');
assert(L.warnschwelle() === 1000, 'und zaehlt in die Warnschwelle');
// Termin von Hand als gebucht markieren - frueher liefen Startseite und
// Kalender hier auseinander, weil der eine raete und der andere nachsah
spaeter.naechster = 1;
assert(L.offenePosten().length === 0,
  'ein bereits gebuchter Termin gilt nicht mehr als offen, auch wenn sein Tag noch kommt');
assert(L.warnschwelle() === 0, 'er zaehlt dann auch nicht mehr in die Warnschwelle');
spaeter.naechster = 0;
assert(L.offenePosten().length === 1, 'zurueckgesetzt ist er wieder offen');

block('Wiederholung: alle N Wochen');
L.zuruecksetzen();
L.einzahlen(500000);
// Start bewusst in der Zukunft, damit nichts sofort gebucht wird
const inZukunft = new Date();
inZukunft.setDate(inZukunft.getDate() + 3);
const startIso = L.isoVon(inZukunft);
const rw = L.postenSpeichern({
  name: 'Bahncard', betrag: 1500, rhythmus: 'woche', intervall: 4, start: startIso,
});
assert(rw.ok, 'Posten "alle 4 Wochen" angelegt');
const woche = L.state.posten[0];
assert(woche.rhythmus === 'woche' && woche.intervall === 4, 'Rhythmus und Intervall gespeichert');
const t0 = L.terminFuerIndex(woche, 0);
const t1 = L.terminFuerIndex(woche, 1);
const t2 = L.terminFuerIndex(woche, 2);
assert(L.isoVon(t0) === startIso, 'Termin 0 ist der Starttermin');
assert(Math.round((t1 - t0) / 86400000) === 28, 'Termin 1 liegt 28 Tage spaeter');
assert(Math.round((t2 - t1) / 86400000) === 28, 'Termin 2 wieder 28 Tage spaeter');
assert(t0.getDay() === t1.getDay() && t1.getDay() === t2.getDay(),
  'alle Termine fallen auf denselben Wochentag');
assert(!L.postenSpeichern({ name: 'X', betrag: 100, rhythmus: 'woche', intervall: 2 }).ok,
  'Wochen-Posten ohne Starttermin wird abgelehnt');
assert(!L.postenSpeichern({ name: 'X', betrag: 100, rhythmus: 'woche', intervall: 0, start: startIso }).ok,
  'Intervall 0 wird abgelehnt');
assert(!L.postenSpeichern({ name: 'X', betrag: 100, rhythmus: 'monat', intervall: 99, tag: 5 }).ok,
  'Intervall 99 wird abgelehnt');

block('Wiederholung: alle N Monate');
L.zuruecksetzen();
L.einzahlen(500000);
L.postenSpeichern({ name: 'Versicherung', betrag: 12000, rhythmus: 'monat', intervall: 2, tag: 15 });
const zwei = L.state.posten[0];
const m0 = L.terminFuerIndex(zwei, 0);
const m1 = L.terminFuerIndex(zwei, 1);
const m2 = L.terminFuerIndex(zwei, 2);
const monatsAbstand = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
assert(monatsAbstand(m0, m1) === 2, 'zwei Monate bis zum naechsten Termin');
assert(monatsAbstand(m1, m2) === 2, 'und wieder zwei Monate');
assert(m0.getDate() === 15 && m1.getDate() === 15 && m2.getDate() === 15, 'immer am 15.');

block('Posten am 31. bleibt nach einem kurzen Monat auf dem 31.');
// Der Klassiker: vom gebuchten Termin weiterzurechnen laesst einen Posten
// nach dem Februar dauerhaft auf dem 28. haengen.
const amEnde = { rhythmus: 'monat', intervall: 1, tag: 31, start: '2026-01-31' };
const folge = [0, 1, 2, 3].map(k => L.isoVon(L.terminFuerIndex(amEnde, k)));
assert(folge[0] === '2026-01-31', 'Januar: 31.');
assert(folge[1] === '2026-02-28', 'Februar: auf den 28. gerutscht');
assert(folge[2] === '2026-03-31', 'Maerz: wieder der 31., nicht der 28.');
assert(folge[3] === '2026-04-30', 'April: der 30.');

block('Nachbuchen: App laenger nicht geoeffnet');
L.zuruecksetzen();
L.einzahlen(500000);
// Posten, der vor drei Monaten angefangen hat und seitdem nie gebucht wurde
const vorMonaten = new Date();
vorMonaten.setMonth(vorMonaten.getMonth() - 3);
vorMonaten.setDate(1);
L.state.posten.push({
  id: 'alt1', name: 'Rueckstand', betrag: 10000,
  rhythmus: 'monat', intervall: 1, tag: 1, start: L.isoVon(vorMonaten), naechster: 0,
});
const nachgebucht = L.abrechnen();
assert(nachgebucht === 4, 'vier faellige Termine nachgebucht (3 Monate zurueck + aktueller)');
assert(L.state.saldo === 500000 - 40000, 'Saldo um alle vier Termine gemindert');
const daten = L.state.transaktionen.filter(t => t.name === 'Rueckstand').map(t => t.datum);
assert(new Set(daten).size === 4, 'jeder Abzug hat sein eigenes, echtes Datum');
assert(daten.every(d => d.endsWith('-01')), 'alle am 1. des jeweiligen Monats');
assert(L.abrechnen() === 0, 'erneutes Abrechnen bucht nichts nach');

block('Wochen-Posten kann zweimal im selben Monat fallen');
L.zuruecksetzen();
L.einzahlen(500000);
// Start am 1. eines 31-Tage-Monats, alle 2 Wochen -> 1., 15., 29.
const dreimal = { rhythmus: 'woche', intervall: 2, tag: 1, start: '2026-01-01' };
const imJanuar = L.termineImZeitraum(dreimal, new Date(2026, 0, 1), new Date(2026, 0, 31));
assert(imJanuar.length === 3, 'drei Termine im Januar, nicht einer');
assert(imJanuar.map(t => t.datum.getDate()).join(',') === '1,15,29', 'am 1., 15. und 29.');

block('Migration alter Daten ohne Wiederholung');
const altStand = {
  saldo: 100000,
  posten: [{ id: 'p1', name: 'Miete', betrag: 50000, tag: 1 }],
  transaktionen: [],
  abgegriffen: {},
};
const jetztKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
altStand.abgegriffen[jetztKey] = ['p1'];
const migriert = L.normalisiere(altStand);
assert(migriert.posten[0].rhythmus === 'monat', 'alter Posten wird zum Monats-Rhythmus');
assert(migriert.posten[0].intervall === 1, 'Intervall 1');
assert(typeof migriert.posten[0].start === 'string', 'Startdatum gesetzt');
assert(migriert.posten[0].naechster === 1,
  'bereits abgezogener Posten steht auf dem naechsten Termin - wird nicht doppelt gebucht');
const altStand2 = JSON.parse(JSON.stringify(altStand));
altStand2.abgegriffen = {};
assert(L.normalisiere(altStand2).posten[0].naechster === 0,
  'noch nicht abgezogener Posten startet bei Termin 0');

block('Rhythmus als Text');
assert(L.rhythmusText({ rhythmus: 'monat', intervall: 1, tag: 28 }) === 'monatlich am 28.', 'monatlich');
assert(L.rhythmusText({ rhythmus: 'monat', intervall: 2, tag: 5 }) === 'alle 2 Monate am 5.', 'alle 2 Monate');
assert(L.rhythmusText({ rhythmus: 'woche', intervall: 1 }) === 'woechentlich'.replace('oe', 'ö'), 'woechentlich');
assert(L.rhythmusText({ rhythmus: 'woche', intervall: 4 }) === 'alle 4 Wochen', 'alle 4 Wochen');

block('Monatsbilanz');
L.zuruecksetzen();
L.einzahlen(20000);
L.postenSpeichern({ name: 'Miete', betrag: 5000, tag: 1 });
const b = L.monatsBilanz();
assert(b.einzahlungen === 20000, 'Einzahlungen des Monats = 20000');
assert(b.posten === 5000, 'Posten des Monats = 5000');
assert(b.ausgaben === 0, 'keine spontanen Ausgaben');
assert(b.frei === 15000, 'frei verfuegbar = Saldo minus offene Posten');

block('Backup: Export und Import');
const sicherung = L.exportDaten();
assert(JSON.parse(sicherung).daten.saldo === 15000, 'Export enthaelt den Saldo');
L.zuruecksetzen();
assert(L.state.saldo === 0, 'Reset leert den Stand');
assert(L.importDaten(sicherung).ok, 'Import des Backups gelingt');
assert(L.state.saldo === 15000, 'Saldo aus dem Backup wiederhergestellt');
assert(L.state.posten.length === 1 && L.state.posten[0].name === 'Miete', 'Posten wiederhergestellt');
assert(!L.importDaten('kein json').ok, 'Mist-Datei wird abgelehnt');
assert(!L.importDaten('{"was":"anderes"}').ok, 'fremdes JSON wird abgelehnt');
assert(L.state.saldo === 15000, 'fehlgeschlagener Import laesst die Daten in Ruhe');

block('Kaputte gespeicherte Daten');
const kaputt = L.normalisiere({ saldo: 'viel', posten: 'nein', transaktionen: null, abgegriffen: 7 });
assert(kaputt.saldo === 0 && Array.isArray(kaputt.posten) && kaputt.posten.length === 0,
  'Unsinn wird zu einem leeren, gueltigen Stand');
localStorage.setItem('inneedmoney.v1', '{nicht json');
L.lade();
assert(typeof L.state.saldo === 'number', 'korruptes localStorage stuerzt nicht ab');

// ------------------------------------------------- DOM-Vertrag (Teil 2)

block('DOM-Vertrag: app.js erwartet nur IDs, die es in index.html gibt');
const idsBlock = appJs.match(/const IDS = \[([\s\S]*?)\];/);
assert(Boolean(idsBlock), 'IDS-Liste in app.js gefunden');
if (idsBlock) {
  const erwartet = (idsBlock[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
  assert(erwartet.length > 20, erwartet.length + ' erwartete IDs eingesammelt');
  const vorhanden = new Set((indexHtml.match(/\bid="([^"]+)"/g) || [])
    .map(s => s.replace(/\bid="|"/g, '')));
  const fehlend = erwartet.filter(id => !vorhanden.has(id));
  assert(fehlend.length === 0, fehlend.length ? 'fehlende IDs im HTML: ' + fehlend.join(', ')
    : 'alle von app.js erwarteten IDs existieren im HTML');
}

block('DOM-Vertrag: jeder knoten[...]-Zugriff steht auch in der IDS-Liste');
if (idsBlock) {
  const erwartet = new Set((idsBlock[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
  const benutzt = [];
  const reKnoten = /knoten\['([^']+)'\]/g;
  let treffer;
  while ((treffer = reKnoten.exec(appJs))) {
    if (!benutzt.includes(treffer[1])) benutzt.push(treffer[1]);
  }
  assert(benutzt.length > 20, benutzt.length + ' benutzte Knoten gefunden');
  const unbekannt = benutzt.filter(id => !erwartet.has(id));
  assert(unbekannt.length === 0, unbekannt.length ? 'nicht in IDS gesammelt: ' + unbekannt.join(', ')
    : 'alle benutzten Knoten werden beim Start geholt');
  const direkt = (appJs.match(/document\.getElementById\('([^']+)'\)/g) || []);
  assert(direkt.length <= 1, 'kein ungeprueftes document.getElementById im UI-Code (nur in el())');
}

block('DOM-Vertrag: jede Kachel oeffnet ein vorhandenes Overlay');
const werte = (quelle, attribut) => {
  const re = new RegExp(attribut + '="([^"]+)"', 'g');
  const raus = [];
  let m;
  while ((m = re.exec(quelle))) raus.push(m[1]);
  return raus;
};
const kacheln = werte(indexHtml, 'data-oeffnet');
const bodies = new Set(werte(indexHtml, 'data-body'));
assert(kacheln.length > 0, kacheln.length + ' Kacheln gefunden');
const ohneZiel = kacheln.filter(k => !bodies.has(k));
assert(ohneZiel.length === 0, ohneZiel.length ? 'Kacheln ohne Overlay: ' + ohneZiel.join(', ')
  : 'alle Kacheln haben ein Overlay');
const titelBlock = appJs.match(/const OVERLAY_TITEL = \{([\s\S]*?)\};/);
if (titelBlock) {
  const ohneTitel = kacheln.filter(k => !new RegExp('\\b' + k + ':').test(titelBlock[1]));
  assert(ohneTitel.length === 0, ohneTitel.length ? 'Kacheln ohne Titel: ' + ohneTitel.join(', ')
    : 'alle Kacheln haben einen Overlay-Titel');
}
const ohneKachel = [...bodies].filter(b => !kacheln.includes(b));
assert(ohneKachel.length === 0, ohneKachel.length ? 'Overlays, die niemand oeffnet: ' + ohneKachel.join(', ')
  : 'kein totes Overlay');

block('DOM-Vertrag: aufklappbare Cards');
const cardNamen = werte(indexHtml, 'data-card');
assert(cardNamen.length === 3, cardNamen.length + ' aufklappbare Cards gefunden');
for (const name of cardNamen) {
  // Abschnitt dieser Card aus dem HTML schneiden
  const start = indexHtml.indexOf('data-card="' + name + '"');
  const ende = indexHtml.indexOf('</section>', start);
  const abschnitt = indexHtml.slice(start, ende);
  assert(/class="card-kopf"/.test(abschnitt), 'Card "' + name + '" hat einen .card-kopf zum Klicken');
  assert(/aria-expanded="/.test(abschnitt), 'Card "' + name + '" hat aria-expanded');
  assert(/class="card-huelle"/.test(abschnitt) && /class="card-inhalt"/.test(abschnitt),
    'Card "' + name + '" hat Huelle und Inhalt zum Einklappen');
  const steuert = (abschnitt.match(/aria-controls="([^"]+)"/) || [])[1];
  assert(steuert && htmlIds.has(steuert), 'aria-controls von "' + name + '" zeigt auf eine echte ID');
}
assert(/\[data-card\]/.test(appJs), 'app.js verdrahtet die Cards ueber [data-card]');
assert(/data-offen/.test(appJs) && /data-offen/.test(indexHtml), 'data-offen wird in HTML und JS benutzt');
for (const regel of ['.card-kopf', '.card-huelle', '.card-inhalt', '.card-pfeil']) {
  assert(css.includes(regel), 'styles.css kennt ' + regel);
}
assert(/data-offen="false"\]\s*\.card-huelle/.test(css), 'CSS klappt bei data-offen="false" zu');
assert(appJs.includes('inneedmoney.ui.v1'), 'Auf-/Zu-Zustand liegt in einem eigenen Storage-Schluessel');
assert(!appJs.includes("state.offen"), 'der Auf-/Zu-Zustand haengt nicht in den Spardaten');

block('Offline-Vertrag: keine externen Abhaengigkeiten');
const extern = indexHtml.match(/(src|href)="https?:\/\/[^"]+"/g) || [];
assert(extern.length === 0, extern.length ? 'externe Referenzen: ' + extern.join(', ') : 'index.html laedt nichts von aussen');
assert(/rel="manifest"/.test(indexHtml), 'manifest.json ist verlinkt');
const sw = fs.readFileSync(path.join(WURZEL, 'sw.js'), 'utf8');
for (const datei of ['index.html', 'styles.css', 'app.js', 'manifest.json']) {
  assert(sw.includes(datei), 'Service Worker cacht ' + datei);
}

// ------------------------------------------------------------------ Fazit

if (fehler) {
  console.error('\n' + fehler + ' Test(s) fehlgeschlagen.');
  process.exit(1);
}
console.log('\nALLE TESTS OK');

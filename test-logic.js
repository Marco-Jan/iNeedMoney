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
assert(!L.pruefeAusgabe(1866).gruende.includes('drittel'), '18,66 EUR -> keine Drittel-Warnung (genau Schwelle)');
assert(L.pruefeAusgabe(1867).gruende.includes('drittel') && typeof L.pruefeAusgabe(1867).warnung === 'string',
  '18,67 EUR -> Drittel-Warnung');
assert(!L.pruefeAusgabe(99999).ok, 'mehr als der Saldo -> Fehler, keine Buchung');
assert(L.state.saldo === 10000, 'pruefeAusgabe bucht nichts');

block('Ausgaben buchen');
const a1 = L.ausgeben(2000, 'Kaffee');
assert(a1.ok && typeof a1.warnung === 'string', '20,00 EUR gebucht, mit Warnung');
assert(L.state.saldo === 8000, 'Saldo = 8000 Cent');
const a2 = L.ausgeben(1000);
assert(a2.ok && !a2.gruende.includes('drittel'), '10,00 EUR gebucht, ohne Drittel-Warnung');
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
assert(!L.pruefeAusgabe(5000).gruende.includes('drittel'), 'ohne offene Posten keine Drittel-Warnung');

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

block('Warnung und Warnschwelle rechnen mit derselben Summe');
// Frueher summierte pruefeAusgabe() Posten, warnschwelle() aber Termine - bei
// einem Posten, der mehrmals im Monat faellt, widersprachen sich die Zahlen.
const morgenIso = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return L.isoVon(d); })();
L.postenSpeichern({ name: 'Woechentlich', betrag: 3000, rhythmus: 'woche', intervall: 1, start: morgenIso });
const schwelleJetzt = L.warnschwelle();
if (schwelleJetzt > 0) {
  assert(schwelleJetzt === Math.floor(L.offeneTermine().length * 3000 / 3), 'die Schwelle zaehlt jeden offenen Termin');
  assert(!L.pruefeAusgabe(schwelleJetzt).gruende.includes('drittel'), 'genau auf der Schwelle: keine Drittel-Warnung');
  assert(L.pruefeAusgabe(schwelleJetzt + 1).gruende.includes('drittel'), 'ein Cent darueber: Drittel-Warnung');
  assert(L.pruefeAusgabe(schwelleJetzt + 1).warnung.includes(L.eur(L.summeOffen())),
    'die Warnung nennt dieselbe offene Summe wie die Startseite');
} else {
  assert(true, 'heute ist Monatsende: keine offenen Termine, uebersprungen');
}

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

block('DOM-Vertrag: jeder Oeffner hat ein Blatt');
const werte = (quelle, attribut) => {
  const re = new RegExp(attribut + '="([^"]+)"', 'g');
  const raus = [];
  let m;
  while ((m = re.exec(quelle))) raus.push(m[1]);
  return raus;
};
const oeffner = werte(indexHtml, 'data-oeffnet');
const bodies = new Set(werte(indexHtml, 'data-body'));
assert(oeffner.length > 0, oeffner.length + ' Oeffner (data-oeffnet) gefunden');
const ohneZiel = oeffner.filter(k => !bodies.has(k));
assert(ohneZiel.length === 0, ohneZiel.length ? 'Oeffner ohne Blatt: ' + ohneZiel.join(', ')
  : 'alle Oeffner haben ein Blatt');
const titelBlock = appJs.match(/const OVERLAY_TITEL = \{([\s\S]*?)\};/);
assert(Boolean(titelBlock), 'OVERLAY_TITEL in app.js gefunden');
if (titelBlock) {
  const ohneTitel = oeffner.filter(k => !new RegExp('\\b' + k + ':').test(titelBlock[1]));
  assert(ohneTitel.length === 0, ohneTitel.length ? 'Oeffner ohne Titel: ' + ohneTitel.join(', ')
    : 'alle Blaetter haben einen Titel');
}
const ohneOeffner = [...bodies].filter(b => !oeffner.includes(b));
assert(ohneOeffner.length === 0, ohneOeffner.length ? 'Blaetter, die niemand oeffnet: ' + ohneOeffner.join(', ')
  : 'kein totes Blatt');
assert(/querySelectorAll\('\[data-oeffnet\]'\)/.test(appJs), 'app.js verdrahtet alle [data-oeffnet]');

block('DOM-Vertrag: Navigation');
const ansichten = werte(indexHtml, 'data-ansicht');
const tabZiele = werte(indexHtml, 'data-tab');
assert(ansichten.length === 4, ansichten.length + ' Ansichten gefunden');
const tabOhneAnsicht = tabZiele.filter(t => !ansichten.includes(t));
assert(tabOhneAnsicht.length === 0, tabOhneAnsicht.length ? 'Tabs ohne Ansicht: ' + tabOhneAnsicht.join(', ')
  : 'jeder Tab zeigt auf eine vorhandene Ansicht');
const ansichtOhneTab = ansichten.filter(a => !tabZiele.includes(a));
assert(ansichtOhneTab.length === 0, ansichtOhneTab.length ? 'unerreichbare Ansichten: ' + ansichtOhneTab.join(', ')
  : 'jede Ansicht ist ueber einen Tab erreichbar');
const sichtbar = (indexHtml.match(/<section class="ansicht" data-ansicht="[^"]+">/g) || []).length;
assert(sichtbar === 1, 'genau eine Ansicht ist beim Start sichtbar, die anderen tragen hidden');
const segmente = werte(indexHtml, 'data-seg');
const panels = werte(indexHtml, 'data-panel');
assert(segmente.length === 2 && segmente.every(s => panels.includes(s)) && panels.every(p => segmente.includes(p)),
  'Einkauf: jeder Umschalter hat sein Panel');
for (const regel of ['#tabs', '.tab', '.ansicht', '.segment', '.balken', '.kleb-fuss']) {
  assert(css.includes(regel), 'styles.css kennt ' + regel);
}

block('Farbschema: System, Hell, Dunkel');
const themen = werte(indexHtml.slice(indexHtml.indexOf('id="thema-wahl"')), 'data-thema').slice(0, 3);
assert(themen.join(',') === 'system,hell,dunkel', 'die Einstellungen bieten System, Hell und Dunkel');
assert(/prefers-color-scheme:\s*light/.test(css), 'ohne Wahl folgt das CSS dem System');
assert(/:root:not\(\[data-thema="dunkel"\]\)/.test(css), 'erzwungenes Dunkel schlaegt ein helles System');
assert(/:root\[data-thema="hell"\]/.test(css), 'erzwungenes Hell schlaegt ein dunkles System');
// Die hellen Werte stehen zweimal im CSS (System hell / von Hand hell) und
// duerfen nicht auseinanderlaufen.
const hellBloecke = [];
{
  const re = /(?::root:not\(\[data-thema="dunkel"\]\)|:root\[data-thema="hell"\])\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) hellBloecke.push(m[1].replace(/\s+/g, ' ').trim());
}
assert(hellBloecke.length === 2 && hellBloecke[0] === hellBloecke[1],
  'beide hellen Farb-Bloecke im CSS sind identisch');
assert(appJs.includes('inneedmoney.ui.v1') && indexHtml.includes('inneedmoney.ui.v1'),
  'das Farbschema liegt im eigenen UI-Schluessel und wird schon im <head> gesetzt');
assert(!/state\.thema/.test(appJs), 'das Farbschema haengt nicht in den Spardaten');
const inlineSkripte = (indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length;
assert(inlineSkripte === 1, 'nur das eine kleine Inline-Skript fuers Farbschema');

block('Offline-Vertrag: keine externen Abhaengigkeiten');
const extern = indexHtml.match(/(src|href)="https?:\/\/[^"]+"/g) || [];
assert(extern.length === 0, extern.length ? 'externe Referenzen: ' + extern.join(', ') : 'index.html laedt nichts von aussen');
assert(/rel="manifest"/.test(indexHtml), 'manifest.json ist verlinkt');
const sw = fs.readFileSync(path.join(WURZEL, 'sw.js'), 'utf8');
for (const datei of ['index.html', 'styles.css', 'app.js', 'manifest.json']) {
  assert(sw.includes(datei), 'Service Worker cacht ' + datei);
}


// ------------------------------------- Vorrat, Preisgedaechtnis und Einkauf

block('Artikel anlegen und per Barcode wiederfinden');
L.zuruecksetzen();
L.einzahlen(50000, 'Start');
const aMilch = L.artikelSpeichern({ ean: '4001234567890', name: 'Milch', einheit: 'l', menge: 2, mindest: 2 });
assert(aMilch.ok, 'Artikel mit Barcode angelegt');
assert(L.artikelNachEan('4001234567890').name === 'Milch', 'Barcode findet den Artikel');
assert(L.artikelNachEan('4-0012 345 67890').name === 'Milch', 'Barcode wird von Trennzeichen befreit');
assert(L.artikelNachEan('9999999999999') === null, 'unbekannter Barcode gibt null');
const doppelt = L.artikelSpeichern({ ean: '4001234567890', name: 'Vollmilch' });
assert(!doppelt.ok, 'derselbe Barcode kann nicht zweimal belegt werden');
assert(!L.artikelSpeichern({ name: '   ' }).ok, 'Artikel ohne Namen wird abgelehnt');
assert(L.state.artikel[0].einheit === 'l', 'Einheit uebernommen');
const komisch = L.artikelSpeichern({ name: 'Komisch', einheit: 'Fass' });
assert(komisch.artikel.einheit === 'Stk', 'unbekannte Einheit faellt auf Stk zurueck');
assert(L.artikelLoeschen(komisch.artikel.id).ok && L.state.artikel.length === 1, 'Artikel geloescht');

block('Vorrat zaehlen und Mindestbestand melden');
const milch = L.artikelNachEan('4001234567890');
assert(milch.menge === 2, 'Bestand 2');
assert(L.nachkaufen().length === 1, 'Bestand auf dem Mindestbestand -> nachkaufen');
L.vorratAendern(milch.id, 3);
assert(milch.menge === 5 && L.nachkaufen().length === 0, 'aufgefuellt -> nichts zu nachkaufen');
L.vorratAendern(milch.id, -99);
assert(milch.menge === 0, 'Bestand wird nicht negativ');
assert(!L.vorratAendern('gibtsnicht', 1).ok, 'unbekannte Artikel-ID -> Fehler');

block('Preisgedaechtnis und Preis-Urteil');
L.vorratAendern(milch.id, 5);
assert(L.preisUrteil(milch.id, 119).stufe === 'neu', 'erster Preis hat kein Urteil');
L.preisErfassen(milch.id, 119, 'Aldi');
assert(milch.bestPreis === 119 && milch.bestLaden === 'Aldi', 'Bestpreis gemerkt');
assert(L.preisUrteil(milch.id, 99).stufe === 'best', 'guenstiger als je -> Bestpreis');
assert(L.preisUrteil(milch.id, 125).stufe === 'gut', 'bis 10 % darueber -> guter Preis');
assert(L.preisUrteil(milch.id, 145).stufe === 'ok', 'bis 25 % darueber -> normal');
assert(L.preisUrteil(milch.id, 179).stufe === 'teuer', 'deutlich darueber -> teuer');
L.preisErfassen(milch.id, 99, 'Rewe');
assert(milch.bestPreis === 99 && milch.letzterPreis === 99, 'neuer Bestpreis uebernommen');
L.preisErfassen(milch.id, 149, 'Edeka');
assert(milch.bestPreis === 99, 'ein teurer Einkauf verdirbt den Bestpreis nicht');
assert(milch.letzterPreis === 149, 'letzter Preis ist der neueste, nicht der billigste');
assert(!L.preisErfassen(milch.id, 0).ok, 'Preis 0 wird abgelehnt');

block('Einkaufsliste');
L.einkaufLeeren();
const p1 = L.einkaufHinzu({ ean: '4001234567890', menge: 2 });
assert(p1.ok && p1.position.preis === 149, 'bekannter Artikel kommt mit letztem Preis als Schaetzung');
assert(p1.geschaetzt === true, 'Preis ist als Schaetzung markiert');
const p2 = L.einkaufHinzu({ ean: '4001234567890', menge: 1 });
assert(p2.zusammengelegt && L.state.einkauf.length === 1 && L.state.einkauf[0].menge === 3,
  'derselbe Artikel wird zusammengelegt, nicht doppelt gelistet');
const neuerScan = L.einkaufHinzu({ ean: '4009876543210', name: 'Kaffee', preis: 599 });
assert(neuerScan.ok && L.artikelNachEan('4009876543210'), 'unbekannter Barcode wird als Artikel angelegt');
assert(!L.einkaufHinzu({ name: '' }).ok, 'Position ohne Namen wird abgelehnt');
const frei = L.einkaufHinzu({ name: 'Broetchen', preis: 50, menge: 4 });
assert(frei.ok && frei.position.artikelId === null, 'Position ohne Barcode bleibt ohne Artikel');
assert(L.einkaufSumme() === 149 * 3 + 599 + 50 * 4, 'Summe = Preis x Menge je Position');
L.einkaufAendern(frei.position.id, { menge: 0 });
assert(L.state.einkauf.find(z => z.id === frei.position.id).menge === 1, 'Menge faellt nie unter 1');
assert(L.einkaufEntfernen(frei.position.id).ok && !L.einkaufEntfernen(frei.position.id).ok,
  'Entfernen wirkt genau einmal');

block('Budget: die Einkaufsliste wird wie eine geplante Ausgabe geprueft');
L.zuruecksetzen();
L.einzahlen(100000, 'Start');
const kuenftigerTag = Math.min(28, new Date().getDate() + 1);
const hatZukunft = kuenftigerTag > new Date().getDate();
L.postenSpeichern({ name: 'Strom', betrag: 30000, tag: kuenftigerTag });
L.artikelSpeichern({ name: 'Kaffee', ean: '4000000000001' });
L.einkaufHinzu({ ean: '4000000000001', preis: 500, menge: 2 });
const bud = L.einkaufBudget();
assert(bud.summe === 1000, 'Budget kennt die Summe der Liste');
assert(bud.frei === L.state.saldo - L.summeOffen(), 'frei verfuegbar = Saldo minus offene Posten');
assert(bud.schwelle === L.warnschwelle(), 'Budget nutzt dieselbe Warnschwelle wie jede Ausgabe');
assert(bud.ok && !bud.warnung, 'kleiner Einkauf loest keine Warnung aus');

if (hatZukunft) {
  L.einkaufAendern(L.state.einkauf[0].id, { preis: 20000 });
  const teuer = L.einkaufBudget();
  assert(teuer.summe === 40000, 'Preisaenderung schlaegt in der Summe durch');
  assert(teuer.ok && teuer.warnung, 'Einkauf ueber 1/3 der offenen Posten warnt');
  assert(teuer.warnung === L.pruefeAusgabe(40000).warnung,
    'die Warnung ist wortgleich zur normalen Ausgabe - keine zweite Regel');
} else {
  assert(true, 'heute ist Monatsende: Warnung nicht pruefbar, uebersprungen');
}

L.einkaufAendern(L.state.einkauf[0].id, { preis: 99999 });
const zuViel = L.einkaufBudget();
assert(!zuViel.ok && zuViel.fehler, 'mehr als der Saldo -> Budget meldet einen Fehler');

L.einkaufLeeren();
assert(L.einkaufBudget().summe === 0 && /leer/i.test(L.einkaufBudget().hinweis),
  'leere Liste wird als leer gemeldet');

block('Einkauf abschliessen: eine Buchung, Vorrat und Preise');
L.zuruecksetzen();
L.einzahlen(50000, 'Start');
const kaffee = L.artikelSpeichern({ name: 'Kaffee', ean: '4000000000002', menge: 1, mindest: 2 }).artikel;
L.preisErfassen(kaffee.id, 599, 'Aldi');
const butter = L.artikelSpeichern({ name: 'Butter', ean: '4000000000003', menge: 0 }).artikel;
L.einkaufHinzu({ artikelId: kaffee.id, menge: 2, preis: 499 });
L.einkaufHinzu({ artikelId: butter.id, menge: 3, preis: 229 });
const vorSaldo = L.state.saldo;
const abschluss = L.einkaufAbschliessen(null, 'Rewe');
assert(abschluss.ok, 'Einkauf gebucht');
assert(abschluss.betrag === 499 * 2 + 229 * 3, 'gebucht wird die Summe der Liste');
assert(L.state.saldo === vorSaldo - abschluss.betrag, 'Saldo um genau die Summe verringert');
const buchungen = L.state.transaktionen.filter(t => /^Einkauf/.test(t.name));
assert(buchungen.length === 1, 'genau EINE Buchung, nicht eine pro Position');
assert(buchungen[0].typ === 'ausgabe' && /Rewe/.test(buchungen[0].name), 'Buchung ist eine Ausgabe mit Laden');
assert(kaffee.menge === 3 && butter.menge === 3, 'Vorrat um die gekauften Mengen erhoeht');
assert(kaffee.bestPreis === 499, 'guenstigerer Preis wird neuer Bestpreis');
assert(butter.bestPreis === 229 && butter.letzterPreis === 229, 'erster Preis landet in der Historie');
assert(L.state.einkauf.length === 0, 'Liste ist nach dem Buchen leer');
assert(abschluss.urteile.some(u => u.name === 'Kaffee' && u.stufe === 'best'),
  'das Urteil wird VOR dem Eintragen gebildet - sonst waere jeder Einkauf ein Bestpreis');
assert(L.nachkaufen().length === 0, 'nach dem Einkauf steht nichts mehr auf der Nachkaufliste');

block('Einkauf abschliessen: Kassenzettel weicht ab');
L.einkaufHinzu({ artikelId: kaffee.id, menge: 1, preis: 499 });
const saldoVorher = L.state.saldo;
const mitZettel = L.einkaufAbschliessen(650, 'Aldi');
assert(mitZettel.ok && mitZettel.betrag === 650 && mitZettel.geplant === 499,
  'gebucht wird der bezahlte Betrag, der geplante wird mitgeliefert');
assert(L.state.saldo === saldoVorher - 650, 'Saldo folgt dem Kassenzettel');
assert(!L.einkaufAbschliessen(500).ok, 'leere Liste kann nicht gebucht werden');
L.einkaufHinzu({ artikelId: kaffee.id, menge: 1 });
L.einkaufAendern(L.state.einkauf[0].id, { preis: 0 });
assert(!L.einkaufAbschliessen().ok, 'ohne Preise und ohne Kassenzettel -> Fehler, keine Buchung');
assert(L.state.einkauf.length === 1, 'die Liste bleibt dabei unangetastet');
L.einkaufLeeren();

block('Einkaufsliste aus dem Vorrat fuellen');
L.vorratAendern(kaffee.id, -99);
assert(L.nachkaufen().length === 1, 'leerer Kaffee steht auf der Nachkaufliste');
const ausVorrat = L.einkaufAusVorrat();
assert(ausVorrat.dazu === 1 && L.state.einkauf.length === 1, 'fehlender Artikel landet auf der Liste');
assert(L.state.einkauf[0].menge === kaffee.mindest + 1, 'Menge fuellt ueber den Mindestbestand hinaus');
assert(L.einkaufAusVorrat().dazu === 0 && L.state.einkauf.length === 1,
  'zweiter Aufruf legt nichts doppelt an');

block('Geloeschter Artikel reisst die Einkaufsliste nicht mit');
L.artikelLoeschen(kaffee.id);
assert(L.state.einkauf.length === 1, 'die Position bleibt auf der Liste stehen');
assert(L.state.einkauf[0].artikelId === null, 'sie ist nur nicht mehr mit einem Artikel verbunden');
assert(L.einkaufSumme() >= 0 && L.einkaufBudget().ok, 'Budget rechnet trotzdem');

block('Vorrat und Einkauf im Backup und bei kaputten Daten');
L.zuruecksetzen();
L.einzahlen(10000, 'Start');
const sichArt = L.artikelSpeichern({ name: 'Nudeln', ean: '4000000000004', menge: 4, mindest: 1 }).artikel;
L.preisErfassen(sichArt.id, 89, 'Lidl');
L.einkaufHinzu({ artikelId: sichArt.id, menge: 2, preis: 95 });
const kopie = L.exportDaten();
L.zuruecksetzen();
assert(L.importDaten(kopie).ok, 'Backup eingelesen');
assert(L.state.artikel.length === 1 && L.state.artikel[0].menge === 4, 'Vorrat ist im Backup');
assert(L.state.artikel[0].bestPreis === 89, 'Preis-Historie ist im Backup');
assert(L.state.einkauf.length === 1 && L.state.einkauf[0].menge === 2, 'Einkaufsliste ist im Backup');

const altesBackup = L.normalisiere({ saldo: 1000, posten: [], transaktionen: [] });
assert(Array.isArray(altesBackup.artikel) && altesBackup.artikel.length === 0,
  'Backup ohne Vorrat laedt mit leerem Vorrat (keine Abstuerze)');
const muell = L.normalisiere({
  saldo: 500,
  artikel: [{ name: 'Krumm', menge: -5, mindest: 'viel', einheit: 42, ean: 'ABC12 3', preise: [{ preis: 'teuer' }, { preis: 0 }, { preis: 250 }] }, null, 7],
  einkauf: [{ name: 'X', menge: -3, preis: -100 }, 'bloed'],
});
assert(muell.artikel.length === 1, 'kaputte Artikel-Eintraege werden verworfen');
const kr = muell.artikel[0];
assert(kr.menge === 0 && kr.mindest === 0 && kr.einheit === 'Stk', 'Unsinnswerte werden geradegezogen');
assert(kr.ean === '123', 'Buchstaben fallen aus dem Barcode');
assert(kr.preise.length === 1 && kr.bestPreis === 250, 'nur brauchbare Preise bleiben, Bestpreis daraus berechnet');
assert(muell.einkauf.length === 1 && muell.einkauf[0].menge === 1 && muell.einkauf[0].preis === 0,
  'kaputte Einkaufs-Positionen werden geradegezogen');
const geerbt = L.normalisiere({ saldo: 0, artikel: [{ name: 'Luege', bestPreis: 1, preise: [{ preis: 900 }] }] });
assert(geerbt.artikel[0].bestPreis === 900,
  'ein importierter Bestpreis wird nicht geglaubt, sondern aus der Historie geholt');

block('Zuruecksetzen raeumt auch Vorrat und Einkaufsliste');
L.zuruecksetzen();
assert(L.state.artikel.length === 0 && L.state.einkauf.length === 0, 'beides ist leer');
assert(gespeichert().artikel.length === 0, 'und das steht auch so im Speicher');

block('DOM-Vertrag: Einkauf, Vorrat und Scanner');
for (const id of ['einkauf-liste', 'vorrat-liste', 'scanner', 'scanner-video', 'ek-buchen', 'art-submit']) {
  assert(htmlIds.has(id), '#' + id + ' steht im HTML');
}
assert(/data-tab="einkauf"/.test(indexHtml) && /data-panel="vorrat"/.test(indexHtml),
  'Einkauf hat einen Tab, der Vorrat ein Panel darin');
assert(/<datalist id="ek-vorschlaege">/.test(indexHtml), 'Artikel-Vorschlaege kommen aus einer lokalen datalist');
// Der Scanner muss ausserhalb der .overlay-body-Logik liegen: er wird aus
// Einkauf UND Vorrat geoeffnet und darf nicht mit umgeschaltet werden.
const scannerAbschnitt = indexHtml.slice(indexHtml.indexOf('id="scanner"'), indexHtml.indexOf('id="frage"'));
assert(!/class="overlay-body"/.test(scannerAbschnitt), 'der Scanner ist kein .overlay-body');
assert(indexHtml.indexOf('id="scanner"') > indexHtml.indexOf('id="overlay"'),
  'der Scanner steht im HTML hinter dem Overlay und liegt dadurch darueber');
assert(indexHtml.indexOf('id="frage"') > indexHtml.indexOf('id="scanner"'),
  'der Bestaetigungs-Dialog liegt ueber dem Scanner');

block('Offline-Vertrag: der Scanner bringt keine Bibliothek mit');
assert(/BarcodeDetector/.test(appJs), 'der Scanner nutzt die eingebaute BarcodeDetector-API');
assert(!/quagga|zxing|jsqr|html5-qrcode/i.test(appJs), 'keine Barcode-Bibliothek im Code');
assert(/getUserMedia/.test(appJs) && /spur\.stop\(\)|\.stop\(\)/.test(appJs),
  'die Kamera wird angefordert UND wieder freigegeben');
assert(/scannerMoeglich/.test(appJs) && /scanner-ean/.test(appJs),
  'ohne BarcodeDetector bleibt die Eingabe von Hand');
for (const regel of ['.scan-knopf', '.budget', '.scanner-buehne', '.urteil-teuer']) {
  assert(css.includes(regel), 'styles.css kennt ' + regel);
}

block('Getippter Name trifft denselben Artikel wie ein Scan');
L.zuruecksetzen();
L.einzahlen(10000, 'Start');
const getippt = L.artikelSpeichern({ name: 'Joghurt', ean: '4000000000009' }).artikel;
L.preisErfassen(getippt.id, 45, 'Aldi');
const ohneScan = L.einkaufHinzu({ name: 'joghurt  ', menge: 2 });
assert(ohneScan.ok && ohneScan.position.artikelId === getippt.id,
  'der getippte Name haengt die Position an den bestehenden Artikel');
assert(ohneScan.position.preis === 45, 'und erbt damit das Preisgedaechtnis');
assert(L.state.artikel.length === 1, 'es entsteht kein stiller Doppel-Artikel');
assert(L.artikelNachName('JOGHURT').id === getippt.id, 'Namenssuche ignoriert Gross-/Kleinschreibung');
assert(L.artikelNachName('Jogh') === null, 'Namenssuche ist exakt, nicht unscharf');
L.einkaufLeeren();

block('Tagesbudget: die zweite Warnregel');
L.zuruecksetzen();
L.einzahlen(310000, 'Start');
// Ohne offene Posten greift die Drittel-Regel nie - frueher hiess das: gar keine Warnung.
assert(L.warnschwelle() === 0, 'keine offenen Posten: die Drittel-Schwelle ist 0');
assert(L.freiVerfuegbar() === 310000, 'frei verfuegbar = Konto, wenn nichts offen ist');
const tageRest = L.restTage();
assert(tageRest >= 1 && tageRest <= 31, 'Resttage zaehlen heute mit (' + tageRest + ')');
assert(L.tagesbudget() === Math.floor(310000 / tageRest), 'Tagesbudget = frei / Resttage, abgerundet');
const grenzeBudget = L.tagesbudget() * L.BUDGET_TAGE_WARNUNG;
if (grenzeBudget < 310000) {
  assert(L.pruefeAusgabe(grenzeBudget).warnung === null, 'genau ' + L.BUDGET_TAGE_WARNUNG + ' Tage Budget: keine Warnung');
  const drueber = L.pruefeAusgabe(grenzeBudget + 1);
  assert(drueber.ok && drueber.gruende.join() === 'budget', 'ein Cent darueber: Warnung wegen Budget, auch ohne offene Posten');
  assert(/Tage deines Budgets/.test(drueber.warnung), 'die Warnung nennt die Tage');
} else {
  assert(true, 'letzter Tag des Monats: drei Tagesbudgets sind mehr als das Konto, uebersprungen');
}
assert(L.budgetTageText(L.tagesbudget() * 2) === '2,0', 'zwei Tagesbudgets sind "2,0" Tage');
assert(L.budgetTageText(L.tagesbudget() * 12) === '12', 'ab zehn Tagen ohne Nachkommastelle');

block('Tagesbudget: mehr als das freie Geld');
L.zuruecksetzen();
L.einzahlen(100000, 'Start');
const tagFrei = Math.min(28, new Date().getDate() + 1);
if (tagFrei > new Date().getDate()) {
  L.postenSpeichern({ name: 'Miete', betrag: 90000, tag: tagFrei });
  assert(L.freiVerfuegbar() === 10000, 'frei = 1000 - 900 = 100 Euro');
  const zuTief = L.pruefeAusgabe(15000);
  assert(zuTief.ok, '150 Euro sind buchbar - das Konto reicht ja');
  assert(zuTief.gruende.includes('reserviert') && !zuTief.gruende.includes('budget'),
    'aber es wird gewarnt: das geht an reservierte Posten');
  assert(zuTief.warnung.includes(L.eur(5000)), 'die Warnung nennt, wie viel dann fehlt');
  assert(L.einkaufBudget().hinweis !== undefined, 'das Einkaufs-Budget laeuft ueber dieselbe Pruefung');
  L.state.saldo = 50000;
  assert(L.tagesbudget() === 0, 'ist nichts frei, ist das Tagesbudget 0 und nie negativ');
  assert(L.pruefeAusgabe(100).gruende.includes('reserviert'), 'dann warnt schon ein Euro');
} else {
  assert(true, 'heute ist Monatsende: nicht pruefbar, uebersprungen');
}

block('Wunschliste: parken, abkuehlen, entscheiden');
L.zuruecksetzen();
L.einzahlen(500000, 'Start');
const t0w = Date.UTC(2026, 5, 10, 12, 0, 0);
const STD = 3600000;
assert(!L.wunschSpeichern({ name: '  ', betrag: 5000 }).ok, 'Wunsch ohne Namen wird abgelehnt');
assert(!L.wunschSpeichern({ name: 'X', betrag: 0 }).ok, 'Wunsch ohne Betrag wird abgelehnt');
const wu = L.wunschSpeichern({ name: 'Kopfhoerer', betrag: 12900 }, t0w);
assert(wu.ok && L.state.wuensche.length === 1, 'Wunsch geparkt');
assert(L.state.saldo === 500000, 'parken bucht nichts');
assert(gespeichert().wuensche.length === 1, 'der Wunsch ist persistiert');
assert(L.wunschRestStunden(wu.wunsch, t0w) === L.ABKUEHL_STUNDEN, 'direkt nach dem Parken: volle Abkuehlzeit');
assert(L.wunschRestStunden(wu.wunsch, t0w + 30 * 60000) === L.ABKUEHL_STUNDEN, 'angefangene Stunden zaehlen voll');
assert(L.wunschRestStunden(wu.wunsch, t0w + 47 * STD + 1) === 1, 'kurz vor Ablauf: noch 1 Stunde');
assert(!L.wunschReif(wu.wunsch, t0w + 47 * STD), 'nach 47 Stunden noch nicht reif');
assert(L.wunschReif(wu.wunsch, t0w + 48 * STD), 'nach 48 Stunden reif');
const zuFrueh = L.wunschKaufen(wu.wunsch.id, t0w + 10 * STD);
assert(!zuFrueh.ok && /38 Stunden/.test(zuFrueh.fehler), 'vor Ablauf laesst sich der Wunsch nicht kaufen');
assert(L.state.saldo === 500000 && wu.wunsch.status === 'offen', 'der gescheiterte Kauf hat nichts veraendert');
const gekauft = L.wunschKaufen(wu.wunsch.id, t0w + 49 * STD);
assert(gekauft.ok && L.state.saldo === 500000 - 12900, 'nach der Abkuehlzeit bucht Kaufen die Ausgabe');
assert(L.state.transaktionen[0].typ === 'ausgabe' && L.state.transaktionen[0].name === 'Kopfhoerer',
  'die Buchung ist eine normale Ausgabe mit dem Namen des Wunsches');
assert(!L.wunschKaufen(wu.wunsch.id, t0w + 50 * STD).ok, 'ein gekaufter Wunsch laesst sich nicht noch einmal kaufen');

const wu2 = L.wunschSpeichern({ name: 'Jacke', betrag: 8000 }, t0w).wunsch;
const wu3 = L.wunschSpeichern({ name: 'Spiel', betrag: 6000 }, t0w + STD).wunsch;
assert(L.offeneWuensche().map(w => w.name).join() === 'Jacke,Spiel', 'offene Wuensche: die aeltesten zuerst');
const weg = L.wunschVerwerfen(wu2.id);
assert(weg.ok && weg.gespart === 8000, 'verwerfen geht jederzeit, auch vor Ablauf');
assert(L.state.saldo === 500000 - 12900, 'verwerfen bucht nichts');
assert(!L.wunschVerwerfen(wu2.id).ok, 'verwerfen wirkt genau einmal');
const wb = L.wunschBilanz();
assert(wb.verworfen === 1 && wb.gespart === 8000 && wb.gekauft === 1 && wb.offen === 1,
  'die Bilanz zaehlt verworfen, gespart, gekauft und offen');

L.state.saldo = 1000;
const zuTeuer = L.wunschKaufen(wu3.id, t0w + 100 * STD);
assert(!zuTeuer.ok && wu3.status === 'offen', 'reicht das Konto nicht, bleibt der Wunsch offen');

block('Wunschliste im Backup und bei kaputten Daten');
const wKopie = L.exportDaten();
L.zuruecksetzen();
assert(L.state.wuensche.length === 0, 'Zuruecksetzen leert die Wunschliste');
assert(L.importDaten(wKopie).ok && L.state.wuensche.length === 3, 'die Wunschliste ist im Backup');
assert(L.state.wuensche.find(w => w.name === 'Spiel').erstellt === t0w + STD, 'der Zeitpunkt des Parkens bleibt erhalten');
assert(L.normalisiere({ saldo: 0 }).wuensche.length === 0, 'altes Backup ohne Wunschliste laedt leer');
const wMuell = L.normalisiere({ saldo: 0, wuensche: [{ name: 'Ok', betrag: 500, status: 'quatsch' }, { name: 'Null', betrag: 0 }, null, 'x'] });
assert(wMuell.wuensche.length === 1 && wMuell.wuensche[0].status === 'offen',
  'kaputte Wuensche werden verworfen, unbekannter Status wird zu offen');

block('DOM-Vertrag: Wunschliste und Bremse');
for (const id of ['wunsch-liste', 'form-wunsch', 'aus-parken', 'tagesbudget', 'aus-budget']) {
  assert(htmlIds.has(id), '#' + id + ' steht im HTML');
}
assert(/data-oeffnet="wunsch"/.test(indexHtml) && /data-body="wunsch"/.test(indexHtml), 'das Wunsch-Blatt hat einen Oeffner');
assert(/BREMSE_SEKUNDEN/.test(appJs) && /Date\.now\(\) < bremseBis/.test(appJs),
  'die Bremse gilt auch fuer das Absenden per Enter, nicht nur fuer den Knopf');
assert(/visibilitychange/.test(appJs), 'kommt die App wieder nach vorn, wird neu gezeichnet');

block('Muster: spontane Ausgaben und "trotz Warnung"');
L.zuruecksetzen();
L.einzahlen(300000, 'Start');
assert(L.monatsMuster().anzahl === 0 && L.monatsMuster().summe === 0, 'ohne Ausgaben ist das Muster leer');
L.ausgeben(100, 'Kaugummi');
const mKlein = L.monatsMuster();
assert(mKlein.anzahl === 1 && mKlein.summe === 100, 'eine spontane Ausgabe wird gezaehlt');
// 2990 von 3000 Euro: mehr als drei Tagesbudgets, ausser am letzten Tag des Monats
const mGross = L.ausgeben(250000, 'Fernseher');
if (mGross.warnung) {
  assert(L.state.transaktionen[0].gewarnt === true, 'eine Ausgabe trotz Warnung wird als solche gemerkt');
  assert(L.monatsMuster().trotzWarnung === 1 && L.monatsMuster().summeTrotz === 250000,
    'das Muster zaehlt sie und ihre Summe');
} else {
  assert(true, 'letzter Tag des Monats: keine Budget-Warnung moeglich, uebersprungen');
}
assert(!('gewarnt' in L.state.transaktionen[1]), 'ohne Warnung traegt die Buchung kein Kennzeichen');
const vorEinkauf = L.monatsMuster().anzahl;
L.einkaufHinzu({ name: 'Brot', preis: 250, menge: 1 });
L.einkaufAbschliessen(null, 'Baecker');
assert(L.state.transaktionen[0].art === 'einkauf', 'ein gebuchter Einkauf traegt seine Herkunft');
assert(L.monatsMuster().anzahl === vorEinkauf, 'ein Einkauf von der Liste zaehlt nicht als spontan');
const mW = L.wunschSpeichern({ name: 'Buch', betrag: 1500 }, Date.now() - 49 * 3600000).wunsch;
assert(L.wunschKaufen(mW.id).ok && L.state.transaktionen[0].art === 'wunsch', 'ein gekaufter Wunsch traegt seine Herkunft');
assert(L.monatsMuster().anzahl === vorEinkauf, 'ein abgekuehlter Wunsch zaehlt nicht als spontan');
const mW2 = L.wunschSpeichern({ name: 'Lampe', betrag: 4000 }).wunsch;
L.wunschVerwerfen(mW2.id);
assert(L.monatsMuster().verworfen === 1 && L.monatsMuster().gespart === 4000, 'verworfene Wuensche des Monats stehen im Muster');
assert(L.monatsMuster('1999-01').anzahl === 0, 'ein anderer Monat hat sein eigenes Muster');
const mRund = L.normalisiere(JSON.parse(L.exportDaten()).daten);
assert(mRund.transaktionen.some(x => x.art === 'einkauf') && mRund.transaktionen.some(x => x.art === 'wunsch'),
  'Herkunft und Kennzeichen ueberleben das Backup');
assert(htmlIds.has('muster'), '#muster steht im HTML');

block('Sparziel: ein eigener Topf');
L.zuruecksetzen();
L.einzahlen(200000, 'Start');
assert(L.sparzielStand() === null, 'ohne Sparziel gibt es keinen Stand');
assert(!L.sparzielEinzahlen(1000).ok, 'ohne Sparziel laesst sich nichts zuruecklegen');
assert(!L.sparzielSetzen({ name: '', ziel: 10000 }).ok, 'Sparziel ohne Namen wird abgelehnt');
assert(!L.sparzielSetzen({ name: 'X', ziel: 0 }).ok, 'Sparziel ohne Zielbetrag wird abgelehnt');
assert(L.sparzielSetzen({ name: 'Urlaub', ziel: 120000 }).neu === true, 'Sparziel angelegt');
assert(L.state.saldo === 200000, 'anlegen bucht nichts');
const freiVorher = L.freiVerfuegbar();
assert(L.sparzielEinzahlen(30000).ok, '300 Euro zurueckgelegt');
assert(L.state.saldo === 170000, 'das Geld verlaesst das Konto');
assert(L.freiVerfuegbar() === freiVorher - 30000, 'und ist nicht mehr frei verfuegbar');
const st = L.sparzielStand();
assert(st.gespart === 30000 && st.rest === 90000 && st.anteil === 0.25 && !st.erreicht, 'Stand: 300 von 1200, 25 Prozent');
assert(L.state.transaktionen[0].typ === 'sparen' && L.state.transaktionen[0].name === 'Urlaub', 'die Bewegung steht als eigene Art in der Historie');
assert(L.monatsBilanz().ausgaben === 0 && L.monatsMuster().anzahl === 0, 'zuruecklegen ist keine Ausgabe und kein Impulskauf');
assert(gespeichert().sparziel.gespart === 30000, 'der Topf ist persistiert');
assert(!L.sparzielEinzahlen(0).ok, 'zuruecklegen von 0 wird abgelehnt');

block('Sparziel: nur aus dem freien Geld');
const tagTopf = Math.min(28, new Date().getDate() + 1);
if (tagTopf > new Date().getDate()) {
  L.postenSpeichern({ name: 'Miete', betrag: 150000, tag: tagTopf });
  assert(L.freiVerfuegbar() === 20000, 'frei sind noch 200 Euro');
  const zuViel = L.sparzielEinzahlen(20001);
  assert(!zuViel.ok && zuViel.fehler.includes(L.eur(20000)), 'mehr als das freie Geld geht nicht in den Topf');
  assert(L.state.saldo === 170000 && L.sparzielStand().gespart === 30000, 'der abgelehnte Versuch hat nichts veraendert');
  assert(L.sparzielEinzahlen(20000).ok && L.freiVerfuegbar() === 0, 'genau das freie Geld geht');
  L.postenLoeschen(L.state.posten[0].id);
  L.sparzielEntnehmen(20000);
} else {
  assert(true, 'heute ist Monatsende: nicht pruefbar, uebersprungen');
}

block('Sparziel: entnehmen, aendern, aufloesen');
assert(!L.sparzielEntnehmen(30001).ok, 'mehr als im Topf liegt laesst sich nicht entnehmen');
assert(L.sparzielEntnehmen(10000).ok && L.state.saldo === 180000 && L.sparzielStand().gespart === 20000,
  'entnehmen legt das Geld zurueck aufs Konto');
assert(L.state.transaktionen[0].typ === 'entnahme', 'die Entnahme steht in der Historie');
assert(L.monatsBilanz().einzahlungen === 200000, 'eine Entnahme zaehlt nicht als Einzahlung');
assert(L.sparzielSetzen({ name: 'Reise', ziel: 40000 }).neu === false, 'Name und Ziel lassen sich aendern');
assert(L.sparzielStand().gespart === 20000 && L.sparzielStand().anteil === 0.5, 'was im Topf liegt, bleibt dabei');
const fertig = L.sparzielEinzahlen(20000);
assert(fertig.ok && fertig.erreicht && L.sparzielStand().erreicht, 'das Erreichen des Ziels wird gemeldet');
assert(L.sparzielEinzahlen(1000).erreicht === false, 'aber nur einmal, nicht bei jeder weiteren Einzahlung');
assert(L.sparzielStand().anteil === 1 && L.sparzielStand().rest === 0, 'ueber dem Ziel bleibt der Anteil bei 100 Prozent');
const saldoVorAufl = L.state.saldo;
const aufl = L.sparzielAufloesen();
assert(aufl.ok && aufl.zurueck === 41000 && L.state.saldo === saldoVorAufl + 41000, 'aufloesen gibt den Topf aufs Konto zurueck');
assert(L.state.sparziel === null && L.state.saldo === 200000, 'danach gibt es kein Sparziel mehr und kein Cent fehlt');

block('Sparziel: eine Ausgabe dagegenstellen');
L.zuruecksetzen();
L.einzahlen(500000, 'Start');
assert(L.sparzielVergleich(5000) === null, 'ohne Sparziel kein Vergleich');
L.sparzielSetzen({ name: 'Rad', ziel: 100000 });
assert(L.sparRateProTag() === 0, 'ohne Einzahlungen gibt es kein Spar-Tempo');
assert(/10 % von dem, was dir/.test(L.sparzielVergleich(10000)), 'ohne Tempo: Anteil an dem, was noch fehlt');
assert(L.sparzielVergleich(10) === null, 'unter einem Prozent wird nichts gesagt');
L.sparzielEinzahlen(30000);
assert(L.sparRateProTag() === 1000, '300 Euro in 30 Tagen sind 10 Euro pro Tag');
assert(/etwa 5 Tage/.test(L.sparzielVergleich(5000)), 'mit Tempo: 50 Euro sind etwa 5 Tage Sparen');
assert(/auf einen Schlag erreicht/.test(L.sparzielVergleich(70000)), 'reicht der Betrag fuer den Rest, wird das gesagt');
L.sparzielEntnehmen(30000);
assert(L.sparRateProTag() === 0, 'Entnahmen ziehen vom Tempo ab, negativ wird es nie');

block('Sparziel im Backup und bei kaputten Daten');
L.sparzielEinzahlen(12345);
const tKopie = L.exportDaten();
L.zuruecksetzen();
assert(L.state.sparziel === null, 'Zuruecksetzen loescht das Sparziel');
assert(L.importDaten(tKopie).ok && L.state.sparziel.gespart === 12345 && L.state.sparziel.name === 'Rad', 'der Topf ist im Backup');
assert(L.state.transaktionen.some(x => x.typ === 'sparen') && L.state.transaktionen.some(x => x.typ === 'entnahme'),
  'die neuen Buchungsarten ueberleben das Backup');
assert(L.normalisiere({ saldo: 0 }).sparziel === null, 'altes Backup ohne Sparziel laedt ohne');
assert(L.normalisiere({ saldo: 0, sparziel: { name: 'X', ziel: 'viel' } }).sparziel === null, 'ein Ziel ohne Betrag wird verworfen');
assert(L.normalisiere({ saldo: 0, sparziel: { ziel: 5000, gespart: -3 } }).sparziel.gespart === 0, 'ein negativer Topf wird zu 0');

block('DOM-Vertrag: Sparziel');
for (const id of ['sparziel-karte', 'sparziel-leer', 'form-sparen', 'form-sparziel', 'sp-entnehmen', 'sz-aufloesen', 'aus-ziel']) {
  assert(htmlIds.has(id), '#' + id + ' steht im HTML');
}
assert(/data-oeffnet="sparen"/.test(indexHtml) && /data-oeffnet="sparziel"/.test(indexHtml), 'beide Spar-Blaetter haben einen Oeffner');

block('Grundbedarf: Artikel-Merkmal');
L.zuruecksetzen();
L.einzahlen(100000, 'Start');
const gb_brot = L.artikelSpeichern({ name: 'Brot', ean: '4000000000017', grundbedarf: true }).artikel;
assert(gb_brot.grundbedarf === true, 'ein Artikel laesst sich als Grundbedarf markieren');
assert(L.artikelSpeichern({ id: gb_brot.id, name: 'Brot', ean: gb_brot.ean }).artikel.grundbedarf === true,
  'das Merkmal bleibt, wenn es beim Aendern nicht genannt wird');
assert(L.artikelSpeichern({ name: 'Konsole' }).artikel.grundbedarf === false, 'ohne Angabe ist ein Artikel kein Grundbedarf');
assert(L.normalisiere({ saldo: 0, artikel: [{ name: 'X', grundbedarf: 'ja' }] }).artikel[0].grundbedarf === false,
  'nur ein echtes true zaehlt');
assert(gespeichert().artikel.find(a => a.name === 'Brot').grundbedarf === true, 'das Merkmal ist persistiert');

block('Grundbedarf: keine Warnung, solange Geld frei ist');
const gb_grenzeG = L.tagesbudget() * L.BUDGET_TAGE_WARNUNG;
if (gb_grenzeG > 0 && gb_grenzeG + 300 <= 100000) {
  const b = gb_grenzeG + 100;
  assert(L.pruefeAusgabe(b).gruende.includes('budget'), 'ohne Grundbedarf warnt die Budget-Regel');
  assert(L.pruefeAusgabe(b, b).warnung === null, 'derselbe Betrag als Grundbedarf: keine Warnung');
  assert(L.pruefeAusgabe(b, 200).warnung === null, 'der Grundbedarf-Anteil zaehlt fuer die Grenze nicht mit');
  const gb_gemischt = L.pruefeAusgabe(b + 200, 100);
  assert(gb_gemischt.gruende.includes('budget') && /Grundbedarf/.test(gb_gemischt.warnung),
    'ist der Rest zu gross, wird trotzdem gewarnt');
} else {
  assert(true, 'Monatsende: Budget-Grenze nicht pruefbar, uebersprungen');
}
assert(!L.pruefeAusgabe(100001, 100001).ok, 'auch Grundbedarf geht nicht ueber das Konto hinaus');
const gb_tagG = Math.min(28, new Date().getDate() + 1);
if (gb_tagG > new Date().getDate()) {
  L.postenSpeichern({ name: 'Miete', betrag: 90000, tag: gb_tagG });
  const gb_knapp = L.pruefeAusgabe(20000, 20000);
  assert(gb_knapp.ok && gb_knapp.gruende.includes('reserviert'), 'reicht das freie Geld nicht, warnt auch Grundbedarf');
  assert(L.pruefeAusgabe(10000, 10000).warnung === null, 'innerhalb des freien Geldes bleibt Grundbedarf still');
  L.postenLoeschen(L.state.posten[0].id);
} else {
  assert(true, 'heute ist Monatsende: nicht pruefbar, uebersprungen');
}

block('Grundbedarf auf der Einkaufsliste');
L.einkaufHinzu({ artikelId: gb_brot.id, menge: 2, preis: 300 });
L.einkaufHinzu({ name: 'Konsole', preis: 5000 });
assert(L.einkaufGrundbedarf() === 600, 'nur die Grundbedarf-Positionen zaehlen');
assert(L.einkaufBudget().grundbedarf === 600 && L.einkaufBudget().summe === 5600, 'das Budget kennt den Anteil');
L.einkaufLeeren();

block('Sofortkauf: scannen und gleich bezahlen');
L.zuruecksetzen();
L.einzahlen(100000, 'Start');
const gb_k1 = L.sofortKauf({ ean: '4000000000024', name: 'Milch', preis: 129, menge: 2, grundbedarf: true });
assert(gb_k1.ok && gb_k1.betrag === 258 && L.state.saldo === 100000 - 258, 'der Betrag geht sofort vom Konto');
const gb_milch = L.artikelNachEan('4000000000024');
assert(gb_milch && gb_milch.grundbedarf && gb_milch.menge === 2 && gb_milch.letzterPreis === 129,
  'ein unbekannter Barcode wird als Artikel angelegt: Vorrat, Preis, Grundbedarf');
assert(L.state.transaktionen[0].art === 'einkauf' && L.state.transaktionen[0].name === '2× Milch',
  'Grundbedarf wird als Einkauf gebucht');
assert(L.monatsMuster().anzahl === 0, 'und zaehlt nicht als Impulskauf');
const gb_k2 = L.sofortKauf({ ean: '4000000000024' });
assert(gb_k2.ok && gb_k2.betrag === 129 && gb_milch.menge === 3, 'bekannter Artikel ohne Preis: der letzte Preis gilt');
assert(gb_k2.urteil && gb_k2.urteil.stufe === 'best', 'das Preis-Urteil kommt mit zurueck');
const gb_artikelVor = L.state.artikel.length;
assert(!L.sofortKauf({ ean: '4000000000031', preis: 100 }).ok, 'unbekannter Barcode ohne Namen -> Fehler');
assert(!L.sofortKauf({ ean: '4000000000031', name: 'Kaese' }).ok, 'unbekannter Artikel ohne Preis -> Fehler');
assert(!L.sofortKauf({ ean: '4000000000031', name: 'Gold', preis: 99999999 }).ok, 'mehr als auf dem Konto -> Fehler');
assert(L.state.artikel.length === gb_artikelVor && !L.artikelNachEan('4000000000031'),
  'ein abgelehnter Kauf legt keinen Artikel an');
const gb_saldoVorSchoko = L.state.saldo;
const gb_k3 = L.sofortKauf({ name: 'Schokolade', preis: 199 });
assert(gb_k3.ok && L.state.saldo === gb_saldoVorSchoko - 199 && !L.state.transaktionen[0].art,
  'kein Grundbedarf: eine spontane Ausgabe wie jede andere');
assert(L.monatsMuster().anzahl === 1 && L.monatsMuster().summe === 199, 'die in der Musteranzeige steht');
L.einkaufHinzu({ artikelId: gb_milch.id, menge: 3 });
assert(L.sofortKauf({ artikelId: gb_milch.id, menge: 2 }).vonListe && L.state.einkauf[0].menge === 1,
  'der Kauf wird von der Einkaufsliste abgezogen');
L.sofortKauf({ artikelId: gb_milch.id });
assert(L.state.einkauf.length === 0, 'ist alles gekauft, verschwindet die Position');
L.sofortKauf({ artikelId: gb_milch.id, grundbedarf: false });
assert(gb_milch.grundbedarf === false && !L.state.transaktionen[0].art, 'der Haken laesst sich beim Kauf umstellen');
const gb_kopieG = L.exportDaten();
L.zuruecksetzen();
assert(L.importDaten(gb_kopieG).ok && L.artikelNachName('Schokolade').menge === 1, 'Sofortkaeufe ueberleben das Backup');

block('DOM-Vertrag: Grundbedarf und Sofortkauf');
for (const id of ['form-sofort', 'so-name', 'so-scan', 'so-preis', 'so-menge', 'so-grund', 'so-warnung', 'so-submit', 'art-grund']) {
  assert(htmlIds.has(id), '#' + id + ' steht im HTML');
}
assert(/data-oeffnet="sofort"/.test(indexHtml), 'das Sofortkauf-Blatt hat einen Oeffner');

block('Icons: alles, was verlinkt ist, liegt im Repo und im Offline-Cache');
{
  const manifestIcons = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')).icons.map(i => i.src);
  const kopfIcons = [...indexHtml.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map(m => m[1]);
  const swText = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  assert(kopfIcons.length >= 2 && manifestIcons.length >= 3, 'Favicon, Apple-Icon und Manifest-Icons sind eingetragen');
  for (const datei of new Set([...manifestIcons, ...kopfIcons])) {
    assert(fs.existsSync(path.join(__dirname, datei)), datei + ' existiert');
    assert(swText.includes("'./" + datei + "'"), datei + ' steht im Service-Worker-Cache');
  }
  assert(!/^https?:/.test(manifestIcons.concat(kopfIcons).join(' ')), 'kein Icon kommt von aussen');
}

// ------------------------------------------------------------------ Fazit

if (fehler) {
  console.error('\n' + fehler + ' Test(s) fehlgeschlagen.');
  process.exit(1);
}
console.log('\nALLE TESTS OK');

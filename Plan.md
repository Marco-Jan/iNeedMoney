# Plan: iNeedMoney (Spar-App)

Ziel: Offline-fähige Web-App (HTML/JS, kein Framework), die beim Sparen hilft.
Wichtigste Anforderung: **muss offline am Handy funktionieren** → keine externen Abhängigkeiten (kein CDN), Daten lokal (localStorage), PWA (manifest + Service Worker).

## Modell

- **Einzahlung**: Geld wird ins Konto eingezahlt (Startpunkt des Sparens).
- **Posten**: wiederkehrende Abzüge mit einstellbarem Rhythmus:
  - **alle N Monate** am Tag X (z. B. 56 € Strom monatlich am 28., oder eine
    Versicherung alle 2 Monate am 20.)
  - **alle N Wochen** ab einem Starttermin (z. B. 80 € Haushaltsgeld alle
    2 Wochen). Wochen-Rhythmen wandern durchs Jahr und können zweimal im
    selben Monat fallen.
- **Rest**: alles, was nicht reserviert ist → für spontane Ausgaben („frei verfügbar").
- **Artikel**: eine Ware, die du kaufst. Ist gleichzeitig **Vorratszähler** und
  **Preisgedächtnis** (Bestpreis, letzter Preis, Laden, Historie) und optional
  über einen **Barcode** ansprechbar.
- **Einkaufsliste**: geplanter Einkauf (Position = Artikel × Menge × Preis).
  Die Summe wird wie eine geplante spontane Ausgabe behandelt.
- **Warnung**: Bei spontaner Ausgabe warnen, wenn der Betrag > 1/3 der Summe der noch offenen Posten (künftige Tage im aktuellen Monat) ist.

## Architektur

`app.js` ist in zwei Hälften geteilt:

1. **Logik** – kennt kein DOM. Alle Buchungen laufen über Funktionen, die
   `{ ok, fehler? , warnung? }` zurückgeben (`einzahlen`, `pruefeAusgabe`,
   `ausgeben`, `postenSpeichern`, `postenLoeschen`, `abrechnen`,
   `monatsBilanz`, `importDaten`, …). Für den Test unter `globalThis.Logik`.
2. **UI** – läuft nur, wenn ein `document` existiert. Holt beim Start alle
   benötigten Elemente über die Liste `IDS` ein und meldet fehlende per
   `console.warn`, statt reihenweise abzustürzen.

Damit ist die Rechenlogik ohne Browser testbar, und der Test kann zusätzlich
prüfen, dass UI und HTML zueinander passen.

## Stand

- [x] **Grundgerüst**: `index.html`, `styles.css`, `app.js` — statisch, ohne Build-Schritt.
- [x] **Datenmodell** (localStorage, Key `inneedmoney.v1`, Beträge als Integer-Cent):
  - `saldo`, `transaktionen` (typ, betrag, datum, name) und
    `posten` (id, name, betrag, rhythmus `'monat'|'woche'`, intervall, tag,
    start, naechster — siehe „Abrechnung")
  - gespeicherte Daten werden beim Laden über `normalisiere()` geprüft → kaputte
    oder fremde Dateien legen die App nicht lahm
- [x] **UI**:
  - [x] **Vier Ansichten mit Leiste unten** (Übersicht, Posten, Einkauf,
        Verlauf) statt acht gleich großer Kacheln. Formulare öffnen sich als
        **Blatt von unten** (`data-oeffnet` → `data-body`), Einstellungen
        hinter dem Zahnrad.
  - [x] **Übersicht**: große Zahl ist „Frei verfügbar" (Konto minus offene
        Termine), nicht der Kontostand. Balken darunter: frei / reserviert.
        Darunter Monatszahlen, „Als Nächstes" (die drei nächsten Termine mit
        „in 4 Tagen") und die letzten Buchungen nach Tag gruppiert.
  - [x] **Als App installieren**: Knopf in den Einstellungen. Hängt an
        `beforeinstallprompt`; iOS kennt das nicht und bekommt den Weg über
        „Teilen → Zum Home-Bildschirm" genannt. Läuft die App installiert
        (`display-mode: standalone`), verschwindet der Abschnitt.
  - [x] Einzahlung erfassen (mit Notiz), zeigt „Konto danach"
  - [x] Posten anlegen, **bearbeiten** und löschen (Formular im Blatt)
  - [x] **Spontane Ausgabe mit Live-Warnung**: schon beim Tippen steht da, was
        danach frei bleibt, und die Drittel-Warnung erscheint im Blatt. Der
        Knopf heißt dann „Trotzdem ausgeben" — das ersetzt den früheren
        Bestätigungs-Dialog. Geprüft wird über dasselbe `pruefeAusgabe()`.
  - [x] **Posten & Kalender in einer Ansicht**: pro Tag ein Punkt (voll = offen,
        Ring = bezahlt; in eine Zelle von 1/7 Bildschirmbreite passt kein Name).
        Ein Tipp auf einen Tag filtert die Terminliste darunter. Heutiger Tag
        markiert, Navigation über Monats- und Jahresgrenzen
  - [x] **Verlauf**: alle Buchungen nach Tag gruppiert, filterbar nach
        Ausgaben / Eingängen / Posten, mit Summe des Filters
  - [x] **Einkauf & Budget**: Einkaufsliste mit Budget-Kasten (Einkauf /
        frei verfügbar / danach frei), Barcode-Scan, Preis-Urteil gegen den
        eigenen Bestpreis, „Aus Vorrat ergänzen", Abschluss als **eine**
        Ausgabe (optional mit der Summe vom Kassenzettel)
  - [x] **Vorrat & Preise**: Artikel anlegen/ändern/löschen, Bestand ±,
        Mindestbestand mit „nachkaufen"-Markierung, Bestpreis und letzter Preis
  - [x] **Barcode-Scanner**: eingebaute `BarcodeDetector`-API, wo vorhanden,
        sonst der **eigene EAN-Leser** (`eanAusZeile()`, EAN-13/EAN-8);
        Eingabe von Hand als letzter Rückfall
  - [x] **Kontostand korrigieren** (Einstellungen): `saldoKorrigieren()` setzt
        den Stand und bucht den Unterschied als eigene Art `'korrektur'`
        (`plus: true` = nach oben). Zählt weder als Ausgabe noch als
        Einzahlung noch in die Musteranzeige. **Mit Absicht umständlich**:
        erst aufklappen, Grund ist Pflicht, die Folgen (frei verfügbar,
        Tagesbudget vorher → nachher, bisherige Korrekturen des Monats)
        stehen da, 10 Sekunden Bremse, dann Rückfrage.
  - [x] Einstellungen: Farbschema, Backup exportieren / importieren, Reset
  - [x] Toasts statt `alert()`
  - [x] **Farbschema System / Hell / Dunkel**. Ohne Wahl folgt die App dem
        Gerät (`prefers-color-scheme`), eine Wahl setzt `data-thema` am
        `<html>`. Sie liegt in `inneedmoney.ui.v1` — bewusst getrennt von den
        Spardaten, damit ein Backup-Import sie nicht mitbringt. Ein kleines
        Inline-Skript im `<head>` setzt das Attribut vor dem ersten Zeichnen,
        sonst blitzt das falsche Schema auf.
- [x] **Offline/PWA**: `manifest.json` (verlinkt!) + Service Worker (`sw.js`, Cache
      `inneedmoney-v13`): Navigation und Assets „Netz zuerst, Cache als Rückfall",
      damit HTML, CSS und JS nach einem Deploy zusammenpassen. Alle Assets lokal.
- [x] **Sprache**: UI auf Deutsch.
- [x] **Design**: flache, ruhige Oberfläche in Dunkel und Hell mit Gold als
      einzigem Akzent (kein Neomorphismus mehr). Farben als Variablen in
      `:root`, Systemschrift, Tippflächen mindestens 44 px, reduzierte
      Animationen bei `prefers-reduced-motion`.
- [x] **Tests**: `node test-logic.js`

## Abrechnung (Details)

Jeder Posten zählt seine Termine über einen **Index ab seinem Startdatum**
durch; `naechster` ist der Index des ersten noch nicht gebuchten Termins.

    termin(k) = k-ter Termin seit p.start

- **Monats-Rhythmus**: `start`-Monat + k × `intervall` Monate, am Tag
  `min(tag, Tage im Monat)`.
- **Wochen-Rhythmus**: `start` + k × `intervall` × 7 Tage.

`abrechnen()` bucht alles, dessen Termin ≤ heute ist, und zählt `naechster`
hoch — auch mehrere Termine auf einmal. Wer die App zwei Monate nicht öffnet,
bei dem ist das Geld trotzdem abgebucht worden; jeder Abzug landet mit seinem
**echten Termin** in der Historie, nicht mit dem heutigen Datum.

- Neue Monats-Posten starten im **laufenden Monat**. Liegt der Tag schon
  hinter uns, wird sofort abgezogen (wie vor den Wiederholungen).
- **Warum ein Index und kein „nächstes Fälligkeitsdatum"**: Rechnet man vom
  zuletzt gebuchten Termin weiter, bleibt ein Posten am 31., der im Februar
  auf den 28. gerutscht ist, ab da dauerhaft auf dem 28. hängen. Über den
  Index wird immer vom Startmonat aus gerechnet.
- **Warum kein `abgegriffen` mehr**: Das war pro Kalendermonat organisiert und
  kann „alle 4 Wochen" nicht abbilden. Alte Stände werden beim Laden migriert
  (`postenNormalisieren`), ohne etwas doppelt zu buchen.
- Warnschwelle: `betrag > floor(summeOffenerTermine / 3)` → Warnkasten im
  Blatt, Knopf „Trotzdem ausgeben". Gezählt werden **Termine**, nicht Posten —
  ein 14-Tage-Posten zählt dreimal, wenn er dreimal im Monat fällt.
  `pruefeAusgabe()` und `warnschwelle()` rechnen mit derselben Summe; früher
  summierte die Prüfung Posten statt Termine und nannte eine andere Zahl.
- **„Offen" vs. „bezahlt" kommt immer aus dem Zähler** (`index < naechster`),
  nie aus „Termin liegt in der Vergangenheit" — sonst widersprechen sich
  Startseite und Kalender.

## Einkauf, Vorrat & Barcode (Details)

Das ist die Antwort auf „so etwas wie Marktguru" unter der Offline-Bedingung.
Marktguru lebt von laufend aktualisierten Prospektdaten aus dem Netz — das
geht hier nicht und soll hier nicht gehen. Stattdessen entsteht der Nutzen aus
**deinen eigenen Preisen**: nicht „was ist im Angebot", sondern „ist das
billig für dich".

- **Preisgedächtnis**: Jeder abgeschlossene Einkauf schreibt den Preis jeder
  Position in die Historie ihres Artikels (max. 20 Einträge). Daraus kommt das
  Urteil beim nächsten Mal:

      ≤ Bestpreis            → „Bestpreis"
      ≤ Bestpreis × 1,10     → „guter Preis"
      ≤ Bestpreis × 1,25     → „normal"
      darüber                → „teuer, X % über deinem Bestpreis"

  Der `bestPreis` wird **immer aus der Historie neu berechnet**, nie aus den
  gespeicherten Daten übernommen — ein kaputter oder fremder Importwert bliebe
  sonst für immer stehen.
- **Urteil vor dem Eintragen**: Beim Abschließen wird das Urteil geholt,
  *bevor* der neue Preis in der Historie landet. Sonst ist der neue Preis
  selbst der Bestpreis und jeder Einkauf wäre ein „Bestpreis".
- **Budget**: `einkaufBudget()` schickt die Listensumme durch dasselbe
  `pruefeAusgabe()` wie jede andere Ausgabe. Damit gilt exakt die gleiche
  Warnschwelle (1/3 der offenen Posten) — **es gibt keine zweite Regel**, die
  irgendwann auseinanderlaufen könnte.
- **Abschluss = eine Buchung**: Der Einkauf landet als *eine* Ausgabe in der
  Historie („Einkauf Rewe · 4 Positionen"), nicht als eine pro Artikel. Sonst
  wäre die Ausgabenliste nach einem Wocheneinkauf unlesbar. Weicht der
  Kassenzettel ab, wird der **bezahlte** Betrag gebucht; die Positionspreise
  bleiben wie eingetragen, denn welche Position sich geändert hat, weiß nur
  der Nutzer.
- **Vorrat**: Beim Abschluss wird die gekaufte Menge auf den Bestand addiert.
  `mindest > 0` schaltet die Nachkauf-Erinnerung ein (0 = egal).
  „Aus Vorrat ergänzen" füllt die Liste mit allem, was auf oder unter dem
  Mindestbestand liegt.
- **Barcode**: über die eingebaute `BarcodeDetector`-API des Browsers plus
  `getUserMedia` — eine Browser-Schnittstelle, **keine Bibliothek**, damit
  „offline, keine Abhängigkeiten" erfüllt bleibt. Fehlt sie (iOS, Firefox,
  Desktop), bleibt das Eingabefeld: der Scanner ist eine Abkürzung, kein
  Nadelöhr. Die Kamera wird beim Schließen **immer** freigegeben
  (`spur.stop()`), auch wenn das Overlay darüber zugemacht wird.
- **Eigener EAN-Leser** (`eanAusZeile(helligkeiten)`, Logik-Hälfte, getestet):
  `BarcodeDetector` fehlt in Safari, Firefox und auf manchen Android-Geräten —
  dort erkannte der Scanner früher schlicht nichts. Jetzt legt `scannerEigen()`
  das Kamerabild auf ein Canvas, nimmt 11 Zeilen aus der Bildmitte (je drei
  Pixelzeilen gemittelt) und zerlegt sie in helle/dunkle Läufe; die Schwelle
  kommt aus der Umgebung (Schatten). Ein Fund zählt erst beim zweiten Mal
  und nur mit gültiger Prüfziffer. Grenzen: nur waagrechte Codes, nur
  EAN-13/EAN-8. Die Kamera wird mit 1920×1080 und Dauer-Autofokus angefragt —
  mit dem Standard 640×480 sind die Striche zu fein.
- **Warum kein EAN-Lookup**: Offline gibt es keine Produktdatenbank. Ein
  Barcode wird nur mit *deinen* Artikeln abgeglichen; ein unbekannter fragt
  einmal nach dem Namen und ist ab dann bekannt.
- **Getippter Name zählt wie ein Scan**: Die Vorschlagsliste im Einkauf bietet
  Artikelnamen an. `einkaufHinzu` sucht deshalb ohne Barcode auch über den
  Namen — sonst entstünden stille Doppel-Artikel ohne Preisgedächtnis.
- **Scanner ist kein `.overlay-body`**: Er wird aus Einkauf *und* Vorrat
  geöffnet und darf nicht mit umgeschaltet werden. Er liegt als eigenes
  Overlay im HTML hinter `#overlay` und vor `#frage` — bei gleichem
  `z-index` entscheidet die DOM-Reihenfolge.
- **Preis in der Zeile per `change`, nicht `input`**: Bei jedem Tastendruck neu
  zu rendern würde den Fokus aus dem Feld reißen.

## CSS-Fallen, die hier schon zugeschlagen haben

- `[hidden]` braucht `display: none !important`. Eine eigene display-Regel
  (z. B. `.sekundaer { display: block }`) schlägt sonst das hidden-Attribut aus
  dem Browser-Stylesheet, und das Element bleibt sichtbar.
- Die hellen Farbwerte stehen **zweimal** in `styles.css` (System ist hell /
  von Hand hell). Ohne Build-Schritt geht das nicht kürzer; der Test prüft,
  dass beide Blöcke identisch sind.
- Gold als **Schrift** nur über `--akzent-text`: im hellen Modus ist das ein
  dunkleres Gold, das normale wäre auf Weiß nicht lesbar. `--akzent` ist nur
  für Flächen (Hauptknopf, Balken).
- `interactive-widget=resizes-content` im Viewport-Meta: sonst verdeckt die
  Handy-Tastatur den unteren Teil des Blatts samt Knopf.
- Formularfelder einzeln prüfen: `input[type="date"]` braucht eigene Regeln, es
  fällt nicht unter die Selektoren für Text- und Zahlenfelder.
- `input[type="text"]` hat **höhere Spezifität** als eine Klasse
  (Attribut-Selektor zählt wie eine Klasse, plus das Element). `.inline-preis`
  allein hätte das `width: 100%` der Textfelder nicht geschlagen — der
  Selektor muss `input[type="text"].inline-preis` heißen.
- `:has()` vermeiden: Die Varianten von `.feld-paar` (Scan-Zeile,
  Spalten-Zeile) bekommen eigene Klassen (`.mit-scan`, `.felder`), damit es
  auch in älteren Handy-Browsern greift.

## Testen

- Logik + DOM-Vertrag: `node test-logic.js`. Der Test prüft nicht nur die Beträge,
  sondern auch, dass **jede ID, die `app.js` erwartet, in `index.html` existiert**,
  dass jeder Öffner ein Blatt hat, jeder Tab eine Ansicht, und dass nichts von
  außen geladen wird.
  Das ist Absicht: ein reiner Logik-Test mit DOM-Attrappe hat genau diesen Fehler
  einmal übersehen, und die App war dadurch komplett tot.
- Browser: über lokalen HTTP-Server, z. B. `python -m http.server` — nicht per `file://`
  (Service Worker registriert sich sonst nicht).

## Gegen Impulskäufe (Details)

Der eigentliche Zweck der App. Vier Bausteine, die zusammengehören:

- **Tagesbudget** als zweite Warnregel. Die Drittel-Regel allein hat ein Loch:
  sind alle Posten des Monats bezahlt, ist die Schwelle 0 und es wird gar
  nicht mehr gewarnt — ausgerechnet am Monatsende. Deshalb:

      Tagesbudget = floor(frei verfügbar / Tage bis Monatsende)   (heute zählt mit)

  `pruefeAusgabe()` liefert `gruende` (Kürzel) und `warnung` (Text):

      'reserviert'  Betrag > frei verfügbar
      'budget'      Betrag > 3 Tagesbudgets (`BUDGET_TAGE_WARNUNG`)
      'drittel'     Betrag > floor(offene Termine / 3)

  `reserviert` und `budget` schließen sich aus (das erste ist der stärkere
  Fall), `drittel` kann dazukommen. Der Einkauf läuft über dieselbe Prüfung.
- **Wunschliste** (`state.wuensche`): `{ id, name, betrag, erstellt (ms),
  status 'offen'|'gekauft'|'verworfen', entschieden }`. Kaufen geht erst
  `ABKUEHL_STUNDEN` (48) nach dem Parken und bucht dann eine normale Ausgabe;
  verwerfen geht jederzeit. Die Sperre ist bewusst nur ein Stolperstein — über
  „Ausgabe" kommt man daran vorbei, aber dann eben mit Warnung und Bremse.
  Alle Wunsch-Funktionen nehmen optional `jetzt` (ms), damit der Test die Uhr
  vorstellen kann.
- **Bremse**: bei einer Warnung ist „Trotzdem ausgeben" `BREMSE_SEKUNDEN` (10)
  lang gesperrt, auch für die Enter-Taste. Die Uhr läuft ab der ersten Warnung
  und startet nicht neu, wenn man am Betrag weitertippt. Daneben steht immer
  „Erst parken" als leichter Ausweg.
- **Muster** (`monatsMuster()`): spontane Ausgaben des Monats, davon trotz
  Warnung, dazu verworfene Wünsche. Dafür tragen Ausgaben optional
  `art: 'einkauf'|'wunsch'` und `gewarnt: true`. Ein Einkauf von der Liste und
  ein abgekühlter Wunsch zählen **nicht** als spontan. Buchungen von vor
  dieser Version haben die Felder nicht und zählen deshalb alle als spontan
  und ungewarnt.
- **Wieder nach vorn** (`visibilitychange`): eine installierte App wird selten
  neu geladen. Kommt sie wieder nach vorn, wird neu abgerechnet und
  gezeichnet, sonst stehen Reststunden und fällige Posten auf dem Stand von
  gestern. Ein offenes Blatt wird dabei nicht neu gezeichnet.
- **Sparziel als eigener Topf** (`state.sparziel = { name, ziel, gespart } |
  null`, genau eines). Zurückgelegtes Geld verlässt das Konto und damit „frei
  verfügbar" — es sieht nicht mehr ausgebbar aus, und das Tagesbudget sinkt
  mit. Bewegungen sind eigene Buchungsarten, `'sparen'` und `'entnahme'`;
  sie zählen weder als Ausgabe noch als Einzahlung und stehen im Verlauf nur
  unter „Alle".
  - Zurücklegen geht **nur aus dem freien Geld**. Sonst sähe das Sparziel gut
    aus und der Strom platzt.
  - Auflösen gibt den Topf aufs Konto zurück; es verschwindet nie Geld.
  - `sparzielVergleich(betrag)` stellt eine Ausgabe gegen das Ziel: mit
    Spar-Tempo (netto der letzten 30 Tage) als „dafür sparst du etwa N Tage",
    sonst als Anteil an dem, was noch fehlt. Bewusst **nicht** „verschiebt
    dein Ziel um N Tage" — das wäre nur wahr, wenn das Geld sonst sicher im
    Topf gelandet wäre.
  - Nach dem Verwerfen eines Wunsches bietet die App an, den Betrag gleich
    zurückzulegen.
- **Grundbedarf** (`artikel.grundbedarf`, Haken im Artikel-Blatt): Lebensmittel
  sind kein Impulskauf. `pruefeAusgabe(betrag, grundbedarf)` nimmt den
  Grundbedarf-Anteil aus der Budget- und der Drittel-Regel heraus. Die Regel
  „mehr als frei verfügbar" gilt weiter für den **ganzen** Betrag. Auf der
  Einkaufsliste zählt `einkaufGrundbedarf()` den Anteil; eine gemischte Liste
  warnt nur wegen des Rests.
- **Scannen & gleich bezahlen** (`sofortKauf()`, Blatt `sofort`): im Laden
  scannen, Preis bestätigen (bekannter Artikel: letzter Preis steht schon da),
  der Betrag geht sofort vom Konto. Dazu Preisgedächtnis, Vorrat +Menge und
  Abzug von der Einkaufsliste. Grundbedarf wird als `art: 'einkauf'` gebucht;
  alles andere ist eine spontane Ausgabe mit Warnung, 10-Sekunden-Bremse und
  Eintrag in der Musteranzeige — der Scanner ist keine Abkürzung um die
  Reibung. Erst prüfen, dann anlegen: ein abgelehnter Kauf hinterlässt keinen
  Artikel.
- **Keine Benachrichtigung**: ohne Server gibt es keinen Push. Dass ein Wunsch
  reif ist, erfährt man erst beim Öffnen der App (Toast + Markierung).

## Mögliche nächste Schritte

- Preis-Verlauf pro Artikel anzeigen (die Historie liegt schon da)
- Einkauf einem Posten zuordnen („Haushaltsgeld") statt als freie Ausgabe
- Posten pausieren statt löschen (für Verträge, die ruhen)

- Auswertung über mehrere Monate

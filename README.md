# iNeedMoney

Eine persönliche Spar-App fürs Handy. Sie führt ein Konto, zieht feste Posten automatisch ab und macht spontane Ausgaben absichtlich etwas unbequem, damit aus einem Impuls nicht sofort ein Kauf wird.

Die App läuft komplett offline im Browser, ohne Konto, ohne Server und ohne Bankanbindung. Alle Daten bleiben auf dem Gerät.

## Die Idee

Gegen Impulskäufe hilft vor allem Zeit zwischen Wunsch und Kauf. Deshalb ist Reibung vor dem Ausgeben hier gewollt:

- Vor einer größeren Ausgabe zeigt die App, was sie kostet: in Tagen Budget, gegen das Sparziel und gegen die laufende Serie ohne Spontankauf.
- Bei einer Warnung ist „Trotzdem ausgeben" erst nach 10 Sekunden drückbar.
- Statt zu kaufen, lässt sich ein Wunsch 48 Stunden parken.

## Was die App kann

### Konto und Zeitraum

- **Konto:** ein zentraler Saldo, von dem alles abgezogen wird.
- **Frei verfügbar:** Kontostand minus der Posten, die im laufenden Zeitraum noch kommen.
- **Tagesbudget:** frei verfügbar, geteilt durch die Tage bis zum Stichtag.
- **Stichtag:** Der Zeitraum läuft bis zum nächsten Geld. Das kann das Monatsende sein, ein fester Tag im Monat oder ein eingetragenes Datum.

### Posten und feste Eingänge

- **Posten:** wiederkehrende Abzüge mit Betrag und Rhythmus, zum Beispiel 56 € Strom monatlich am 28. oder etwas alle 4 Wochen. Sie werden am Termin automatisch abgezogen, auch wenn die App länger nicht geöffnet war.
- **Feste Eingänge:** ein Posten mit Haken „Das ist ein Eingang", zum Beispiel das Gehalt. Er wird am Termin automatisch gutgeschrieben. Geld, das erst noch kommt, zählt bis dahin nicht als frei verfügbar.
- **Kalender:** zeigt alle Termine des Monats und ob sie schon gebucht sind.

### Einzahlen und Ausgeben

- **Einzahlung** und **spontane Ausgabe** werden von Hand erfasst.
- **Vorschläge beim Tippen:** Bei „Wofür?" und „Notiz" schlägt die App die häufigsten Einträge aus dem Verlauf vor. Bei Einzahlungen trägt sie den üblichen Betrag mit ein, bei Ausgaben nicht.
- **Rückgängig:** nur über die Meldung direkt nach dem Buchen und nur am selben Tag. Im Verlauf lässt sich nichts löschen.

### Warnungen

Eine spontane Ausgabe löst eine Warnung aus, wenn sie

- mehr ist als ein Drittel der noch offenen Posten,
- mehr ist als drei Tagesbudgets, oder
- mehr ist als das frei verfügbare Geld.

Schon ab mehr als einem Tagesbudget erinnert die App daran, dass sich der Kauf auch parken lässt. Das ist nur ein Hinweis, ohne Bremse.

### Wunschliste und Sparziel

Die beiden lösen verschiedene Probleme:

| | Geparkte Wünsche | Sparziel |
|---|---|---|
| Wofür | Einen Kaufimpuls 48 Stunden abkühlen lassen | Geld für etwas Größeres ansparen |
| Wird Geld bewegt? | Nein, beim Parken wird nichts abgebucht | Ja, das Zurückgelegte verlässt „frei verfügbar" |
| Ende | Kaufen oder verwerfen; verwerfen zählt als gespart | Entnehmen oder auflösen, das Geld geht zurück aufs Konto |

Zurücklegen geht nur aus dem freien Geld, nicht aus dem, was für Posten reserviert ist.

### Einkauf, Vorrat und Scanner

- **Vorrat:** eigene Artikel mit Menge, Mindestbestand und Preisgedächtnis.
- **Einkaufsliste:** mit Budget und Preis-Urteil gegen die eigenen früheren Preise.
- **Grundbedarf:** So markierte Artikel (z. B. Lebensmittel) lösen beim Kauf keine Budget- oder Drittel-Warnung aus, nur noch „mehr als frei verfügbar".
- **Scannen und gleich bezahlen:** im Laden den Barcode scannen, Preis bestätigen, der Betrag wird sofort abgezogen.
- **Barcode-Scanner:** nutzt den `BarcodeDetector` des Browsers, wo es ihn gibt, sonst einen eigenen EAN-13/EAN-8-Leser. Es gibt keine Produktdatenbank; ein Barcode wird nur mit den eigenen Artikeln abgeglichen.

### Überblick und Sicherheit

- **Muster:** wie viel im Zeitraum spontan und wie viel trotz Warnung ausgegeben wurde.
- **Serie:** Tage seit der letzten spontanen Ausgabe.
- **Verlauf:** alle Buchungen, nach Art filterbar.
- **Kontostand korrigieren:** in den Einstellungen, mit Pflicht-Grund und 10 Sekunden Bremse. Die Differenz wird als Korrektur gebucht.
- **Backup:** Export und Import als JSON-Datei. Nach 14 Tagen ohne Export erinnert die App daran.
- **Update-Hinweis:** Liegt eine neue Version vor, bietet eine Meldung „Neu laden" an.

## Installieren und starten

Die App besteht nur aus statischen Dateien. Sie braucht einen HTTP-Server, weil sich der Service Worker über `file://` nicht registriert.

```
python -m http.server
```

Danach `http://localhost:8000` im Browser öffnen. Auf dem Handy lässt sich die Seite über „Zum Startbildschirm hinzufügen" bzw. den Installieren-Knopf in den Einstellungen als App installieren; dafür muss sie über HTTPS ausgeliefert werden.

## Daten

- Alles liegt im `localStorage` des Browsers auf dem Gerät.
- Es wird nichts ins Netz übertragen.
- Wer die Browserdaten löscht oder das Gerät wechselt, verliert die Daten ohne Backup. Deshalb regelmäßig exportieren.

## Technik

- Nur HTML, CSS und JavaScript: kein Framework, kein Build-Schritt, kein npm.
- Keine externen Abhängigkeiten: kein CDN, keine Webfonts, keine Scanner-Bibliothek.
- PWA mit `manifest.json` und Service Worker für Offline-Betrieb.
- Oberfläche auf Deutsch.

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche: Ansichten, Blätter, Formulare |
| `app.js` | Logik (oben) und Oberfläche (unten) |
| `styles.css` | Gestaltung, hell und dunkel |
| `sw.js` | Service Worker und Offline-Cache |
| `manifest.json` | PWA-Angaben und Icons |
| `test-logic.js` | Logik-Tests ohne Browser |
| `AGENTS.md` | Regeln und Fachlogik für die Arbeit am Code |
| `Plan.md` | Roadmap |

## Entwickeln

Logik-Tests laufen ohne Browser:

```
node test-logic.js
```

Bei Änderungen an ausgelieferten Dateien die Cache-Version in `sw.js` (`CACHE`) hochzählen, damit installierte Apps die neue Fassung laden.

Zwei Grundsätze, die beim Weiterbauen gelten:

- Reibung vor dem Ausgeben ist Absicht und wird nicht wegoptimiert.
- Nichts einbauen, was „offline, ohne Build" bricht.

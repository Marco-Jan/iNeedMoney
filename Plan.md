# Plan: iNeedMoney (Spar-App)

Ziel: Offline-fähige Web-App (HTML/JS, kein Framework), die beim Sparen hilft.
Wichtigste Anforderung: **muss offline am Handy funktionieren** → keine externen Abhängigkeiten (kein CDN), Daten lokal (localStorage), PWA (manifest + Service Worker).

## Modell

- **Einzahlung**: Geld wird ins Konto eingezahlt (Startpunkt des Sparens).
- **Posten**: wiederkehrende monatliche Abzüge (z. B. 56 € Strom am 28.). Jeder Posten = Betrag + Tag im Monat, zieht jeden Monat ab.
- **Rest**: alles, was nicht reserviert ist → für spontane Ausgaben.
- **Warnung**: Bei spontaner Ausgabe warnen, wenn der Betrag > 1/3 der Summe der noch offenen Posten (künftige Tage im aktuellen Monat) ist.

## Schritte

- [x] **Grundgerüst**: `index.html`, `styles.css`, `app.js` — statisch, ohne Build-Schritt.
- [x] **Datenmodell** (localStorage, Key `inneedmoney.v1`, Beträge als Integer-Cent):
  - `saldo`: aktueller Saldo
  - `posten`: wiederkehrende monatliche Posten (id, name, betrag, tag)
  - `transaktionen`: Einzahlungen + Ausgaben + Posten-Abzüge (typ, betrag, datum, name)
  - `abgegriffen`: pro monatsKey (`JJJJ-MM`) die ids der bereits abgezogenen Posten → jeder Posten wird genau einmal pro Monat abgezogen
- [x] **UI**:
  - [x] Saldo-Anzeige (Konto) + Hinweis „Noch offen im Monat"
  - [x] Einzahlung erfassen
  - [x] Posten anlegen/löschen
  - [x] Spontane Ausgabe mit **Warnung** (Regel: Betrag > 1/3 der offenen Posten im laufenden Monat → Warnhinweis + `confirm()`)
  - [x] Kalenderansicht: Posten pro Tag sichtbar, heutiger Tag markiert, Navigation zwischen Monaten
  - [x] Historie der letzten Transaktionen
- [x] **Offline/PWA**: `manifest.json` + Service Worker (`sw.js`, Cache `inneedmoney-v1`), alle Assets lokal (eigene PNG-Icons), App installierbar.
- [x] **Sprache**: UI auf Deutsch.
- [x] **Logik-Test**: `node test-logic.js` — prüft Saldo, Abzüge und Warnschwelle gegen einen localStorage/DOM-Stub (ohne Browser).

## Abrechnung (Details)

- Beim Start (`abrechnen()`): Posten mit `tag <= heute` und id nicht in `abgegriffen[monatsKey]` werden sofort vom Saldo abgezogen und in die Historie geschrieben.
- Neue Posten, deren Tag im laufenden Monat bereits liegt, werden beim Anlegen sofort abgezogen.
- Warnschwelle: `betrag > floor(summeOffenerPosten / 3)` → Warnbox + Bestätigung per `confirm()`.

## Testen

- Logik: `node test-logic.js` (alle Assertions grün).
- Browser: über lokalen HTTP-Server, z. B. `python -m http.server` — nicht per `file://` (Service Worker registriert sich sonst nicht).

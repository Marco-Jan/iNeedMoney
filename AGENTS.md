# AGENTS.md

## Projekt
iNeedMoney: persönliche Spar-App. Features (vom Nutzer gefordert):
- **Konto**: zentrales Saldo, von dem abgezogen wird
- **Posten**: wiederkehrende monatliche Abzüge (Betrag + Tag im Monat, z. B. 56 € Strom am 28.), im Kalender sichtbar
- **Einzahlungen** und spontane **Ausgaben** erfassen
- **Zweck**: die App soll helfen, **impulsive Käufe zu vermeiden**. Reibung vor dem Ausgeben ist deshalb gewollt, nicht zu „optimieren".
- **Warnung bei spontanen Ausgaben** (drei Gründe, alle in `pruefeAusgabe()`):
  - Betrag > 1/3 der Summe der noch offenen Posten (künftige Tage im laufenden Monat)
  - Betrag > 3 Tagesbudgets (Tagesbudget = frei verfügbar ÷ Tage bis Monatsende)
  - Betrag > frei verfügbar (geht an reservierte Posten)
  Bei einer Warnung ist „Trotzdem ausgeben" erst nach 10 Sekunden drückbar.
- **Wunschliste mit Abkühlzeit**: ein Wunsch wird 48 Stunden geparkt und ist erst danach kaufbar; verwerfen geht jederzeit und zählt als gespart
- **Sparziel als eigener Topf**: zurückgelegtes Geld verlässt das Konto und „frei verfügbar"; zurücklegen geht nur aus dem freien Geld, Ausgaben werden gegen das Ziel gestellt
- **Grundbedarf**: Artikel im Vorrat lassen sich als Grundbedarf (Lebensmittel) markieren; ihr Kauf löst keine Budget-/Drittel-Warnung aus, nur noch „mehr als frei verfügbar"
- **Scannen & gleich bezahlen**: im Laden Barcode scannen, Preis bestätigen oder eintippen, der Betrag wird sofort abgezogen (`sofortKauf()`); Nicht-Grundbedarf läuft dabei durch Warnung und Bremse
- **Barcode ohne Bibliothek**: `BarcodeDetector`, wo vorhanden, sonst der eigene EAN-13/EAN-8-Leser `eanAusZeile()` — keine Scanner-Bibliothek einbauen
- **Stichtag**: der Zeitraum läuft bis zum nächsten Geld (Monatsende, fester Tag oder eingetragenes Datum) — nie direkt mit „Monatsende" rechnen, immer über `periode()` / `restTage()`
- **Kontostand korrigieren**: in den Einstellungen, bucht den Unterschied als `korrektur` (weder Ausgabe noch Einzahlung); bewusst mit Reibung (Pflicht-Grund, Folgen anzeigen, 10 Sekunden Bremse, Rückfrage)
- **Muster**: die Übersicht zeigt, wie viel diesen Monat spontan und trotz Warnung ausgegeben wurde

## Tech-Stack & harte Constraints
- Nur HTML + JS, **kein Framework, kein Build-Schritt, kein npm**.
- **Muss offline am Handy funktionieren** (wichtigste Anforderung):
  - Keine externen Abhängigkeiten (kein CDN, keine Webfonts, keine externen Bilder).
  - Daten in `localStorage` persistieren.
  - PWA: `manifest.json` + Service Worker für Offline-Funktion/Installierbarkeit.
- UI-Sprache: **Deutsch**.

## Arbeiten im Repo
- Roadmap: siehe `Plan.md` — Schritte der Reihe nach abarbeiten.
- Logik-Test (ohne Browser): `node test-logic.js` — prüft Saldo, Abzüge und Warnschwelle gegen den localStorage-Stub.
- Testen im Browser: über lokalen HTTP-Server (z. B. `python -m http.server`), nicht per `file://` — Service Worker registriert sich sonst nicht.
- Keine neuen Dependencies/Tools einfügen, die gegen „offline + kein Build" verstoßen.

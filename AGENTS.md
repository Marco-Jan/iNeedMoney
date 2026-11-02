# AGENTS.md

## Projekt
iNeedMoney: persönliche Spar-App. Features (vom Nutzer gefordert):
- **Konto**: zentrales Saldo, von dem abgezogen wird
- **Posten**: wiederkehrende monatliche Abzüge (Betrag + Tag im Monat, z. B. 56 € Strom am 28.), im Kalender sichtbar
- **Einzahlungen** und spontane **Ausgaben** erfassen
- **Warnung bei spontanen Ausgaben**: Betrag > 1/3 der Summe der noch offenen Posten (künftige Tage im laufenden Monat) → Warnhinweis anzeigen

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

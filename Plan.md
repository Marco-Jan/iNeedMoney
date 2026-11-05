# Plan: iNeedMoney (Spar-App)

Ziel: Offline-fähige Web-App (HTML/JS, kein Framework), die beim Sparen hilft.
Wichtigste Anforderung: **muss offline am Handy funktionieren** → keine externen Abhängigkeiten (kein CDN), Daten lokal (localStorage), PWA (manifest + Service Worker).

## Modell

- **Einzahlung**: Geld wird ins Konto eingezahlt (Startpunkt des Sparens).
- **Posten**: wiederkehrende monatliche Abzüge (z. B. 56 € Strom am 28.). Jeder Posten = Betrag + Tag im Monat, zieht jeden Monat ab.
- **Rest**: alles, was nicht reserviert ist → für spontane Ausgaben („frei verfügbar").
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
  - `saldo`, `posten` (id, name, betrag, tag), `transaktionen` (typ, betrag, datum, name),
    `abgegriffen` (pro `JJJJ-MM` die ids der bereits abgezogenen Posten)
  - gespeicherte Daten werden beim Laden über `normalisiere()` geprüft → kaputte
    oder fremde Dateien legen die App nicht lahm
- [x] **UI**:
  - [x] Saldo + Hinweis „Noch offen diesen Monat"
  - [x] Monatsübersicht: eingezahlt / ausgegeben / Posten bezahlt / frei verfügbar
  - [x] Einzahlung erfassen (mit Notiz)
  - [x] Posten anlegen, **bearbeiten** und löschen
  - [x] Spontane Ausgabe mit Warnung (eigener Bestätigungs-Dialog, kein `confirm()`)
  - [x] Kalenderansicht: pro Tag Punkte + gerundeter Betrag (in eine Zelle von
        1/7 Bildschirmbreite passt kein Name), darunter eine Liste mit den vollen
        Namen. Heutiger Tag markiert, Navigation über Monats- und Jahresgrenzen
  - [x] Alle Ausgaben mit Summe
  - [x] Historie der letzten Buchungen mit Datum und Art
  - [x] Einstellungen: Backup exportieren / importieren, Reset (nicht mehr versehentlich erreichbar)
  - [x] Toasts statt `alert()`
  - [x] **Cards auf der Startseite einklappbar** (Kopf = Knopf mit `aria-expanded`,
        Pfeil dreht sich). Der Auf-/Zu-Zustand liegt in `inneedmoney.ui.v1` —
        bewusst getrennt von den Spardaten, damit ein Backup-Import ihn nicht
        mitbringt. Animation über `grid-template-rows: 1fr → 0fr`, mit
        `@supports`-Rückfall für ältere Browser.
- [x] **Offline/PWA**: `manifest.json` (verlinkt!) + Service Worker (`sw.js`, Cache
      `inneedmoney-v2`): Navigation „Netz zuerst, Cache als Rückfall", Assets
      „Cache zuerst". Alle Assets lokal.
- [x] **Sprache**: UI auf Deutsch.
- [x] **Design**: Neomorphismus in Schwarz mit Gold-Akzenten, Variablen in
      `:root`, reduzierte Animationen bei `prefers-reduced-motion`.
- [x] **Tests**: `node test-logic.js`

## Abrechnung (Details)

- Beim Start (`abrechnen()`): Posten, deren **effektiver Tag** ≤ heute ist und deren
  id nicht in `abgegriffen[monatsKey]` steht, werden vom Saldo abgezogen und in die
  Historie geschrieben.
- **Effektiver Tag**: `min(tag, Tage im Monat)`. Ein Posten am 31. wird im Februar
  am 28. (bzw. 29.) fällig — sonst würde er in kurzen Monaten nie abgezogen.
- Neue Posten, deren Tag im laufenden Monat bereits liegt, werden beim Anlegen sofort abgezogen.
- Warnschwelle: `betrag > floor(summeOffenerPosten / 3)` → Warnkasten + Bestätigungs-Dialog.
- **„Offen" vs. „bezahlt" kommt immer aus `abgegriffen`**, nie aus „Tag liegt in
  der Vergangenheit". Im Normalbetrieb ist beides deckungsgleich, weil
  `abrechnen()` beim Start alles Fällige abzieht — läuft es doch auseinander,
  widersprechen sich sonst Startseite und Kalender.

## CSS-Fallen, die hier schon zugeschlagen haben

- `[hidden]` braucht `display: none !important`. Eine eigene display-Regel
  (z. B. `.sekundaer { display: block }`) schlägt sonst das hidden-Attribut aus
  dem Browser-Stylesheet, und das Element bleibt sichtbar.
- Das Grid-Item einer einklappbaren Card darf **kein vertikales Padding** haben.
  Mit `box-sizing: border-box` fällt die Höhe nie unter das Padding — die
  `0fr`-Zeile ist zwar 0 hoch, das Padding bleibt als Streifen stehen, in dem
  der Inhalt durchscheint. Der Abstand nach unten kommt deshalb vom letzten Kind.
- Nach Änderungen an CSS/JS liefert der Service Worker erst einmal die alte
  Datei aus dem Cache. Beim Testen Cache leeren oder den SW abmelden.

## Testen

- Logik + DOM-Vertrag: `node test-logic.js`. Der Test prüft nicht nur die Beträge,
  sondern auch, dass **jede ID, die `app.js` erwartet, in `index.html` existiert**,
  dass jede Kachel ein Overlay öffnet und dass nichts von außen geladen wird.
  Das ist Absicht: ein reiner Logik-Test mit DOM-Attrappe hat genau diesen Fehler
  einmal übersehen, und die App war dadurch komplett tot.
- Browser: über lokalen HTTP-Server, z. B. `python -m http.server` — nicht per `file://`
  (Service Worker registriert sich sonst nicht).

## Mögliche nächste Schritte

- Posten pausieren statt löschen (für Verträge, die ruhen)
- Sparziel mit Fortschritt
- Auswertung über mehrere Monate

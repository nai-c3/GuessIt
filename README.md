# 🎄 GUESS IT

Live-Schätzspiel für die c3 Weihnachtsfeier. Die Leinwand zeigt QR-Code, Fragen, Auflösung, animierte Rangliste und das große Finale. Alle spielen per Smartphone mit.

## Starten

```bash
npm install
npm start
```

Die Konsole zeigt zwei Links:

- **Spieler:** `http://<IP>:3000/` (steckt auch im QR-Code auf der Leinwand)
- **Host/Leinwand:** `http://<IP>:3000/host?key=<SCHLÜSSEL>`

Den Host-Link auf dem Laptop am Beamer öffnen und mit **F** auf Vollbild schalten.

### Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `PORT` | Port (Standard 3000) |
| `HOST_KEY` | fester Host-Schlüssel (sonst bei jedem Start zufällig) |
| `PUBLIC_URL` | öffentliche Adresse für den QR-Code, z. B. `https://guessit.example.com` |
| `QUESTIONS_FILE` | anderer Pfad zur Fragendatei |

## Wichtig: Wie kommen die Handys an den Server?

Die Handys müssen den Server erreichen. Zwei Wege:

1. **Laptop im selben WLAN** wie alle Gäste. Der QR-Code nutzt automatisch die WLAN-IP des Laptops. Achtung: Gäste-WLANs blockieren oft Verbindungen zwischen Geräten („Client Isolation“), und Gäste im Mobilfunknetz kommen nicht dran. **Vorher vor Ort testen!**
2. **Im Internet hosten** (empfohlen), z. B. auf Render, Railway oder Fly.io als Node-App mit `npm start`. Dort `HOST_KEY` setzen und gegebenenfalls `PUBLIC_URL`. Dann funktioniert es auch über Mobilfunk.

Der Spielstand liegt nur im Arbeitsspeicher. Wird der Server neu gestartet, ist das Spiel weg. Handys, deren Bildschirm sich sperrt, verbinden sich dagegen automatisch wieder und behalten ihre Punkte.

## Steuerung (Leinwand)

| Taste/Button | Aktion |
|---|---|
| Leertaste / → / Enter | Weiter: Start → Frage → Auflösung → Zwischenstand → … → Finale |
| `+15 s` | mehr Zeit für die aktuelle Frage |
| F | Vollbild |
| M | Ton an/aus |
| ☰ Menü | Live-Antwort korrigieren, Finale wiederholen, neues Spiel, alles zurücksetzen |
| Klick auf Namen in der Lobby | Spieler entfernen (z. B. bei unpassenden Namen) |

Eine Frage schließt automatisch, wenn die Zeit abläuft oder alle verbundenen Spieler geantwortet haben.

## Fragen bearbeiten – `questions.json`

```json
{ "question": "Wie hoch ist der Kölner Dom?", "answer": 157, "unit": "Meter", "time": 30, "info": "Optionaler Zusatztext bei der Auflösung" }
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `question` | ✔ | Fragetext |
| `answer` | ✔ (außer bei Live-Fragen) | richtige Antwort (Zahl) |
| `unit` | | Einheit, wird überall angezeigt |
| `time` | | Sekunden zum Schätzen (Standard 30) |
| `info` | | Zusatzinfo bei der Auflösung |
| `format` | | `"year"` = ohne Tausenderpunkt anzeigen (1984 statt 1.984) |
| `maxDeviation` | | lineare Wertung: ab dieser Abweichung 0 Punkte (für Jahreszahlen nötig, siehe unten) |
| `live` | | `true` = Antwort wird erst vor Ort ermittelt |

### Live-Fragen (Antwort wird vor Ort ermittelt)

Für Mini-Spiele wie „Wie lange braucht Kollege X, um ein Geschenk einzupacken?“:

```json
{ "question": "Wie viele Sekunden braucht Tim für 10 Liegestütze?", "live": true, "unit": "Sekunden", "time": 40 }
```

Ablauf: Alle schätzen → die Frage schließt → auf der Leinwand erscheint ein Eingabefeld, und die Handys zeigen „schaut nach vorne“ → ihr spielt das Mini-Spiel → du trägst das Ergebnis ein und klickst **Auflösen**. Hast du dich vertippt, kannst du über ☰ → *Live-Antwort korrigieren* die Antwort ändern. Die Punkte dieser Frage werden dann neu berechnet.

Zeiten lassen sich auch als `1:20` eingeben (= 80 Sekunden), sowohl von Spielern als auch vom Host.

## Punkte

- **Grundpunkte (max. 1000):** Gemessen wird, um welchen *Faktor* die Schätzung danebenliegt. Exakt = 1000, Faktor 2 daneben = 500, ab Faktor 4 = 0. So ist die Wertung fair, egal ob die Antwort 88 oder 384.400 ist.
- **Bonus:** Die drei nächsten Schätzungen bekommen +300 / +200 / +100.
- **Jahreszahlen & Co.:** Hier passt die Faktor-Wertung nicht (1980 statt 1984 wäre fast perfekt). Setze deshalb `maxDeviation`, z. B. `20`: Dann gibt es pro Jahr Abweichung linear weniger, und ab 20 Jahren 0 Punkte. Das gilt auch, wenn die Antwort 0 oder negativ ist.

Die Konstanten stehen oben in `server.js`.

## Hinweise

- Die mitgelieferten 13 Fragen sind Beispiele (allgemeines Wissen + 1 Live-Frage). Am meisten Spaß machen c3-eigene Fragen.
- Schriftarten kommen von Google Fonts. Ohne Internet greifen System-Schriften, und das Spiel läuft trotzdem.
- Die Sounds werden im Browser erzeugt. Damit sie funktionieren, muss auf der Leinwand einmal geklickt oder eine Taste gedrückt werden (passiert spätestens beim Start).

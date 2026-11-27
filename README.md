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

## Hosting

GUESS IT braucht einen laufenden Node-Server, weil alle Handys per WebSocket live verbunden sind. Statische Hoster wie tiiny.host oder GitHub Pages reichen dafür nicht.

### Empfohlen: Render.com (mit `render.yaml`)

1. Bei [render.com](https://render.com) mit GitHub anmelden.
2. **New → Blueprint**, das Repo `nai-c3/guessit` und den Branch mit dem Code wählen. Render liest `render.yaml` und legt den Dienst „guess-it“ in Frankfurt an.
3. Nach dem Deploy im Dienst unter **Environment** den generierten `HOST_KEY` ablesen.
4. Leinwand: `https://<dienst>.onrender.com/host?key=<HOST_KEY>`. Der QR-Code zeigt automatisch die richtige Adresse.

Tarif: `starter` (kostenpflichtig, läuft durchgehend, wird anteilig abgerechnet). Nach der Feier den Dienst im Dashboard löschen, dann fallen keine weiteren Kosten an. Für eine Gratis-Variante auf `plan: free` umstellen: Der Dienst schläft dann nach 15 Minuten ohne Besucher ein, ein [UptimeRobot](https://uptimerobot.com)-Monitor alle 5 Minuten hält ihn wach. **Nicht während des Spiels neu deployen:** Der Spielstand liegt nur im Arbeitsspeicher und wäre weg.

### Notlösung: Laptop + Tunnel

```bash
npm start
npx cloudflared tunnel --url http://localhost:3000   # oder: cloudflared installieren
```

Cloudflare gibt eine `https://…trycloudflare.com`-Adresse aus. Die Leinwand über diese Adresse öffnen (nicht über `localhost`), dann zeigt der QR-Code automatisch darauf. Das funktioniert auch über Mobilfunk, hängt aber an Laptop und WLAN vor Ort.

### Nur im lokalen WLAN

Der QR-Code nutzt die WLAN-IP des Laptops. Gäste-WLANs blockieren oft Verbindungen zwischen Geräten, und Gäste im Mobilfunknetz kommen nicht dran. Unbedingt vorher vor Ort testen.

Handys, deren Bildschirm sich sperrt, verbinden sich automatisch wieder und behalten ihre Punkte.

## Steuerung (Leinwand)

| Taste/Button | Aktion |
|---|---|
| Leertaste / → / Enter | Weiter: Start → Frage → Auflösung → Zwischenstand → … → Finale |
| `+15 s` | mehr Zeit für die aktuelle Frage |
| F | Vollbild |
| M | Ton an/aus |
| ☰ Menü | Live-Antwort korrigieren, Finale wiederholen, neues Spiel, alles zurücksetzen |
| Klick auf Namen in der Lobby | Spieler entfernen (z. B. bei unpassenden Namen) |

Eine Frage schließt automatisch, sobald alle verbundenen Spieler geantwortet haben, sonst mit „Frage beenden“ (Leertaste). Ein Zeitlimit gibt es nur, wenn eine Frage `time` gesetzt hat.

**Spannung zum Schluss:** Mit `"hideLeaderboardFrom": 11` oben in `questions.json` gibt es ab Frage 11 keinen Zwischenstand mehr. Nach der Auflösung geht es direkt zur nächsten Frage, der Stand wird erst im Finale enthüllt.

## Fragen bearbeiten – `questions.json`

```json
{ "question": "Wie hoch ist der Kölner Dom?", "answer": 157, "unit": "Meter", "time": 30, "info": "Optionaler Zusatztext bei der Auflösung" }
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `question` | ✔ | Fragetext |
| `answer` | ✔ (außer bei Live-Fragen) | richtige Antwort (Zahl) |
| `unit` | | Einheit, wird überall angezeigt |
| `time` | | Optionales Zeitlimit in Sekunden. Ohne Angabe bleibt die Frage offen, bis alle geantwortet haben oder du sie beendest. |
| `info` | | Zusatzinfo bei der Auflösung |
| `format` | | `"year"` = ohne Tausenderpunkt anzeigen (1984 statt 1.984) |
| `maxDeviation` | | lineare Wertung: ab dieser Abweichung 0 Punkte (für Jahreszahlen nötig, siehe unten) |
| `live` | | `true` = Antwort wird erst vor Ort ermittelt |
| `image` | | Name einer Grafik aus `public/img/` ohne Endung (z. B. `coffee`), erscheint bei Frage und Auflösung |
| `_todo` | | Notiz für euch, wird nirgends angezeigt |

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

## Design

Der Look ist vom Plakat „C3 XMAS PARTY 02.12.2026“ abgeleitet:

- **Farben** (am Plakat gemessen): Lila-Papier `#d5bddb`, Rot `#e75738`, Ultramarin `#4a39e0`, helles Blau `#8677e6`, Weiß. Alle stehen als Tokens oben in `public/style.css`.
- **Schrift:** Archivo in breitester Variante (Versalien, wie die Plakat-Groteske) und Unbounded für Zahlen (runde Ziffern wie im Datum). Beide kommen von Google Fonts.
- **Druckgefühl:** Papierkörnung über der ganzen Seite, blaue Rasterpunkt-Schatten hinter Headlines, harte versetzte Schatten statt Rundungen.
- **Logo:** „GUESS IT“ wird live als SVG mit zerlaufenden Buchstaben gerendert (`blobLogo()` in `public/common.js`).
- **Collage-Grafiken** in `public/img/` (Stoppuhr, Keksglas, Weihnachtsbaum, Pokal, Zeigehand, Maßband): mit Magnific erzeugt, freigestellt und wie Risodruck blau eingefärbt. Sie werden mit `mix-blend-mode: multiply` übergedruckt.

## Hinweise

- Die mitgelieferten 13 Fragen sind Beispiele (allgemeines Wissen + 1 Live-Frage). Am meisten Spaß machen c3-eigene Fragen.
- Schriftarten kommen von Google Fonts. Ohne Internet greifen System-Schriften, und das Spiel läuft trotzdem.
- Die Sounds werden im Browser erzeugt. Damit sie funktionieren, muss auf der Leinwand einmal geklickt oder eine Taste gedrückt werden (passiert spätestens beim Start).

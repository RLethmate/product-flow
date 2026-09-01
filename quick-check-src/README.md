# LASTA Quick Check

Ein Fragebogen, zwei Betriebsarten, **eine Codebasis**.

| | Einzelmodus | Teammodus |
|---|---|---|
| Wer | eine Person auf der Landingpage | mehrere Personen im Workshop |
| Auswertung | eigenes Profil | Mittelwert der Gruppe, aktualisiert sich laufend |
| Zugang | Link von `it-team-flow.de` | QR-Code und Raumcode |
| Kontaktdaten | ja, als Lead | nein |
| Betrieb | statisch, GitHub Pages | Node-Server, Hetzner |

Ersetzt das frühere Typeform (`form.typeform.com/to/JiDiDyST`) und die
SpiderApp aus dem WIEN-IT-Workshop.

## Verzeichnisse

```
quick-check-src/            <- HIER wird bearbeitet
  app/index.html            Markup und CSS, mit Platzhaltern
  app/app.js                gesamte Logik, beide Modi
  app/config.solo.js        Konfiguration Einzelmodus
  app/config.team.js        Konfiguration Teammodus
  server/server.js          Backend
  server/quick-check.service systemd-Unit
  sync.py                   erzeugt beide Deployments
  test/test.js              Testsuite

static/quick-check/index.html              <- ERZEUGT, nicht bearbeiten
quick-check-src/server/public/             <- ERZEUGT, nicht bearbeiten
```

`sync.py` setzt Konfiguration und Logik in das Markup ein und schreibt zwei
selbstenthaltene Dateien. Sie unterscheiden sich ausschliesslich im
Konfigurationsblock; die Testsuite prueft das.

**Nach jeder Änderung in `app/`:**

```bash
cd quick-check-src && python3 sync.py
```

Ohne diesen Aufruf ändert sich am Deployment nichts.

## Tests

Einmalig einrichten. jsdom absichtlich ausserhalb des Dropbox-Ordners, sonst
synchronisiert Dropbox tausende Dateien:

```bash
mkdir -p ~/.qc-test && cd ~/.qc-test && npm install jsdom
```

Ausführen:

```bash
cd quick-check-src
python3 sync.py
NODE_PATH=~/.qc-test/node_modules node test/test.js
```

Geprüft werden die **erzeugten** Dateien, damit `sync.py` mit abgedeckt ist.
Der Backend-Teil startet einen echten Server auf Port 31739 gegen eine
temporäre Datendatei.

## Einzelmodus veröffentlichen

Die Seite ist Teil der Hugo-Site und liegt nach `sync.py` unter
`static/quick-check/`. Hugo kopiert `static/` unverändert, es gibt also keinen
Build-Schritt. Nach dem Push auf `main` deployt der Workflow
`.github/workflows/hugo.yml` nach GitHub Pages, erreichbar unter
`https://it-team-flow.de/quick-check/`.

Ohne Backend läuft die Seite im Testbetrieb: das Ergebnis entsteht im Browser,
es wird nichts übertragen und nichts gespeichert. Die Seite sagt das auch.

Für die Lead-Erfassung in `app/config.solo.js`:

```js
apiBase: "https://quick-check.it-team-flow.de"
```

Danach `sync.py`. Das Backend muss die Herkunft `https://it-team-flow.de` in
`ALLOWED_ORIGINS` führen, sonst blockt der Browser die Anfrage.

## Teammodus in Betrieb nehmen

### Was auf dem Server passiert

Der Dienst hört nur auf `127.0.0.1:3000` hinter einem eigenen nginx-Server-Block
für eine eigene Subdomain. Er hat einen eigenen Benutzer, ein eigenes
Datenverzeichnis und schreibt ausschliesslich dorthin. Bestehende Server-Blöcke
werden nicht angefasst.

### Vorbereitung

DNS-Eintrag `quick-check.it-team-flow.de` auf die Hetzner-Maschine
(`162.55.222.147`). Die Zone liegt bei united-domains.

### Installation

```bash
sudo adduser --system --group --no-create-home quickcheck
sudo mkdir -p /opt/quick-check /var/lib/quick-check
sudo chown quickcheck:quickcheck /var/lib/quick-check

# Dateien aus quick-check-src/server/ nach /opt/quick-check kopieren,
# public/ mit kopieren, node_modules NICHT:
sudo rsync -a --exclude node_modules --exclude data.json \
  quick-check-src/server/ root@SERVER:/opt/quick-check/

cd /opt/quick-check && sudo npm ci --omit=dev
```

### Dienst

`quick-check.service` nach `/etc/systemd/system/` kopieren und die
Umgebungsvariablen setzen:

| Variable | Bedeutung |
|---|---|
| `ADMIN_TOKEN` | **Pflicht.** Ohne gesetztes Token antworten `/api/data` und `/api/reset` mit 503, statt Daten offenzulegen. Lang und zufällig wählen. |
| `ALLOWED_ORIGINS` | Erlaubte Herkünfte, z. B. `https://it-team-flow.de`. Ohne Angabe sind nur Anfragen von derselben Herkunft möglich. |
| `PUBLIC_URL` | Basis-URL für den QR-Code, z. B. `https://quick-check.it-team-flow.de`. |
| `DATA_FILE` | `/var/lib/quick-check/data.json` |

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now quick-check
sudo systemctl status quick-check
```

### nginx

Eigene Datei unter `/etc/nginx/sites-available/quick-check`, nichts Bestehendes
ändern:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name quick-check.it-team-flow.de;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quick-check /etc/nginx/sites-enabled/
sudo nginx -t          # prueft ALLE Server-Bloecke, muss fehlerfrei sein
sudo systemctl reload nginx
sudo certbot --nginx -d quick-check.it-team-flow.de
```

`nginx -t` vor dem Reload ist nicht optional: es ist die Absicherung dagegen,
dass ein Fehler in der neuen Datei die bestehenden Sites mitnimmt.

## Workshop durchführen

1. Raumcode wählen, zum Beispiel den Kundennamen: `wien`.
2. Moderationsansicht öffnen und projizieren:
   `https://quick-check.it-team-flow.de/quick-check/?room=wien&present=1`
   Sie zeigt QR-Code, Adresse, Raumcode, Anzahl der Rückmeldungen und das
   Gruppenprofil. Aktualisierung alle drei Sekunden.
3. Teilnehmende scannen den QR-Code, beantworten 15 Aussagen und sehen danach
   das Gruppenprofil mit ihren eigenen Werten als gestrichelte Linie darüber.
4. Nach dem Workshop über die Moderationsansicht zurücksetzen. Das fragt nach
   dem `ADMIN_TOKEN` und leert **nur diesen Raum**.

Leads aus dem Einzelmodus exportieren:

```bash
curl -H "x-admin-token: DEIN-TOKEN" \
  https://quick-check.it-team-flow.de/api/data?room=default
```

## API

| Endpunkt | Zugang | Zweck |
|---|---|---|
| `POST /api/submit` | öffentlich | Antworten, optional Kontaktdaten. Begrenzt auf 30 Einreichungen je IP in 10 Minuten. |
| `GET /api/aggregate?room=` | öffentlich | **nur** Anzahl und Mittelwert je Frage. Keine Rohdaten, keine Kontaktdaten. |
| `GET /api/qr?room=` | öffentlich | QR-Code als SVG |
| `GET /api/data` | Token | Rohdaten inklusive Kontaktdaten, optional nach Raum |
| `POST /api/reset` | Token | Raum leeren, `{"room":"*"}` leert alles |

Der Server kennt den Fragebogen **nicht**. Er aggregiert nur je Frage
(`q0`, `q1`, …) und weiss nichts von Dimensionen, Zonen oder Texten. Die
Zuordnung macht die App. Deshalb müssen Änderungen am Fragebogen nur an einer
Stelle gemacht werden.

## Offene Punkte

- **Mindestzahl für Anonymität.** Bei drei oder vier Teilnehmenden lassen sich
  einzelne Antworten aus dem Mittelwert zurückrechnen. Das Gruppenprofil sollte
  erst ab einer Mindestzahl von Rückmeldungen erscheinen. Bewusst noch nicht
  gebaut.
- **Formulierung der Aussagen.** Das Subjekt wechselt zwischen „wir", „eure
  Teams" und „deine Teams"; die Aussagen 13 und 15 fragen mehrere Bedingungen
  gleichzeitig ab. Beides stammt wörtlich aus dem Typeform. Eine Änderung
  berührt die Vergleichbarkeit mit Altdaten und ist eine inhaltliche
  Entscheidung.
- **Zonengrenzen.** „wirksam" ab Mittelwert 4,0, „teilweise wirksam" ab 2,0,
  darunter „Entwicklungsfeld". Ansatzpunkte erscheinen nur für die beiden
  unteren Zonen. Die
  Textstufen der Gesamtbewertung folgen dagegen weiterhin den Punktegrenzen 29
  und 45 aus dem Typeform. Beides ist bewusst gesetzt, aber nicht empirisch
  kalibriert.
- **Einwilligung.** Speicherung und Kontaktaufnahme hängen an einem Häkchen,
  weil die Daten nur diesem einen Zweck dienen. Ob das der geforderten
  Granularität entspricht, ist juristisch zu prüfen.
- **Logik im alten Typeform ist defekt.** Die Sprungregeln am Ende deckten
  Ergebnisse über 45 Punkte nicht ab, und die Bereiche überlappten. Die
  Stufengrenzen hier sind eine Rekonstruktion der erkennbaren Absicht.

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

## Stand am 03.09.2026

**Einzelmodus ist live** unter https://it-team-flow.de/quick-check/, erreichbar
über die Blog-Kachel der Startseite. Er läuft ohne Backend: das Ergebnis
entsteht im Browser, das Kontaktformular überträgt nichts, und die Seite weist
darauf hin.

**Teammodus ist gebaut, aber nicht in Betrieb.** Der Code liegt vollständig
unter `server/`, die Abhängigkeiten sind gepinnt, die Testsuite deckt ihn gegen
einen wirklich gestarteten Server ab. Es fehlt allein die Inbetriebnahme.

### Was als Nächstes zu tun ist

1. **Bestandsaufnahme auf dem Server** ausführen, siehe unten. Rein lesend.
   Die entscheidende offene Frage: steht ein Verwaltungswerkzeug wie Plesk vor
   dem Apache? Falls ja, sind Eingriffe direkt in den Apache-Dateien der falsche
   Weg.
2. **Namen entscheiden**, siehe „Welcher Name für den Dienst?". Kurzfassung:
   `quick-check.it-agile.de` braucht keinen DNS-Eintrag, weil der Platzhalter
   der Zone schon auf die Maschine zeigt. `quick-check.it-team-flow.de` verlangt
   einen eigenen A-Eintrag bei united-domains.
3. **`ADMIN_TOKEN`** festlegen, lang und zufällig. Ohne gesetztes Token sind
   `/api/data` und `/api/reset` deaktiviert.
4. Nach der Inbetriebnahme **`apiBase` in `app/config.solo.js`** auf den Dienst
   zeigen lassen und `python3 sync.py` ausführen, damit auch der öffentliche
   Quick Check seine Anfragen dorthin sendet.

### Was danach noch offen bleibt

- **E-Mail-Benachrichtigung** bei neuen Anfragen. Ohne sie liegt ein Lead in
  `data.json`, bis jemand ihn abholt. Das Vorbild ist das Powermail-Formular auf
  `it-agile.de/kontakt/`, das genau das tut: speichern und benachrichtigen.
- **Mindestzahl an Rückmeldungen**, bevor im Teammodus ein Gruppenprofil
  erscheint. Bei drei oder vier Teilnehmenden lassen sich einzelne Antworten aus
  dem Mittelwert zurückrechnen.
- **Datenschutzerklärung** um den Quick Check ergänzen, sobald das
  Kontaktformular tatsächlich Daten überträgt.

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

Der Dienst hört nur auf `127.0.0.1:3000` hinter einem eigenen Apache-Auftritt
für eine eigene Subdomain. Er hat einen eigenen Benutzer, ein eigenes
Datenverzeichnis und schreibt ausschliesslich dorthin. Bestehende Auftritte
werden nicht angefasst.

### Vorbereitung: erst den Bestand aufnehmen

Von aussen ist folgendes gesichert (Stand 02.09.2026):

| Frage | Befund |
|---|---|
| Maschine | `162.55.222.147`, Hetzner, Rechenzentrum Nürnberg |
| Webserver | **Apache**, nicht nginx |
| Was dort läuft | `it-agile.de`, `www.it-agile.de` (TYPO3), `matomo.it-agile.de` |
| Unbekannte Namen | Apache antwortet mit 404, es gibt also eine Auffang-Konfiguration |
| Zertifikate | Let's Encrypt für `it-agile.de` und `www.it-agile.de`, kein Platzhalter |
| DNS `*.it-agile.de` | Platzhalter auf `162.55.222.147`, jede Subdomain landet also schon dort |
| DNS `*.it-team-flow.de` | Platzhalter auf GitHub Pages, `quick-check.it-team-flow.de` antwortet dort mit 404 |

Was von aussen **nicht** erkennbar ist und vor dem ersten Eingriff geklärt
werden muss:

- Betriebssystem und Apache-Version, und damit die Pfade der Konfiguration.
- Ob Apache von Hand konfiguriert wird oder ein Verwaltungswerkzeug wie Plesk
  davorsteht. Das ist die wichtigste Frage: Bei Plesk wären Eingriffe direkt in
  den Apache-Dateien der falsche Weg, sie würden beim nächsten Speichern im
  Werkzeug überschrieben.
- Ob Node.js schon installiert ist und in welcher Version.
- Wer die Maschine administriert und ob Änderungen abgestimmt werden müssen.

Diese Bestandsaufnahme ändert nichts. Auf dem Server ausführen und die Ausgabe
mitbringen:

```bash
# Betriebssystem, Webserver, Node
cat /etc/os-release | head -2
apache2 -v 2>/dev/null || httpd -v 2>/dev/null
node --version 2>/dev/null || echo "kein Node"

# Verwaltungswerkzeug im Spiel?
which plesk 2>/dev/null && echo "PLESK VORHANDEN"
ls -d /usr/local/psa /opt/psa /usr/local/cpanel 2>/dev/null

# Wie sind die vorhandenen Auftritte konfiguriert?
ls /etc/apache2/sites-enabled/ 2>/dev/null || ls /etc/httpd/conf.d/ 2>/dev/null

# Sind die Proxy-Module da, die ein Weiterleiten brauchen?
apache2ctl -M 2>/dev/null | grep -E "proxy|headers"

# Wie werden die Zertifikate erneuert?
which certbot && certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains"

# Ist Port 3000 frei?
ss -tlnp | grep -E ":3000|:80|:443"
```

### Welcher Name für den Dienst?

Zwei Möglichkeiten, mit unterschiedlichem Aufwand:

**`quick-check.it-agile.de`** — kein DNS-Eintrag nötig, der Platzhalter der Zone
zeigt bereits auf die Maschine. Das Zertifikat lässt sich sofort ausstellen,
weil der Name auflöst. Der Quick Check auf `it-team-flow.de` spricht dann eine
andere Herkunft an; das ist vorgesehen und über `ALLOWED_ORIGINS` abgedeckt.

**`quick-check.it-team-flow.de`** — bleibt in der Marke des Auftritts, verlangt
aber einen eigenen A-Eintrag bei united-domains auf `162.55.222.147`, der den
Platzhalter der Zone übersteuert. Erst danach lässt sich ein Zertifikat
ausstellen.

Der Aufwand spricht für den ersten Namen, die Marke für den zweiten.

### Installation

```bash
sudo adduser --system --group --no-create-home quickcheck
sudo mkdir -p /opt/quick-check /var/lib/quick-check
sudo chown quickcheck:quickcheck /var/lib/quick-check

# Dateien aus quick-check-src/server/ nach /opt/quick-check,
# public/ mitnehmen, node_modules und data.json nicht:
rsync -a --exclude node_modules --exclude data.json \
  quick-check-src/server/ root@162.55.222.147:/opt/quick-check/

cd /opt/quick-check && sudo npm ci --omit=dev
```

### Dienst

`quick-check.service` nach `/etc/systemd/system/` kopieren und die
Umgebungsvariablen setzen:

| Variable | Bedeutung |
|---|---|
| `ADMIN_TOKEN` | **Pflicht.** Ohne gesetztes Token antworten `/api/data` und `/api/reset` mit 503, statt Daten offenzulegen. Lang und zufällig wählen. |
| `ALLOWED_ORIGINS` | Erlaubte Herkünfte, Kommaliste. Während der Übergangszeit: `https://rlethmate.github.io,https://it-team-flow.de` |
| `PUBLIC_URL` | Basis-URL für den QR-Code, also der oben gewählte Name mit `https://`. Ausdrücklich setzen, dann hängt der QR-Code nicht von Kopfzeilen des Proxys ab. |
| `DATA_FILE` | `/var/lib/quick-check/data.json` |

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now quick-check
sudo systemctl status quick-check
curl -s localhost:3000/api/aggregate   # muss {"room":"default","count":0,...} liefern
```

Der Dienst hört nur auf dem Rechner selbst. Bis der Proxy steht, ist er von
aussen nicht erreichbar.

### Apache als Vorschaltung

Eigene Datei, damit nichts Bestehendes angefasst wird. Pfade unter Debian und
Ubuntu, bei anderen Systemen entsprechend anpassen:

```apache
# /etc/apache2/sites-available/quick-check.conf
<VirtualHost *:80>
    ServerName quick-check.it-agile.de

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "http"

    ErrorLog  ${APACHE_LOG_DIR}/quick-check-error.log
    CustomLog ${APACHE_LOG_DIR}/quick-check-access.log combined
</VirtualHost>
```

```bash
sudo a2enmod proxy proxy_http headers
sudo a2ensite quick-check
sudo apache2ctl configtest      # prueft ALLE Auftritte, muss "Syntax OK" sagen
sudo systemctl reload apache2
sudo certbot --apache -d quick-check.it-agile.de
```

`configtest` vor dem Reload ist nicht optional: es ist die Absicherung dagegen,
dass ein Fehler in der neuen Datei die bestehenden Auftritte mitnimmt. Solange
`configtest` fehlschlägt, bleibt der alte Zustand aktiv.

Nach `certbot` prüfen, dass der neue Auftritt über HTTPS antwortet und die
bestehenden Auftritte unverändert laufen:

```bash
curl -sI https://quick-check.it-agile.de/quick-check/ | head -1
curl -sI https://www.it-agile.de/            | head -1
curl -sI https://matomo.it-agile.de/         | head -1
```

### Wieder abbauen

Falls etwas nicht passt, ist der Eingriff vollständig rückbaubar:

```bash
sudo a2dissite quick-check && sudo systemctl reload apache2
sudo systemctl disable --now quick-check
sudo rm /etc/systemd/system/quick-check.service /etc/apache2/sites-available/quick-check.conf
sudo rm -rf /opt/quick-check /var/lib/quick-check
sudo deluser quickcheck
```

Bestehende Auftritte, Zertifikate und Konfigurationen bleiben davon unberührt,
weil nichts von ihnen verändert wurde.

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

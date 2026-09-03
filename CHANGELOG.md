# Changelog

Änderungen an `it-team-flow.de`, neueste zuerst.

Die Site wird aus diesem Repository gebaut und über GitHub Pages ausgeliefert.
Es gibt keine Versionsnummern; ein Eintrag ist durch Datum und Merge-Commit
bezeichnet. Neue Einträge oben anfügen.

---

## 2026-09-03 — Quick Check statt Typeform

Merge-Commit `adabea2`, Stand davor `4c9d3e0`. 17 Commits, 116 geänderte
Dateien, davon 77 Löschungen des mitcommitteten `public/`.

### Neu: LASTA Quick Check

- **Eigener Quick Check unter https://it-team-flow.de/quick-check/** — ersetzt
  das Typeform (`form.typeform.com/to/JiDiDyST`). Im Fragebogen ist damit kein
  Fremdanbieter mehr beteiligt.
- 15 Aussagen zur teamübergreifenden Lieferfähigkeit, **in fünf Schritten**,
  eine LASTA-Dimension je Schritt, mit Fortschrittsanzeige und
  Zurück-Navigation ohne Antwortverlust.
- **Ergebnis als Zielscheibe** mit drei Bewertungszonen: Entwicklungsfeld
  (Mittelwert unter 2,0), teilweise wirksam (2,0 bis unter 4,0), wirksam (ab
  4,0). Werte an den Achsen, Balken je Dimension zeigen die Zone.
- **Ansatzpunkte nur dort, wo etwas zu holen ist** — für Entwicklungsfelder und
  teilweise wirksame Dimensionen, schwächste zuerst. Wirksame Dimensionen
  bekommen keinen Tipp.
- **Kontaktformular zur Lead-Erfassung**, Feld für Feld nach dem Vorbild von
  `it-agile.de/kontakt/` (TYPO3 Powermail), inklusive Wortlaut der Einwilligung
  und Spam-Falle. Überspringbar.
- **Zwischenspeicherung im Browser** — ein begonnener Check lässt sich
  fortsetzen und springt zum ersten offenen Schritt.
- Ergebnis druck- und als PDF speicherbar.
- Aus dem alten Typeform übernommen: die 15 Aussagen, die Skalenanker, die drei
  Gesamtbewertungs-Texte und alle 15 Ansatzpunkte.
- **Teammodus ist gebaut, aber noch nicht in Betrieb**: Teilnahme über QR-Code
  und Raumcode, Gruppenmittelwert aktualisiert sich laufend, Moderationsansicht
  zum Projizieren. Braucht einen eigenen Server, siehe
  `quick-check-src/README.md`.

### Behobene Fehler

- **Die Webinar-Anmeldung war tot.** Der hinterlegte Link lieferte HTTP 404 —
  betroffen waren fünf Schaltflächen der Startseite und Verweise in vier
  Blogartikeln, alle über die zentrale Einstellung `webinar_url`. Auf die
  funktionierende Anmeldung umgestellt, vorher auf Erreichbarkeit geprüft.
- **Zwei Pages-Workflows liefen gegeneinander.** `hugo.yml` veröffentlichte den
  Hugo-Build, `static.yml` das rohe Repository (`path: '.'`). Beide lösten bei
  jedem Push auf `main` aus; wer zuletzt fertig wurde, bestimmte, was online
  stand. `static.yml` ist entfernt — sie hätte den Quellcode unter öffentlichen
  Adressen veröffentlicht und in Forks einen Konflikt um die Domain erzeugt,
  weil sie im Gegensatz zu Hugo die Datei `CNAME` mitveröffentlicht.
- **Blogseiten waren unter Unterpfaden unformatiert.**
  `layouts/blog/single.html` verwies absolut auf CSS, Bilder, Skripte,
  Impressum und Datenschutz. Auf der echten Domain fiel das nie auf, weil die
  Site in der Wurzel liegt. Jetzt über `relURL`, wie alle anderen Vorlagen
  längst. Für Inhaltsdateien gibt es dafür den Kurzbaustein
  `layouts/shortcodes/asset.html`.
- **Der Quick Check fehlte in der Sitemap.** Als Datei unter `static/` ist er
  keine Hugo-Seite und war damit für Suchmaschinen unsichtbar, während die alte
  Teaser-Seite gelistet war. Eigene Vorlage `layouts/sitemap.xml` nimmt ihn
  ausdrücklich auf.
- **Der Datenschutz-Link im Quick Check zeigte ins Leere** — `../datenschutz/`
  statt `../datenschutz.html`, ausgerechnet neben der Einwilligung. Die Seite
  deklariert ihre Adresse im Frontmatter.
- **Die Antwortskala brach auf Smartphones um.** Bei 375 px Breite passten die
  fünf Felder nicht in eine Zeile; eine Likert-Skala verliert damit ihre
  räumliche Linearität und Aussagekraft.
- Drei Tippfehler auf der Quick-Check-Blogseite.

### Datenschutz und Ladezeit

- **Kein Fremdnetz mehr.** jQuery kam von `d3e54v103j8qbb.cloudfront.net`, dem
  Netz von Webflow — bei jedem Seitenaufruf ging die IP-Adresse der Besucherin
  an einen Dritten in den USA. Die Datei liegt jetzt unter
  `static/js/jquery-3.5.1.min.js`, byteweise dieselbe: gleicher SHA-256 wie die
  bisherige CDN-Fassung und wie `code.jquery.com`.
- **Impressum, Datenschutz und alle Blogartikel laden keine Skripte mehr** —
  rund 305 KB weniger je Aufruf, die dort ohnehin nichts bewirkt haben. Nur
  `layouts/index.html` braucht jQuery und den Webflow-Laufzeitcode, wegen 12
  Interaktionen, 30 verborgener Startzustände und eines Sliders. Ohne den
  Laufzeitcode blieben diese Elemente unsichtbar.
- **Linkvorschau** für den Quick Check: `canonical`, `og:url`, `og:image` mit
  Maßen und Alternativtext, `og:site_name`, `og:locale` und Twitter-Karte. Beim
  Teilen in Slack oder LinkedIn erscheint eine Vorschau statt nur eines Links.

### Inhalt

- **Webinar-Ankündigung korrigiert.** Die Startseite kündigte ein Webinar
  »teamübergreifende Lieferfähigkeit« an, das es nicht gibt; die Anmeldung führt
  zu »Die Flow Manager Rolle«. Überschrift entsprechend geändert, der
  Beschreibungstext spricht das Thema nun aus der Rolle heraus an.
- **Angebots-PDF** auf Fassung V4.2: 10 statt 8 Seiten, besserer Kontrast,
  Tippfehler behoben. Dateiname unverändert, bereits verschickte Links bleiben
  gültig.
- **Impressum:** Geschäftsführung Sebastian Keller und Urs Reupke; inhaltlich
  Verantwortlicher nach § 55 Abs. 2 RStV auf Sebastian Keller geändert.
- Die Kachel „Quick Check" auf der Startseite führt **direkt** zum Quick Check
  statt über eine Zwischenseite. Die Blogseite `/blog/quick-check/` bleibt
  bestehen, weil ihre Adresse in der Sitemap gelistet ist; ihr Knopf führt jetzt
  ebenfalls zum neuen Quick Check.

### Für Entwicklung

- **Eine Codebasis, zwei Betriebsarten.** `quick-check-src/sync.py` erzeugt aus
  einer Quelle den statischen Einzelmodus (`static/quick-check/`) und den
  Teammodus (`quick-check-src/server/public/`). Die Testsuite prüft, dass sich
  beide Auslieferungen ausschließlich im Konfigurationsblock unterscheiden.
  **Änderungen gehören immer in `quick-check-src/app/`, nie in die erzeugten
  Dateien**, danach `python3 sync.py`.
- **Das Backend kennt den Fragebogen nicht** — es aggregiert nur je Frage
  (`q0`, `q1`, …) und weiß nichts von Dimensionen, Zonen oder Texten. Fragen und
  Texte bleiben dadurch an einer Stelle gepflegt.
- **375 automatisierte Prüfungen** in `quick-check-src/test/test.js`, alle grün.
  Der Backend-Teil läuft gegen einen tatsächlich gestarteten Server. Aufruf und
  Einrichtung stehen im Kopf der Datei.
- **Das erzeugte `public/` ist aus der Versionierung genommen**, dazu eine
  bisher fehlende `.gitignore`. Hugo baut das Verzeichnis bei jedem Deploy neu;
  der mitcommittete Stand von Januar wurde nie ausgeliefert und hätte gelöschte
  Seiten überlebt.
- Betriebsanleitung für den Teammodus unter `quick-check-src/README.md`,
  einschließlich einer rein lesenden Bestandsaufnahme für den Server. Sie
  beschreibt **Apache**, nicht nginx — die Maschine läuft Apache.

### Bekannte offene Punkte

Stand bei Veröffentlichung, nicht mit dieser Änderung erledigt:

- Teammodus in Betrieb nehmen, dazu E-Mail-Benachrichtigung für eingehende
  Anfragen und eine Mindestzahl an Rückmeldungen, bevor ein Gruppenprofil
  erscheint. Bei drei oder vier Teilnehmenden lassen sich einzelne Antworten aus
  dem Mittelwert zurückrechnen.
- **Die Datenschutzerklärung muss um den Quick Check ergänzt werden, sobald das
  Kontaktformular Daten überträgt.** Derzeit läuft es ohne Backend, es wird
  nichts übertragen und nichts gespeichert; die Seite weist darauf hin.
- Zonengrenzen und Gesamtbewertungs-Stufen sind gesetzt, nicht empirisch
  kalibriert. Die Stufengrenzen bei 29 und 45 Punkten sind eine Rekonstruktion
  der Logik des alten Typeform, die in sich widersprüchlich war.
- Das Vorschaubild ist 1080×800; für Linkvorschauen wären etwa 1200×630 besser.
- Das Subjekt der 15 Aussagen wechselt zwischen „wir", „eure Teams" und „deine
  Teams"; zwei Aussagen fragen mehrere Bedingungen gleichzeitig ab. Der Wortlaut
  stammt aus dem Typeform, eine Änderung berührt die Vergleichbarkeit mit
  Altdaten.
- In den Vorlagen steht `UC_UI_SUPPRESS_CMP_DISPLAY = true`, ein Rest des
  Zustimmungs-Werkzeugs Usercentrics, das auf dieser Site nicht geladen wird.
- Matomo lädt weiterhin von `matomo.it-agile.de`, also vom eigenen Server.

### Prüfung nach der Veröffentlichung

Automatisiert nachgewiesen: Quick Check erreichbar, Sitemap gültig und um
`/quick-check/` ergänzt, kein Typeform-Verweis, kein Verweis auf das
Webflow-Netz, alle Webinar-Links auf der funktionierenden Anmeldung, Angebots-PDF
byteweise identisch zur Quelle, Quellcode nicht öffentlich erreichbar.

Manuell bestätigt: Animationen und Slider der Startseite laufen nach der
Umstellung auf lokales jQuery weiter. Das war der einzige Punkt, der sich nicht
automatisiert prüfen lässt.

# Changelog

Versionen nach [SemVer](https://semver.org/lang/de/): neue Funktion → MINOR, Fehlerbehebung →
PATCH. Unter 1.0 noch nicht offiziell veröffentlicht. Die Version steht in `package.json` (WXT
übernimmt sie ins Manifest) und oben rechts im Popup.

## 0.4.0 – 2026-11-22

- Eine gemerkte Anzeige ist jetzt ein **Stellenangebot**, keine Bewerbung mehr: Sie landet in
  jobpilot unter „Stellenangebote“ (Tabelle `job_postings`) und wird erst dort zur Bewerbung.
  Ansprechpartner aus der Anzeige bleiben am Stellenangebot.
- Dublettenprüfung gegen Stellenangebote und Bewerbungen; der Hinweis nennt, als was die Stelle
  schon erfasst ist („Stellenangebot“ bzw. „Bewerbung · Beworben“).
- Knopf „Stellenangebot speichern“ statt „Stelle merken“.

## 0.3.0 – 2026-11-21

- Dublettenprüfung: Die Extension erkennt eine schon erfasste Stelle nicht nur an der Adresse,
  sondern auch an Firma + Position und an Firma + fast gleichem Anzeigentext – beim Öffnen und noch
  einmal beim Speichern (falls Firma oder Stelle geändert wurden). Der Hinweis „Schon in jobpilot?“
  nennt Status und Grund; „Trotzdem neu merken“ speichert dennoch.

## 0.2.2 – 2026-11-21

- Anzeigentext ohne Kopf und Bedienelemente der Jobbörse: Er beginnt nach „Vollständige
  Stellenbeschreibung“ (bzw. „Über den Job“, „Full job description“); Zeilen wie „Return to Search
  Result“, „Mit Indeed bewerben“, Bewertung oder „Diesen Job melden“ fallen weg. Markierter Text
  bleibt unverändert.

## 0.2.1 – 2026-11-21

- Indeed/LinkedIn: Der Anzeigentext enthält nur noch die Stellenbeschreibung – ohne „Return to
  Search Result“, „Mit Indeed bewerben“, Bewertung oder „Diesen Job melden“.

## 0.2.0 – 2026-11-21

- Indeed und LinkedIn: In der geteilten Ansicht (Trefferliste links, Anzeige rechts) wird nur die
  Anzeige gelesen; Stelle, Firma und Ort kommen direkt aus der Seite, ohne KI.
- Gespeichert wird die feste Adresse der Anzeige (Indeed `/viewjob?jk=…`, LinkedIn
  `/jobs/view/<id>/`) statt der Suchseite – auch für die Dublettenprüfung.
- Versionsnummer oben rechts im Popup.

## 0.1.0 – 2026-11-21

- Erste Version: Stellenanzeige mit einem Klick als Bewerbung „Gemerkt“ in jobpilot speichern –
  ohne KI aus schema.org-`JobPosting`, sonst auf Wunsch per KI (`job-import`), Vorschau zum
  Korrigieren, Dublettenprüfung über die Adresse, Anmeldung mit dem jobpilot-Konto.

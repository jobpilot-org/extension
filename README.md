# jobpilot – Browser-Extension

Merkt interessante Stellenanzeigen mit einem Klick in jobpilot. Die Anzeige landet als
**Stellenangebot** (Tabelle `job_postings`, noch keine Bewerbung) in der zentralen
Supabase-Datenbank (`../backend`) und erscheint in den Apps unter „Stellenangebote“ – bisher in der
desktop-app; dort wird daraus bei Bedarf eine Bewerbung.

## Ablauf

1. Auf einer Stellenanzeige das jobpilot-Symbol anklicken (beim ersten Mal anmelden – dasselbe Konto
   wie in den Apps).
2. Die Extension liest die geöffnete Seite – erst dann, nicht vorher (`activeTab`, keine
   Host-Berechtigungen):
   - **ohne KI** aus den strukturierten Daten der Seite (schema.org `JobPosting` als JSON-LD, das
     viele Jobbörsen und Karriereseiten einbetten): Firma, Stelle, Ort, Gehalt, Anzeigentext;
   - bei Jobbörsen mit geteilter Ansicht (Indeed, LinkedIn: Trefferliste links, Anzeige rechts)
     nur den **Anzeigenbereich** und daraus Titel, Firma und Ort (`SITE_SELECTORS` in
     `lib/job-posting.ts`); gespeichert wird die feste Adresse der Anzeige (Indeed
     `/viewjob?jk=…`, LinkedIn `/jobs/view/<id>/`) statt der Suchseite. Ändern die Börsen ihren
     Seitenaufbau, greift wieder der Hauptbereich bzw. die KI – dann die Selektoren anpassen;
   - fehlt etwas, auf Wunsch **mit KI** über die Edge Function `job-import` mit dem eigenen KI-Key
     (Zustimmung `ai.consent` wie in den Apps). Markierter Text hat Vorrang vor dem ganzen Seitentext.
3. Vorschau prüfen, ggf. korrigieren, „Stellenangebot speichern“. Ist die Stelle schon erfasst (als
   Stellenangebot oder Bewerbung) – gleiche
   Adresse, gleiche Firma + Position oder gleiche Firma mit fast gleichem Anzeigentext
   (`lib/duplicates.ts`, Kopie von `desktop-app/src/domain/duplicates.ts`) –, erscheint ein Hinweis
   statt einer Dublette.

Dieselbe Stelle auf Portal und Firmenseite: Erkennt die Extension die Firma wieder, bietet sie
„Als Firmenseite/Quelle hinzufügen“ an – die Seite landet als weitere Quelle in
`job_posting_sources`, die Angaben der Firmenseite haben Vorrang. Bewerbungslinks („Jetzt
bewerben“) und Bewerbungs-E-Mails werden mitgelesen.

Den Anzeigentext speichert die Extension in `job_postings.job_description` – Grundlage für den
geplanten Zuschnitt des Lebenslaufs auf eine Stelle.

## Aufbau

- `entrypoints/popup/` – Popup (React): Anmeldung, Vorschau, Speichern
- `lib/job-posting.ts` – reine Logik (JSON-LD lesen, HTML → Text, Entwurf, Prüfung), getestet in
  `lib/__tests__/`
- `lib/page-reader.ts` – liest die Seite per `scripting.executeScript`
- `lib/jobpilot.ts` – Supabase-Client (Sitzung in `storage.local`), Speichern, Dublettenprüfung,
  Aufruf von `job-import`
- `assets/jobpilot.css` – byte-gleiche Kopie der Design-Datei der Apps

## Befehle

```bash
npm run dev              # Chrome mit geladener Extension und Hot Reload
npm run dev:firefox      # dasselbe in Firefox
npm run check            # Typecheck + Tests – vor "fertig"
npm test                 # vitest
npm run build            # .output/chrome-mv3 (in Chrome: Erweiterungen → Entwicklermodus → „Entpackte Erweiterung laden“)
npm run build:firefox    # .output/firefox-mv2 (about:debugging → „Temporäres Add-on laden“)
npm run zip              # ZIP für den Chrome Web Store
```

Supabase-Instanz über `.env` (`WXT_SUPABASE_URL`, `WXT_SUPABASE_PUBLISHABLE_KEY`, Vorlage
`.env.example`); ohne `.env` das gehostete Projekt `dev`.

`@jobpilot-org/shared-ai` und die Aufrufhilfe für `job-import` kommen aus GitHub Packages. Vor `npm install` ein GitHub-Token mit `read:packages` in die Umgebung laden (nie in eine Datei schreiben):

```bash
set -a; . ~/.config/jobpilot/github.env; set +a
export NODE_AUTH_TOKEN="$GITHUB_PACKAGES_TOKEN"
```

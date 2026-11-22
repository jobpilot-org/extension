// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: {} }));

import { SITE_SELECTORS } from '../job-posting';
import { readPage } from '../page-reader';

const filler = (word: string) => `${word} `.repeat(120);

describe('readPage', () => {
  beforeEach(() => {
    document.title = 'Jobs';
    document.head.innerHTML = '';
  });

  it('liest bei Indeed nur den Anzeigenbereich rechts, nicht die Trefferliste', () => {
    document.body.innerHTML = `
      <main>
        <ul id="mosaic-jobResults"><li>Schnellbewerbung AI Consultant Franklin Institute ${filler('Liste')}</li></ul>
        <div id="jobsearch-ViewjobPaneWrapper">
          <a>Return to Search Result</a>
          <h2 data-testid="jobsearch-JobInfoHeader-title">Senior Software &amp; App Engineer (m/w/d)<span> - job post</span></h2>
          <div data-testid="inlineHeader-companyName"><a>FLH Media Digital</a></div>
          <div data-testid="inlineHeader-companyLocation">Ismaning</div>
          <button>Mit Indeed bewerben</button>
          <div id="jobDescriptionText">${filler('Anzeige')}</div>
          <button>Diesen Job melden</button>
        </div>
      </main>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.text).toContain('Anzeige');
    expect(snapshot.text).not.toContain('Liste');
    // Nur die Beschreibung, ohne Bedienelemente der Börse
    for (const chrome of ['Return to Search Result', 'Mit Indeed bewerben', 'Diesen Job melden', 'FLH']) {
      expect(snapshot.text).not.toContain(chrome);
    }
    expect(snapshot.hints).toEqual({
      title: 'Senior Software & App Engineer (m/w/d) - job post',
      company: 'FLH Media Digital',
      location: 'Ismaning',
    });
  });

  it('nimmt ohne bekannten Bereich den Hauptbereich bzw. die ganze Seite', () => {
    document.body.innerHTML = `<nav>Menü</nav><main>${filler('Haupt')}</main>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.text).toContain('Haupt');
    expect(snapshot.text).not.toContain('Menü');
    expect(snapshot.hints).toEqual({ title: undefined, company: undefined, location: undefined });

    document.body.innerHTML = `<nav>Menü</nav><div>kurz</div>`;
    expect(readPage(SITE_SELECTORS).text).toContain('Menü');
  });

  it('übergeht einen leeren Anzeigenbereich und liest JSON-LD', () => {
    document.head.innerHTML = '<script type="application/ld+json">{"@type":"JobPosting"}</script>';
    document.body.innerHTML = `<div class="jobsearch-RightPane"></div><main>${filler('Haupt')}</main>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.text).toContain('Haupt');
    expect(snapshot.jsonLd).toEqual(['{"@type":"JobPosting"}']);
  });
});

describe('readPage ohne gesonderte Beschreibung', () => {
  it('nimmt den ganzen Anzeigenbereich, wenn die Beschreibung zu kurz ist', () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details">
        <h1 class="job-details-jobs-unified-top-card__job-title">Dev</h1>
        <div id="job-details">kurz</div>
        <p>${'Bereich '.repeat(60)}</p>
      </div>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.text).toContain('Bereich');
    expect(snapshot.hints?.title).toBe('Dev');
  });
});

describe('readPage: Bewerbungsweg', () => {
  it('findet „Jetzt bewerben“-Links und E-Mail-Adressen', () => {
    document.body.innerHTML = `
      <main>
        <p>${'Text '.repeat(120)}</p>
        <p>Deine Ansprechpartnerin Julia Illgner, bewerbung@simple-first.de</p>
        <a href="https://simple-first.de/bewerben?job=ki">Jetzt bewerben</a>
        <a href="https://simple-first.de/kontakt">Kontakt</a>
        <a href="mailto:info@simple-first.de">Mail</a>
      </main>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.applyLinks).toEqual(['https://simple-first.de/bewerben?job=ki']);
    expect(snapshot.emails).toEqual(['info@simple-first.de', 'bewerbung@simple-first.de']);
  });
});

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
          <h2 data-testid="jobsearch-JobInfoHeader-title">Senior Software &amp; App Engineer (m/w/d)<span> - job post</span></h2>
          <div data-testid="inlineHeader-companyName"><a>FLH Media Digital</a></div>
          <div data-testid="inlineHeader-companyLocation">Ismaning</div>
          <div id="jobDescriptionText">${filler('Anzeige')}</div>
        </div>
      </main>`;
    const snapshot = readPage(SITE_SELECTORS);
    expect(snapshot.text).toContain('Anzeige');
    expect(snapshot.text).not.toContain('Liste');
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

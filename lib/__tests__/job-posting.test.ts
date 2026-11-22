import { describe, expect, it } from 'vitest';

import {
  draftFromPage,
  findJobPosting,
  htmlToText,
  isComplete,
  mergeJobImport,
  normalizeJobUrl,
  parseJobImport,
  parseSalary,
  postingText,
  stripBoardChrome,
  sourceFromUrl,
  toPostingColumns,
  today,
  validateDraft,
  type JobDraft,
  type PageSnapshot,
} from '../job-posting';

const description =
  '<p>Wir suchen dich als <strong>Fullstack-Entwickler (m/w/d)</strong> für unser Team in Berlin.</p><ul><li>TypeScript &amp; React</li><li>PostgreSQL</li></ul>';

const jobPosting = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Fullstack-Entwickler (m/w/d)',
  description,
  hiringOrganization: { '@type': 'Organization', name: 'Acme GmbH' },
  jobLocation: [
    { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Berlin' } },
    { '@type': 'Place', address: { addressLocality: 'Berlin' } },
  ],
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'EUR',
    value: { '@type': 'QuantitativeValue', minValue: 5000, maxValue: 6000, unitText: 'MONTH' },
  },
};

const page = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: 'https://www.stepstone.de/stellenangebote--123.html?utm_source=x&id=5#top',
  title: 'Fullstack-Entwickler – Acme',
  selection: '',
  jsonLd: [],
  text: 'Navigation\n\n\n\nFullstack-Entwickler bei Acme. '.repeat(5),
  ...overrides,
});

describe('findJobPosting', () => {
  it('findet die Anzeige auch in @graph und Arrays und überspringt kaputtes JSON', () => {
    expect(
      findJobPosting([
        '{kaputt',
        JSON.stringify({ '@type': 'WebSite' }),
        JSON.stringify({ '@graph': [{ '@type': 'Organization' }, [{ ...jobPosting }]] }),
      ]),
    ).toMatchObject({ title: 'Fullstack-Entwickler (m/w/d)' });
    expect(findJobPosting([JSON.stringify({ '@type': ['Thing', 'JobPosting'], title: 'x' })])).toEqual({
      '@type': ['Thing', 'JobPosting'],
      title: 'x',
    });
    expect(findJobPosting([JSON.stringify({ '@type': 'WebSite' })])).toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('macht Absätze und Aufzählungspunkte und dekodiert Entities', () => {
    expect(htmlToText(description)).toBe(
      'Wir suchen dich als Fullstack-Entwickler (m/w/d) für unser Team in Berlin.\n\n• TypeScript & React\n• PostgreSQL',
    );
  });

  it('versteht zusätzlich kodiertes HTML', () => {
    expect(htmlToText('&lt;p&gt;Gr&amp;ouml;&szlig;e&lt;/p&gt;&lt;p&gt;B&lt;/p&gt;')).toBe('Größe\n\nB');
  });
});

describe('draftFromPage', () => {
  it('übernimmt alles aus der JobPosting – Monatsgehalt × 12, Ort ohne Doppelung', () => {
    const { draft, structured } = draftFromPage(page({ jsonLd: [JSON.stringify(jobPosting)] }));
    expect(structured).toBe(true);
    expect(draft).toEqual({
      company: 'Acme GmbH',
      role: 'Fullstack-Entwickler (m/w/d)',
      location: 'Berlin',
      workMode: undefined,
      salaryMin: 60000,
      salaryMax: 72000,
      source: 'StepStone',
      jobUrl: 'https://www.stepstone.de/stellenangebote--123.html?id=5',
      jobDescription: htmlToText(description),
    });
    expect(isComplete(draft)).toBe(true);
  });

  it('setzt Remote nur ohne festen Ort und lässt Stundenlöhne und Fremdwährung leer', () => {
    const remote = {
      ...jobPosting,
      jobLocation: undefined,
      jobLocationType: 'TELECOMMUTE',
      baseSalary: { currency: 'USD', value: { value: 100000, unitText: 'YEAR' } },
    };
    const { draft } = draftFromPage(page({ jsonLd: [JSON.stringify(remote)] }));
    expect(draft).toMatchObject({ workMode: 'remote', location: '', salaryMin: undefined });

    const hourly = { ...jobPosting, baseSalary: { currency: 'EUR', value: { value: 25, unitText: 'HOUR' } } };
    expect(draftFromPage(page({ jsonLd: [JSON.stringify(hourly)] })).draft.salaryMin).toBeUndefined();

    const yearly = { ...jobPosting, baseSalary: { value: { value: '65000', unitText: 'YEAR' } } };
    expect(draftFromPage(page({ jsonLd: [JSON.stringify(yearly)] })).draft).toMatchObject({
      salaryMin: 65000,
      salaryMax: undefined,
    });
  });

  it('nimmt ohne strukturierte Daten den Seitentext, mit Vorrang für markierten Text', () => {
    const { draft, structured } = draftFromPage(page());
    expect(structured).toBe(false);
    expect(draft.company).toBe('');
    expect(draft.jobDescription).not.toMatch(/\n{3}/);
    expect(isComplete(draft)).toBe(false);

    const selection = 'Markierte Anzeige mit genug Text. '.repeat(4);
    expect(postingText(page({ selection }))).toBe(selection.trim());
    expect(postingText(page({ selection: 'zu kurz' }))).toContain('Navigation');
    expect(postingText(page({ text: 'x'.repeat(30_000) }))).toHaveLength(20_000);
  });

  it('nimmt den Seitentext, wenn die JobPosting keine Beschreibung hat', () => {
    const { draft } = draftFromPage(
      page({ jsonLd: [JSON.stringify({ ...jobPosting, description: undefined })] }),
    );
    expect(draft.jobDescription).toContain('Fullstack-Entwickler bei Acme');
  });
});

describe('Eckdaten aus der Seite', () => {
  it('nimmt Titel, Firma und Ort aus den Hinweisen – dann reicht es ohne KI', () => {
    const { draft, structured } = draftFromPage(
      page({
        url: 'https://de.indeed.com/?vjk=01de8d4f6df77be3',
        hints: {
          title: 'Senior Software & App Engineer (m/w/d) - job post',
          company: ' FLH Media Digital ',
          location: 'Ismaning',
        },
      }),
    );
    expect(structured).toBe(false);
    expect(draft).toMatchObject({
      role: 'Senior Software & App Engineer (m/w/d)',
      company: 'FLH Media Digital',
      location: 'Ismaning',
      source: 'Indeed',
      jobUrl: 'https://de.indeed.com/viewjob?jk=01de8d4f6df77be3',
    });
    expect(isComplete(draft)).toBe(true);
  });
});

describe('mergeJobImport', () => {
  const job = parseJobImport({
    company: 'KI GmbH',
    role: 'KI-Rolle',
    location: 'Hamburg',
    workMode: 'hybrid',
    salaryMin: 50000,
    salaryMax: null,
    skills: ['TS', 3],
    contactName: 'Frau Muster',
    contactEmail: ' ',
    summary: 'Kurz.',
  });

  it('füllt nur Leeres und behält Daten von der Seite', () => {
    const draft: JobDraft = {
      company: 'Acme',
      role: '',
      location: '',
      salaryMax: 70000,
      jobUrl: 'https://x.de',
      jobDescription: 'Text',
    };
    expect(mergeJobImport(draft, job)).toEqual({
      ...draft,
      role: 'KI-Rolle',
      location: 'Hamburg',
      workMode: 'hybrid',
      salaryMin: undefined,
      salaryMax: 70000,
      contactName: 'Frau Muster',
      contactEmail: undefined,
    });
  });

  it('prüft die Antwort', () => {
    expect(job.skills).toEqual(['TS']);
    expect(parseJobImport({ role: 'x', workMode: 'mond', salaryMin: -1 })).toMatchObject({
      workMode: null,
      salaryMin: null,
      company: '',
    });
    expect(() => parseJobImport(null)).toThrow();
    expect(() => parseJobImport({ company: 'x' })).toThrow();
  });
});

describe('Hilfen', () => {
  it('erkennt die Quelle', () => {
    expect(sourceFromUrl('https://de.linkedin.com/jobs/view/1')).toBe('LinkedIn');
    expect(sourceFromUrl('https://www.xing.com/jobs/1')).toBe('XING');
    expect(sourceFromUrl('https://de.indeed.com/viewjob')).toBe('Indeed');
    expect(sourceFromUrl('https://www.karriere.acme.de/job')).toBe('karriere.acme.de');
    expect(sourceFromUrl('chrome://extensions')).toBeUndefined();
    expect(sourceFromUrl('kein link')).toBeUndefined();
  });

  it('bildet die feste Adresse bei Indeed und LinkedIn', () => {
    expect(normalizeJobUrl('https://de.indeed.com/?vjk=01de8d4f6df77be3')).toBe(
      'https://de.indeed.com/viewjob?jk=01de8d4f6df77be3',
    );
    expect(normalizeJobUrl('https://de.indeed.com/jobs?q=dev&l=M%C3%BCnchen&vjk=abc123&from=x')).toBe(
      'https://de.indeed.com/viewjob?jk=abc123',
    );
    expect(normalizeJobUrl('https://de.indeed.com/viewjob?jk=abc123&tk=1&from=serp')).toBe(
      'https://de.indeed.com/viewjob?jk=abc123',
    );
    expect(normalizeJobUrl('https://de.indeed.com/?vjk=<script>')).toBe('https://de.indeed.com/?vjk=%3Cscript%3E');
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=dev')).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
    expect(normalizeJobUrl('https://de.linkedin.com/jobs/view/senior-dev-at-acme-4012345678?trk=x')).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
  });

  it('entfernt Tracking aus der Adresse', () => {
    expect(normalizeJobUrl('https://a.de/job?id=1&trk=abc&gclid=1#x')).toBe('https://a.de/job?id=1');
    expect(normalizeJobUrl('kaputt')).toBe('kaputt');
  });

  it('liest Gehälter', () => {
    expect(parseSalary('')).toBeUndefined();
    expect(parseSalary('65.000 €')).toBe(65000);
    expect(parseSalary('65k')).toBe(65000);
    expect(parseSalary('72,5k')).toBe(72500);
    expect(parseSalary('viel')).toBeNaN();
  });

  it('prüft den Entwurf', () => {
    const draft: JobDraft = { company: ' ', role: 'Dev', location: '', jobUrl: '', jobDescription: '' };
    expect(validateDraft(draft)).toEqual({ company: 'Bitte die Firma angeben.' });
    expect(
      validateDraft({ ...draft, company: 'A', salaryMin: 80000, salaryMax: 60000 }).salary,
    ).toMatch(/höher/);
    expect(validateDraft({ ...draft, company: 'A', salaryMin: Number.NaN }).salary).toMatch(/Zahl/);
  });

  it('baut die Zeile für job_postings', () => {
    expect(today(new Date(2026, 10, 3, 23, 30))).toBe('2026-11-03');
    expect(
      toPostingColumns({
        company: ' Acme ',
        role: 'Dev',
        location: '',
        jobUrl: 'https://a.de',
        jobDescription: ' ',
        source: '',
        contactName: ' Frau Muster ',
      }),
    ).toEqual({
      company: 'Acme',
      role: 'Dev',
      location: '',
      work_mode: null,
      source: null,
      job_url: 'https://a.de',
      salary_min: null,
      salary_max: null,
      job_description: null,
      contact_name: 'Frau Muster',
      contact_email: null,
    });
  });
});

describe('stripBoardChrome', () => {
  const indeed = [
    'Return to Search Result',
    'Job Post Details',
    'Senior Software & App Engineer (m/w/d)',
    'FLH Media Digital',
    '·',
    '4.3',
    'Ismaning',
    'Vollzeit',
    'Mit Indeed bewerben',
    'Stellenbeschreibung',
    'Keine Gehaltsinformationen angegeben',
    'Vollständige Stellenbeschreibung',
    'Kurzbeschreibung der Stelle',
    'Rolle: Verantwortung für die technische Weiterentwicklung moderner Software-, Web- und Mobile-Anwendungen',
    '',
    'Dein Profil',
    'Diesen Job melden',
    'Informationen zur Anzeigentransparenz',
    'Return to Search Result',
  ].join('\n');

  it('beginnt nach „Vollständige Stellenbeschreibung“ und entfernt Bedienelemente', () => {
    expect(stripBoardChrome(indeed)).toBe(
      'Kurzbeschreibung der Stelle\nRolle: Verantwortung für die technische Weiterentwicklung moderner Software-, Web- und Mobile-Anwendungen\n\nDein Profil',
    );
  });

  it('lässt Text ohne Marke bis auf Bedienelemente stehen und behält zu kurze Reste', () => {
    const plain = `Mit Indeed bewerben\n${'Aufgaben '.repeat(20)}\nDiesen Job melden`;
    expect(stripBoardChrome(plain)).toBe('Aufgaben '.repeat(20).trim());
    expect(stripBoardChrome('Vollständige Stellenbeschreibung\nkurz')).toBe(
      'Vollständige Stellenbeschreibung\nkurz',
    );
  });

  it('wirkt im Entwurf, aber nicht auf markierten Text', () => {
    expect(postingText(page({ text: indeed }))).toMatch(/^Kurzbeschreibung der Stelle/);
    const selection = `Mit Indeed bewerben\n${'Markiert '.repeat(20)}`;
    expect(postingText(page({ text: indeed, selection }))).toBe(selection.trim());
  });
});

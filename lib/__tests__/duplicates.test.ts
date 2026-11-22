import { describe, expect, it } from 'vitest';

import {
  companyKey,
  findDuplicates,
  normalizeJobUrl,
  roleKey,
  textSimilarity,
  type DuplicateTarget,
} from '../duplicates';

const posting =
  'Wir suchen einen Senior Software Engineer für unser Team in Ismaning. Du entwickelst moderne Web- und Mobile-Anwendungen mit TypeScript, React und React Native, arbeitest eng mit dem Produktmanagement zusammen und bringst mehrjährige Erfahrung in der professionellen Softwareentwicklung mit.';

type Entry = DuplicateTarget & { status: string; appliedAt: string };

const application = (overrides: Partial<Entry>): Entry => ({
  id: 'a1',
  company: 'FLH Media Digital GmbH',
  role: 'Senior Software & App Engineer (m/w/d)',
  appliedAt: '2026-11-20',
  status: 'saved',
  ...overrides,
});

describe('Normalisierung', () => {
  it('vereinheitlicht Adressen', () => {
    expect(normalizeJobUrl('https://de.indeed.com/?vjk=01de8d4f6df77be3')).toBe(
      'https://de.indeed.com/viewjob?jk=01de8d4f6df77be3',
    );
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=4012345678')).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
    expect(normalizeJobUrl(' https://a.de/job?id=1&utm_source=x#top ')).toBe('https://a.de/job?id=1');
    expect(normalizeJobUrl('kein link')).toBe('kein link');
  });

  it('vereinheitlicht Firma und Position', () => {
    expect(companyKey('FLH Media Digital GmbH & Co. KG')).toBe('flh media digital');
    expect(companyKey('Müller AG')).toBe('mueller');
    expect(roleKey('Senior Software & App Engineer (m/w/d)')).toBe('senior software app engineer');
    expect(roleKey('Senior Software & App Engineer (w/m/d)')).toBe('senior software app engineer');
    expect(roleKey('Fullstack-Developer (all genders)')).toBe('fullstack developer');
    expect(roleKey('Entwickler m/w/d')).toBe('entwickler');
  });

  it('misst die Ähnlichkeit von Anzeigentexten', () => {
    expect(textSimilarity(posting, posting)).toBe(1);
    expect(textSimilarity(posting, `${posting} Jetzt bewerben!`)).toBeGreaterThan(0.9);
    expect(textSimilarity(posting, 'Ganz andere Stelle als Pflegekraft in Hamburg mit Schichtdienst.')).toBe(0);
    expect(textSimilarity('', posting)).toBe(0);
  });
});

describe('findDuplicates', () => {
  it('erkennt dieselbe Anzeige an der Adresse, auch über Such- und Anzeigenseite hinweg', () => {
    const existing = [
      application({ id: 'indeed', company: 'Andere Firma', jobUrl: 'https://de.indeed.com/viewjob?jk=abc123' }),
    ];
    expect(
      findDuplicates(
        { company: 'FLH', role: 'Dev', jobUrl: 'https://de.indeed.com/jobs?q=dev&vjk=abc123' },
        existing,
      ),
    ).toEqual([{ item: existing[0], reason: 'url' }]);
  });

  it('erkennt Firma + Position trotz Rechtsform und Gender-Zusatz', () => {
    const matches = findDuplicates(
      { company: 'FLH Media Digital', role: 'Senior Software & App Engineer (w/m/d)' },
      [application({ id: 'a1', status: 'rejected' })],
    );
    expect(matches).toMatchObject([{ item: { id: 'a1', status: 'rejected' }, reason: 'company-role' }]);
  });

  it('erkennt umbenannte Position am fast gleichen Anzeigentext', () => {
    const existing = [application({ id: 'a1', role: 'Software Engineer', jobDescription: posting })];
    expect(
      findDuplicates({ company: 'FLH Media Digital', role: 'App Developer', jobDescription: `${posting} ` }, existing),
    ).toMatchObject([{ reason: 'company-description' }]);
    // Anderer Text, andere Position bei derselben Firma: keine Dublette
    expect(
      findDuplicates(
        { company: 'FLH Media Digital', role: 'Vertrieb', jobDescription: 'Vertrieb '.repeat(40) },
        existing,
      ),
    ).toEqual([]);
  });

  it('übergeht die bearbeitete Bewerbung und andere Firmen, sortiert sichere Treffer zuerst', () => {
    const existing = [
      application({ id: 'same-role' }),
      application({ id: 'same-url', company: 'X', role: 'Y', jobUrl: 'https://a.de/job/1' }),
      application({ id: 'other', company: 'Andere GmbH' }),
    ];
    const candidate = {
      company: 'FLH Media Digital',
      role: 'Senior Software & App Engineer',
      jobUrl: 'https://www.a.de/job/1/?utm_source=x',
    };
    expect(findDuplicates(candidate, existing).map((m) => [m.item.id, m.reason])).toEqual([
      ['same-url', 'url'],
      ['same-role', 'company-role'],
    ]);
    expect(findDuplicates(candidate, existing, 'same-role').map((m) => m.item.id)).toEqual(['same-url']);
  });

  it('meldet bei leerer Firma keine Treffer über Firma', () => {
    expect(findDuplicates({ company: ' ', role: 'Senior Software & App Engineer' }, [application({})])).toEqual([]);
  });
});

// Reine Logik der Extension ohne Browser-APIs: aus dem Inhalt einer Seite einen Entwurf für eine
// gemerkte Bewerbung machen. Zuerst ohne KI aus den strukturierten Daten der Seite (schema.org
// `JobPosting` als JSON-LD, das viele Jobbörsen und Karriereseiten einbetten), sonst ergänzt um das
// Ergebnis der Edge Function `job-import` (backend/supabase/functions/job-import).

import { WORK_MODES, type AiResponse, type WorkMode } from '@jobpilot-org/shared-ai/assistant';
import {
  MAX_POSTING_CHARS,
  MIN_POSTING_CHARS,
} from '@jobpilot-org/shared-ai/features/job-import';

import { normalizeJobUrl } from './duplicates';

export { WORK_MODES, normalizeJobUrl };
export type { WorkMode };

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'Vor Ort',
};

/** Was die Extension von der geöffneten Seite liest (siehe `page-reader.ts`) */
export type PageSnapshot = {
  url: string;
  title: string;
  /** Vom Nutzer markierter Text – hat Vorrang vor dem ganzen Seitentext */
  selection: string;
  /** Inhalt aller `<script type="application/ld+json">` */
  jsonLd: string[];
  /** Sichtbarer Text des Anzeigenbereichs, sonst des Hauptbereichs bzw. der ganzen Seite */
  text: string;
  /** Eckdaten aus bekannten Elementen der Jobbörse (siehe `SITE_SELECTORS`), soweit gefunden */
  hints?: PageHints;
  /** Ziele von Links wie „Jetzt bewerben“ (absolute http(s)-Adressen) */
  applyLinks?: string[];
  /** E-Mail-Adressen aus mailto-Links und dem Text der Anzeige */
  emails?: string[];
};

export type PageHints = { title?: string; company?: string; location?: string };

/**
 * Bekannte Bereiche großer Jobbörsen. Bei geteilten Ansichten (Trefferliste links, Anzeige rechts –
 * Indeed, LinkedIn) steht die Anzeige nur in einem Teil der Seite; ohne diese Auswahl landet die
 * ganze Trefferliste im Anzeigentext. Die Selektoren hängen am Aufbau fremder Seiten und können
 * veralten – dann greift wieder der Hauptbereich bzw. die KI.
 */
export const SITE_SELECTORS = {
  detail: [
    // Indeed: rechter Bereich der Suche, eigene Anzeigenseite
    '#jobsearch-ViewjobPaneWrapper',
    '.jobsearch-RightPane',
    '.jobsearch-ViewJobLayout-jobDisplay',
    '#viewJobSSRRoot',
    // LinkedIn: rechter Bereich der Jobsuche, eigene Anzeigenseite
    '.jobs-search__job-details--container',
    '.jobs-search__job-details',
    '.job-view-layout',
  ],
  /** Nur die Stellenbeschreibung innerhalb des Bereichs – ohne Kopf, Bewerben-Knopf, „Job melden“ */
  description: [
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '#job-details',
  ],
  title: [
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '.jobsearch-JobInfoHeader-title',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
  ],
  company: [
    '[data-testid="inlineHeader-companyName"]',
    '[data-company-name="true"]',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
  ],
  location: [
    '[data-testid="inlineHeader-companyLocation"]',
    '[data-testid="job-location"]',
    '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
  ],
};
export type SiteSelectors = typeof SITE_SELECTORS;

export type JobDraft = {
  company: string;
  role: string;
  location: string;
  workMode?: WorkMode;
  /** Jahresgehalt in Euro */
  salaryMin?: number;
  salaryMax?: number;
  source?: string;
  jobUrl: string;
  /** Text der Stellenanzeige – Grundlage für spätere KI-Funktionen (Lebenslauf zuschneiden) */
  jobDescription: string;
  contactName?: string;
  contactEmail?: string;
  /** Jobportal oder Firmenseite – auf der Firmenseite stehen meist Ansprechpartner und Bewerbungsweg */
  kind: SourceKind;
  applyEmail?: string;
  applyUrl?: string;
};

export type SourceKind = 'portal' | 'company';

/** Antwort der Edge Function `job-import` */
export type JobImport = AiResponse<'stellenanzeige'>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const text = (value: unknown) => (typeof value === 'string' ? decodeEntities(value).trim() : '');

function hasType(node: Json, type: string) {
  return asArray(node['@type']).some((t) => t === type || t === `http://schema.org/${type}`);
}

/** Erste `JobPosting` in den JSON-LD-Blöcken, auch verschachtelt in Arrays oder `@graph` */
export function findJobPosting(jsonLd: readonly string[]): Json | undefined {
  const queue: unknown[] = [];
  for (const block of jsonLd) {
    try {
      queue.push(JSON.parse(block));
    } catch {
      // Kaputtes JSON-LD kommt vor – ignorieren
    }
  }
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
    } else if (isObject(node)) {
      if (hasType(node, 'JobPosting')) return node;
      if (node['@graph']) queue.push(node['@graph']);
    }
  }
  return undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  ndash: '–',
  mdash: '—',
  bull: '•',
  middot: '·',
  hellip: '…',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  laquo: '«',
  raquo: '»',
};

export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/** HTML-Beschreibung aus JSON-LD als lesbarer Text mit Absätzen und Aufzählungspunkten */
export function htmlToText(html: string) {
  // Manche Seiten kodieren das HTML zusätzlich als Entities („&lt;p&gt;“)
  const source = /&lt;\/?[a-z]/i.test(html) && !/<\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  const plain = source
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|section|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(plain)
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n• \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function organizationName(value: unknown) {
  if (typeof value === 'string') return text(value);
  return isObject(value) ? text(value.name) : '';
}

function locations(posting: Json) {
  const names = asArray(posting.jobLocation).flatMap((place) => {
    if (!isObject(place)) return [];
    const address = place.address;
    if (typeof address === 'string') return [text(address)];
    if (isObject(address)) return [text(address.addressLocality) || text(address.addressRegion)];
    return [text(place.name)];
  });
  return [...new Set(names.filter(Boolean))].join(', ');
}

const SALARY_FACTORS: Record<string, number> = { YEAR: 1, MONTH: 12 };

/** Jahresgehalt in Euro aus `baseSalary`; Stunden- und Wochenlöhne und andere Währungen bleiben leer */
function salary(posting: Json): { min?: number; max?: number } {
  const base = posting.baseSalary;
  if (!isObject(base)) return {};
  const currency = text(base.currency).toUpperCase();
  if (currency && currency !== 'EUR') return {};
  const value = base.value;
  const amount = isObject(value) ? value : { value };
  const unit = text(amount.unitText || base.unitText).toUpperCase() || 'YEAR';
  const factor = SALARY_FACTORS[unit];
  if (!factor) return {};
  const number = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * factor) : undefined;
  };
  return { min: number(amount.minValue) ?? number(amount.value), max: number(amount.maxValue) };
}

/** Entwurf allein aus der `JobPosting` der Seite – ohne KI */
export function draftFromJobPosting(posting: Json, url: string): JobDraft {
  const location = locations(posting);
  const remote = asArray(posting.jobLocationType).some((t) => text(t).toUpperCase() === 'TELECOMMUTE');
  const { min, max } = salary(posting);
  return {
    company: organizationName(posting.hiringOrganization),
    role: text(posting.title),
    location,
    // Remote-Angebot mit festem Ort ist oft „hybrid“ oder „remote möglich“ – dann lieber offen lassen
    workMode: remote && !location ? 'remote' : undefined,
    salaryMin: min,
    salaryMax: max,
    source: sourceFromUrl(url),
    jobUrl: normalizeJobUrl(url),
    jobDescription: typeof posting.description === 'string' ? htmlToText(posting.description) : '',
    kind: sourceKind(url),
    applyEmail: isObject(posting.applicationContact) ? text(posting.applicationContact.email) || undefined : undefined,
  };
}

/** Indeed hängt an den Titel unsichtbaren Text für Screenreader an, z. B. „- job post“ */
function cleanTitle(title: string) {
  return title.replace(/\s*[-–]\s*(job post|stellenanzeige|stellenangebot)\s*$/i, '').trim();
}

/** Entwurf ohne strukturierte Daten: Eckdaten aus bekannten Elementen der Seite, sonst leer */
export function emptyDraft(snapshot: PageSnapshot): JobDraft {
  const hints = snapshot.hints ?? {};
  return {
    company: hints.company?.trim() ?? '',
    role: cleanTitle(hints.title ?? ''),
    location: hints.location?.trim() ?? '',
    source: sourceFromUrl(snapshot.url),
    jobUrl: normalizeJobUrl(snapshot.url),
    jobDescription: postingText(snapshot),
    kind: sourceKind(snapshot.url),
  };
}

/** Entwurf aus der Seite: mit `JobPosting`, sonst leer mit dem Anzeigentext */
export function draftFromPage(snapshot: PageSnapshot): { draft: JobDraft; structured: boolean } {
  const posting = findJobPosting(snapshot.jsonLd);
  const structured = !!posting;
  const draft = posting ? draftFromJobPosting(posting, snapshot.url) : emptyDraft(snapshot);
  if (posting && draft.jobDescription.length < MIN_POSTING_CHARS) {
    draft.jobDescription = postingText(snapshot);
  }
  // Bewerbungsweg: „Jetzt bewerben“-Link und Bewerbungs-E-Mail aus der Seite
  draft.applyUrl ??= snapshot.applyLinks?.find((link) => normalizeJobUrl(link) !== draft.jobUrl);
  draft.applyEmail ??= chooseApplyEmail(snapshot.emails ?? []);
  return { draft, structured };
}

/** Überschrift, nach der bei Jobbörsen die eigentliche Beschreibung beginnt */
const DESCRIPTION_START =
  /^(vollständige stellenbeschreibung|full job description|über den job|about the job|stellenbeschreibung im detail)$/i;

/** Bedienelemente und Kopfzeilen der Jobbörsen, die nicht zur Anzeige gehören */
const CHROME_LINE =
  /^(return to search results?|zurück zu den suchergebnissen|job post details|mit indeed bewerben|apply (now|with indeed)|jetzt bewerben|einfach bewerben|easy apply|diesen job melden|report (this )?job|informationen zur anzeigentransparenz|·|\d([.,]\d)?)$/i;

/**
 * Entfernt Kopf und Bedienelemente der Jobbörse aus dem gelesenen Text. Hängt an sichtbaren Texten
 * statt an Klassennamen, weil diese sich seltener ändern. Bleibt nach dem Schnitt zu wenig übrig,
 * gilt der ganze Text.
 */
export function stripBoardChrome(text: string) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => DESCRIPTION_START.test(line.trim()));
  const body = start >= 0 ? lines.slice(start + 1) : lines;
  const cleaned = body
    .filter((line) => !CHROME_LINE.test(line.trim()))
    .join('\n')
    .trim();
  return cleaned.length >= MIN_POSTING_CHARS ? cleaned : text;
}

/** Text der Anzeige: markierter Text, sonst der Seitentext – gekürzt auf die Grenze der Edge Function */
export function postingText(snapshot: PageSnapshot) {
  const selection = snapshot.selection.trim();
  const chosen =
    selection.length >= MIN_POSTING_CHARS ? selection : stripBoardChrome(snapshot.text.trim());
  return chosen
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n')
    .slice(0, MAX_POSTING_CHARS)
    .trim();
}

/** Reichen die Daten ohne KI? Firma, Rolle und ein Anzeigentext müssen da sein. */
export function isComplete(draft: JobDraft) {
  return !!draft.company && !!draft.role && draft.jobDescription.length >= MIN_POSTING_CHARS;
}

/** Ergänzt den Entwurf um das KI-Ergebnis; was schon da ist (z. B. aus JSON-LD), bleibt */
export function mergeJobImport(draft: JobDraft, job: JobImport): JobDraft {
  const salaryKnown = draft.salaryMin !== undefined || draft.salaryMax !== undefined;
  return {
    ...draft,
    company: draft.company || job.company.trim(),
    role: draft.role || job.role.trim(),
    location: draft.location || job.location.trim(),
    workMode: draft.workMode ?? job.workMode ?? undefined,
    salaryMin: salaryKnown ? draft.salaryMin : (job.salaryMin ?? undefined),
    salaryMax: salaryKnown ? draft.salaryMax : (job.salaryMax ?? undefined),
    contactName: draft.contactName ?? (job.contactName?.trim() || undefined),
    contactEmail: draft.contactEmail ?? (job.contactEmail?.trim() || undefined),
  };
}

/** Prüft die Antwort von `job-import`; wirft bei fehlenden Pflichtfeldern */
export function parseJobImport(data: unknown): JobImport {
  if (!isObject(data)) throw new Error('Antwort ohne Daten');
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const nullableStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const int = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
  if (typeof data.role !== 'string') throw new Error('Antwort ohne Rolle');
  return {
    company: str(data.company),
    role: data.role,
    location: str(data.location),
    workMode: (WORK_MODES as readonly unknown[]).includes(data.workMode)
      ? (data.workMode as WorkMode)
      : null,
    salaryMin: int(data.salaryMin),
    salaryMax: int(data.salaryMax),
    skills: Array.isArray(data.skills) ? data.skills.filter((s) => typeof s === 'string') : [],
    contactName: nullableStr(data.contactName),
    contactEmail: nullableStr(data.contactEmail),
    summary: str(data.summary),
  };
}

const KNOWN_SOURCES: [RegExp, string][] = [
  [/(^|\.)linkedin\./, 'LinkedIn'],
  [/(^|\.)stepstone\./, 'StepStone'],
  [/(^|\.)xing\./, 'XING'],
  [/(^|\.)indeed\./, 'Indeed'],
];

/** Quelle wie in den Vorschlägen der Apps (`SOURCE_SUGGESTIONS`), sonst der Seitenname */
export function sourceFromUrl(url: string): string | undefined {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    host = parsed.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
  return KNOWN_SOURCES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** Kalendertag (YYYY-MM-DD) in lokaler Zeit */
export function today(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Gehaltsfeld: leer → undefined, „65.000“/„65000“/„65k“ → 65000, sonst NaN */
export function parseSalary(value: string): number | undefined {
  const raw = value.trim().replace(/\s|€/g, '').toLowerCase();
  if (!raw) return undefined;
  const thousands = raw.endsWith('k');
  const digits = (thousands ? raw.slice(0, -1) : raw).replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(digits)) return Number.NaN;
  return Math.round(Number(digits) * (thousands ? 1000 : 1));
}

export type DraftErrors = Partial<Record<'company' | 'role' | 'salary', string>>;

export function validateDraft(draft: JobDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.company.trim()) errors.company = 'Bitte die Firma angeben.';
  if (!draft.role.trim()) errors.role = 'Bitte die Stelle angeben.';
  const { salaryMin: min, salaryMax: max } = draft;
  if ((min !== undefined && Number.isNaN(min)) || (max !== undefined && Number.isNaN(max))) {
    errors.salary = 'Bitte das Gehalt als Zahl angeben, z. B. 65000.';
  } else if (min !== undefined && max !== undefined && min > max) {
    errors.salary = 'Das Mindestgehalt ist höher als das Höchstgehalt.';
  }
  return errors;
}

const PORTAL_HOST =
  /(^|\.)(indeed|stepstone|linkedin|xing|monster|jobware|arbeitsagentur|glassdoor|kununu|stellenanzeigen|jobs|meinestadt|kimeta|jooble|absolventa|get-in-it|heise|stellenwerk)\./;

/** Jobportal oder Firmenseite – unbekannte Seiten gelten als Firmenseite */
export function sourceKind(url: string): SourceKind {
  try {
    return PORTAL_HOST.test(new URL(url).hostname.toLowerCase()) ? 'portal' : 'company';
  } catch {
    return 'portal';
  }
}

const APPLY_MAIL = /(bewerb|karriere|career|jobs?@|recruit|personal|hr@|talent)/i;

/** Bewerbungsadresse: nur E-Mails, die danach aussehen (keine info@, datenschutz@ o. Ä.) */
export function chooseApplyEmail(emails: readonly string[]): string | undefined {
  return emails.map((e) => e.trim().toLowerCase()).find((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && APPLY_MAIL.test(e));
}

/** Spalten für `job_postings` (Stellenangebot, noch keine Bewerbung); `user_id`, `id` setzt die Datenbank */
export function toPostingColumns(draft: JobDraft) {
  return {
    company: draft.company.trim(),
    role: draft.role.trim(),
    location: draft.location.trim(),
    work_mode: draft.workMode ?? null,
    source: draft.source?.trim() || null,
    job_url: draft.jobUrl || null,
    salary_min: draft.salaryMin ?? null,
    salary_max: draft.salaryMax ?? null,
    job_description: draft.jobDescription.trim() || null,
    contact_name: draft.contactName?.trim() || null,
    contact_email: draft.contactEmail?.trim() || null,
    apply_email: draft.applyEmail?.trim() || null,
    apply_url: draft.applyUrl || null,
  };
}

/** Spalten für `job_posting_sources` – die Datenbank leitet daraus die Eckdaten des Stellenangebots ab */
export function toSourceColumns(draft: JobDraft, postingId: string) {
  const { company, role, location, work_mode, source, job_url, salary_min, salary_max, job_description, contact_name, contact_email, apply_email, apply_url } =
    toPostingColumns(draft);
  return {
    posting_id: postingId,
    kind: draft.kind,
    source,
    url: job_url,
    company,
    role,
    location: location || null,
    work_mode,
    salary_min,
    salary_max,
    job_description,
    contact_name,
    contact_email,
    apply_email,
    apply_url,
  };
}

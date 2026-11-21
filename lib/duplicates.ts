
// Dublettenprüfung: Ist eine Stelle schon als Bewerbung erfasst? Geprüft wird gegen die nicht
// gelöschten Bewerbungen des Nutzers – über die Adresse der Anzeige, über Firma + Position und über
// Firma + sehr ähnlichen Anzeigentext (falls die Position umbenannt wurde). Kopie von
// `desktop-app/src/domain/duplicates.ts` (nur die Typen sind hier eigene); Änderungen in beiden
// nachziehen.

/** Status wie in `domain/application.ts` der Apps */
export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interview'
  | 'final'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

/** Was die Prüfung von einer vorhandenen Bewerbung braucht */
export type ExistingApplication = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: string;
  jobUrl?: string;
  jobDescription?: string;
};

/** Was von einer neuen Stelle bekannt ist */
export type DuplicateCandidate = {
  company: string;
  role: string;
  jobUrl?: string;
  jobDescription?: string;
};

export type DuplicateReason = 'url' | 'company-role' | 'company-description';

export type DuplicateMatch = {
  application: Pick<ExistingApplication, 'id' | 'company' | 'role' | 'status' | 'appliedAt'>;
  reason: DuplicateReason;
};

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  url: 'gleiche Anzeige (Adresse)',
  'company-role': 'gleiche Firma und Position',
  'company-description': 'gleiche Firma, fast gleicher Anzeigentext',
};

const TRACKING_PARAM = /^(utm_|trk|ref|refid|tracking|src$|source$|campaign|gclid|fbclid|mc_)/i;

/**
 * Feste Adresse einer Anzeige: ohne Sprungmarke, Tracking-Parameter und `www.`; bei Indeed und
 * LinkedIn die Anzeige statt der Such- bzw. Listenansicht. Ungültige Adressen bleiben, wie sie sind.
 */
export function normalizeJobUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  const host = parsed.hostname;
  if (/(^|\.)indeed\./.test(host)) {
    const id = parsed.searchParams.get('jk') ?? parsed.searchParams.get('vjk');
    if (id && /^[0-9a-f]+$/i.test(id)) return new URL(`/viewjob?jk=${id}`, parsed.origin).toString();
  }
  if (/(^|\.)linkedin\./.test(host)) {
    const id =
      parsed.searchParams.get('currentJobId') ??
      parsed.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
    if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  parsed.hash = '';
  // Erst sammeln, dann löschen – Löschen während des Durchlaufs überspränge Einträge
  const tracking = Array.from(parsed.searchParams.keys()).filter((key) => TRACKING_PARAM.test(key));
  for (const key of tracking) parsed.searchParams.delete(key);
  return parsed.toString();
}

/** Adresse für den Vergleich: zusätzlich ohne `www.`, Protokoll und abschließenden Schrägstrich */
function urlKey(url: string) {
  return normalizeJobUrl(url)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/(\?|$)/, '$1');
}

function fold(text: string) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

const LEGAL_FORMS =
  /\b(gmbh|mbh|ag|se|kg|kgaa|co|ug|ohg|gbr|ev|e\s?v|inc|ltd|llc|plc|holding|group|gruppe)\b/g;

/** „FLH Media Digital GmbH & Co. KG“ → „flh media digital“ */
export function companyKey(company: string) {
  return fold(company)
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_FORMS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** „Senior Software & App Engineer (m/w/d)“ → „senior software app engineer“ */
export function roleKey(role: string) {
  return fold(role)
    .replace(/\((?:[mwfdxi]\s*[/|,]\s*)+[mwfdxi]\)|\(all genders?\)|\(gn\)|\(m\/w\/d\)/g, ' ')
    .replace(/\b(m\s*\/\s*w\s*\/\s*d|w\s*\/\s*m\s*\/\s*d|all genders?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ähnlichkeit zweier Anzeigentexte (0–1): Anteil gemeinsamer Wortgruppen aus drei Wörtern */
export function textSimilarity(a: string, b: string) {
  const shingles = (text: string) => {
    const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 2 < words.length; i++) set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    return set;
  };
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const shingle of left) if (right.has(shingle)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Ab hier gilt ein Anzeigentext als „fast gleich“; kurze Texte werden nicht verglichen */
const SIMILAR_TEXT = 0.6;
const MIN_TEXT_CHARS = 200;

/**
 * Bewerbungen, die dieselbe Stelle sein dürften – sicherste Treffer zuerst, je Bewerbung nur der
 * stärkste Grund. `existing` sind die nicht gelöschten Bewerbungen; `ignoreId` die gerade
 * bearbeitete.
 */
export function findDuplicates(
  candidate: DuplicateCandidate,
  existing: readonly ExistingApplication[],
  ignoreId?: string,
): DuplicateMatch[] {
  const url = candidate.jobUrl?.trim() ? urlKey(candidate.jobUrl) : undefined;
  const company = companyKey(candidate.company);
  const role = roleKey(candidate.role);
  const text = candidate.jobDescription?.trim() ?? '';
  const order: DuplicateReason[] = ['url', 'company-role', 'company-description'];
  const matches: DuplicateMatch[] = [];

  for (const application of existing) {
    if (application.id === ignoreId) continue;
    let reason: DuplicateReason | undefined;
    if (url && application.jobUrl?.trim() && urlKey(application.jobUrl) === url) {
      reason = 'url';
    } else if (company && companyKey(application.company) === company) {
      if (role && roleKey(application.role) === role) {
        reason = 'company-role';
      } else if (
        text.length >= MIN_TEXT_CHARS &&
        (application.jobDescription?.length ?? 0) >= MIN_TEXT_CHARS &&
        textSimilarity(text, application.jobDescription!) >= SIMILAR_TEXT
      ) {
        reason = 'company-description';
      }
    }
    if (!reason) continue;
    const { id, company: c, role: r, status, appliedAt } = application;
    matches.push({ application: { id, company: c, role: r, status, appliedAt }, reason });
  }
  return matches.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));
}

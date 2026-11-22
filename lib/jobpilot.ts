import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import { browser } from 'wxt/browser';

import type { DuplicateTarget } from './duplicates';
import { parseJobImport, toPostingColumns, type JobDraft, type JobImport } from './job-posting';

// Zugriff auf die zentrale Supabase-Datenbank (backend/). Standard ist das gehostete Projekt `dev`;
// eine andere Instanz (z. B. die lokale) über WXT_SUPABASE_URL und WXT_SUPABASE_PUBLISHABLE_KEY in
// .env. Der Publishable Key ist öffentlich; er gibt nur frei, was RLS dem angemeldeten Nutzer erlaubt.
export const SUPABASE_URL = import.meta.env.WXT_SUPABASE_URL ?? 'https://mczpmqhbhvvqysgwdbgg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_F1D8l9dBkNsnanXX0PyOFw_ae5Paos5';

/** Sitzung im Speicher der Extension, damit sie das Schließen des Popups übersteht */
const storage = {
  getItem: async (key: string) => ((await browser.storage.local.get(key))[key] as string | undefined) ?? null,
  setItem: (key: string, value: string) => browser.storage.local.set({ [key]: value }),
  removeItem: (key: string) => browser.storage.local.remove(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return;
  if (error.code === 'invalid_credentials') throw new Error('E-Mail oder Passwort ist falsch.');
  if (error.code === 'email_not_confirmed') throw new Error('Bitte bestätige zuerst deine E-Mail-Adresse.');
  if (error.status === undefined || error.status === 0) {
    throw new Error('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
  }
  throw new Error('Die Anmeldung hat nicht geklappt. Bitte später noch einmal versuchen.');
}

const STATUS_LABELS: Record<string, string> = {
  saved: 'Gemerkt',
  applied: 'Beworben',
  screening: 'Screening',
  interview: 'Fachgespräch',
  final: 'Finale Runde',
  offer: 'Angebot',
  rejected: 'Abgesagt',
  withdrawn: 'Zurückgezogen',
};

/** Vorhandener Eintrag für die Dublettenprüfung, mit Anzeigetext wie „Bewerbung · Beworben“ */
export type ExistingEntry = DuplicateTarget & { label: string };

/**
 * Stellenangebote und nicht gelöschte Bewerbungen des Nutzers – dieselbe Stelle kann schon als das
 * eine oder das andere erfasst sein.
 */
export async function listExisting(): Promise<ExistingEntry[]> {
  const [postings, applications] = await Promise.all([
    supabase.from('job_postings').select('id, company, role, job_url, job_description, application_id, dismissed_at'),
    supabase
      .from('applications')
      .select('id, company, role, status, job_url, job_description')
      .is('archived_at', null),
  ]);
  if (postings.error || applications.error) throw new Error('Daten ließen sich nicht laden.');
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return [
    // Ist aus dem Stellenangebot schon eine Bewerbung geworden, reicht der Treffer bei der Bewerbung
    ...postings.data
      .filter((row) => !row.application_id)
      .map((row) => ({
        id: row.id as string,
        company: row.company as string,
        role: row.role as string,
        jobUrl: text(row.job_url),
        jobDescription: text(row.job_description),
        label: row.dismissed_at ? 'Stellenangebot · verworfen' : 'Stellenangebot',
      })),
    ...applications.data.map((row) => ({
      id: row.id as string,
      company: row.company as string,
      role: row.role as string,
      jobUrl: text(row.job_url),
      jobDescription: text(row.job_description),
      label: `Bewerbung · ${STATUS_LABELS[row.status as string] ?? row.status}`,
    })),
  ];
}

/** Speichert die Anzeige als Stellenangebot – noch keine Bewerbung (Tabelle `job_postings`) */
export async function saveJob(draft: JobDraft) {
  const { data, error } = await supabase
    .from('job_postings')
    .insert(toPostingColumns(draft))
    .select('id')
    .single();
  if (error) throw new Error('Das Stellenangebot ließ sich nicht speichern. Bitte noch einmal versuchen.');
  return data.id as string;
}

// Zustimmung zur KI-Nutzung – dieselbe Einstellung wie in den Apps (`settings`, Schlüssel ai.consent)
export async function hasAiConsent() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'ai.consent').maybeSingle();
  return data?.value === 'yes';
}

export async function giveAiConsent() {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'ai.consent', value: 'yes' }, { onConflict: 'user_id,key' });
  if (error) throw new Error('Die Zustimmung ließ sich nicht speichern.');
}

const AI_MESSAGES: Record<string, string> = {
  unauthorized: 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.',
  'missing-key':
    'Zum Auslesen per KI brauchst du einen eigenen KI-Key. Hinterlege ihn in einer jobpilot-App unter Einstellungen – oder fülle die Felder selbst aus.',
  'invalid-key': 'Dein KI-Key wurde abgelehnt. Bitte prüfe ihn in den Einstellungen einer jobpilot-App.',
  'bad-request': 'Auf dieser Seite ist zu wenig Text für eine Stellenanzeige. Markiere den Anzeigentext und versuche es erneut.',
  'too-large': 'Der Text ist zu lang. Markiere nur die Anzeige und versuche es erneut.',
  refused: 'Der KI-Dienst hat das Auslesen dieser Seite abgelehnt.',
  incomplete: 'Das Auslesen wurde nicht vollständig. Bitte noch einmal versuchen.',
  'ai-unavailable': 'Der KI-Dienst ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
  unavailable: 'Der Server ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
  offline: 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.',
  'invalid-response': 'Die Antwort war unvollständig. Bitte noch einmal versuchen.',
};

/** Liest die Eckdaten per Edge Function `job-import` (eigener KI-Key des Nutzers) */
export async function importJob(posting: string, url: string): Promise<JobImport> {
  const { data, error } = await supabase.functions.invoke<{ job: unknown }>('job-import', {
    body: { posting, url },
  });
  if (error) {
    let code = 'offline';
    if (error instanceof FunctionsHttpError) {
      const body = (await (error.context as Response).json().catch(() => null)) as { error?: string } | null;
      code = body?.error && body.error in AI_MESSAGES ? body.error : 'unavailable';
    }
    throw new Error(AI_MESSAGES[code]);
  }
  try {
    return parseJobImport(data?.job);
  } catch {
    throw new Error(AI_MESSAGES['invalid-response']);
  }
}

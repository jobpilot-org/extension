import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import { browser } from 'wxt/browser';

import { parseJobImport, toApplicationColumns, today, type JobDraft, type JobImport } from './job-posting';

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

export type SavedApplication = { id: string; company: string; role: string; status: string };

/** Schon gemerkte oder laufende Bewerbung zur selben Adresse (ohne gelöschte) */
export async function findByUrl(jobUrl: string): Promise<SavedApplication | undefined> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, company, role, status')
    .eq('job_url', jobUrl)
    .is('archived_at', null)
    .limit(1);
  if (error) throw new Error('Bewerbungen ließen sich nicht laden.');
  return data[0];
}

/** Legt die Bewerbung mit Status „Gemerkt“ an, dazu den Ansprechpartner aus der Anzeige */
export async function saveJob(draft: JobDraft) {
  const { data, error } = await supabase
    .from('applications')
    .insert(toApplicationColumns(draft, today()))
    .select('id')
    .single();
  if (error) throw new Error('Die Stelle ließ sich nicht speichern. Bitte noch einmal versuchen.');
  const contact = draft.contactName?.trim();
  if (contact) {
    // Ein fehlender Kontakt ist kein Grund, das Merken scheitern zu lassen
    await supabase
      .from('contacts')
      .insert({ application_id: data.id, name: contact, email: draft.contactEmail?.trim() || null });
  }
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

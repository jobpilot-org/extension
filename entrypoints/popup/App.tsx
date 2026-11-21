import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';

import {
  draftFromPage,
  isComplete,
  mergeJobImport,
  parseSalary,
  validateDraft,
  WORK_MODE_LABELS,
  WORK_MODES,
  type DraftErrors,
  type JobDraft,
  type JobImport,
  type WorkMode,
} from '@/lib/job-posting';
import {
  findByUrl,
  giveAiConsent,
  hasAiConsent,
  importJob,
  saveJob,
  signIn,
  supabase,
  type SavedApplication,
} from '@/lib/jobpilot';
import { readActiveTab } from '@/lib/page-reader';

const CONSENT_TEXT =
  'Zum Auslesen wird der Text dieser Seite an den jobpilot-Server gesendet und von dort mit deinem eigenen KI-Key an den KI-Anbieter (Anthropic) weitergeleitet. Gespeichert wird dabei nichts.';

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

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Etwas ist schiefgelaufen. Bitte noch einmal versuchen.';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <>
      <header className="popup-header">
        <img className="popup-icon" src="/icon/96.png" alt="" />
        <span className="jp-brand">
          jobpilot<span className="jp-brand__dot">.</span>
        </span>
      </header>
      {session === undefined ? null : session ? (
        <>
          <Capture />
          <footer className="popup-footer">
            <span>{session.user.email}</span>
            <button type="button" className="jp-link-button" onClick={() => void supabase.auth.signOut()}>
              Abmelden
            </button>
          </footer>
        </>
      ) : (
        <Login />
      )}
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }

  return (
    <form className="popup-body" onSubmit={(event) => void submit(event)}>
      <p className="jp-muted">Melde dich mit deinem jobpilot-Konto an, um Stellenanzeigen zu merken.</p>
      <Field label="E-Mail">
        <input
          className="jp-input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Passwort">
        <PasswordInput
          className="jp-input"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <p className="jp-error">{error}</p>}
      <button type="submit" className="jp-button" disabled={busy}>
        Anmelden
      </button>
      <p className="jp-muted popup-small">Noch kein Konto? Lege es in der jobpilot-Desktop-App an.</p>
    </form>
  );
}

/** Formularwerte als Text; Gehälter werden erst beim Speichern gelesen */
type Form = {
  company: string;
  role: string;
  location: string;
  workMode?: WorkMode;
  salaryMin: string;
  salaryMax: string;
  source: string;
  jobDescription: string;
};

const toForm = (draft: JobDraft): Form => ({
  company: draft.company,
  role: draft.role,
  location: draft.location,
  workMode: draft.workMode,
  salaryMin: draft.salaryMin?.toString() ?? '',
  salaryMax: draft.salaryMax?.toString() ?? '',
  source: draft.source ?? '',
  jobDescription: draft.jobDescription,
});

/** Formular zurück in den Entwurf; Adresse und Ansprechpartner kommen aus `base` */
const toDraft = (form: Form, base: JobDraft): JobDraft => ({
  ...base,
  company: form.company,
  role: form.role,
  location: form.location,
  workMode: form.workMode,
  salaryMin: parseSalary(form.salaryMin),
  salaryMax: parseSalary(form.salaryMax),
  source: form.source,
  jobDescription: form.jobDescription,
});

type Ai =
  | { kind: 'idle' }
  | { kind: 'consent' }
  | { kind: 'running' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; job: JobImport };

type Step =
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'form'; base: JobDraft; existing?: SavedApplication }
  | { kind: 'saved'; company: string; role: string };

/** Stelle aus dem aktiven Tab lesen, prüfen lassen und als Bewerbung „Gemerkt“ speichern */
function Capture() {
  const [step, setStep] = useState<Step>({ kind: 'reading' });
  const [form, setForm] = useState<Form>();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [ai, setAi] = useState<Ai>({ kind: 'idle' });
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { draft } = draftFromPage(await readActiveTab());
        const existing = await findByUrl(draft.jobUrl);
        if (!active) return;
        setForm(toForm(draft));
        setStep({ kind: 'form', base: draft, existing });
      } catch (e) {
        if (active) setStep({ kind: 'error', message: message(e) });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (step.kind === 'reading') {
    return (
      <div className="popup-body" role="status">
        <p className="jp-muted">Seite wird gelesen …</p>
      </div>
    );
  }
  if (step.kind === 'error') {
    return (
      <div className="popup-body">
        <p className="jp-error">{step.message}</p>
      </div>
    );
  }
  if (step.kind === 'saved') {
    return (
      <div className="popup-body">
        <div className="jp-callout">
          <p className="jp-eyebrow">Gemerkt ✓</p>
          <p>
            <strong>{step.company}</strong> · {step.role}
          </p>
        </div>
        <p className="jp-muted">Die Stelle steht jetzt in allen jobpilot-Apps unter „Gemerkt“.</p>
        <button type="button" className="jp-button" onClick={() => window.close()}>
          Schließen
        </button>
      </div>
    );
  }
  if (!form) return null;

  const { base, existing } = step;
  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const complete = isComplete(toDraft(form, base));

  async function runAi(current: Form) {
    setAi({ kind: 'running' });
    try {
      const job = await importJob(current.jobDescription, base.jobUrl);
      // Felder, die der Nutzer schon ausgefüllt hat, bleiben
      setForm((latest) => toForm(mergeJobImport(toDraft(latest ?? current, base), job)));
      setAi({ kind: 'done', job });
    } catch (e) {
      setAi({ kind: 'error', message: message(e) });
    }
  }

  async function startAi() {
    if (await hasAiConsent()) return runAi(form!);
    setAi({ kind: 'consent' });
  }

  async function acceptConsent() {
    try {
      await giveAiConsent();
      await runAi(form!);
    } catch (e) {
      setAi({ kind: 'error', message: message(e) });
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const draft = toDraft(form!, base);
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      // Ansprechpartner nennt nur die KI; das Formular zeigt ihn nicht
      const contact = ai.kind === 'done' ? mergeJobImport(base, ai.job) : base;
      await saveJob({ ...draft, contactName: contact.contactName, contactEmail: contact.contactEmail });
      setStep({ kind: 'saved', company: draft.company.trim(), role: draft.role.trim() });
    } catch (e) {
      setSaveError(message(e));
      setSaving(false);
    }
  }

  if (existing && !showDuplicate) {
    return (
      <div className="popup-body">
        <div className="jp-callout">
          <p className="jp-eyebrow">Schon in jobpilot</p>
          <p>
            <strong>{existing.company}</strong> · {existing.role}
          </p>
          <p className="popup-small">Status: {STATUS_LABELS[existing.status] ?? existing.status}</p>
        </div>
        <button
          type="button"
          className="jp-button jp-button--secondary"
          onClick={() => setShowDuplicate(true)}
        >
          Trotzdem neu merken
        </button>
      </div>
    );
  }

  return (
    <form className="popup-body" onSubmit={(event) => void save(event)} noValidate>
      {complete && ai.kind === 'idle' && (
        <p className="jp-muted popup-small">
          Aus den Daten der Seite übernommen – ohne KI. Bitte kurz prüfen.
        </p>
      )}
      {!complete && ai.kind === 'idle' && (
        <div className="jp-callout">
          <p>
            Die Seite liefert nicht alle Eckdaten. Lass sie per KI auslesen oder fülle die Felder
            selbst aus.
          </p>
          <p className="popup-small">Tipp: Markierst du vorher den Anzeigentext, liest die KI nur diesen.</p>
          <button type="button" className="jp-button jp-button--compact" onClick={() => void startAi()}>
            Mit KI auslesen
          </button>
        </div>
      )}
      {ai.kind === 'consent' && (
        <div className="jp-callout">
          <p className="popup-small">{CONSENT_TEXT}</p>
          <div className="jp-form-actions">
            <button
              type="button"
              className="jp-button jp-button--compact jp-button--secondary"
              onClick={() => setAi({ kind: 'idle' })}
            >
              Abbrechen
            </button>
            <button type="button" className="jp-button jp-button--compact" onClick={() => void acceptConsent()}>
              Einverstanden
            </button>
          </div>
        </div>
      )}
      {ai.kind === 'running' && (
        <p className="jp-muted" role="status">
          Die KI liest die Anzeige …
        </p>
      )}
      {ai.kind === 'error' && (
        <div className="jp-callout">
          <p className="jp-error popup-small">{ai.message}</p>
          <button
            type="button"
            className="jp-button jp-button--compact jp-button--secondary"
            onClick={() => void startAi()}
          >
            Erneut versuchen
          </button>
        </div>
      )}
      {ai.kind === 'done' && ai.job.summary && (
        <div className="jp-callout">
          <p className="jp-eyebrow">Worum es geht</p>
          <p className="popup-small">{ai.job.summary}</p>
          {ai.job.skills.length > 0 && <p className="popup-small">{ai.job.skills.join(' · ')}</p>}
        </div>
      )}

      <Field label="Firma" error={errors.company}>
        <input className="jp-input" value={form.company} onChange={(e) => update({ company: e.target.value })} />
      </Field>
      <Field label="Stelle" error={errors.role}>
        <input className="jp-input" value={form.role} onChange={(e) => update({ role: e.target.value })} />
      </Field>
      <Field label="Ort">
        <input className="jp-input" value={form.location} onChange={(e) => update({ location: e.target.value })} />
      </Field>
      <div className="jp-field">
        <span className="jp-field__label">Arbeitsmodell</span>
        <div className="jp-segmented" role="group" aria-label="Arbeitsmodell">
          {WORK_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`jp-segmented__option${form.workMode === mode ? ' is-selected' : ''}`}
              aria-pressed={form.workMode === mode}
              onClick={() => update({ workMode: form.workMode === mode ? undefined : mode })}
            >
              {WORK_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
      <div className="jp-form-row">
        <Field label="Gehalt von (€/Jahr)" error={errors.salary}>
          <input
            className="jp-input"
            inputMode="numeric"
            value={form.salaryMin}
            onChange={(e) => update({ salaryMin: e.target.value })}
          />
        </Field>
        <Field label="bis">
          <input
            className="jp-input"
            inputMode="numeric"
            value={form.salaryMax}
            onChange={(e) => update({ salaryMax: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Quelle">
        <input className="jp-input" value={form.source} onChange={(e) => update({ source: e.target.value })} />
      </Field>
      <Field label="Anzeigentext">
        <textarea
          className="jp-input"
          rows={5}
          value={form.jobDescription}
          onChange={(e) => update({ jobDescription: e.target.value })}
        />
      </Field>
      {saveError && <p className="jp-error">{saveError}</p>}
      <button type="submit" className="jp-button" disabled={saving || ai.kind === 'running'}>
        Stelle merken
      </button>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="jp-field">
      <span className="jp-field__label">{label}</span>
      {children}
      {error && <span className="jp-field__message">{error}</span>}
    </label>
  );
}

/** Passwortfeld mit Augen-Symbol wie in der desktop-app (`src/renderer/ui.tsx`) */
function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Passwort verbergen' : 'Passwort anzeigen';
  return (
    <span className="password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        onClick={() => setVisible((current) => !current)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}

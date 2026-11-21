import { browser } from 'wxt/browser';

import type { PageSnapshot } from './job-posting';

/**
 * Läuft per `scripting.executeScript` in der geöffneten Seite – muss deshalb ohne Importe und
 * äußere Variablen auskommen. Liest nur, schreibt nichts.
 */
function readPage(): PageSnapshot {
  const visible = (element: Element | null) =>
    element instanceof HTMLElement ? element.innerText.trim() : '';
  // Hauptbereich ohne Navigation und Fußzeile, wenn die Seite einen sinnvollen hat
  const main = visible(document.querySelector('main, [role="main"], article'));
  const text = main.length >= 500 ? main : visible(document.body);
  return {
    url: location.href,
    title: document.title,
    selection: String(window.getSelection() ?? ''),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'), (script) =>
      (script.textContent ?? '').slice(0, 200_000),
    ),
    text: text.slice(0, 50_000),
  };
}

export class PageReadError extends Error {}

/** Liest die Seite im aktiven Tab. Dank `activeTab` nur nach Klick auf die Extension erlaubt. */
export async function readActiveTab(): Promise<PageSnapshot> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new PageReadError('Diese Seite kann jobpilot nicht lesen. Öffne eine Stellenanzeige im Web.');
  }
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    const snapshot = result?.result as PageSnapshot | undefined;
    if (!snapshot) throw new Error('leer');
    return snapshot;
  } catch {
    // z. B. Chrome Web Store, PDF-Ansicht oder vom Browser gesperrte Seiten
    throw new PageReadError('Diese Seite lässt sich nicht auslesen. Lade sie neu und versuche es noch einmal.');
  }
}

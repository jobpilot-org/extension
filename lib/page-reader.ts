import { browser } from 'wxt/browser';

import { SITE_SELECTORS, type PageSnapshot, type SiteSelectors } from './job-posting';

/**
 * Läuft per `scripting.executeScript` in der geöffneten Seite – muss deshalb ohne Importe und
 * äußere Variablen auskommen; die Selektoren kommen als Argument. Liest nur, schreibt nichts.
 */
export function readPage(selectors: SiteSelectors): PageSnapshot {
  const visible = (element: Element | null) =>
    element instanceof HTMLElement ? element.innerText.trim() : '';
  const first = (root: ParentNode, list: string[]) => {
    for (const selector of list) {
      const text = visible(root.querySelector(selector));
      if (text) return text.split('\n')[0]!.trim();
    }
    return undefined;
  };
  // Anzeigenbereich bekannter Jobbörsen, sonst Hauptbereich ohne Navigation und Fußzeile
  let region: Element | null = null;
  for (const selector of selectors.detail) {
    const element = document.querySelector(selector);
    if (visible(element).length >= 200) {
      region = element;
      break;
    }
  }
  const root = region ?? document;
  // Innerhalb des Bereichs nur die Beschreibung, wenn die Börse sie gesondert auszeichnet
  let description = '';
  for (const selector of selectors.description) {
    const text = visible(root.querySelector(selector));
    if (text.length >= 200) {
      description = text;
      break;
    }
  }
  const main = visible(document.querySelector('main, [role="main"], article'));
  const text =
    description || (region ? visible(region) : main.length >= 500 ? main : visible(document.body));
  return {
    url: location.href,
    title: document.title,
    selection: String(window.getSelection() ?? ''),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'), (script) =>
      (script.textContent ?? '').slice(0, 200_000),
    ),
    text: text.slice(0, 50_000),
    hints: {
      title: first(root, selectors.title),
      company: first(root, selectors.company),
      location: first(root, selectors.location),
    },
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
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
      args: [SITE_SELECTORS],
    });
    const snapshot = result?.result as PageSnapshot | undefined;
    if (!snapshot) throw new Error('leer');
    return snapshot;
  } catch {
    // z. B. Chrome Web Store, PDF-Ansicht oder vom Browser gesperrte Seiten
    throw new PageReadError('Diese Seite lässt sich nicht auslesen. Lade sie neu und versuche es noch einmal.');
  }
}

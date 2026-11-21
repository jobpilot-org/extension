import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'jobpilot',
    description: 'Stellenanzeigen mit einem Klick in jobpilot merken',
    // Bewusst ohne Host-Berechtigungen: Die Extension liest eine Seite nur, nachdem man auf ihr
    // Symbol geklickt hat (activeTab + scripting). storage hält die Anmeldung.
    permissions: ['activeTab', 'scripting', 'storage'],
  },
});

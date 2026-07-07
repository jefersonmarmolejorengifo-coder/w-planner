// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// El sitio de marketing (público, estático) de Productivity-Plus.
// `site` fija el dominio canónico para canonical y sitemap.
// La app React (privada, CSR) se sirve aparte bajo /app.
export default defineConfig({
  site: 'https://productivityplus.softatumedida.com',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: {
    // Inlinar CSS pequeño reduce requests y mejora LCP; el resto va a archivos.
    inlineStylesheets: 'auto',
  },
});

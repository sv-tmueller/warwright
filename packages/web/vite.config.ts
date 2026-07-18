import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only same-origin proxy (see the sub-plan on issue #59): the
    // client uses RELATIVE URLs (api-client.ts never hardcodes a base
    // URL), so the browser sees every request as same-origin with the
    // Vite dev server. That makes cookie sessions (sameSite: lax) and the
    // csrf-token header just work with zero server-side CORS change.
    // Production assumes the server serves packages/web/dist (or a
    // reverse proxy fronts both) so this same-origin assumption holds
    // there too.
    proxy: {
      '/auth': SERVER_ORIGIN,
      '/warbands': SERVER_ORIGIN,
      '/queue': SERVER_ORIGIN,
    },
  },
});

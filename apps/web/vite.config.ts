import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy only the API routes so Vite internals (/@vite, etc) keep working.
const apiTargets = [
  '/health',
  '/stats',
  '/games',
  '/lobbies',
  '/agents',
  '/payouts'
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      apiTargets.map((path) => [
        path,
        {
          target: process.env.VITE_PROXY_API_TARGET ?? 'http://localhost:3001',
          changeOrigin: true
        }
      ])
    )
  }
});

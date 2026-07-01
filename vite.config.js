import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ocpn-studio/' : '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: { 'process.env': {} },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      // Disable strict mode to allow serving linked packages outside project root
      strict: false,
    },
  },
  optimizeDeps: {
    exclude: ['@rwth-pads/cpnsim'],
  },
}));

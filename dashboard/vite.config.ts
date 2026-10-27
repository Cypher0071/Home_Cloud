import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
      '/terminal': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/,
            },
            {
              name: 'vendor-lucide',
              test: /node_modules[\\/]lucide-react[\\/]/,
            },
            {
              name: 'vendor-xterm',
              test: /node_modules[\\/]@xterm[\\/]/,
            },
            {
              name: 'vendor-yaml',
              test: /node_modules[\\/]js-yaml[\\/]/,
            },
            {
              name: 'vendor-prism',
              test: /node_modules[\\/]prism-react-renderer[\\/]/,
            },
            {
              name: 'vendor-axios',
              test: /node_modules[\\/]axios[\\/]/,
            },
          ],
        },
      },
    },
  },
})

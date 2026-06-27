import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Rolldown (bundler nativo de Vite 8) expone advancedChunks como reemplazo
    // de manualChunks (deprecated en Rolldown). Usamos rolldownOptions.output
    // para fijar vendor chunks cacheables independientes del hash del index.
    //
    // API: build.rolldownOptions.output.advancedChunks.groups[]
    //   name     – nombre base del chunk resultante (ej. "vendor-react-*.js")
    //   test     – regex contra el módulo ID; primer match gana (orden de grupos)
    //   priority – desempate cuando un módulo cumple varios grupos (mayor = antes)
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              // React y react-dom cambian muy poco entre deploys → cache larga.
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react[\\/]jsx-runtime)/,
              priority: 20,
            },
            {
              // @supabase/supabase-js ya era separado automáticamente; lo fijamos
              // explícito para garantizar nombre estable y evitar que un refactor
              // de Rolldown lo reabsorba en el index.
              name: 'vendor-supabase',
              test: /node_modules[\\/]@supabase/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})

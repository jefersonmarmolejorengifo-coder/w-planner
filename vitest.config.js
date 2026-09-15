import { defineConfig } from 'vite';

// Config de test SEPARADA de vite.config.js. Por qué no reusar ese archivo:
// @vitejs/plugin-react 6.x (el que usa este repo) configura el JSX a través
// de hooks `oxc.*`, propios del bundler Rolldown que trae Vite 8 por defecto.
// vitest 3.2.6 (declara "vite": "^5 || ^6 || ^7.0.0-0" como dependencia, así
// que resuelve SU PROPIA copia de Vite clásico basado en esbuild) no entiende
// esos hooks `oxc`, así que el plugin no hace nada bajo vitest y el JSX cae al
// runtime clásico (`React.createElement` sin `React` importado → "React is
// not defined"). La solución NO es tocar vite.config.js (rompería el build de
// producción con Rolldown): basta con decirle al esbuild interno de vitest
// que use el runtime automático, igual que hace Vite en el build real.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    // 15s en vez del default (5s): con la suite completa en paralelo
    // (369 pruebas, varios workers) los ciclos fireEvent+act+waitFor de
    // AuthScreen.test.jsx (jsdom + React real) compiten por CPU y a veces
    // superan 5s sin que haya ningún bug real (medido: 100ms en aislado,
    // hasta 3.2s bajo contención). Subir el timeout evita falsos negativos
    // por carga de máquina, no tapa una aserción débil.
    testTimeout: 15000,
  },
});

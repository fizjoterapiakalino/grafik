import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    // Ustawienie bazy dla GitHub Pages (nazwa repozytorium)
    base: '/grafik/',

    // Katalog główny projektu
    root: '.',

    // Katalog publiczny (statyczne assety)
    publicDir: 'public',

    // Konfiguracja serwera deweloperskiego
    server: {
        port: 3000,
        open: true,
        cors: true,
    },

    // Konfiguracja budowania
    build: {
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
        },
    },

    // Aliasy ścieżek (muszą być zsynchronizowane z tsconfig.json)
    resolve: {
        alias: {
            '@': resolve(__dirname, 'scripts'),
            '@styles': resolve(__dirname, 'styles'),
            '@pages': resolve(__dirname, 'pages'),
        },
    },
});

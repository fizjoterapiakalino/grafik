import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    // Ustawienie bazy dla GitHub Pages (nazwa repozytorium)
    base: '/grafik/',

    // Katalog główny projektu
    root: '.',

    // Katalog publiczny (statyczne assety)
    publicDir: 'public',

    // Pluginy
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    src: 'pages/*',
                    dest: 'pages',
                },
                {
                    src: 'styles/*',
                    dest: 'styles',
                },
                {
                    src: 'logo.png',
                    dest: '.',
                },
            ],
        }),

        // PWA Configuration
        VitePWA({
            registerType: 'prompt',
            includeAssets: [
                'logo.png',
                'icons/apple-touch-icon.png',
            ],
            manifest: {
                name: 'Grafik - Fizjoterapia Kalinowa',
                short_name: 'Grafik',
                description: 'System zarządzania grafikiem, stanowiskami i urlopami fizjoterapii',
                theme_color: '#0d9488',
                background_color: '#f1f5f9',
                display: 'standalone',
                orientation: 'any',
                scope: '/grafik/',
                start_url: '/grafik/',
                categories: ['medical', 'productivity', 'business'],
                icons: [
                    {
                        src: 'icons/icon-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-maskable-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                // Cache all static assets
                globPatterns: [
                    '**/*.{js,css,html,ico,png,svg,woff,woff2}',
                ],
                // Runtime caching for external resources
                runtimeCaching: [
                    {
                        // Google Fonts stylesheets
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-stylesheets',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                            },
                        },
                    },
                    {
                        // Google Fonts font files
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-webfonts',
                            expiration: {
                                maxEntries: 30,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                            },
                        },
                    },
                    {
                        // Font Awesome CDN
                        urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'font-awesome-cdn',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                            },
                        },
                    },
                    {
                        // pdfmake & Chart.js CDN
                        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'jsdelivr-cdn',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                            },
                        },
                    },
                    {
                        // pdfmake from cdnjs
                        urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfmake\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'pdfmake-cdn',
                            expiration: {
                                maxEntries: 5,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                            },
                        },
                    },
                ],
                // Don't precache Firebase SDK - it handles its own offline support
                navigateFallback: 'index.html',
                navigateFallbackAllowlist: [/^\/grafik\//],
            },
            devOptions: {
                enabled: false, // Disable SW in development to avoid cache issues
            },
        }),
    ],

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

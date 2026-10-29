import globals from 'globals';
import pluginJs from '@eslint/js';

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'WebScrapper/**', 'tests/__build__/**'],
    },
    pluginJs.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
                pdfMake: 'readonly',
            },
            sourceType: 'module',
            ecmaVersion: 2021,
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-undef': 'error',
        },
    },
];

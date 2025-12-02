const globals = require('globals');
const pluginJs = require('@eslint/js');
const eslintPluginPrettier = require('eslint-plugin-prettier/recommended');

module.exports = [
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
            },
            sourceType: 'module',
            ecmaVersion: 2021,
        },
    },
    pluginJs.configs.recommended,
    eslintPluginPrettier,
    {
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-undef': 'off',
        },
    },
];

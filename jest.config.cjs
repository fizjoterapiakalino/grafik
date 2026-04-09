module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/tests'],
    moduleNameMapper: {
        '^\\.\\./scripts/(.*)\\.js$': '<rootDir>/tests/__build__/scripts/$1.js',
    },
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
};

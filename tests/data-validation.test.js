// tests/data-validation.test.js
/**
 * @jest-environment jsdom
 */

import {
    isValidDate,
    isValidBoolean,
    validateCellContent,
    validateTreatmentData,
    validateCellState,
    sanitizeCellState,
    sanitizeTreatmentData,
    ALLOWED_CELL_KEYS,
    ALLOWED_TREATMENT_KEYS,
} from '../scripts/data-validation.js';

describe('data-validation', () => {
    describe('isValidDate', () => {
        test('returns true for valid date format', () => {
            expect(isValidDate('2024-01-15')).toBe(true);
            expect(isValidDate('2024-12-31')).toBe(true);
            expect(isValidDate('2000-01-01')).toBe(true);
        });

        test('returns false for invalid date format', () => {
            expect(isValidDate('15-01-2024')).toBe(false);
            expect(isValidDate('2024/01/15')).toBe(false);
            expect(isValidDate('2024-1-15')).toBe(false);
            expect(isValidDate('January 15, 2024')).toBe(false);
        });

        test('returns false for null/undefined/empty', () => {
            expect(isValidDate(null)).toBe(false);
            expect(isValidDate(undefined)).toBe(false);
            expect(isValidDate('')).toBe(false);
        });

        test('returns false for non-string values', () => {
            expect(isValidDate(20240115)).toBe(false);
            expect(isValidDate(new Date())).toBe(false);
        });

        test('returns false for invalid dates', () => {
            expect(isValidDate('2024-13-01')).toBe(false); // Invalid month
            expect(isValidDate('2024-02-30')).toBe(false); // Invalid day
        });
    });

    describe('isValidBoolean', () => {
        test('returns true for boolean values', () => {
            expect(isValidBoolean(true)).toBe(true);
            expect(isValidBoolean(false)).toBe(true);
        });

        test('returns true for null/undefined', () => {
            expect(isValidBoolean(null)).toBe(true);
            expect(isValidBoolean(undefined)).toBe(true);
        });

        test('returns false for non-boolean values', () => {
            expect(isValidBoolean('true')).toBe(false);
            expect(isValidBoolean(1)).toBe(false);
            expect(isValidBoolean(0)).toBe(false);
        });
    });

    describe('validateCellContent', () => {
        test('returns valid for normal text', () => {
            expect(validateCellContent('Kowalski').valid).toBe(true);
            expect(validateCellContent('Jan Nowak').valid).toBe(true);
            expect(validateCellContent('Müller').valid).toBe(true);
        });

        test('returns valid for empty/null/undefined', () => {
            expect(validateCellContent('').valid).toBe(true);
            expect(validateCellContent(null).valid).toBe(true);
            expect(validateCellContent(undefined).valid).toBe(true);
        });

        test('returns invalid for too long content', () => {
            const longText = 'A'.repeat(51);
            const result = validateCellContent(longText);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('50 znaków');
        });

        test('returns invalid for XSS attempts', () => {
            expect(validateCellContent('<script>alert(1)</script>').valid).toBe(false);
            expect(validateCellContent('javascript:alert(1)').valid).toBe(false);
            expect(validateCellContent('<img onerror=alert(1)>').valid).toBe(false);
        });

        test('returns invalid for non-string values', () => {
            const result = validateCellContent(123);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('tekstem');
        });
    });

    describe('validateTreatmentData', () => {
        test('returns valid for correct treatment data', () => {
            const data = {
                startDate: '2024-01-01',
                endDate: '2024-01-15',
                extensionDays: 5,
                additionalInfo: 'Test note',
            };
            expect(validateTreatmentData(data).valid).toBe(true);
        });

        test('returns valid for null/undefined', () => {
            expect(validateTreatmentData(null).valid).toBe(true);
            expect(validateTreatmentData(undefined).valid).toBe(true);
        });

        test('returns invalid for unknown keys', () => {
            const data = { startDate: '2024-01-01', unknownKey: 'value' };
            const result = validateTreatmentData(data);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('unknownKey');
        });

        test('returns invalid for invalid date format', () => {
            const data = { startDate: 'invalid-date' };
            const result = validateTreatmentData(data);
            expect(result.valid).toBe(false);
        });

        test('returns invalid for extension days out of range', () => {
            expect(validateTreatmentData({ extensionDays: -1 }).valid).toBe(false);
            expect(validateTreatmentData({ extensionDays: 400 }).valid).toBe(false);
        });

        test('returns valid for extension days in range', () => {
            expect(validateTreatmentData({ extensionDays: 0 }).valid).toBe(true);
            expect(validateTreatmentData({ extensionDays: 365 }).valid).toBe(true);
        });
    });

    describe('validateCellState', () => {
        test('returns valid for minimal cell state', () => {
            const cellState = { content: 'Test' };
            expect(validateCellState(cellState).valid).toBe(true);
        });

        test('returns valid for complete cell state', () => {
            const cellState = {
                content: 'Kowalski',
                isMassage: true,
                isPnf: false,
                treatmentStartDate: '2024-01-01',
                treatmentEndDate: '2024-01-15',
                treatmentExtensionDays: 5,
            };
            expect(validateCellState(cellState).valid).toBe(true);
        });

        test('returns valid for split cell state', () => {
            const cellState = {
                isSplit: true,
                content1: 'Kowalski',
                content2: 'Nowak',
            };
            expect(validateCellState(cellState).valid).toBe(true);
        });

        test('returns invalid for unknown keys', () => {
            const cellState = { content: 'Test', unknownField: 'value' };
            const result = validateCellState(cellState);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes('unknownField'))).toBe(true);
        });

        test('returns invalid for non-boolean flags', () => {
            const cellState = { content: 'Test', isMassage: 'yes' };
            const result = validateCellState(cellState);
            expect(result.valid).toBe(false);
        });

        test('returns invalid for non-object input', () => {
            expect(validateCellState(null).valid).toBe(false);
            expect(validateCellState('string').valid).toBe(false);
        });

        test('returns warning for split cell with content', () => {
            const cellState = {
                isSplit: true,
                content: 'Should be empty',
                content1: 'Part1',
            };
            const result = validateCellState(cellState);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes('content'))).toBe(true);
        });
    });

    describe('sanitizeCellState', () => {
        test('removes unknown keys', () => {
            const cellState = {
                content: 'Test',
                unknownKey: 'value',
                anotherUnknown: 123,
            };
            const result = sanitizeCellState(cellState);

            expect(result.content).toBe('Test');
            expect(result.unknownKey).toBeUndefined();
            expect(result.anotherUnknown).toBeUndefined();
        });

        test('preserves allowed keys', () => {
            const cellState = {
                content: 'Test',
                isMassage: true,
                treatmentStartDate: '2024-01-01',
            };
            const result = sanitizeCellState(cellState);

            expect(result.content).toBe('Test');
            expect(result.isMassage).toBe(true);
            expect(result.treatmentStartDate).toBe('2024-01-01');
        });

        test('sanitizes nested treatmentData', () => {
            const cellState = {
                content: 'Test',
                treatmentData1: {
                    startDate: '2024-01-01',
                    unknownNested: 'value',
                },
            };
            const result = sanitizeCellState(cellState);

            expect(result.treatmentData1.startDate).toBe('2024-01-01');
            expect(result.treatmentData1.unknownNested).toBeUndefined();
        });

        test('limits history array to 10 entries', () => {
            const cellState = {
                content: 'Test',
                history: Array(20)
                    .fill(null)
                    .map((_, i) => ({ oldValue: `Entry ${i}` })),
            };
            const result = sanitizeCellState(cellState);

            expect(result.history.length).toBe(10);
        });

        test('returns empty object for null/undefined', () => {
            expect(sanitizeCellState(null)).toEqual({});
            expect(sanitizeCellState(undefined)).toEqual({});
        });
    });

    describe('sanitizeTreatmentData', () => {
        test('removes unknown keys', () => {
            const data = {
                startDate: '2024-01-01',
                unknownKey: 'value',
            };
            const result = sanitizeTreatmentData(data);

            expect(result.startDate).toBe('2024-01-01');
            expect(result.unknownKey).toBeUndefined();
        });

        test('returns null for empty object after sanitization', () => {
            const data = { unknownKey: 'value' };
            const result = sanitizeTreatmentData(data);
            expect(result).toBeNull();
        });

        test('returns null for null/undefined input', () => {
            expect(sanitizeTreatmentData(null)).toBeNull();
            expect(sanitizeTreatmentData(undefined)).toBeNull();
        });
    });

    describe('ALLOWED_CELL_KEYS', () => {
        test('contains expected keys', () => {
            expect(ALLOWED_CELL_KEYS).toContain('content');
            expect(ALLOWED_CELL_KEYS).toContain('isSplit');
            expect(ALLOWED_CELL_KEYS).toContain('isMassage');
            expect(ALLOWED_CELL_KEYS).toContain('treatmentStartDate');
            expect(ALLOWED_CELL_KEYS).toContain('history');
        });
    });

    describe('ALLOWED_TREATMENT_KEYS', () => {
        test('contains expected keys', () => {
            expect(ALLOWED_TREATMENT_KEYS).toContain('startDate');
            expect(ALLOWED_TREATMENT_KEYS).toContain('endDate');
            expect(ALLOWED_TREATMENT_KEYS).toContain('extensionDays');
            expect(ALLOWED_TREATMENT_KEYS).toContain('additionalInfo');
        });
    });
});

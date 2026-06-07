import {
    clearCellContentKeys,
    copyTreatmentData,
    deepClone,
    escapeHTML,
    formatDatePL,
    isWorkday,
    safeBool,
    safeCopy,
    toDateString,
    toUTCDate,
} from '../scripts/utils.js';

describe('utils', () => {
    test('safeCopy converts undefined to null and preserves other values', () => {
        expect(safeCopy(undefined)).toBeNull();
        expect(safeCopy(null)).toBeNull();
        expect(safeCopy('value')).toBe('value');
        expect(safeCopy(0)).toBe(0);
    });

    test('safeBool treats undefined as false and coerces other values', () => {
        expect(safeBool(undefined)).toBe(false);
        expect(safeBool(null)).toBe(false);
        expect(safeBool('yes')).toBe(true);
        expect(safeBool(0)).toBe(false);
    });

    test('deepClone returns independent nested objects', () => {
        const source = { nested: { value: 1 } };
        const clone = deepClone(source);

        clone.nested.value = 2;

        expect(source.nested.value).toBe(1);
        expect(clone.nested.value).toBe(2);
    });

    test('clearCellContentKeys nulls all schedule content fields but keeps unrelated data', () => {
        const state = {
            content: 'Pacjent',
            isMassage: true,
            treatmentData1: { startDate: '2026-01-02' },
            untouched: 'keep',
        };

        clearCellContentKeys(state);

        expect(state.content).toBeNull();
        expect(state.isMassage).toBeNull();
        expect(state.treatmentData1).toBeNull();
        expect(state.untouched).toBe('keep');
    });

    test('copyTreatmentData copies normal treatment fields without undefined values', () => {
        const target = {};

        copyTreatmentData(
            {
                treatmentStartDate: '2026-01-02',
                treatmentExtensionDays: undefined,
                treatmentEndDate: '2026-01-20',
                additionalInfo: 'Notatka',
            },
            target
        );

        expect(target).toEqual({
            treatmentStartDate: '2026-01-02',
            treatmentExtensionDays: null,
            treatmentEndDate: '2026-01-20',
            additionalInfo: 'Notatka',
        });
    });

    test('copyTreatmentData copies split treatment data by suffix', () => {
        const target = {};

        copyTreatmentData(
            {
                treatmentData2: {
                    startDate: '2026-02-01',
                    extensionDays: 3,
                    endDate: undefined,
                    additionalInfo: 'Druga czesc',
                },
            },
            target,
            '2'
        );

        expect(target.treatmentData2).toEqual({
            startDate: '2026-02-01',
            extensionDays: 3,
            endDate: null,
            additionalInfo: 'Druga czesc',
        });
    });

    test('UTC date helpers round-trip and format dates predictably', () => {
        const date = toUTCDate('2026-05-21');

        expect(date.toISOString()).toBe('2026-05-21T00:00:00.000Z');
        expect(toDateString(date)).toBe('2026-05-21');
        expect(formatDatePL(date)).toBe('21.05.2026');
    });

    test('isWorkday rejects weekends in UTC', () => {
        expect(isWorkday(toUTCDate('2026-05-22'))).toBe(true);
        expect(isWorkday(toUTCDate('2026-05-23'))).toBe(false);
        expect(isWorkday(toUTCDate('2026-05-24'))).toBe(false);
    });

    test('escapeHTML escapes special characters', () => {
        expect(escapeHTML('<b>"Double" & \'Single\'</b>')).toBe('&lt;b&gt;&quot;Double&quot; &amp; &#039;Single&#039;&lt;/b&gt;');
    });

    test('escapeHTML handles empty, null, and undefined', () => {
        expect(escapeHTML('')).toBe('');
        expect(escapeHTML(null)).toBe('');
        expect(escapeHTML(undefined)).toBe('');
    });

    test('escapeHTML converts numbers to strings and escapes them if needed', () => {
        expect(escapeHTML(123)).toBe('123');
    });
});

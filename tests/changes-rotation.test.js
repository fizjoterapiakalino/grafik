/**
 * @jest-environment jsdom
 */

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
            })),
        })),
        runTransaction: jest.fn(),
    },
}));

import { generateTwoWeekPeriods } from '../scripts/changes-rotation.js';
import { findRotationPeriodForDate } from '../scripts/rotation-periods.js';

describe('generateTwoWeekPeriods (ISO continuous 14-day rotation grid)', () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    test('produces contiguous 14-day periods across 2024 -> 2025 -> 2026 -> 2027 with zero overlap or gap', () => {
        const years = [2024, 2025, 2026, 2027];
        const allPeriods = years.flatMap((year) => generateTwoWeekPeriods(year));

        expect(allPeriods.length).toBeGreaterThanOrEqual(104);

        for (let i = 0; i < allPeriods.length; i++) {
            const startMs = Date.parse(`${allPeriods[i].start}T00:00:00Z`);
            const endMs = Date.parse(`${allPeriods[i].end}T00:00:00Z`);

            // Each period starts on Monday (1) and ends 11 days later on Friday (5) of week 2
            expect(new Date(startMs).getUTCDay()).toBe(1);
            expect(new Date(endMs).getUTCDay()).toBe(5);
            expect((endMs - startMs) / ONE_DAY_MS).toBe(11);

            if (i > 0) {
                const prevStartMs = Date.parse(`${allPeriods[i - 1].start}T00:00:00Z`);
                expect((startMs - prevStartMs) / ONE_DAY_MS).toBe(14);
            }
        }
    });

    test('assigns year-boundary period 2024-12-30..2025-01-10 exclusively to 2025', () => {
        const periods2024 = generateTwoWeekPeriods(2024);
        const periods2025 = generateTwoWeekPeriods(2025);

        expect(periods2024[periods2024.length - 1]).toEqual({
            start: '2024-12-16',
            end: '2024-12-27',
        });
        expect(periods2025[0]).toEqual({
            start: '2024-12-30',
            end: '2025-01-10',
        });
    });
});

describe('findRotationPeriodForDate', () => {
    test('encloses a Saturday between week 1 and week 2 of a 14-day block in its period', () => {
        const period = findRotationPeriodForDate('2026-10-24');
        expect(period.start <= '2026-10-24').toBe(true);
        const startMs = Date.parse(`${period.start}T00:00:00Z`);
        const targetMs = Date.parse('2026-10-24T00:00:00Z');
        const diffDays = (targetMs - startMs) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBeGreaterThanOrEqual(0);
        expect(diffDays).toBeLessThanOrEqual(13);
        expect(period.start).toBe('2026-10-19');
        expect(period.end).toBe('2026-10-30');
    });

    test('encloses Monday start and Sunday end within the enclosing period', () => {
        const mondayPeriod = findRotationPeriodForDate('2026-10-19');
        const sundayPeriod = findRotationPeriodForDate('2026-11-01');
        expect(mondayPeriod).toEqual({ start: '2026-10-19', end: '2026-10-30' });
        expect(sundayPeriod).toEqual({ start: '2026-10-19', end: '2026-10-30' });
    });
});


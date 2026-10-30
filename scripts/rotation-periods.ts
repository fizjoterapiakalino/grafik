// scripts/rotation-periods.ts
/**
 * Logika i pomocnicze funkcje dla dwutygodniowych okresów rotacyjnych.
 */

export interface RotationPeriod {
    start: string;
    end: string;
}

export const isWeekend = (date: Date): boolean => {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
};

export const EPOCH_MONDAY = Date.UTC(2024, 0, 1);
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_PERIOD_MS = 14 * ONE_DAY_MS;

export const generateTwoWeekPeriods = (year: number): RotationPeriod[] => {
    const periods: RotationPeriod[] = [];
    let k = Math.floor((Date.UTC(year, 0, 1) - EPOCH_MONDAY) / ONE_PERIOD_MS) - 2;

    while (true) {
        const startMs = EPOCH_MONDAY + k * ONE_PERIOD_MS;
        const thursday = new Date(startMs + 3 * ONE_DAY_MS);
        const thursdayYear = thursday.getUTCFullYear();

        if (thursdayYear === year) {
            const startDate = new Date(startMs);
            const endDate = new Date(startMs + 11 * ONE_DAY_MS);
            periods.push({
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            });
        } else if (thursdayYear > year) {
            break;
        }
        k++;
    }

    return periods;
};

export const findRotationPeriodForDate = (dateIso: string): RotationPeriod => {
    const [y, m, d] = dateIso.split('-').map(Number);
    const k = Math.floor((Date.UTC(y, m - 1, d) - EPOCH_MONDAY) / ONE_PERIOD_MS);
    const startMs = EPOCH_MONDAY + k * ONE_PERIOD_MS;
    const startDate = new Date(startMs);
    const endDate = new Date(startMs + 11 * ONE_DAY_MS);
    return {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
    };
};

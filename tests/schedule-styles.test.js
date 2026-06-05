import { readFileSync } from 'fs';

describe('schedule styles', () => {
    const css = readFileSync('styles/schedule.css', 'utf8');

    test('colors every-other-day names in full and split cells', () => {
        const everyOtherDayRule = css.match(/\.every-other-day-text,[\s\S]*?\}/)?.[0] || '';

        expect(everyOtherDayRule).toContain('color: var(--bg-every-other-day)');
        expect(everyOtherDayRule).toContain('font-weight: bold');
        expect(everyOtherDayRule).toContain('td.split-cell .split-cell-wrapper>div.every-other-day-text>span');
    });

    test('fades text for past schedule treatments', () => {
        const pastTreatmentRule = css.match(/\.schedule-table td\.past-treatment-cell > span,[\s\S]*?\}/)?.[0] || '';

        expect(pastTreatmentRule).toContain('.split-cell-wrapper > div.past-treatment-part > span');
        expect(pastTreatmentRule).toContain('opacity: 0.68');
        expect(pastTreatmentRule).toContain('filter: saturate(0.88)');
    });
});

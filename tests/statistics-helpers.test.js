import {
    calculateScheduleMetrics,
    calculateWeeklyAverages,
    createWeeklyStatsSnapshot,
    getIsoWeekInfo,
} from '../scripts/statistics-helpers.js';

describe('statistics helpers', () => {
    test('calculates schedule metrics using employee ids and ignores hydrotherapy as patient entry', () => {
        const scheduleCells = {
            '8:00': {
                empA: {
                    content: 'Anna Kowalska',
                    isMassage: true,
                    treatmentStartDate: '2026-05-01',
                    treatmentEndDate: '2026-05-25',
                    treatmentExtensionDays: 3,
                },
                empB: { isBreak: true },
            },
            '8:30': {
                empA: {
                    isSplit: true,
                    content1: 'Jan Nowak',
                    content2: 'Hydro.',
                    treatmentData1: { startDate: '2026-05-01', endDate: '2026-05-27', extensionDays: 0 },
                    isHydrotherapy2: true,
                },
                empB: {
                    content: 'Anna Kowalska',
                    isPnf: true,
                    treatmentStartDate: '2026-05-01',
                    treatmentEndDate: '2026-05-24',
                    treatmentExtensionDays: 15,
                },
            },
            '9:00': {
                empA: { content: 'Hydro.', isHydrotherapy: true },
            },
            '14:30': {
                empA: { content: 'Bez dat' },
            },
        };

        const metrics = calculateScheduleMetrics(scheduleCells, ['empA', 'empB'], new Date('2026-05-25T10:00:00Z'));

        expect(metrics.totalSlots).toBe(4);
        expect(metrics.uniquePatients).toBe(3);
        expect(metrics.breaks).toBe(1);
        expect(metrics.hydrotherapy).toBe(2);
        expect(metrics.massageOrPnf).toBe(2);
        expect(metrics.extendedTreatments).toBe(2);
        expect(metrics.longExtensions).toBe(1);
        expect(metrics.endingToday).toBe(1);
        expect(metrics.endingSoon).toBe(1);
        expect(metrics.overdue).toBe(1);
        expect(metrics.missingTreatmentDates).toBe(1);
        expect(metrics.duplicatePatientEntries).toBe(1);
        expect(metrics.dataQualityScore).toBe(82);
        expect(metrics.handoverMorning).toBe(3);
        expect(metrics.handoverAfternoon).toBe(1);
        expect(metrics.byEmployee).toEqual({ empA: 3, empB: 1 });
        expect(metrics.byHour['8:30']).toBe(2);
    });

    test('builds current weekly snapshot with leave-adjusted team availability', () => {
        const employees = {
            empA: { displayName: 'Anna', color: '#fff' },
            empB: { displayName: 'Jan', color: '#000' },
            hidden: { displayName: 'Hidden', color: '#999', isHidden: true },
        };
        const leaves = {
            Anna: [{ id: 'leave-1', type: 'vacation', startDate: '2026-05-25', endDate: '2026-05-26' }],
        };
        const scheduleCells = {
            '8:00': {
                empA: { content: 'Pacjent 1' },
                empB: { content: 'Pacjent 2' },
            },
        };

        const snapshot = createWeeklyStatsSnapshot(scheduleCells, employees, leaves, new Date('2026-05-25T10:00:00Z'));

        expect(snapshot.weekKey).toBe('2026-W22');
        expect(snapshot.leaveDays).toBe(2);
        expect(snapshot.activeEmployeeCount).toBe(2);
        expect(snapshot.averageAvailableEmployees).toBe(1.6);
        expect(snapshot.averagePatientsPerAvailableEmployee).toBe(1.3);
    });

    test('calculates four-week averages and week-over-week trend', () => {
        const snapshots = [10, 20, 30, 45].map((totalSlots, index) => ({
            weekKey: `2026-W2${index + 1}`,
            year: 2026,
            weekNumber: 21 + index,
            weekStart: '2026-05-01',
            weekEnd: '2026-05-07',
            updatedAt: '2026-05-01T00:00:00.000Z',
            scheduleMetrics: {
                totalSlots,
                uniquePatients: totalSlots / 2,
                breaks: 0,
                massageOrPnf: 0,
                hydrotherapy: 0,
                byEmployee: {},
                byHour: {},
                possibleSlots: 100,
                availableSlots: 100,
                occupancyPercent: totalSlots,
            },
            activeEmployeeCount: 4,
            averageAvailableEmployees: 4,
            leaveDays: index,
            averagePatientsPerAvailableEmployee: totalSlots / 4,
        }));

        const averages = calculateWeeklyAverages(snapshots, new Date('2026-06-08T10:00:00Z'), 4);

        expect(averages.weeks.map(week => week.weekKey)).toEqual(['2026-W21', '2026-W22', '2026-W23', '2026-W24']);
        expect(averages.averageTotalSlots).toBe(26.3);
        expect(averages.totalLeaveDays).toBe(6);
        expect(averages.trendPercent).toBe(50);
    });

    test('uses ISO week year around calendar boundaries', () => {
        expect(getIsoWeekInfo(new Date('2027-01-01T12:00:00Z')).weekKey).toBe('2026-W53');
    });
});

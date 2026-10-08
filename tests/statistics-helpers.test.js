import {
    calculateScheduleMetrics,
    calculateWeeklyAverages,
    createWeeklyStatsSnapshot,
    getIsoWeekInfo,
    createDailyWorkloadSnapshot,
    calculatePeriodWorkloadAverages,
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

    test('creates daily workload snapshot considering active treatment dates and leaves', () => {
        const employees = {
            empA: { displayName: 'Anna', color: '#10b981' },
            empB: { displayName: 'Jan', color: '#3b82f6' },
        };
        const leaves = {
            Anna: [{ id: 'l1', type: 'vacation', startDate: '2026-09-30', endDate: '2026-10-02' }],
        };
        const scheduleCells = {
            '8:00': {
                empA: { content: 'Pacjent A', treatmentStartDate: '2026-09-20', treatmentEndDate: '2026-10-05' },
                empB: { content: 'Pacjent B', treatmentStartDate: '2026-09-20', treatmentEndDate: '2026-10-05' },
            },
            '8:30': {
                empB: { content: 'Pacjent C' }, // bez dat leczenia - aktywny
            },
        };

        const snapshot = createDailyWorkloadSnapshot(scheduleCells, employees, leaves, new Date('2026-09-30T10:00:00Z'));

        expect(snapshot.date).toBe('2026-09-30');
        expect(snapshot.isWorkday).toBe(true);
        expect(snapshot.employees.empA.isOnLeave).toBe(true);
        expect(snapshot.employees.empA.leaveType).toBe('vacation');
        expect(snapshot.employees.empA.patientSlots).toBe(0); // na urlopie nie liczy pacjentów

        expect(snapshot.employees.empB.isOnLeave).toBe(false);
        expect(snapshot.employees.empB.patientSlots).toBe(2);
        expect(snapshot.totalPatients).toBe(2);
    });

    test('calculates period workload averages in weekly and monthly scopes', () => {
        const employees = {
            empA: { displayName: 'Anna', color: '#10b981' },
            empB: { displayName: 'Jan', color: '#3b82f6' },
        };

        const snapshots = [
            {
                date: '2026-09-28',
                year: 2026,
                month: 9,
                dayOfWeek: 1,
                weekKey: '2026-W40',
                isWorkday: true,
                updatedAt: '2026-09-28T12:00:00Z',
                totalPatients: 16,
                activeEmployeesCount: 2,
                employees: {
                    empA: { employeeId: 'empA', employeeName: 'Anna', patientSlots: 10, uniquePatients: 10, availableSlots: 15, occupancyPercent: 67, isOnLeave: false },
                    empB: { employeeId: 'empB', employeeName: 'Jan', patientSlots: 6, uniquePatients: 6, availableSlots: 15, occupancyPercent: 40, isOnLeave: false },
                },
            },
            {
                date: '2026-09-29',
                year: 2026,
                month: 9,
                dayOfWeek: 2,
                weekKey: '2026-W40',
                isWorkday: true,
                updatedAt: '2026-09-29T12:00:00Z',
                totalPatients: 8,
                activeEmployeesCount: 2,
                employees: {
                    empA: { employeeId: 'empA', employeeName: 'Anna', patientSlots: 0, uniquePatients: 0, availableSlots: 15, occupancyPercent: 0, isOnLeave: true, leaveType: 'vacation' },
                    empB: { employeeId: 'empB', employeeName: 'Jan', patientSlots: 8, uniquePatients: 8, availableSlots: 15, occupancyPercent: 53, isOnLeave: false },
                },
            },
        ];

        const weeklyAvg = calculatePeriodWorkloadAverages(snapshots, 'weekly', {
            weekKey: '2026-W40',
            year: 2026,
            employees,
        });

        expect(weeklyAvg.workdaysCount).toBe(2);
        expect(weeklyAvg.totalPatientCount).toBe(24);

        const empA = weeklyAvg.employees.find(e => e.employeeId === 'empA');
        expect(empA).toBeDefined();
        expect(empA?.daysPresent).toBe(1);
        expect(empA?.daysOnLeave).toBe(1);
        expect(empA?.averagePatientsPerPresentDay).toBe(10); // 10 / 1 dzień obecności
        expect(empA?.averagePatientsPerWorkday).toBe(5); // 10 / 2 dni robocze

        const empB = weeklyAvg.employees.find(e => e.employeeId === 'empB');
        expect(empB?.daysPresent).toBe(2);
        expect(empB?.averagePatientsPerPresentDay).toBe(7); // (6 + 8) / 2 = 7
    });
});

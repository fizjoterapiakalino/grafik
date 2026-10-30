import {
    getActiveEmployeeIds,
    isClinicalWorkday,
    countClinicalWorkdaysInRange,
    getIsoWeeksForYear,
    getIsoWeekInfo,
    createDailyWorkloadSnapshot,
    calculatePeriodWorkloadAverages,
    calculateColumnHygieneMetrics,
    normalizeLeavesData,
} from '../scripts/statistics-helpers.js';

describe('statistics-helpers', () => {
    describe('getActiveEmployeeIds', () => {
        test('includes isScheduleOnly employees and excludes isHidden', () => {
            const employees = {
                emp1: { displayName: 'Anna', isHidden: false },
                emp2: { displayName: 'Jan', isHidden: true },
                emp3: { displayName: 'Marek', isScheduleOnly: true, isHidden: false },
                emp4: { displayName: 'Ewa' },
            };
            expect(getActiveEmployeeIds(employees)).toEqual(['emp1', 'emp3', 'emp4']);
        });
    });

    describe('clinical workdays and ISO weeks', () => {
        test('isClinicalWorkday identifies Mon-Fri workdays and excludes weekends and Polish holidays', () => {
            // Monday 2026-10-19: standard workday
            expect(isClinicalWorkday('2026-10-19')).toBe(true);
            // Saturday 2026-10-24: weekend
            expect(isClinicalWorkday('2026-10-24')).toBe(false);
            // Sunday 2026-10-25: weekend
            expect(isClinicalWorkday('2026-10-25')).toBe(false);
            // Friday 2026-05-01: Święto Pracy (holiday)
            expect(isClinicalWorkday('2026-05-01')).toBe(false);
            // Thursday 2026-06-04: Boże Ciało (holiday)
            expect(isClinicalWorkday('2026-06-04')).toBe(false);
        });

        test('countClinicalWorkdaysInRange counts workdays excluding holidays and handles inverted ranges', () => {
            // Mon 2026-04-27 to Sun 2026-05-03: Mon-Thu (4 days), Fri is May 1 (holiday), Sat-Sun (weekend)
            expect(countClinicalWorkdaysInRange('2026-04-27', '2026-05-03')).toBe(4);
            // Inverted range returns 0
            expect(countClinicalWorkdaysInRange('2026-05-03', '2026-04-27')).toBe(0);
        });

        test('getIsoWeeksForYear generates all ISO weeks with labels for a given year', () => {
            const weeks2026 = getIsoWeeksForYear(2026);
            expect(weeks2026.length).toBeGreaterThanOrEqual(52);
            expect(weeks2026[0]).toMatchObject({
                weekKey: '2026-W01',
                weekNumber: 1,
                weekStart: '2025-12-29',
                weekEnd: '2026-01-04',
            });
            expect(weeks2026[0].label).toContain('Tydzień 1');
            expect(weeks2026[weeks2026.length - 1].weekKey).toMatch(/^2026-W5[23]$/);
        });

        test('getIsoWeekInfo correctly computes week key', () => {
            expect(getIsoWeekInfo(new Date('2026-10-21T12:00:00Z')).weekKey).toBe('2026-W43');
        });
    });

    describe('createDailyWorkloadSnapshot', () => {
        const employees = {
            empA: { displayName: 'Anna Kowalska', color: '#10b981' },
            empB: { displayName: 'Jan Nowak', color: '#3b82f6' },
        };

        test('counts day 15 (dateIso === treatmentEndDate) as 1 active slot, and day 16 (dateIso > treatmentEndDate) as 0 slots', () => {
            // Treatment starting Mon 2026-10-05 has 15th workday on Fri 2026-10-23
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Pacjent Piętnastodniowy',
                        treatmentStartDate: '2026-10-05',
                        treatmentEndDate: '2026-10-23',
                    },
                },
            };

            // Day 15: Friday 2026-10-23 -> active (1 slot)
            const snapDay15 = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-23T10:00:00Z'));
            expect(snapDay15.employees.empA.patientSlots).toBe(1);

            // Day 16: Monday 2026-10-26 (> treatmentEndDate) -> cut off (0 slots)
            const snapDay16 = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-26T10:00:00Z'));
            expect(snapDay16.employees.empA.patientSlots).toBe(0);
        });

        test('derives effectiveEndDate via ScheduleLogic.calculateEndDate when treatmentEndDate is missing', () => {
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Pacjent Bez EndDate',
                        treatmentStartDate: '2026-10-05',
                        // treatmentEndDate missing
                    },
                },
            };

            // 15th workday from 2026-10-05 is 2026-10-23
            const snapActive = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-23T10:00:00Z'));
            expect(snapActive.employees.empA.patientSlots).toBe(1);

            const snapExpired = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-26T10:00:00Z'));
            expect(snapExpired.employees.empA.patientSlots).toBe(0);
        });

        test('excludes undated cells (!treatmentStartDate) yielding 0 slots', () => {
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Pacjent Bez Daty',
                    },
                },
            };

            const snap = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-21T10:00:00Z'));
            expect(snap.employees.empA.patientSlots).toBe(0);
        });

        test('counts split cell A / B with two simultaneously active halves as 1 slot (not 2)', () => {
            const scheduleCells = {
                '8:30': {
                    empA: {
                        isSplit: true,
                        content1: 'Pacjent Lewy',
                        treatmentData1: { startDate: '2026-10-19', endDate: '2026-11-06' },
                        content2: 'Pacjent Prawy',
                        treatmentData2: { startDate: '2026-10-19', endDate: '2026-11-06' },
                    },
                },
            };

            const snap = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-21T10:00:00Z'));
            expect(snap.employees.empA.patientSlots).toBe(1);
        });

        test('counts split cell A / B as 1 slot when one half is expired and one half is active', () => {
            const scheduleCells = {
                '8:30': {
                    empA: {
                        isSplit: true,
                        content1: 'Pacjent Wygasły',
                        treatmentData1: { startDate: '2026-09-01', endDate: '2026-09-19' },
                        content2: 'Pacjent Aktywny',
                        treatmentData2: { startDate: '2026-10-19', endDate: '2026-11-06' },
                    },
                },
            };

            const snap = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-21T10:00:00Z'));
            expect(snap.employees.empA.patientSlots).toBe(1);
        });

        test('does NOT write patientIds containing patient names (RODO constraint)', () => {
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Jan Kowalski RODO',
                        treatmentStartDate: '2026-10-19',
                        treatmentEndDate: '2026-11-06',
                    },
                },
            };

            const snap = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-21T10:00:00Z'));
            const pIds = snap.employees.empA.patientIds;
            if (pIds && pIds.length > 0) {
                pIds.forEach((id) => {
                    expect(id).not.toContain('legacy:');
                    expect(id.toLowerCase()).not.toContain('kowalski');
                });
            } else {
                expect(pIds === undefined || pIds.length === 0).toBe(true);
            }
        });

        test('respects Polish holidays (0 slots), leaves (0 slots), and isEveryOtherDay parity', () => {
            const leaves = {
                'Anna Kowalska': [
                    { id: 'l1', type: 'vacation', startDate: '2026-10-20', endDate: '2026-10-22' },
                ],
            };
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Pacjent A',
                        treatmentStartDate: '2026-10-19',
                        treatmentEndDate: '2026-11-06',
                    },
                    empB: {
                        content: 'Pacjent B Co Drugi Dzień',
                        treatmentStartDate: '2026-10-19',
                        treatmentEndDate: '2026-11-06',
                        isEveryOtherDay: true,
                    },
                },
            };

            // On holiday 2026-05-01: 0 slots
            const snapHoliday = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-05-01T10:00:00Z'));
            expect(snapHoliday.isWorkday).toBe(false);
            expect(snapHoliday.employees.empA.patientSlots).toBe(0);

            // On leave 2026-10-21: Anna is on vacation (0 slots, isOnLeave = true)
            const snapLeave = createDailyWorkloadSnapshot(scheduleCells, employees, leaves, new Date('2026-10-21T10:00:00Z'));
            expect(snapLeave.employees.empA.isOnLeave).toBe(true);
            expect(snapLeave.employees.empA.patientSlots).toBe(0);

            // empB is not on leave, checking isEveryOtherDay:
            // Workday 1: Mon 2026-10-19 -> active (1 slot)
            const snapDay1 = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-19T10:00:00Z'));
            expect(snapDay1.employees.empB.patientSlots).toBe(1);

            // Workday 2: Tue 2026-10-20 -> skipped (0 slots)
            const snapDay2 = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-20T10:00:00Z'));
            expect(snapDay2.employees.empB.patientSlots).toBe(0);

            // Workday 3: Wed 2026-10-21 -> active (1 slot)
            const snapDay3 = createDailyWorkloadSnapshot(scheduleCells, employees, {}, new Date('2026-10-21T10:00:00Z'));
            expect(snapDay3.employees.empB.patientSlots).toBe(1);
        });
    });

    describe('calculatePeriodWorkloadAverages', () => {
        const employees = {
            empA: { displayName: 'Anna Kowalska', color: '#10b981' },
            empB: { displayName: 'Jan Nowak', color: '#3b82f6' },
        };

        const makeSnapshot = (date, slotsA, slotsB, onLeaveB = false) => ({
            date,
            year: Number.parseInt(date.substring(0, 4), 10),
            month: Number.parseInt(date.substring(5, 7), 10),
            dayOfWeek: 1,
            weekKey: getIsoWeekInfo(new Date(`${date}T12:00:00Z`)).weekKey,
            isWorkday: isClinicalWorkday(date),
            updatedAt: `${date}T12:00:00.000Z`,
            totalPatients: slotsA + (onLeaveB ? 0 : slotsB),
            activeEmployeesCount: 2,
            employees: {
                empA: {
                    employeeId: 'empA',
                    employeeName: 'Anna Kowalska',
                    patientSlots: slotsA,
                    availableSlots: 20,
                    occupancyPercent: Math.round((slotsA / 20) * 100),
                    isOnLeave: false,
                },
                empB: {
                    employeeId: 'empB',
                    employeeName: 'Jan Nowak',
                    patientSlots: onLeaveB ? 0 : slotsB,
                    availableSlots: 20,
                    occupancyPercent: onLeaveB ? 0 : Math.round((slotsB / 20) * 100),
                    isOnLeave: onLeaveB,
                    leaveType: onLeaveB ? 'vacation' : null,
                },
            },
        });

        test('supports cross-year biweekly period spanning Dec 2025 and Jan 2026', () => {
            const snapshots = [
                makeSnapshot('2025-12-29', 10, 8),
                makeSnapshot('2025-12-30', 10, 8),
                makeSnapshot('2026-01-02', 10, 8),
                makeSnapshot('2026-01-05', 12, 10),
            ];

            const result = calculatePeriodWorkloadAverages(snapshots, 'biweekly', {
                periodStart: '2025-12-29',
                periodEnd: '2026-01-09',
                year: 2026,
                employees,
                referenceDate: new Date('2026-01-05T12:00:00Z'),
            });

            expect(result.recordedWorkdaysCount).toBe(4);
            expect(result.totalActiveSlots).toBe(76); // (10+8)*3 + (12+10) = 54 + 22 = 76
            expect(result.employees[0].totalActiveSlots).toBe(42); // 10+10+10+12
            expect(result.employees[1].totalActiveSlots).toBe(34); // 8+8+8+10
        });

        test('caps expectedWorkdaysCount at referenceDate for an ongoing period and returns 0 for future period without NaN', () => {
            // Ongoing period 2026-10-19..2026-10-30. On Wednesday 2026-10-21 (workday 3):
            const refWednesday = new Date('2026-10-21T12:00:00Z');
            const snapshots = [
                makeSnapshot('2026-10-19', 10, 10),
                makeSnapshot('2026-10-20', 10, 10),
                makeSnapshot('2026-10-21', 10, 10),
            ];

            const ongoingResult = calculatePeriodWorkloadAverages(snapshots, 'biweekly', {
                periodStart: '2026-10-19',
                periodEnd: '2026-10-30',
                year: 2026,
                employees,
                referenceDate: refWednesday,
            });

            expect(ongoingResult.recordedWorkdaysCount).toBe(3);
            expect(ongoingResult.expectedWorkdaysCount).toBe(3); // Capped at Wednesday!

            // Future period starting 2026-11-02 when referenceDate is 2026-10-21
            const futureResult = calculatePeriodWorkloadAverages([], 'biweekly', {
                periodStart: '2026-11-02',
                periodEnd: '2026-11-13',
                year: 2026,
                employees,
                referenceDate: refWednesday,
            });

            expect(futureResult.recordedWorkdaysCount).toBe(0);
            expect(futureResult.expectedWorkdaysCount).toBe(0);
            expect(futureResult.averageDailyPerPresentEmployee).toBe(0);
            expect(Number.isNaN(futureResult.averageDailyPerPresentEmployee)).toBe(false);
            expect(futureResult.averagePeriodSumPerPresentEmployee).toBe(0);
            expect(Number.isNaN(futureResult.averagePeriodSumPerPresentEmployee)).toBe(false);
        });

        test('divides averagePeriodSumPerPresentEmployee by employeesWithPresenceCount excluding all-period leave', () => {
            // empA present 2 days with 20 slots total; empB on vacation both days (0 days present)
            const snapshots = [
                makeSnapshot('2026-10-19', 10, 0, true),
                makeSnapshot('2026-10-20', 10, 0, true),
            ];

            const result = calculatePeriodWorkloadAverages(snapshots, 'biweekly', {
                periodStart: '2026-10-19',
                periodEnd: '2026-10-30',
                year: 2026,
                employees,
                referenceDate: new Date('2026-10-20T12:00:00Z'),
            });

            expect(result.employeesWithPresenceCount).toBe(1);
            expect(result.totalActiveSlots).toBe(20);
            // Must divide by 1 present employee (empA), not 2 total employees: 20 / 1 = 20
            expect(result.averagePeriodSumPerPresentEmployee).toBe(20);
        });

        test('computes previousPeriodDeltaDaily against the immediately preceding period', () => {
            // Period 1: 2026-W41, avg = 8.0
            // Period 2: 2026-W42, avg = 10.0
            const snapshots = [
                makeSnapshot('2026-10-05', 8, 8),
                makeSnapshot('2026-10-12', 10, 10),
            ];

            const result = calculatePeriodWorkloadAverages(snapshots, 'weekly', {
                weekKey: '2026-W42',
                year: 2026,
                employees,
                referenceDate: new Date('2026-10-16T12:00:00Z'),
            });

            expect(result.averageDailyPerPresentEmployee).toBe(10);
            expect(result.previousPeriodDeltaDaily).toBe(2); // 10 - 8 = +2
        });
    });

    describe('calculateColumnHygieneMetrics', () => {
        const employees = {
            empA: { displayName: 'Anna Kowalska', color: '#10b981' },
            empB: { displayName: 'Jan Nowak', color: '#3b82f6' },
        };

        test('mixed split cell reports overdue bell for expired half and active extension for ongoing half', () => {
            const today = new Date('2026-10-21T10:00:00Z');
            const scheduleCells = {
                '8:30': {
                    empA: {
                        isSplit: true,
                        content1: 'Pacjent Przeterminowany',
                        treatmentData1: { startDate: '2026-09-01', endDate: '2026-09-19', extensionDays: 0 },
                        content2: 'Pacjent Przedłużony',
                        treatmentData2: { startDate: '2026-10-12', endDate: '2026-11-03', extensionDays: 3 },
                    },
                },
            };

            const report = calculateColumnHygieneMetrics(scheduleCells, employees, today);

            const hygieneA = report.byEmployee.empA;
            expect(hygieneA.overdueBellsCount).toBe(1);
            expect(hygieneA.overdueTimes).toEqual(['8:30']);
            expect(hygieneA.activeExtensionsCount).toBe(1);
            expect(hygieneA.activeExtensionDaysSum).toBe(3);
        });

        test('reports undatedEntries when filled non-break/non-hydro cell lacks startDate', () => {
            const today = new Date('2026-10-21T10:00:00Z');
            const scheduleCells = {
                '9:00': {
                    empA: {
                        content: 'Pacjent Bez Daty Początku',
                        // treatmentStartDate missing
                    },
                },
            };

            const report = calculateColumnHygieneMetrics(scheduleCells, employees, today);

            expect(report.undatedEntries).toEqual([
                { employeeId: 'empA', employeeName: 'Anna Kowalska', time: '9:00' },
            ]);
            expect(report.byEmployee.empA.undatedCount).toBe(1);
        });

        test('computes lastUpdatedIso and lastUpdatedDaysAgo handling late UTC timestamps, clamping future dates, and ignoring malformed strings', () => {
            const today = new Date('2026-10-30T10:00:00Z');
            const scheduleCells = {
                '8:00': {
                    empA: {
                        content: 'Pacjent Wczorajszy',
                        treatmentStartDate: '2026-10-29',
                        treatmentEndDate: '2026-11-19',
                        history: [
                            { timestamp: '2026-10-29T21:30:00.000Z', author: 'Anna' },
                            { timestamp: 'invalid-date-string' },
                        ],
                    },
                },
                '8:30': {
                    empB: {
                        content: 'Pacjent Przyszły',
                        treatmentStartDate: '2026-11-05', // In the future relative to 2026-10-30
                        treatmentEndDate: '2026-11-26',
                    },
                },
            };

            const report = calculateColumnHygieneMetrics(scheduleCells, employees, today);

            // empA: last updated 2026-10-29 -> 1 day ago
            expect(report.byEmployee.empA.lastUpdatedIso).toBe('2026-10-29');
            expect(report.byEmployee.empA.lastUpdatedDaysAgo).toBe(1);

            // empB: future date 2026-11-05 clamped to 0 days ago (Dziś)
            expect(report.byEmployee.empB.lastUpdatedIso).toBe('2026-11-05');
            expect(report.byEmployee.empB.lastUpdatedDaysAgo).toBe(0);
        });
    });

    describe('normalizeLeavesData', () => {
        test('normalizes leaves data properly', () => {
            const raw = {
                'Anna Kowalska': [
                    { id: '1', startDate: '2026-10-01', endDate: '2026-10-05', type: 'vacation' },
                    null,
                    { invalid: true },
                ],
            };
            const normalized = normalizeLeavesData(raw);
            expect(normalized['Anna Kowalska']).toHaveLength(1);
            expect(normalized['Anna Kowalska'][0].startDate).toBe('2026-10-01');
        });
    });
});

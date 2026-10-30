/**
 * @jest-environment jsdom
 */

import fs from 'fs';
import path from 'path';

const mockScheduleDoc = {
    get: jest.fn(),
};

const mockLeavesDoc = {
    get: jest.fn(),
};

const mockStatsDailyQuery = {
    get: jest.fn(),
};

const mockStatsDailyDoc = {
    get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
    set: jest.fn().mockResolvedValue(undefined),
};

const mockStatsDailyCollection = {
    where: jest.fn(() => mockStatsDailyQuery),
    doc: jest.fn(() => mockStatsDailyDoc),
    get: jest.fn(),
};

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn((colName) => {
            if (colName === 'schedules') {
                return {
                    doc: jest.fn((docId) => {
                        if (docId === 'mainSchedule') return mockScheduleDoc;
                        return { get: jest.fn().mockResolvedValue({ exists: false, data: () => null }) };
                    }),
                };
            }
            if (colName === 'leaves') {
                return {
                    doc: jest.fn((docId) => {
                        if (docId === 'mainLeaves') return mockLeavesDoc;
                        return { get: jest.fn().mockResolvedValue({ exists: false, data: () => null }) };
                    }),
                };
            }
            if (colName === 'statsDaily') {
                return mockStatsDailyCollection;
            }
            return {
                doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false, data: () => null }) })),
                where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: [] }) })),
            };
        }),
    },
}));

let mockEmployees = {};

jest.mock('../scripts/employee-manager.js', () => ({
    EmployeeManager: {
        load: jest.fn().mockResolvedValue(undefined),
        getAll: jest.fn(() => mockEmployees),
        getById: jest.fn((id) => mockEmployees[id] || null),
        getNameById: jest.fn((id) => mockEmployees[id]?.displayName || id),
        compareEmployees: jest.fn((a, b) => {
            const nameA = a.displayName || '';
            const nameB = b.displayName || '';
            return nameA.localeCompare(nameB, 'pl');
        }),
    },
}));

import { Statistics } from '../scripts/statistics.js';

describe('Statistics UI & Controller (Wariant A: Obciążenie i Sumienność)', () => {
    const htmlPath = path.resolve(__dirname, '../pages/statistics.html');
    let statisticsHtml = '';

    beforeAll(() => {
        statisticsHtml = fs.readFileSync(htmlPath, 'utf-8');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();

        // Mock Chart.js constructor and canvas getContext
        HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({});
        global.Chart = jest.fn().mockImplementation((ctx, config) => ({
            ctx,
            config,
            destroy: jest.fn(),
            update: jest.fn(),
            resize: jest.fn(),
        }));
        global.Chart.register = jest.fn();

        // Set up DOM
        document.body.innerHTML = statisticsHtml;

        // Seed 2 employees
        mockEmployees = {
            empB: { id: 'empB', displayName: 'Marek W.', color: '#3b82f6', isHidden: false },
            empA: { id: 'empA', displayName: 'Anna K.', color: '#10b981', isHidden: false },
        };

        // Today reference date: 2026-10-21 (Wednesday)
        // Two-week rotation period for 2026-10-21 is 2026-10-19 to 2026-10-30
        const scheduleCells = {
            '8:00': {
                // Marek W. overdue bell 1 (ended 2026-09-21)
                empB: {
                    content: 'Pacjent Marek 1',
                    treatmentStartDate: '2026-09-01',
                    treatmentEndDate: '2026-09-21',
                    history: [{ timestamp: '2026-09-01T08:00:00.000Z' }],
                },
            },
            '8:30': {
                // Anna K. active turnus with +3 dni extension
                empA: {
                    content: 'Pacjent Anna',
                    treatmentStartDate: '2026-10-19',
                    treatmentEndDate: '2026-11-09',
                    treatmentExtensionDays: 3,
                    history: [{ timestamp: '2026-10-21T08:30:00.000Z' }],
                },
            },
            '9:00': {
                // Anna K. undated cell
                empA: {
                    content: 'Pacjent Bez Daty',
                },
            },
            '13:00': {
                // Marek W. overdue bell 2 (ended 2026-09-21)
                empB: {
                    content: 'Pacjent Marek 2',
                    treatmentStartDate: '2026-09-01',
                    treatmentEndDate: '2026-09-21',
                },
            },
            '9:30': {
                // Marek W. active turnus
                empB: {
                    content: 'Pacjent Marek 3',
                    treatmentStartDate: '2026-10-19',
                    treatmentEndDate: '2026-11-06',
                    history: [{ timestamp: '2026-10-20T09:30:00.000Z' }],
                },
            },
        };

        mockScheduleDoc.get.mockResolvedValue({
            exists: true,
            data: () => ({
                scheduleCells: scheduleCells,
                employees: mockEmployees,
            }),
        });

        mockLeavesDoc.get.mockResolvedValue({
            exists: true,
            data: () => ({}),
        });

        // Seed 3 days of snapshots within the 2-week period (2026-10-19, 2026-10-20, 2026-10-21)
        const mockSnapshots = [
            {
                date: '2026-10-19',
                year: 2026,
                month: 10,
                dayOfWeek: 1,
                weekKey: '2026-W43',
                isWorkday: true,
                employees: {
                    empA: { employeeId: 'empA', employeeName: 'Anna K.', patientSlots: 10, availableSlots: 15, isOnLeave: false },
                    empB: { employeeId: 'empB', employeeName: 'Marek W.', patientSlots: 6, availableSlots: 15, isOnLeave: false },
                },
                totalPatients: 16,
                activeEmployeesCount: 2,
            },
            {
                date: '2026-10-20',
                year: 2026,
                month: 10,
                dayOfWeek: 2,
                weekKey: '2026-W43',
                isWorkday: true,
                employees: {
                    empA: { employeeId: 'empA', employeeName: 'Anna K.', patientSlots: 10, availableSlots: 15, isOnLeave: false },
                    empB: { employeeId: 'empB', employeeName: 'Marek W.', patientSlots: 6, availableSlots: 15, isOnLeave: false },
                },
                totalPatients: 16,
                activeEmployeesCount: 2,
            },
            {
                date: '2026-10-21',
                year: 2026,
                month: 10,
                dayOfWeek: 3,
                weekKey: '2026-W43',
                isWorkday: true,
                employees: {
                    empA: { employeeId: 'empA', employeeName: 'Anna K.', patientSlots: 10, availableSlots: 15, isOnLeave: false },
                    empB: { employeeId: 'empB', employeeName: 'Marek W.', patientSlots: 6, availableSlots: 15, isOnLeave: false },
                },
                totalPatients: 16,
                activeEmployeesCount: 2,
            },
        ];

        mockStatsDailyQuery.get.mockResolvedValue({
            docs: mockSnapshots.map((snap) => ({
                id: snap.date,
                exists: true,
                data: () => snap,
            })),
        });
    });

    afterEach(() => {
        Statistics.destroy();
    });

    test('initializes default biweekly view, renders KPIs, undated banner, sorted hygiene table, and horizontal chart', async () => {
        // Freeze system time to Wednesday 2026-10-21
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-21T10:00:00Z'));

        await Statistics.init();

        // 1. Verify default period button is biweekly and active
        const biweeklyBtn = document.getElementById('periodBiweeklyBtn');
        const weeklyBtn = document.getElementById('periodWeeklyBtn');
        const monthlyBtn = document.getElementById('periodMonthlyBtn');
        const yearlyBtn = document.getElementById('periodYearlyBtn');

        expect(biweeklyBtn).not.toBeNull();
        expect(biweeklyBtn.classList.contains('active')).toBe(true);
        expect(weeklyBtn.classList.contains('active')).toBe(false);
        expect(monthlyBtn.classList.contains('active')).toBe(false);
        expect(yearlyBtn.classList.contains('active')).toBe(false);

        // 2. Verify 4 KPI cards
        const kpiAvgDaily = document.getElementById('kpiAvgDailyValue');
        const kpiAvgPeriodSum = document.getElementById('kpiAvgPeriodSumValue');
        const kpiOverdueBells = document.getElementById('kpiOverdueBellsValue');
        const kpiWorkdayCoverage = document.getElementById('kpiWorkdayCoverageValue');

        // Total slots: 30 + 18 = 48 across 6 person-days = 8.0 daily avg
        expect(kpiAvgDaily.textContent.trim()).toBe('8');
        // Total slots: 48 across 2 present employees = 24.0 period sum per employee
        expect(kpiAvgPeriodSum.textContent.trim()).toBe('24');
        // Overdue bells on Marek W.: 2 (08:00 and 13:00)
        expect(kpiOverdueBells.textContent.trim()).toBe('2');
        // 3 recorded workdays out of 3 expected workdays up to today
        expect(kpiWorkdayCoverage.textContent.trim()).toMatch(/3\s*\/\s*3/);

        // 3. Verify undated warning banner is visible
        const undatedBanner = document.getElementById('undatedWarningBanner');
        const undatedText = document.getElementById('undatedWarningText');
        expect(undatedBanner).not.toBeNull();
        expect(undatedBanner.style.display).not.toBe('none');
        expect(undatedBanner.hasAttribute('hidden')).toBe(false);
        expect(undatedText.textContent).toContain('Anna K.');
        expect(undatedText.textContent).toContain('09:00');

        // 4. Verify table headers and rows
        const periodSumHeader = document.getElementById('periodSumHeader');
        expect(periodSumHeader.textContent.trim()).toBe('Suma (2 tyg.)');

        const tbody = document.getElementById('workloadHygieneBody');
        const rows = tbody.querySelectorAll('tr');
        expect(rows.length).toBe(2);

        // Row 1: Anna K. (sorted first by EmployeeManager.compareEmployees)
        const row0Cells = rows[0].querySelectorAll('td');
        expect(row0Cells[0].textContent).toContain('Anna K.');
        expect(row0Cells[1].textContent).toContain('3 dni'); // 3 workdays
        expect(row0Cells[2].textContent).toBe('10'); // daily avg
        expect(row0Cells[3].textContent).toBe('30'); // period sum
        expect(row0Cells[4].textContent).toContain('0'); // 0 overdue bells
        expect(row0Cells[5].textContent).toBe('+3 dni (1 wpis)'); // active extension
        expect(row0Cells[6].textContent.trim()).toBe('Dziś'); // history timestamp was 2026-10-21

        // Row 2: Marek W.
        const row1Cells = rows[1].querySelectorAll('td');
        expect(row1Cells[0].textContent).toContain('Marek W.');
        expect(row1Cells[1].textContent).toContain('3 dni');
        expect(row1Cells[2].textContent).toBe('6');
        expect(row1Cells[3].textContent).toBe('18');
        // Bell badge with title containing '08:00, 13:00'
        const bellBadge = row1Cells[4].querySelector('.bell-badge');
        expect(bellBadge).not.toBeNull();
        expect(bellBadge.textContent).toContain('2');
        expect(bellBadge.getAttribute('title')).toContain('08:00, 13:00');
        expect(row1Cells[5].textContent).toBe('0'); // no active extension
        expect(row1Cells[6].textContent.trim()).toBe('Wczoraj'); // history timestamp was 2026-10-20 (1 day ago)

        // 5. Verify Chart.js was instantiated with horizontal bars and 2 datasets
        expect(global.Chart).toHaveBeenCalled();
        const chartConfig = global.Chart.mock.calls[0][1];
        expect(chartConfig.options.indexAxis).toBe('y');
        expect(chartConfig.data.datasets.length).toBe(2);
        expect(chartConfig.data.datasets[0].label).toContain('Śr. aktywnych');
        expect(chartConfig.data.datasets[1].label).toContain('Zaległe dzwoneczki');
        // Labels sorted by EmployeeManager.compareEmployees
        expect(chartConfig.data.labels).toEqual(['Anna K.', 'Marek W.']);
        expect(chartConfig.data.datasets[0].data).toEqual([10, 6]);
        expect(chartConfig.data.datasets[1].data).toEqual([0, 2]);

        // 6. Verify absence of legacy deleted views
        expect(document.getElementById('leavesStatsView')).toBeNull();
        expect(document.getElementById('employeeStatsView')).toBeNull();
        expect(document.getElementById('overviewView')).toBeNull();
        expect(document.getElementById('scheduleStatsView')).toBeNull();

        jest.useRealTimers();
    });

    test('hides undated banner when all cells have treatment dates', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-21T10:00:00Z'));

        // Provide schedule cells where all cells have startDate
        const cleanCells = {
            '8:30': {
                empA: {
                    content: 'Pacjent Anna',
                    treatmentStartDate: '2026-10-19',
                    treatmentEndDate: '2026-11-06',
                },
            },
        };

        mockScheduleDoc.get.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                scheduleCells: cleanCells,
                employees: mockEmployees,
            }),
        });

        await Statistics.init();

        const undatedBanner = document.getElementById('undatedWarningBanner');
        expect(undatedBanner.style.display === 'none' || undatedBanner.hidden).toBe(true);

        jest.useRealTimers();
    });

    test('renders KPIs and workload table without throwing when Chart global is undefined', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-21T10:00:00Z'));

        const originalChart = global.Chart;
        // @ts-expect-error test offline / CDN failure when Chart is undefined
        delete global.Chart;

        await expect(Statistics.init()).resolves.not.toThrow();

        const kpiAvgDaily = document.getElementById('kpiAvgDailyValue');
        expect(kpiAvgDaily.textContent.trim()).toBe('8');

        const tbody = document.getElementById('workloadHygieneBody');
        expect(tbody.querySelectorAll('tr').length).toBe(2);

        global.Chart = originalChart;
        jest.useRealTimers();
    });

    test('switching periods updates period header, select visibility, and re-renders chart', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-21T10:00:00Z'));

        await Statistics.init();

        const periodSumHeader = document.getElementById('periodSumHeader');
        const periodSelectGroup = document.getElementById('statsPeriodSelectGroup');
        const weeklyBtn = document.getElementById('periodWeeklyBtn');
        const monthlyBtn = document.getElementById('periodMonthlyBtn');
        const yearlyBtn = document.getElementById('periodYearlyBtn');

        // Switch to Weekly
        weeklyBtn.click();
        expect(weeklyBtn.classList.contains('active')).toBe(true);
        expect(periodSumHeader.textContent.trim()).toBe('Suma (1 tydz.)');
        expect(periodSelectGroup.style.display).not.toBe('none');

        // Switch to Monthly
        monthlyBtn.click();
        expect(monthlyBtn.classList.contains('active')).toBe(true);
        expect(periodSumHeader.textContent.trim()).toBe('Suma (miesiąc)');
        expect(periodSelectGroup.style.display).not.toBe('none');

        // Switch to Yearly
        yearlyBtn.click();
        expect(yearlyBtn.classList.contains('active')).toBe(true);
        expect(periodSumHeader.textContent.trim()).toBe('Suma (rok)');
        // In yearly mode, period select group must be hidden
        expect(periodSelectGroup.style.display === 'none' || periodSelectGroup.hidden).toBe(true);

        // Chart should have been updated / re-instantiated
        expect(global.Chart.mock.calls.length).toBeGreaterThanOrEqual(4);

        jest.useRealTimers();
    });
});

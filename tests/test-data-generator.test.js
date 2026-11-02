/**
 * @jest-environment jsdom
 */

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        update: jest.fn(),
    },
    FieldValue: {
        delete: jest.fn(() => '__DELETE__'),
    },
    auth: {},
}));

import { TestDataGenerator } from '../scripts/test-data-generator.js';
import { ScheduleData } from '../scripts/schedule-data.js';
import { EmployeeManager } from '../scripts/employee-manager.js';
import { ScheduleLogic } from '../scripts/schedule-logic.js';
import { isClinicalWorkday } from '../scripts/statistics-helpers.js';

describe('TestDataGenerator', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div class="table-container"></div>';
        container = document.querySelector('.table-container');
        window.showToast = jest.fn();
    });

    afterEach(() => {
        TestDataGenerator.destroy();
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    describe('isLocal and init mounting', () => {
        test('isLocal returns true for localhost, 127.0.0.1, or empty string, and false for production domains', () => {
            expect(TestDataGenerator.isLocal('localhost')).toBe(true);
            expect(TestDataGenerator.isLocal('127.0.0.1')).toBe(true);
            expect(TestDataGenerator.isLocal('')).toBe(true);
            expect(TestDataGenerator.isLocal('grafikkalinowa.github.io')).toBe(false);
            expect(TestDataGenerator.isLocal('example.com')).toBe(false);
        });

        test('init mounts #devTestGeneratorPanel on localhost with default count 80', () => {
            TestDataGenerator.init({ hostname: 'localhost' });

            const panel = document.getElementById('devTestGeneratorPanel');
            expect(panel).not.toBeNull();
            expect(container.contains(panel)).toBe(true);

            const countInput = document.getElementById('devGeneratedPatientCount');
            expect(countInput).not.toBeNull();
            expect(countInput.getAttribute('type')).toBe('number');
            expect(countInput.getAttribute('min')).toBe('1');
            expect(countInput.getAttribute('max')).toBe('300');
            expect(countInput.value).toBe('80');

            const btnGen = document.getElementById('btnDevGenTestData');
            const btnClear = document.getElementById('btnDevClearAllCells');
            expect(btnGen).not.toBeNull();
            expect(btnClear).not.toBeNull();
            expect(btnGen.textContent).toContain('Generuj Pacjentów');
            expect(btnClear.textContent).toContain('Wyczyść Grafik');
        });

        test('init does not mount #devTestGeneratorPanel when hostname is grafikkalinowa.github.io', () => {
            TestDataGenerator.init({ hostname: 'grafikkalinowa.github.io' });

            const panel = document.getElementById('devTestGeneratorPanel');
            expect(panel).toBeNull();
        });

        test('init does not create duplicate panels if called multiple times', () => {
            TestDataGenerator.init({ hostname: 'localhost' });
            TestDataGenerator.init({ hostname: 'localhost' });

            const panels = document.querySelectorAll('#devTestGeneratorPanel');
            expect(panels.length).toBe(1);
        });

        test('destroy removes the panel and cleans up listeners', () => {
            TestDataGenerator.init({ hostname: 'localhost' });
            expect(document.getElementById('devTestGeneratorPanel')).not.toBeNull();

            TestDataGenerator.destroy();
            expect(document.getElementById('devTestGeneratorPanel')).toBeNull();
        });
    });

    describe('generateData with normal placement (5 active employees + 1 hidden)', () => {
        const createMockEmployees = () => ({
            emp1: { displayName: 'Jan Kowal', isHidden: false },
            emp2: { displayName: 'Anna Nowak', isHidden: false },
            emp3: { displayName: 'Piotr Ziel', isHidden: false },
            emp4: { displayName: 'Maria Wiśń', isHidden: false },
            emp5: { displayName: 'Krzysztof Maz', isHidden: false },
            empHidden: { displayName: 'Ukryty Pracownik', isHidden: true },
        });

        test('generates exactly 80 entries across ScheduleData.updateMultipleCells without touching hidden employees or 17:30', () => {
            jest.spyOn(EmployeeManager, 'getAll').mockReturnValue(createMockEmployees());

            // Pre-existing occupied cell at 08:00 emp1 and break cell at 09:00 emp2
            const preExistingCells = {
                '8:00': {
                    emp1: { content: 'Istniejący', treatmentStartDate: '2026-10-01' },
                },
                '9:00': {
                    emp2: { isBreak: true },
                },
            };

            jest.spyOn(ScheduleData, 'getAppState').mockReturnValue({
                scheduleCells: preExistingCells,
            });

            let recordedUpdates = null;
            jest.spyOn(ScheduleData, 'updateMultipleCells').mockImplementation((updates) => {
                recordedUpdates = updates;
            });

            TestDataGenerator.init({ hostname: 'localhost' });
            TestDataGenerator.generateData(); // Defaults to 80

            expect(recordedUpdates).not.toBeNull();
            expect(recordedUpdates.length).toBe(80);

            const surnameRegex = /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+$/;
            const distinctStartDates = new Set();
            const touchedCoords = new Set();

            for (const update of recordedUpdates) {
                const { time, employeeIndex, updateFn } = update;
                touchedCoords.add(`${time}__${employeeIndex}`);

                // Never writes to hidden employee
                expect(employeeIndex).not.toBe('empHidden');
                // Never writes to 17:30
                expect(time).not.toBe('17:30');
                // Never writes to pre-existing occupied cells
                expect(`${time}__${employeeIndex}`).not.toBe('8:00__emp1');
                expect(`${time}__${employeeIndex}`).not.toBe('9:00__emp2');

                const cellState = {};
                updateFn(cellState);

                // Every content is a single-word Polish surname
                expect(cellState.content).toBeDefined();
                expect(cellState.content).toMatch(surnameRegex);
                expect(cellState.content).not.toContain(' ');
                expect(cellState.content).not.toContain('.');

                // No treatment flags or random extension days
                expect(cellState.isMassage).toBeFalsy();
                expect(cellState.isPnf).toBeFalsy();
                expect(cellState.isEveryOtherDay).toBeFalsy();
                expect(cellState.isHydrotherapy).toBeFalsy();
                expect(cellState.isBreak).toBeFalsy();
                expect(cellState.treatmentExtensionDays).toBe(0);

                // Treatment dates
                expect(cellState.treatmentStartDate).toBeDefined();
                expect(isClinicalWorkday(cellState.treatmentStartDate)).toBe(true);
                distinctStartDates.add(cellState.treatmentStartDate);

                const expectedEndDate = ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, 0);
                expect(cellState.treatmentEndDate).toBe(expectedEndDate);

                // Non-split cell properties
                expect(cellState.isSplit).toBeFalsy();
                expect(cellState.patientId).toBeDefined();
            }

            // Variety of start dates across the 80 generated entries
            expect(distinctStartDates.size).toBeGreaterThanOrEqual(5);
            // Toast notification
            expect(window.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Wygenerowano 80 nazwisk w 80 komórkach'),
                5000
            );
        });

        test('clicking #btnDevGenTestData triggers generateData with input value', () => {
            jest.spyOn(EmployeeManager, 'getAll').mockReturnValue(createMockEmployees());
            jest.spyOn(ScheduleData, 'getAppState').mockReturnValue({ scheduleCells: {} });

            let recordedUpdates = null;
            jest.spyOn(ScheduleData, 'updateMultipleCells').mockImplementation((updates) => {
                recordedUpdates = updates;
            });

            TestDataGenerator.init({ hostname: 'localhost' });
            const countInput = document.getElementById('devGeneratedPatientCount');
            countInput.value = '40';

            const btnGen = document.getElementById('btnDevGenTestData');
            btnGen.click();

            expect(recordedUpdates).not.toBeNull();
            expect(recordedUpdates.length).toBe(40);
        });
    });

    describe('scarce cells splitting (3 active employees = 63 cells, 80 entries requested)', () => {
        test('splits cells to accommodate all 80 entries when free cells < requestedCount', () => {
            const threeEmployees = {
                emp1: { displayName: 'Jan', isHidden: false },
                emp2: { displayName: 'Anna', isHidden: false },
                emp3: { displayName: 'Piotr', isHidden: false },
            };
            jest.spyOn(EmployeeManager, 'getAll').mockReturnValue(threeEmployees);
            jest.spyOn(ScheduleData, 'getAppState').mockReturnValue({ scheduleCells: {} });

            let recordedUpdates = null;
            jest.spyOn(ScheduleData, 'updateMultipleCells').mockImplementation((updates) => {
                recordedUpdates = updates;
            });

            TestDataGenerator.init({ hostname: 'localhost' });
            TestDataGenerator.generateData(80);

            // 63 total available cells (21 slots * 3 employees)
            // To fit 80 entries: 17 split cells (34 entries) + 46 single cells (46 entries) = 80 entries across 63 cells
            expect(recordedUpdates).not.toBeNull();
            expect(recordedUpdates.length).toBe(63);

            let totalGeneratedPatients = 0;
            let splitCellCount = 0;
            let singleCellCount = 0;
            const surnameRegex = /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+$/;

            for (const update of recordedUpdates) {
                const cellState = {};
                update.updateFn(cellState);

                if (cellState.isSplit) {
                    splitCellCount++;
                    totalGeneratedPatients += 2;

                    expect(cellState.content1).toMatch(surnameRegex);
                    expect(cellState.content2).toMatch(surnameRegex);
                    expect(cellState.patientId1).toBeDefined();
                    expect(cellState.patientId2).toBeDefined();
                    expect(cellState.treatmentData1).toBeDefined();
                    expect(cellState.treatmentData2).toBeDefined();
                    expect(cellState.treatmentData1.extensionDays).toBe(0);
                    expect(cellState.treatmentData2.extensionDays).toBe(0);
                    expect(isClinicalWorkday(cellState.treatmentData1.startDate)).toBe(true);
                    expect(isClinicalWorkday(cellState.treatmentData2.startDate)).toBe(true);
                    expect(cellState.treatmentData1.endDate).toBe(
                        ScheduleLogic.calculateEndDate(cellState.treatmentData1.startDate, 0)
                    );
                    expect(cellState.treatmentData2.endDate).toBe(
                        ScheduleLogic.calculateEndDate(cellState.treatmentData2.startDate, 0)
                    );
                } else {
                    singleCellCount++;
                    totalGeneratedPatients += 1;

                    expect(cellState.content).toMatch(surnameRegex);
                    expect(cellState.patientId).toBeDefined();
                    expect(cellState.treatmentExtensionDays).toBe(0);
                    expect(isClinicalWorkday(cellState.treatmentStartDate)).toBe(true);
                    expect(cellState.treatmentEndDate).toBe(
                        ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, 0)
                    );
                }
            }

            expect(splitCellCount).toBe(17);
            expect(singleCellCount).toBe(46);
            expect(totalGeneratedPatients).toBe(80);
        });
    });

    describe('clearAllData', () => {
        test('clears all occupied cells in scheduleCells and shows toast', () => {
            const initialScheduleCells = {
                '8:00': {
                    emp1: { content: 'Kowalski', treatmentStartDate: '2026-10-10' },
                    emp2: { isBreak: true },
                },
                '8:30': {
                    emp1: { isSplit: true, content1: 'Nowak', content2: 'Zieliński' },
                },
            };

            jest.spyOn(ScheduleData, 'getAppState').mockReturnValue({
                scheduleCells: initialScheduleCells,
            });

            let recordedUpdates = null;
            jest.spyOn(ScheduleData, 'updateMultipleCells').mockImplementation((updates) => {
                recordedUpdates = updates;
            });

            TestDataGenerator.init({ hostname: 'localhost' });
            TestDataGenerator.clearAllData();

            expect(recordedUpdates).not.toBeNull();
            expect(recordedUpdates.length).toBe(3);

            for (const update of recordedUpdates) {
                const cellState = { dummy: 'value', content: 'test' };
                update.updateFn(cellState);
                expect(Object.keys(cellState).length).toBe(0);
            }

            expect(window.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Wyczyszczono'),
                expect.any(Number)
            );
        });

        test('clicking #btnDevClearAllCells triggers clearAllData', () => {
            jest.spyOn(ScheduleData, 'getAppState').mockReturnValue({
                scheduleCells: {
                    '8:00': { emp1: { content: 'Kowalski' } },
                },
            });

            let recordedUpdates = null;
            jest.spyOn(ScheduleData, 'updateMultipleCells').mockImplementation((updates) => {
                recordedUpdates = updates;
            });

            TestDataGenerator.init({ hostname: 'localhost' });
            const btnClear = document.getElementById('btnDevClearAllCells');
            btnClear.click();

            expect(recordedUpdates).not.toBeNull();
            expect(recordedUpdates.length).toBe(1);
        });
    });
});

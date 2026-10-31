/**
 * @jest-environment jsdom
 */

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
                update: jest.fn(),
                onSnapshot: jest.fn(),
            })),
        })),
    },
    auth: {
        onAuthStateChanged: jest.fn(),
        currentUser: null,
    },
}));

import { ScheduleModals, openPatientAbsenceModal } from '../scripts/schedule-modals.js';
import { ScheduleUI, applyCellDataToDom } from '../scripts/schedule-ui.js';

describe('Patient Absence Modal and Navbar Absence Button', () => {
    let container;
    let toastMock;

    const setupDom = () => {
        document.body.innerHTML = `
            <div id="scheduleActionButtons" class="schedule-action-buttons">
                <button id="btnPatientInfo" class="action-icon-btn" title="Informacje o pacjencie" disabled></button>
                <button id="btnReportAbsence" class="action-icon-btn" title="Zgłoś nieobecność pacjenta" disabled></button>
                <button id="btnAddBreak" class="action-icon-btn" title="Dodaj przerwę" disabled></button>
                <button id="btnClearCell" class="action-icon-btn danger" title="Wyczyść komórkę" disabled></button>
            </div>

            <div id="patientAbsenceModal" class="modal-overlay" style="display: none">
                <div class="modal-content absence-modal-content">
                    <div class="absence-modal-header">
                        <h2 class="modal-title"><i class="fas fa-calendar-times"></i> Zgłoś nieobecność pacjenta</h2>
                        <div id="absencePatientSubhead" class="absence-patient-subhead"></div>
                    </div>
                    <div class="modal-body">
                        <div class="absence-calendar-toolbar">
                            <button type="button" id="absencePrevMonthBtn" class="action-btn outline btn-sm" title="Poprzedni miesiąc">&lt;</button>
                            <span id="absenceMonthYearLabel" class="absence-month-label"></span>
                            <button type="button" id="absenceNextMonthBtn" class="action-btn outline btn-sm" title="Następny miesiąc">&gt;</button>
                        </div>
                        <div id="absenceCalendarGrid" class="absence-calendar-grid"></div>
                        <div class="absence-legend">
                            <span class="absence-legend-item"><span class="absence-dot turnus-dot"></span> W turnusie</span>
                            <span class="absence-legend-item"><span class="absence-dot absent-dot"></span> Nieobecność (⚠️)</span>
                            <span class="absence-legend-item"><span class="absence-dot today-dot"></span> Dzisiaj</span>
                        </div>
                        <div id="absenceSelectedSummary" class="absence-selected-summary">
                            Liczba wybranych dni: <strong id="absenceSelectedCount">0</strong>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" id="clearAbsencesBtn" class="action-btn outline danger">Wyczyść wszystkie</button>
                        <button type="button" id="saveAbsenceModal" class="action-btn primary">Zapisz</button>
                        <button type="button" id="closeAbsenceModal" class="action-btn outline">Anuluj</button>
                    </div>
                </div>
            </div>

            <table id="mainScheduleTable">
                <tbody>
                    <tr>
                        <td id="patientCell" class="editable-cell" data-time="08:00" data-employee-index="0">Jan Kowalski</td>
                        <td id="breakCell" class="editable-cell break-cell" data-time="08:30" data-employee-index="0">Przerwa</td>
                        <td id="hydroCell" class="editable-cell hydrotherapy-cell" data-time="09:00" data-employee-index="0">Hydro.</td>
                        <td id="emptyCell" class="editable-cell" data-time="09:30" data-employee-index="0"></td>
                        <td id="splitCell" class="editable-cell split-cell" data-time="10:00" data-employee-index="0">
                            <div class="split-cell-wrapper">
                                <div id="splitPart1" tabindex="0">Anna Nowak</div>
                                <div id="splitPart2" tabindex="0">Piotr Wiśniewski</div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        `;
        container = document.getElementById('patientAbsenceModal');
    };

    beforeEach(() => {
        toastMock = jest.fn();
        window.showToast = toastMock;
        setupDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    describe('Modal opening and subhead information', () => {
        test('aborts with toast when cell has no patient text', () => {
            const emptyCell = document.getElementById('emptyCell');
            const cellState = {};
            const callback = jest.fn();

            ScheduleModals.openPatientAbsenceModal(emptyCell, cellState, callback);

            expect(container.style.display).toBe('none');
            expect(toastMock).toHaveBeenCalledWith('Brak pacjenta w tej komórce.', 3000);
            expect(callback).not.toHaveBeenCalled();
        });

        test('opens modal and displays patient name and turnus range in subhead', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-15',
                treatmentEndDate: '2026-10-28',
                absenceDates: ['2026-10-20'],
            };
            const callback = jest.fn();

            ScheduleModals.openPatientAbsenceModal(patientCell, cellState, callback);

            expect(container.style.display).toBe('flex');
            const subhead = document.getElementById('absencePatientSubhead');
            expect(subhead.textContent).toContain('Jan Kowalski');
            expect(subhead.textContent).toContain('Turnus: 15.10.2026 - 28.10.2026');

            const monthLabel = document.getElementById('absenceMonthYearLabel');
            expect(monthLabel.textContent).toBe('Październik 2026');

            const selectedCount = document.getElementById('absenceSelectedCount');
            expect(selectedCount.textContent).toBe('1');
        });

        test('exports openPatientAbsenceModal directly', () => {
            expect(typeof openPatientAbsenceModal).toBe('function');
            expect(openPatientAbsenceModal).toBe(ScheduleModals.openPatientAbsenceModal);
        });
    });

    describe('Calendar grid, toggling dates and count updates', () => {
        test('renders weekday headers and day buttons with turnus and absence styles', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-10',
                treatmentEndDate: '2026-10-25',
                absenceDates: ['2026-10-14'],
            };

            openPatientAbsenceModal(patientCell, cellState, jest.fn());

            const grid = document.getElementById('absenceCalendarGrid');
            const weekdays = grid.querySelectorAll('.absence-weekday');
            expect(weekdays.length).toBe(7);

            const day14Btn = grid.querySelector('.absence-day-btn[data-date="2026-10-14"]');
            expect(day14Btn).not.toBeNull();
            expect(day14Btn.classList.contains('is-absent')).toBe(true);
            expect(day14Btn.classList.contains('in-turnus')).toBe(true);
            expect(day14Btn.innerHTML).toContain('⚠️');

            const day10Btn = grid.querySelector('.absence-day-btn[data-date="2026-10-10"]');
            expect(day10Btn.classList.contains('in-turnus')).toBe(true);
            expect(day10Btn.classList.contains('is-absent')).toBe(false);
        });

        test('clicking a day toggles selection and updates selected count', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
                treatmentEndDate: '2026-10-31',
                absenceDates: [],
            };

            openPatientAbsenceModal(patientCell, cellState, jest.fn());

            const countEl = document.getElementById('absenceSelectedCount');
            expect(countEl.textContent).toBe('0');

            const day12Btn = document.querySelector('.absence-day-btn[data-date="2026-10-12"]');
            expect(day12Btn).not.toBeNull();

            // Toggle on
            day12Btn.click();
            expect(countEl.textContent).toBe('1');
            const updatedDay12 = document.querySelector('.absence-day-btn[data-date="2026-10-12"]');
            expect(updatedDay12.classList.contains('is-absent')).toBe(true);

            // Toggle another day
            const day16Btn = document.querySelector('.absence-day-btn[data-date="2026-10-16"]');
            day16Btn.click();
            expect(countEl.textContent).toBe('2');

            // Toggle off day 12
            const reQueriedDay12 = document.querySelector('.absence-day-btn[data-date="2026-10-12"]');
            reQueriedDay12.click();
            expect(countEl.textContent).toBe('1');
            const finalDay12 = document.querySelector('.absence-day-btn[data-date="2026-10-12"]');
            expect(finalDay12.classList.contains('is-absent')).toBe(false);
        });
    });

    describe('Month navigation', () => {
        test('navigates to next and previous month updating month label and year', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-12-10',
                treatmentEndDate: '2026-12-24',
            };

            openPatientAbsenceModal(patientCell, cellState, jest.fn());

            const monthLabel = document.getElementById('absenceMonthYearLabel');
            expect(monthLabel.textContent).toBe('Grudzień 2026');

            const nextBtn = document.getElementById('absenceNextMonthBtn');
            nextBtn.click();
            expect(monthLabel.textContent).toBe('Styczeń 2027');

            const prevBtn = document.getElementById('absencePrevMonthBtn');
            prevBtn.click();
            expect(monthLabel.textContent).toBe('Grudzień 2026');

            prevBtn.click();
            expect(monthLabel.textContent).toBe('Listopad 2026');
        });
    });

    describe('Clearing absences', () => {
        test('clearAbsencesBtn clears all selections and updates counter', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
                treatmentEndDate: '2026-10-31',
                absenceDates: ['2026-10-05', '2026-10-06', '2026-10-07'],
            };

            openPatientAbsenceModal(patientCell, cellState, jest.fn());

            const countEl = document.getElementById('absenceSelectedCount');
            expect(countEl.textContent).toBe('3');

            const clearBtn = document.getElementById('clearAbsencesBtn');
            clearBtn.click();

            expect(countEl.textContent).toBe('0');
            const absentBtns = document.querySelectorAll('.absence-day-btn.is-absent');
            expect(absentBtns.length).toBe(0);
        });
    });

    describe('Saving absences', () => {
        test('saves sorted ISO dates to normal cell and shows toast', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
                treatmentEndDate: '2026-10-31',
                absenceDates: ['2026-10-25'],
            };
            const callback = jest.fn();

            openPatientAbsenceModal(patientCell, cellState, callback);

            // Add 2026-10-03 (before 25)
            const day3Btn = document.querySelector('.absence-day-btn[data-date="2026-10-03"]');
            day3Btn.click();

            const saveBtn = document.getElementById('saveAbsenceModal');
            saveBtn.click();

            expect(callback).toHaveBeenCalledTimes(1);
            const targetState = {};
            const updateFn = callback.mock.calls[0][0];
            updateFn(targetState);

            expect(targetState.absenceDates).toEqual(['2026-10-03', '2026-10-25']);
            expect(toastMock).toHaveBeenCalledWith('Zapisano nieobecności pacjenta (2 dni).');
            expect(container.style.display).toBe('none');
        });

        test('handles split cell part 1 correctly, updating treatmentData1.absenceDates and absenceDates1', () => {
            const splitPart1 = document.getElementById('splitPart1');
            const cellState = {
                isSplit: true,
                content1: 'Anna Nowak',
                content2: 'Piotr Wiśniewski',
                treatmentData1: { startDate: '2026-10-01', endDate: '2026-10-15', absenceDates: ['2026-10-05'] },
                treatmentData2: { startDate: '2026-10-10', endDate: '2026-10-25', absenceDates: ['2026-10-12'] },
            };
            const callback = jest.fn();

            openPatientAbsenceModal(splitPart1, cellState, callback);

            const subhead = document.getElementById('absencePatientSubhead');
            expect(subhead.textContent).toContain('Anna Nowak');

            // Add date 2026-10-08
            const day8Btn = document.querySelector('.absence-day-btn[data-date="2026-10-08"]');
            day8Btn.click();

            const saveBtn = document.getElementById('saveAbsenceModal');
            saveBtn.click();

            expect(callback).toHaveBeenCalledTimes(1);
            const targetState = {};
            const updateFn = callback.mock.calls[0][0];
            updateFn(targetState);

            expect(targetState.treatmentData1.absenceDates).toEqual(['2026-10-05', '2026-10-08']);
            expect(targetState.absenceDates1).toEqual(['2026-10-05', '2026-10-08']);
            expect(container.style.display).toBe('none');
        });

        test('handles split cell part 2 correctly', () => {
            const splitPart2 = document.getElementById('splitPart2');
            const cellState = {
                isSplit: true,
                content1: 'Anna Nowak',
                content2: 'Piotr Wiśniewski',
                treatmentData1: { startDate: '2026-10-01', endDate: '2026-10-15', absenceDates: ['2026-10-05'] },
                treatmentData2: { startDate: '2026-10-10', endDate: '2026-10-25', absenceDates: ['2026-10-12'] },
            };
            const callback = jest.fn();

            openPatientAbsenceModal(splitPart2, cellState, callback);

            const subhead = document.getElementById('absencePatientSubhead');
            expect(subhead.textContent).toContain('Piotr Wiśniewski');

            // Add date 2026-10-18
            const day18Btn = document.querySelector('.absence-day-btn[data-date="2026-10-18"]');
            day18Btn.click();

            const saveBtn = document.getElementById('saveAbsenceModal');
            saveBtn.click();

            expect(callback).toHaveBeenCalledTimes(1);
            const targetState = {
                treatmentData2: {},
            };
            const updateFn = callback.mock.calls[0][0];
            updateFn(targetState);

            expect(targetState.treatmentData2.absenceDates).toEqual(['2026-10-12', '2026-10-18']);
            expect(targetState.absenceDates2).toEqual(['2026-10-12', '2026-10-18']);
            expect(container.style.display).toBe('none');
        });

        test('shows empty toast when saving 0 absences', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
                treatmentEndDate: '2026-10-31',
                absenceDates: ['2026-10-05'],
            };
            const callback = jest.fn();

            openPatientAbsenceModal(patientCell, cellState, callback);

            const clearBtn = document.getElementById('clearAbsencesBtn');
            clearBtn.click();

            const saveBtn = document.getElementById('saveAbsenceModal');
            saveBtn.click();

            const targetState = {};
            callback.mock.calls[0][0](targetState);
            expect(targetState.absenceDates).toEqual([]);
            expect(toastMock).toHaveBeenCalledWith('Wyczyszczono nieobecności pacjenta.');
        });
    });

    describe('Keyboard and overlay interaction', () => {
        test('Escape closes modal without calling update callback', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
                treatmentEndDate: '2026-10-31',
            };
            const callback = jest.fn();

            openPatientAbsenceModal(patientCell, cellState, callback);
            expect(container.style.display).toBe('flex');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(container.style.display).toBe('none');
            expect(callback).not.toHaveBeenCalled();
        });

        test('Clicking overlay backdrop closes modal without saving', () => {
            const patientCell = document.getElementById('patientCell');
            const cellState = {
                content: 'Jan Kowalski',
                treatmentStartDate: '2026-10-01',
            };
            const callback = jest.fn();

            openPatientAbsenceModal(patientCell, cellState, callback);
            expect(container.style.display).toBe('flex');

            container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(container.style.display).toBe('none');
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('Navbar action button state management', () => {
        const updateNavbarButtons = (activeCell) => {
            const patientInfoBtn = document.getElementById('btnPatientInfo');
            const reportAbsenceBtn = document.getElementById('btnReportAbsence');
            const actionButtons = document.querySelectorAll('.schedule-action-buttons .action-icon-btn');

            actionButtons.forEach((btn) => {
                btn.classList.remove('active');
                btn.disabled = true;
            });

            if (!activeCell) return;

            actionButtons.forEach((btn) => {
                btn.classList.add('active');
                btn.disabled = false;
            });

            const hasPatient =
                !activeCell.classList.contains('break-cell') &&
                !activeCell.classList.contains('hydrotherapy-cell') &&
                (activeCell.textContent || '').trim() !== '';

            if (patientInfoBtn) {
                patientInfoBtn.classList.toggle('active', hasPatient);
                patientInfoBtn.disabled = !hasPatient;
            }
            if (reportAbsenceBtn) {
                reportAbsenceBtn.classList.toggle('active', hasPatient);
                reportAbsenceBtn.disabled = !hasPatient;
            }
        };

        test('activates #btnReportAbsence for standard patient cell', () => {
            const patientCell = document.getElementById('patientCell');
            updateNavbarButtons(patientCell);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(false);
            expect(btn.classList.contains('active')).toBe(true);
        });

        test('activates #btnReportAbsence for split cell part with patient', () => {
            const splitPart1 = document.getElementById('splitPart1');
            updateNavbarButtons(splitPart1);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(false);
            expect(btn.classList.contains('active')).toBe(true);
        });

        test('disables #btnReportAbsence for break cell', () => {
            const breakCell = document.getElementById('breakCell');
            updateNavbarButtons(breakCell);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(true);
            expect(btn.classList.contains('active')).toBe(false);
        });

        test('disables #btnReportAbsence for hydrotherapy cell', () => {
            const hydroCell = document.getElementById('hydroCell');
            updateNavbarButtons(hydroCell);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(true);
            expect(btn.classList.contains('active')).toBe(false);
        });

        test('disables #btnReportAbsence for empty cell', () => {
            const emptyCell = document.getElementById('emptyCell');
            updateNavbarButtons(emptyCell);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(true);
            expect(btn.classList.contains('active')).toBe(false);
        });

        test('disables #btnReportAbsence when active cell is cleared (null)', () => {
            updateNavbarButtons(null);

            const btn = document.getElementById('btnReportAbsence');
            expect(btn.disabled).toBe(true);
            expect(btn.classList.contains('active')).toBe(false);
        });
    });

    describe('applyCellDataToDom and patient absence badge', () => {
        const getTodayStr = () => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        };

        test('generates .patient-absence-badge with .cell-icon for single cell and ScheduleUI.getElementText strips it', () => {
            const todayStr = getTodayStr();
            const td = document.createElement('td');
            const cellObj = {
                content: 'Jan Kowalski',
                absenceDates: [todayStr],
            };

            applyCellDataToDom(td, cellObj);

            const badge = td.querySelector('.patient-absence-badge');
            expect(badge).not.toBeNull();
            expect(badge.classList.contains('cell-icon')).toBe(true);
            expect(badge.getAttribute('title')).toBe('Zgłoszona nieobecność w dniu dzisiejszym');
            expect(badge.innerHTML).toContain('fa-exclamation-triangle');

            expect(ScheduleUI.getElementText(td)).toBe('Jan Kowalski');
        });

        test('generates .patient-absence-badge with .cell-icon for split cell parts and ScheduleUI.getElementText strips it', () => {
            const todayStr = getTodayStr();
            const td = document.createElement('td');
            const cellObj = {
                isSplit: true,
                content1: 'Anna Nowak',
                content2: 'Piotr Wiśniewski',
                treatmentData1: { absenceDates: [todayStr] },
                treatmentData2: { absenceDates: ['2020-01-01'] },
            };

            applyCellDataToDom(td, cellObj);

            const part1 = td.querySelector('[data-split-part="1"]');
            const part2 = td.querySelector('[data-split-part="2"]');

            expect(part1).not.toBeNull();
            expect(part2).not.toBeNull();

            const badge1 = part1.querySelector('.patient-absence-badge');
            expect(badge1).not.toBeNull();
            expect(badge1.classList.contains('cell-icon')).toBe(true);
            expect(badge1.getAttribute('title')).toBe('Zgłoszona nieobecność w dniu dzisiejszym');
            expect(badge1.innerHTML).toContain('fa-exclamation-triangle');
            expect(ScheduleUI.getElementText(part1)).toBe('Anna Nowak');

            const badge2 = part2.querySelector('.patient-absence-badge');
            expect(badge2).toBeNull();
            expect(ScheduleUI.getElementText(part2)).toBe('Piotr Wiśniewski');
        });

        test('coexists with shared-patient-cell marker and does not collide with W', () => {
            const todayStr = getTodayStr();
            const td = document.createElement('td');
            const cellObj = {
                content: 'Maria Curie',
                isSharedPatient: true,
                absenceDates: [todayStr],
            };

            applyCellDataToDom(td, cellObj);

            expect(td.classList.contains('shared-patient-cell')).toBe(true);
            const badge = td.querySelector('.patient-absence-badge');
            expect(badge).not.toBeNull();
            expect(badge.classList.contains('cell-icon')).toBe(true);
            expect(ScheduleUI.getElementText(td)).toBe('Maria Curie');
        });
    });
});

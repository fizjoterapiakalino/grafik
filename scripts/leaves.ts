// scripts/leaves.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig, hideLoadingOverlay, UndoManager } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { LeavesSummary } from './leaves-summary.js';
import { LeavesCareSummary } from './leaves-care-summary.js';
import { CalendarModal } from './calendar-modal.js';
import { toUTCDate } from './utils.js';
import { printLeavesTableToPdf } from './leaves-pdf.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { Employee, LeaveEntry } from './types';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Stan aplikacji
 */
interface AppState {
    leaves: Record<string, LeaveEntry[]>;
}

/**
 * Interfejs publicznego API Leaves
 */
interface LeavesAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Moduł urlopów
 */
export const Leaves: LeavesAPI = (() => {
    let loadingOverlay: HTMLElement | null = null;
    let leavesTableBody: HTMLTableSectionElement | null = null;
    let leavesHeaderRow: HTMLTableRowElement | null = null;
    let monthlyViewBtn: HTMLElement | null = null;
    let summaryViewBtn: HTMLElement | null = null;
    let careViewBtn: HTMLElement | null = null;
    let monthlyViewContainer: HTMLElement | null = null;
    let careViewContainer: HTMLElement | null = null;
    let clearFiltersBtn: HTMLElement | null = null;
    let leavesFilterContainer: HTMLElement | null = null;
    let yearSelect: HTMLSelectElement | null = null;
    let currentYearBtn: HTMLElement | null = null;
    let printLeavesNavbarBtn: HTMLElement | null = null;

    const months = [
        'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
        'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
    ];

    let currentYear = new Date().getUTCFullYear();
    let activeCell: HTMLTableCellElement | null = null;
    let activeFilters = new Set<string>();

    let undoManager: InstanceType<typeof UndoManager>;
    let appState: AppState = { leaves: {} };

    const _handleAppSearch = (e: Event): void => {
        const { searchTerm } = (e as CustomEvent<{ searchTerm: string }>).detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#leavesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            tr.style.display = (tr.dataset.employee || '').toLowerCase().includes(lowerCaseSearchTerm) ? '' : 'none';
        });
    };

    const _handleTableDblClick = (event: Event): void => {
        const mouseEvent = event as MouseEvent;
        const nameCell = (mouseEvent.target as HTMLElement).closest('.employee-name-cell');
        if (nameCell) {
            const row = nameCell.closest('tr');
            const firstMonthCell = row?.querySelector('.day-cell[data-month="0"]') as HTMLTableCellElement | null;
            openCalendarForCell(firstMonthCell);
            return;
        }
        const targetCell = (mouseEvent.target as HTMLElement).closest('.day-cell') as HTMLTableCellElement | null;
        openCalendarForCell(targetCell);
    };

    const _handleTableClick = (event: Event): void => {
        const target = (event.target as HTMLElement).closest('.day-cell') as HTMLTableCellElement | null;
        setActiveCell(target);
    };

    const setActiveCell = (cell: HTMLTableCellElement | null): void => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
        }
        activeCell = cell;
        if (activeCell) {
            activeCell.classList.add('active-cell');
            activeCell.focus();
        }
    };

    const _handleArrowNavigation = (key: string): void => {
        if (!activeCell) return;

        let nextElement: HTMLTableCellElement | null = null;
        const currentRow = activeCell.closest('tr') as HTMLTableRowElement;
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(activeCell);

        switch (key) {
            case 'ArrowRight':
                nextElement = currentRow.cells[currentIndexInRow + 1] as HTMLTableCellElement | null;
                break;
            case 'ArrowLeft':
                if (currentIndexInRow > 1) {
                    nextElement = currentRow.cells[currentIndexInRow - 1] as HTMLTableCellElement | null;
                }
                break;
            case 'ArrowDown': {
                const nextRow = currentRow.nextElementSibling as HTMLTableRowElement | null;
                if (nextRow) {
                    nextElement = nextRow.cells[currentIndexInRow] as HTMLTableCellElement | null;
                }
                break;
            }
            case 'ArrowUp': {
                const prevRow = currentRow.previousElementSibling as HTMLTableRowElement | null;
                if (prevRow) {
                    nextElement = prevRow.cells[currentIndexInRow] as HTMLTableCellElement | null;
                }
                break;
            }
        }

        if (nextElement && nextElement.classList.contains('day-cell')) {
            setActiveCell(nextElement);
        }
    };

    const _handleKeyDown = (event: KeyboardEvent): void => {
        if (!activeCell) return;

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            _handleArrowNavigation(event.key);
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            openCalendarForCell(activeCell);
        }

        if (event.ctrlKey && event.key === 'z') {
            event.preventDefault();
            undoLastAction();
            return;
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clearCellLeaves(activeCell);
        }
    };

    const undoLastAction = (): void => {
        const prevState = undoManager.undo() as AppState | null;
        if (prevState) {
            const restoredLeaves = prevState.leaves;
            saveAllLeavesData(restoredLeaves).then(() => {
                refreshCurrentView();
                window.showToast('Cofnięto ostatnią zmianę.', 2000);
            });
        } else {
            window.showToast('Brak akcji do cofnięcia.', 2000);
        }
    };

    const refreshCurrentView = async (): Promise<void> => {
        if (monthlyViewBtn?.classList.contains('active')) {
            await showMonthlyView();
        } else if (summaryViewBtn?.classList.contains('active')) {
            await showSummaryView();
        } else if (careViewBtn?.classList.contains('active')) {
            await showCareView();
        }
    };

    const handleYearChange = async (e: Event): Promise<void> => {
        currentYear = parseInt((e.target as HTMLSelectElement).value, 10);
        await refreshCurrentView();
    };

    const populateYearSelect = (): void => {
        if (!yearSelect) return;
        const nowYear = new Date().getUTCFullYear();
        const startYear = nowYear - 5;
        const endYear = nowYear + 10;

        yearSelect.innerHTML = '';

        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
        yearSelect.addEventListener('change', handleYearChange);
    };

    const generateLegendAndFilters = (): void => {
        const legendContainer = document.getElementById('leavesLegend');
        if (!legendContainer) return;
        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>';
        const leaveTypeSelect = document.getElementById('leaveTypeSelect') as HTMLSelectElement | null;
        if (!leaveTypeSelect) return;

        if (activeFilters.size === 0) {
            Array.from(leaveTypeSelect.options).forEach((option) => {
                activeFilters.add(option.value);
            });
        }

        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>';
        const colors = AppConfig.leaves.leaveTypeColors as unknown as Record<string, string>;

        Array.from(leaveTypeSelect.options).forEach((option) => {
            const key = option.value;
            const color = colors[key] || colors['default'] || '#4CAF50';

            const filterItem = document.createElement('label');
            filterItem.className = 'legend-item filter-label';
            filterItem.innerHTML = `
                <input type="checkbox" class="filter-checkbox" value="${key}" ${activeFilters.has(key) ? 'checked' : ''}>
                <span class="legend-color-box" style="background-color: ${color};"></span> ${option.textContent}
            `;
            legendContainer.appendChild(filterItem);
        });

        const handleFilterChange = async (e: Event): Promise<void> => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('filter-checkbox')) {
                if (target.checked) {
                    activeFilters.add(target.value);
                } else {
                    activeFilters.delete(target.value);
                }
                const allLeaves = await getAllLeavesData();
                renderAllEmployeeLeaves(allLeaves);
            }
        };

        if (!legendContainer.hasAttribute('data-listener-attached')) {
            legendContainer.addEventListener('change', handleFilterChange);
            legendContainer.setAttribute('data-listener-attached', 'true');
        }
    };

    const init = async (): Promise<void> => {
        loadingOverlay = document.getElementById('loadingOverlay');
        leavesTableBody = document.getElementById('leavesTableBody') as HTMLTableSectionElement | null;
        leavesHeaderRow = document.getElementById('leavesHeaderRow') as HTMLTableRowElement | null;
        monthlyViewBtn = document.getElementById('monthlyViewBtn');
        summaryViewBtn = document.getElementById('summaryViewBtn');
        careViewBtn = document.getElementById('careViewBtn');
        monthlyViewContainer = document.getElementById('leavesTable');
        careViewContainer = document.getElementById('careViewContainer');
        leavesFilterContainer = document.getElementById('leavesFilterContainer');
        yearSelect = document.getElementById('yearSelect') as HTMLSelectElement | null;
        currentYearBtn = document.getElementById('currentYearBtn');
        printLeavesNavbarBtn = document.getElementById('printLeavesNavbarBtn');

        CalendarModal.init();

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();
            populateYearSelect();
            generateLegendAndFilters();
            clearFiltersBtn = document.getElementById('clearFiltersBtn');
            setupEventListeners();

            const allLeaves = await getAllLeavesData();
            appState.leaves = allLeaves;

            undoManager = new UndoManager({ maxStates: 20 });
            undoManager.initialize(appState);

            await showMonthlyView();
            highlightCurrentMonth();

            const contextMenuItems = [
                { id: 'contextOpenCalendar', action: (cell: HTMLElement) => openCalendarForCell(cell as HTMLTableCellElement) },
                { id: 'contextClearCell', action: (cell: HTMLElement) => clearCellLeaves(cell as HTMLTableCellElement) },
            ];
            window.initializeContextMenu('contextMenu', '.day-cell', contextMenuItems);
        } catch (error) {
            console.error('Błąd inicjalizacji strony urlopów:', error);
            window.showToast('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = (): void => {
        monthlyViewBtn?.removeEventListener('click', showMonthlyView);
        summaryViewBtn?.removeEventListener('click', showSummaryView);
        careViewBtn?.removeEventListener('click', showCareView);
        leavesTableBody?.removeEventListener('dblclick', _handleTableDblClick);
        leavesTableBody?.removeEventListener('click', _handleTableClick);
        document.removeEventListener('keydown', _handleKeyDown);
        document.removeEventListener('app:search', _handleAppSearch);
        clearFiltersBtn?.removeEventListener('click', handleClearFilters);
        yearSelect?.removeEventListener('change', handleYearChange);
        currentYearBtn?.removeEventListener('click', handleCurrentYearClick);
        printLeavesNavbarBtn?.removeEventListener('click', handlePrintLeaves);

        if (window.destroyContextMenu) {
            window.destroyContextMenu('contextMenu');
        }

        CalendarModal.destroy();
        activeCell = null;
        debugLog('Leaves module destroyed');
    };

    const openCalendarForCell = async (cell: HTMLTableCellElement | null): Promise<void> => {
        if (!cell) return;
        const tr = cell.closest('tr') as HTMLTableRowElement;
        const employeeName = tr.dataset.employee || '';
        const employeeId = tr.dataset.id || '';
        const monthIndex = parseInt(cell.dataset.month || '0', 10);

        try {
            const allLeaves = await getAllLeavesData();
            const existingLeaves = allLeaves[employeeName] || [];

            const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, currentYear);
            const totalLimit = (leaveInfo.entitlement || 0) + (leaveInfo.carriedOver || 0);

            const updatedLeaves = await CalendarModal.open(employeeName, existingLeaves, monthIndex, currentYear, {
                totalLimit: totalLimit,
            });

            appState.leaves = allLeaves;
            undoManager.pushState(appState);

            await saveLeavesData(employeeName, updatedLeaves);
            renderSingleEmployeeLeaves(employeeName, updatedLeaves);
        } catch (error) {
            debugLog('Operacja w kalendarzu została anulowana.', error);
            if (error !== 'Modal closed without confirmation') {
                window.showToast('Anulowano zmiany.', 2000);
            }
        }
    };

    const setupEventListeners = (): void => {
        monthlyViewBtn?.addEventListener('click', showMonthlyView);
        summaryViewBtn?.addEventListener('click', showSummaryView);
        careViewBtn?.addEventListener('click', showCareView);
        leavesTableBody?.addEventListener('dblclick', _handleTableDblClick);
        leavesTableBody?.addEventListener('click', _handleTableClick);
        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);
        clearFiltersBtn?.addEventListener('click', handleClearFilters);
        currentYearBtn?.addEventListener('click', handleCurrentYearClick);
        printLeavesNavbarBtn?.addEventListener('click', handlePrintLeaves);

        // Mobile accordion functionality
        setupMobileAccordion();
    };

    const setupMobileAccordion = (): void => {
        // Only setup on mobile screens
        if (window.innerWidth > 768) return;

        const handleCardToggle = (event: Event): void => {
            const target = event.target as HTMLElement;
            const nameCell = target.closest('.employee-name-cell, .summary-table td:first-child');

            if (nameCell) {
                const row = nameCell.closest('tr');
                if (row) {
                    row.classList.toggle('expanded');
                }
                // Prevent event from bubbling to _handleTableClick
                event.stopPropagation();
            }
        };

        leavesTableBody?.addEventListener('click', handleCardToggle, true);

        // Also setup for summary and care views
        const summaryTableBody = document.getElementById('summaryTableBody');
        const careTableBody = document.getElementById('careTableBody');
        summaryTableBody?.addEventListener('click', handleCardToggle, true);
        careTableBody?.addEventListener('click', handleCardToggle, true);
    };

    const handleClearFilters = async (): Promise<void> => {
        activeFilters.clear();
        generateLegendAndFilters();
        const allLeaves = await getAllLeavesData();
        renderAllEmployeeLeaves(allLeaves);
    };

    const showMonthlyView = async (): Promise<void> => {
        monthlyViewBtn?.classList.add('active');
        summaryViewBtn?.classList.remove('active');
        careViewBtn?.classList.remove('active');

        if (monthlyViewContainer) monthlyViewContainer.style.display = '';
        if (careViewContainer) careViewContainer.style.display = 'none';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'flex';

        generateTableHeaders();
        const employees = EmployeeManager.getAll();
        generateTableRows(employees);
        const allLeaves = await getAllLeavesData();
        renderAllEmployeeLeaves(allLeaves);
        highlightCurrentMonth();
    };

    const handleCurrentYearClick = async (): Promise<void> => {
        const now = new Date();
        const thisYear = now.getUTCFullYear();
        if (currentYear !== thisYear) {
            currentYear = thisYear;
            if (yearSelect) yearSelect.value = String(currentYear);
            await refreshCurrentView();
        } else {
            highlightCurrentMonth();
        }
    };

    const highlightCurrentMonth = (): void => {
        document.querySelectorAll('.current-month-column').forEach((el) => el.classList.remove('current-month-column'));
        document.querySelectorAll('.past-month-column').forEach((el) => el.classList.remove('past-month-column'));

        const now = new Date();
        const actualYear = now.getUTCFullYear();
        const actualMonthIndex = now.getUTCMonth();

        if (currentYear < actualYear) {
            months.forEach((_, monthIndex) => {
                _applyPastMonthHighlight(monthIndex);
            });
        } else if (currentYear === actualYear) {
            months.forEach((_, monthIndex) => {
                if (monthIndex < actualMonthIndex) {
                    _applyPastMonthHighlight(monthIndex);
                } else if (monthIndex === actualMonthIndex) {
                    _applyCurrentMonthHighlight(monthIndex);
                }
            });
        }
    };

    const _applyCurrentMonthHighlight = (monthIndex: number): void => {
        if (leavesHeaderRow && leavesHeaderRow.children[monthIndex + 1]) {
            leavesHeaderRow.children[monthIndex + 1].classList.add('current-month-column');
        }
        document.querySelectorAll(`td[data-month="${monthIndex}"]`).forEach((cell) => {
            cell.classList.add('current-month-column');
        });
    };

    const _applyPastMonthHighlight = (monthIndex: number): void => {
        if (leavesHeaderRow && leavesHeaderRow.children[monthIndex + 1]) {
            leavesHeaderRow.children[monthIndex + 1].classList.add('past-month-column');
        }
        document.querySelectorAll(`td[data-month="${monthIndex}"]`).forEach((cell) => {
            cell.classList.add('past-month-column');
        });
    };

    const showSummaryView = async (): Promise<void> => {
        monthlyViewBtn?.classList.remove('active');
        summaryViewBtn?.classList.add('active');
        careViewBtn?.classList.remove('active');

        if (monthlyViewContainer) monthlyViewContainer.style.display = '';
        if (careViewContainer) careViewContainer.style.display = 'none';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'none';

        const allLeaves = await getAllLeavesData();
        if (leavesHeaderRow && leavesTableBody) {
            LeavesSummary.render(leavesHeaderRow, leavesTableBody, allLeaves, currentYear);
        }
    };

    const showCareView = async (): Promise<void> => {
        monthlyViewBtn?.classList.remove('active');
        summaryViewBtn?.classList.remove('active');
        careViewBtn?.classList.add('active');

        if (monthlyViewContainer) monthlyViewContainer.style.display = 'none';
        if (careViewContainer) careViewContainer.style.display = 'block';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'none';

        const allLeaves = await getAllLeavesData();
        if (careViewContainer) {
            LeavesCareSummary.render(careViewContainer, allLeaves, currentYear);
        }
    };

    /**
     * Wrapper dla eksportu PDF - przekazuje aktualny rok
     */
    const handlePrintLeaves = (): void => {
        printLeavesTableToPdf({ year: currentYear });
    };

    const generateTableHeaders = (): void => {
        if (!leavesHeaderRow) return;
        leavesHeaderRow.innerHTML = `<th>Pracownik / ${currentYear}</th>`;
        months.forEach((month) => {
            const th = document.createElement('th');
            th.textContent = month;
            leavesHeaderRow!.appendChild(th);
        });
    };

    const generateTableRows = (employees: Record<string, Employee>): void => {
        if (!leavesTableBody) return;
        leavesTableBody.innerHTML = '';

        const sortedEmployees = Object.entries(employees)
            .map(([id, emp]) => ({ ...emp, id }))
            .filter((emp) => !emp.isHidden && !emp.isScheduleOnly)
            .sort((a, b) => EmployeeManager.compareEmployees(a, b));

        sortedEmployees.forEach((emp) => {
            const name = emp.displayName || emp.name;
            const tr = document.createElement('tr');
            tr.dataset.employee = name || '';
            tr.dataset.id = emp.id;

            const nameTd = document.createElement('td');
            nameTd.textContent = EmployeeManager.getFullNameById(emp.id);
            nameTd.classList.add('employee-name-cell');
            nameTd.style.cursor = 'pointer';
            nameTd.setAttribute('title', 'Dwuklik aby otworzyć kalendarz');
            tr.appendChild(nameTd);

            months.forEach((_, monthIndex) => {
                const monthTd = document.createElement('td');
                monthTd.classList.add('day-cell');
                monthTd.dataset.month = String(monthIndex);
                monthTd.setAttribute('data-label', months[monthIndex]);
                monthTd.setAttribute('tabindex', '0');
                tr.appendChild(monthTd);
            });
            leavesTableBody!.appendChild(tr);
        });
    };

    const getAllLeavesData = async (): Promise<Record<string, LeaveEntry[]>> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            return docSnap.exists ? (docSnap.data() as Record<string, LeaveEntry[]>) || {} : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    const saveLeavesData = async (employeeName: string, leaves: LeaveEntry[]): Promise<void> => {
        try {
            await db.collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .set({ [employeeName]: leaves }, { merge: true });
            window.showToast('Urlopy zapisane pomyślnie.', 2000);
        } catch (error) {
            console.error('Błąd podczas zapisu urlopów do Firestore:', error);
            window.showToast('Wystąpił błąd podczas zapisu urlopów. Spróbuj ponownie.', 5000);
        }
    };

    const updateEmployeeTooltip = (employeeRow: HTMLTableRowElement, leaves: LeaveEntry[]): void => {
        const employeeId = employeeRow.dataset.id;
        const nameCell = employeeRow.querySelector('.employee-name-cell');
        if (!nameCell || !employeeId) return;

        const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, currentYear);
        const totalLimit = (leaveInfo.entitlement || 0) + (leaveInfo.carriedOver || 0);

        let plannedDays = 0;
        leaves.forEach((leave) => {
            if (leave.type !== 'vacation' && leave.type !== undefined) return;
            if (!leave.startDate || !leave.endDate) return;

            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            const yearStart = new Date(Date.UTC(currentYear, 0, 1));
            const yearEnd = new Date(Date.UTC(currentYear, 11, 31));

            const effectiveStart = start < yearStart ? yearStart : start;
            const effectiveEnd = end > yearEnd ? yearEnd : end;

            if (effectiveStart > effectiveEnd) return;

            let current = new Date(effectiveStart);
            while (current <= effectiveEnd) {
                const dayOfWeek = current.getUTCDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                    plannedDays++;
                }
                current.setUTCDate(current.getUTCDate() + 1);
            }
        });

        nameCell.setAttribute('title', `Zaplanowano: ${plannedDays} / ${totalLimit}\nDwuklik aby otworzyć kalendarz`);
    };

    const renderAllEmployeeLeaves = (allLeaves: Record<string, LeaveEntry[]>): void => {
        Object.keys(allLeaves).forEach((employeeName) => {
            renderSingleEmployeeLeaves(employeeName, allLeaves[employeeName] || []);
        });

        leavesTableBody?.querySelectorAll('tr[data-employee]').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const employeeName = tr.dataset.employee || '';
            updateEmployeeTooltip(tr, allLeaves[employeeName] || []);
        });
    };

    const renderSingleEmployeeLeaves = (employeeName: string, leaves: LeaveEntry[]): void => {
        const employeeRow = leavesTableBody?.querySelector(`tr[data-employee="${employeeName}"]`) as HTMLTableRowElement | null;
        if (!employeeRow) return;

        employeeRow.querySelectorAll('.day-cell').forEach((cell) => {
            cell.innerHTML = '';
            cell.classList.remove('has-content');
        });

        const filteredLeaves = leaves
            .filter((leave) => {
                if (!leave.id || !leave.startDate || !leave.endDate) return false;
                if (!activeFilters.has(leave.type || 'vacation')) return false;

                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);

                if (end.getUTCFullYear() < currentYear || start.getUTCFullYear() > currentYear) return false;
                return true;
            })
            .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

        const lanes: (LeaveEntry | null)[][] = [];

        filteredLeaves.forEach((leave) => {
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            let startMonthIndex = 0;
            let endMonthIndex = 11;

            if (start.getUTCFullYear() === currentYear) startMonthIndex = start.getUTCMonth();
            else if (start.getUTCFullYear() > currentYear) startMonthIndex = 12;

            if (end.getUTCFullYear() === currentYear) endMonthIndex = end.getUTCMonth();
            else if (end.getUTCFullYear() < currentYear) endMonthIndex = -1;

            const effectiveStart = Math.max(0, startMonthIndex);
            const effectiveEnd = Math.min(11, endMonthIndex);

            if (effectiveStart > effectiveEnd) return;

            let laneIndex = 0;
            while (true) {
                if (!lanes[laneIndex]) lanes[laneIndex] = new Array(12).fill(null);

                let isLaneFree = true;
                for (let m = effectiveStart; m <= effectiveEnd; m++) {
                    if (lanes[laneIndex][m] !== null) {
                        isLaneFree = false;
                        break;
                    }
                }

                if (isLaneFree) {
                    for (let m = effectiveStart; m <= effectiveEnd; m++) {
                        lanes[laneIndex][m] = leave;
                    }
                    break;
                }
                laneIndex++;
            }
        });

        const colors = AppConfig.leaves.leaveTypeColors as unknown as Record<string, string>;

        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
            const cell = employeeRow.querySelector(`td[data-month="${monthIndex}"]`);
            if (!cell) continue;

            const monthStart = new Date(Date.UTC(currentYear, monthIndex, 1));
            const monthEnd = new Date(Date.UTC(currentYear, monthIndex + 1, 0));

            let maxLaneForMonth = -1;
            for (let l = 0; l < lanes.length; l++) {
                if (lanes[l] && lanes[l][monthIndex]) {
                    maxLaneForMonth = l;
                }
            }

            for (let l = 0; l <= maxLaneForMonth; l++) {
                const leave = lanes[l] ? lanes[l][monthIndex] : null;

                if (leave) {
                    const bgColor = colors[leave.type || 'vacation'] || colors['default'] || '#4CAF50';
                    const start = toUTCDate(leave.startDate);
                    const end = toUTCDate(leave.endDate);

                    const div = document.createElement('div');
                    div.classList.add('leave-block');
                    const leaveOption = document.querySelector(`#leaveTypeSelect option[value="${leave.type || 'vacation'}"]`);
                    const leaveTypeName = leaveOption ? leaveOption.textContent : 'Urlop';

                    // Format dates for display
                    const formatDate = (d: Date): string => {
                        return `${d.getUTCDate().toString().padStart(2, '0')}.${(d.getUTCMonth() + 1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
                    };

                    // Check if leave spans multiple months
                    const isMultiMonth = start.getUTCMonth() !== end.getUTCMonth() || start.getUTCFullYear() !== end.getUTCFullYear();

                    // Enhanced tooltip with full date range for multi-month leaves
                    let tooltipText = leaveTypeName || 'Urlop';
                    if (isMultiMonth) {
                        tooltipText = `${leaveTypeName}: ${formatDate(start)} - ${formatDate(end)}`;
                        div.setAttribute('data-full-range', `${formatDate(start)} - ${formatDate(end)}`);
                    }
                    div.setAttribute('title', tooltipText);
                    div.style.backgroundColor = bgColor;
                    div.setAttribute('data-color', bgColor);
                    div.setAttribute('data-type', leave.type || 'vacation');

                    if (start < monthStart) div.classList.add('continues-left');
                    if (end > monthEnd) div.classList.add('continues-right');

                    let text = '';
                    const displayStart = start > monthStart ? start.getUTCDate() : monthStart.getUTCDate();
                    text += `${displayStart}`;
                    const displayEnd = end < monthEnd ? end.getUTCDate() : monthEnd.getUTCDate();

                    if (displayStart !== displayEnd) {
                        text += `-${displayEnd}`;
                    }

                    // Create text span for proper centering
                    const textSpan = document.createElement('span');
                    textSpan.textContent = text;
                    div.appendChild(textSpan);

                    // Add date badge for multi-month leaves (shows on hover)
                    if (isMultiMonth && (start < monthStart || end > monthEnd)) {
                        const badge = document.createElement('span');
                        badge.className = 'leave-date-badge';
                        badge.textContent = `${formatDate(start)} → ${formatDate(end)}`;
                        div.appendChild(badge);
                    }

                    cell.appendChild(div);
                    cell.classList.add('has-content');
                } else {
                    const spacer = document.createElement('div');
                    spacer.classList.add('leave-spacer');
                    spacer.innerHTML = '&nbsp;';
                    cell.appendChild(spacer);
                }
            }
        }
    };

    const clearCellLeaves = async (cell: HTMLTableCellElement | null): Promise<void> => {
        if (!cell) return;
        const employeeName = (cell.closest('tr') as HTMLTableRowElement).dataset.employee || '';
        const monthToClear = parseInt(cell.dataset.month || '0', 10);
        try {
            const allLeaves = await getAllLeavesData();

            appState.leaves = allLeaves;
            undoManager.pushState(appState);

            const employeeLeaves = allLeaves[employeeName] || [];
            const remainingLeaves = employeeLeaves.filter((leave) => {
                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);
                return end.getUTCMonth() < monthToClear || start.getUTCMonth() > monthToClear;
            });
            await saveLeavesData(employeeName, remainingLeaves);
            renderSingleEmployeeLeaves(employeeName, remainingLeaves);
        } catch (error) {
            console.error('Błąd podczas czyszczenia urlopów w komórce:', error);
            window.showToast('Wystąpił błąd podczas czyszczenia urlopów. Spróbuj ponownie.', 5000);
        }
    };

    const saveAllLeavesData = async (allLeavesData: Record<string, LeaveEntry[]>): Promise<void> => {
        try {
            await db.collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .set(allLeavesData);
            appState.leaves = allLeavesData;
        } catch (error) {
            console.error('Błąd podczas przywracania urlopów:', error);
            throw error;
        }
    };

    return { init, destroy };
})();

// Backward compatibility
declare global {
    interface Window {
        Leaves: LeavesAPI;
    }
}

window.Leaves = Leaves;

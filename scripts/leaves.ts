// scripts/leaves.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig, hideLoadingOverlay, months } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { LeavesSummary, LeavesCareSummary } from './leaves-summary.js';
import { CalendarModal } from './calendar-modal.js';
import { toUTCDate, toDateString } from './utils.js';
import { printLeavesTableToPdf } from './leaves-pdf.js';
import { initializeContextMenu, destroyContextMenu } from './context-menu.js';
import {
    renderGanttView,
    renderMobileView,
    scrollToToday,
    setupMobileAccordion as setupGanttMobileAccordion,
    setupDragToSelect,
    setOnLeaveCreated,
    cleanupDragListeners,
    setupLeaveBarInteractions,
    cleanupLeaveBarInteractions,
    setOnLeaveUpdated,
    setOnLeaveDeleted,
    setOnLeaveTypeChanged,
    initExpandedMonths,
    setupMonthToggle,
    setOnMonthToggle,
    setCurrentViewData,
    expandAllMonths,
    collapseAllMonths,
    isMonthExpanded,
    showLeaveTypePopup as showGanttLeaveTypePopup,
    destroyGanttPopups,
} from './leaves-gantt.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { Employee, LeaveEntry } from './types';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Stan aplikacji
 */
interface AppState {
    leaves: Record<string, LeaveEntry[]>;
}

interface LeaveUndoEntry {
    employeeName: string;
    previousLeaves: LeaveEntry[];
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
    let ganttViewBtn: HTMLElement | null = null;
    let monthlyViewBtn: HTMLElement | null = null;
    let summaryViewBtn: HTMLElement | null = null;
    let careViewBtn: HTMLElement | null = null;
    let ganttViewContainer: HTMLElement | null = null;
    let ganttMobileViewContainer: HTMLElement | null = null;
    let monthlyViewContainer: HTMLElement | null = null;
    let careViewContainer: HTMLElement | null = null;
    let clearFiltersBtn: HTMLElement | null = null;
    let leavesFilterContainer: HTMLElement | null = null;
    let yearSelect: HTMLSelectElement | null = null;
    let currentYearBtn: HTMLElement | null = null;
    let toggleAllMonthsBtn: HTMLElement | null = null;
    let printLeavesNavbarBtn: HTMLElement | null = null;

    let currentYear = new Date().getUTCFullYear();
    let activeCell: HTMLTableCellElement | null = null;
    let activeFilters = new Set<string>();

    let undoLeavesBtn: HTMLButtonElement | null = null;
    let undoStack: LeaveUndoEntry[] = [];
    let unsubscribeLeaves: (() => void) | null = null;
    let pendingSnapshotRefresh = false;
    let appState: AppState = { leaves: {} };

    const updateUndoBtn = (): void => {
        if (undoLeavesBtn) {
            undoLeavesBtn.disabled = undoStack.length === 0;
        }
    };

    const pushUndo = (employeeName: string, previousLeaves: LeaveEntry[]): void => {
        undoStack.push({
            employeeName,
            previousLeaves: structuredClone(previousLeaves),
        });
        const maxStates = AppConfig.undoManager?.maxStates ?? 20;
        if (undoStack.length > maxStates) {
            undoStack.shift();
        }
        updateUndoBtn();
    };

    const getDefaultMonthCellForRow = (row: HTMLTableRowElement | null): HTMLTableCellElement | null => {
        if (!row) return null;
        const now = new Date();
        const monthIndex = currentYear === now.getUTCFullYear() ? now.getUTCMonth() : 0;
        return row.querySelector(`.day-cell[data-month="${monthIndex}"]`) as HTMLTableCellElement | null;
    };

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
            const cell = getDefaultMonthCellForRow(row);
            const rect = nameCell.getBoundingClientRect();
            if (cell) showLeaveTypePopup(cell, rect.left, rect.bottom + 8);
            return;
        }
        const targetCell = (mouseEvent.target as HTMLElement).closest('.day-cell') as HTMLTableCellElement | null;
        if (targetCell) {
            showLeaveTypePopup(targetCell, mouseEvent.clientX, mouseEvent.clientY);
        }
    };

    const _handleTableClick = (event: Event): void => {
        const element = event.target as HTMLElement;
        const removeLeaveAction = element.closest('.leave-block-remove');
        if (removeLeaveAction) {
            event.preventDefault();
            event.stopPropagation();
            const leaveBlock = removeLeaveAction.closest('.leave-block') as HTMLElement | null;
            const row = removeLeaveAction.closest('tr') as HTMLTableRowElement | null;
            if (leaveBlock?.dataset.leaveId && row?.dataset.employee) {
                void deleteSingleLeave(row.dataset.employee, leaveBlock.dataset.leaveId);
            }
            return;
        }

        const monthAction = element.closest('.month-cell-action');
        if (monthAction) {
            event.preventDefault();
            event.stopPropagation();
            const targetCell = monthAction.closest('.day-cell') as HTMLTableCellElement | null;
            const rect = monthAction.getBoundingClientRect();
            if (targetCell) showLeaveTypePopup(targetCell, rect.left, rect.bottom + 8);
            return;
        }

        const clearAction = element.closest('.month-cell-clear');
        if (clearAction) {
            event.preventDefault();
            event.stopPropagation();
            const targetCell = clearAction.closest('.day-cell') as HTMLTableCellElement | null;
            void clearCellLeaves(targetCell);
            return;
        }

        const targetCell = element.closest('.day-cell') as HTMLTableCellElement | null;
        setActiveCell(targetCell);
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
            const rect = activeCell.getBoundingClientRect();
            showLeaveTypePopup(activeCell, rect.left, rect.bottom + 8);
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

    const undoLastAction = async (): Promise<void> => {
        const entry = undoStack.pop();
        updateUndoBtn();
        if (!entry) {
            window.showToast('Brak akcji do cofnięcia.', 2000);
            return;
        }

        try {
            await saveLeavesData(entry.employeeName, entry.previousLeaves, true);
            appState.leaves[entry.employeeName] = entry.previousLeaves;
            await refreshCurrentView();
            window.showToast('Cofnięto ostatnią zmianę.', 2000);
        } catch (error) {
            console.error('Błąd podczas cofania akcji:', error);
            window.showToast('Wystąpił błąd podczas cofania zmiany.', 3500);
        }
    };

    const refreshCurrentView = async (): Promise<void> => {
        if (ganttViewBtn?.classList.contains('active')) {
            await showGanttView();
        } else if (monthlyViewBtn?.classList.contains('active')) {
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
            filterItem.className = 'filter-toggle';
            filterItem.innerHTML = `
                <input type="checkbox" class="filter-checkbox" value="${key}" ${activeFilters.has(key) ? 'checked' : ''}>
                <span class="legend-color-box" style="background-color: ${color};"></span>
                <span class="filter-toggle-text">${option.textContent}</span>
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
        ganttViewBtn = document.getElementById('ganttViewBtn');
        monthlyViewBtn = document.getElementById('monthlyViewBtn');
        summaryViewBtn = document.getElementById('summaryViewBtn');
        careViewBtn = document.getElementById('careViewBtn');
        ganttViewContainer = document.getElementById('ganttViewContainer');
        ganttMobileViewContainer = document.getElementById('ganttMobileViewContainer');
        monthlyViewContainer = document.getElementById('monthlyViewContainer');
        careViewContainer = document.getElementById('careViewContainer');
        leavesFilterContainer = document.getElementById('leavesFilterContainer');
        yearSelect = document.getElementById('yearSelect') as HTMLSelectElement | null;
        currentYearBtn = document.getElementById('currentYearBtn');
        toggleAllMonthsBtn = document.getElementById('toggleAllMonthsBtn');
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

            undoLeavesBtn = document.getElementById('undoLeavesBtn') as HTMLButtonElement | null;
            undoLeavesBtn?.addEventListener('click', undoLastAction);
            updateUndoBtn();

            // Nasłuch onSnapshot dla zmian z innych stanowisk
            unsubscribeLeaves = db.collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .onSnapshot((docSnap) => {
                    if (!docSnap.exists) return;
                    const newLeaves = (docSnap.data() as Record<string, LeaveEntry[]>) || {};
                    appState.leaves = newLeaves;
                    if (CalendarModal.isOpen && CalendarModal.isOpen()) {
                        pendingSnapshotRefresh = true;
                    } else {
                        void refreshCurrentView();
                    }
                }, (error) => {
                    console.error('Błąd nasłuchu urlopów Firestore:', error);
                });

            // Show Gantt view by default
            await showGanttView();
            highlightCurrentMonth();

            const contextMenuItems = [
                { id: 'contextOpenCalendar', action: (cell: HTMLElement) => openCalendarForCell(cell as HTMLTableCellElement) },
                { id: 'contextClearCell', action: (cell: HTMLElement) => clearCellLeaves(cell as HTMLTableCellElement) },
            ];
            initializeContextMenu('contextMenu', '.day-cell', contextMenuItems);
        } catch (error) {
            console.error('Błąd inicjalizacji strony urlopów:', error);
            window.showToast('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = (): void => {
        ganttViewBtn?.removeEventListener('click', showGanttView);
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
        toggleAllMonthsBtn?.removeEventListener('click', handleToggleAllMonths);
        printLeavesNavbarBtn?.removeEventListener('click', handlePrintLeaves);

        unsubscribeLeaves?.();
        unsubscribeLeaves = null;
        destroyGanttPopups();
        undoLeavesBtn?.removeEventListener('click', undoLastAction);
        undoLeavesBtn = null;
        undoStack = [];

        // Cleanup Gantt listeners
        cleanupDragListeners();
        cleanupLeaveBarInteractions();

        destroyContextMenu('contextMenu');

        CalendarModal.destroy();
        activeCell = null;
        debugLog('Leaves module destroyed');
    };

    const openCalendarForCell = async (cell: HTMLTableCellElement | null, defaultLeaveType?: string): Promise<void> => {
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
                defaultLeaveType: defaultLeaveType,
                visibleMonthCount: 2,
            });

            pushUndo(employeeName, existingLeaves);

            await saveLeavesData(employeeName, updatedLeaves);
            appState.leaves[employeeName] = updatedLeaves;
            renderSingleEmployeeLeaves(employeeName, updatedLeaves);
        } catch (error) {
            debugLog('Operacja w kalendarzu została anulowana.', error);
            if (error !== 'Modal closed without confirmation') {
                window.showToast('Anulowano zmiany.', 2000);
            }
        } finally {
            if (pendingSnapshotRefresh) {
                pendingSnapshotRefresh = false;
                void refreshCurrentView();
            }
        }
    };

    const showLeaveTypePopup = (cell: HTMLTableCellElement, x: number, y: number): void => {
        const row = cell.closest('tr') as HTMLTableRowElement | null;
        const employeeName = row?.dataset.employee || '';
        const monthIndex = parseInt(cell.dataset.month || '0', 10);
        const employeeLeaves = appState.leaves[employeeName] || [];

        showGanttLeaveTypePopup({
            employeeName,
            x,
            y,
            year: currentYear,
            dateSubtitle: `${months[monthIndex]} ${currentYear}`,
            leaves: employeeLeaves,
            employees: EmployeeManager.getAll(),
            onSelectType: (leaveType) => {
                void openCalendarForCell(cell, leaveType);
            },
        });
    };

    const setupEventListeners = (): void => {
        ganttViewBtn?.addEventListener('click', showGanttView);
        monthlyViewBtn?.addEventListener('click', showMonthlyView);
        summaryViewBtn?.addEventListener('click', showSummaryView);
        careViewBtn?.addEventListener('click', showCareView);
        leavesTableBody?.addEventListener('dblclick', _handleTableDblClick);
        leavesTableBody?.addEventListener('click', _handleTableClick);
        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);
        clearFiltersBtn?.addEventListener('click', handleClearFilters);
        currentYearBtn?.addEventListener('click', handleCurrentYearClick);
        toggleAllMonthsBtn?.addEventListener('click', handleToggleAllMonths);
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
    };

    const handleClearFilters = async (): Promise<void> => {
        activeFilters.clear();
        generateLegendAndFilters();
        const allLeaves = await getAllLeavesData();
        renderAllEmployeeLeaves(allLeaves);
    };

    /**
     * Show Gantt View
     */
    const showGanttView = async (): Promise<void> => {
        ganttViewBtn?.classList.add('active');
        monthlyViewBtn?.classList.remove('active');
        summaryViewBtn?.classList.remove('active');
        careViewBtn?.classList.remove('active');

        if (ganttViewContainer) ganttViewContainer.style.display = '';
        if (ganttMobileViewContainer) ganttMobileViewContainer.style.display = '';
        if (monthlyViewContainer) monthlyViewContainer.style.display = 'none';
        if (careViewContainer) careViewContainer.style.display = 'none';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'flex';
        if (toggleAllMonthsBtn) toggleAllMonthsBtn.style.display = '';

        // Initialize expanded months for current year
        initExpandedMonths(currentYear);

        const employees = EmployeeManager.getAll();
        const allLeaves = await getAllLeavesData();

        // Store current view data for popup limit validation
        setCurrentViewData(employees, allLeaves, currentYear);

        // Set callback for month toggle re-rendering
        setOnMonthToggle(() => {
            renderGanttView(employees, allLeaves, currentYear);
            setupMonthToggle();
            setupGanttInteractions();
        });

        // Render desktop Gantt view
        renderGanttView(employees, allLeaves, currentYear);

        // Render mobile list view
        if (ganttMobileViewContainer) {
            ganttMobileViewContainer.innerHTML = renderMobileView(employees, allLeaves, currentYear);
            setupGanttMobileAccordion();
        }

        // Setup month toggle click handlers
        setupMonthToggle();

        // Setup all Gantt interactions (desktop only)
        setupGanttInteractions();

        // Scroll to today's position, centered – wait for rAF + paint
        setTimeout(() => scrollToToday(), 200);
    };

    /**
     * Sprawdza nakładanie i scala urlopy tego samego typu
     */
    const mergeOrValidateLeave = (
        existingLeaves: LeaveEntry[],
        candidate: { id?: string; startDate: string; endDate: string; type: string }
    ): { success: true; mergedLeaves: LeaveEntry[] } | { success: false; reason: string } => {
        const candidateType = candidate.type || 'vacation';
        let curStart = candidate.startDate;
        let curEnd = candidate.endDate;

        // Kopia wpisów z pominięciem edytowanego urlopu (jeśli ma id)
        const others = candidate.id
            ? existingLeaves.filter(l => l.id !== candidate.id)
            : [...existingLeaves];

        // Sprawdź czy nachodzi na urlop innego typu
        const hasOtherTypeOverlap = others.some(existing => {
            const isOverlap = existing.startDate <= curEnd && existing.endDate >= curStart;
            const existingType = existing.type || 'vacation';
            return isOverlap && existingType !== candidateType;
        });

        if (hasOtherTypeOverlap) {
            return {
                success: false,
                reason: 'W wybranym terminie istnieje już inny wpis urlopowy.',
            };
        }

        // Scal wpisy tego samego typu, które nachodzą na kandydata
        const remainingLeaves: LeaveEntry[] = [];
        for (const existing of others) {
            const existingType = existing.type || 'vacation';
            const isOverlap = existing.startDate <= curEnd && existing.endDate >= curStart;

            if (isOverlap && existingType === candidateType) {
                if (existing.startDate < curStart) curStart = existing.startDate;
                if (existing.endDate > curEnd) curEnd = existing.endDate;
            } else {
                remainingLeaves.push(existing);
            }
        }

        // Ponowne sprawdzenie po ewentualnym rozszerzeniu granic
        const finalOtherTypeOverlap = remainingLeaves.some(existing => {
            const isOverlap = existing.startDate <= curEnd && existing.endDate >= curStart;
            const existingType = existing.type || 'vacation';
            return isOverlap && existingType !== candidateType;
        });

        if (finalOtherTypeOverlap) {
            return {
                success: false,
                reason: 'W wybranym terminie istnieje już inny wpis urlopowy.',
            };
        }

        const mergedEntry: LeaveEntry = {
            id: candidate.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            startDate: curStart,
            endDate: curEnd,
            type: candidateType,
        };

        remainingLeaves.push(mergedEntry);
        return { success: true, mergedLeaves: remainingLeaves };
    };

    /**
     * Handle new leave created from Gantt drag-select
     */
    const handleGanttLeaveCreated = async (
        employeeName: string,
        startDate: string,
        endDate: string,
        leaveType: string
    ): Promise<void> => {
        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];

            const validation = mergeOrValidateLeave(employeeLeaves, {
                startDate,
                endDate,
                type: leaveType,
            });

            if (!validation.success) {
                window.showToast(validation.reason, 3500);
                const employees = EmployeeManager.getAll();
                renderGanttView(employees, allLeaves, currentYear);
                setupGanttInteractions();
                return;
            }

            // Save state for undo
            pushUndo(employeeName, employeeLeaves);

            // Save to Firebase
            await saveLeavesData(employeeName, validation.mergedLeaves);
            appState.leaves[employeeName] = validation.mergedLeaves;

            // Refresh Gantt view
            const employees = EmployeeManager.getAll();
            renderGanttView(employees, appState.leaves, currentYear);
            setupGanttInteractions();

        } catch (error) {
            console.error('Błąd podczas tworzenia urlopu:', error);
            window.showToast('Wystąpił błąd podczas tworzenia urlopu. Spróbuj ponownie.', 5000);
        }
    };

    /**
     * Setup all Gantt interactions (drag, resize, click)
     */
    const setupGanttInteractions = (): void => {
        setOnLeaveCreated(handleGanttLeaveCreated);
        setOnLeaveUpdated(handleGanttLeaveUpdated);
        setOnLeaveDeleted(handleGanttLeaveDeleted);
        setOnLeaveTypeChanged(handleGanttLeaveTypeChanged);
        setupDragToSelect();
        setupLeaveBarInteractions();
    };

    /**
     * Handle leave dates updated (resize)
     */
    const handleGanttLeaveUpdated = async (
        employeeName: string,
        leaveId: string,
        newStartDate: string,
        newEndDate: string
    ): Promise<void> => {
        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];
            const leaveToUpdate = employeeLeaves.find(l => l.id === leaveId);

            if (!leaveToUpdate) return;

            const validation = mergeOrValidateLeave(employeeLeaves, {
                id: leaveId,
                startDate: newStartDate,
                endDate: newEndDate,
                type: leaveToUpdate.type || 'vacation',
            });

            if (!validation.success) {
                window.showToast(validation.reason, 3500);
                const employees = EmployeeManager.getAll();
                renderGanttView(employees, allLeaves, currentYear);
                setupGanttInteractions();
                return;
            }

            pushUndo(employeeName, employeeLeaves);

            await saveLeavesData(employeeName, validation.mergedLeaves);
            appState.leaves[employeeName] = validation.mergedLeaves;

            // Refresh view
            const employees = EmployeeManager.getAll();
            renderGanttView(employees, appState.leaves, currentYear);
            setupGanttInteractions();
        } catch (error) {
            console.error('Błąd podczas aktualizacji urlopu:', error);
            window.showToast('Wystąpił błąd podczas aktualizacji. Spróbuj ponownie.', 5000);
        }
    };

    /**
     * Handle leave deleted
     */
    const handleGanttLeaveDeleted = async (
        employeeName: string,
        leaveId: string
    ): Promise<void> => {
        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];

            pushUndo(employeeName, employeeLeaves);

            const filteredLeaves = employeeLeaves.filter(l => l.id !== leaveId);

            await saveLeavesData(employeeName, filteredLeaves);
            appState.leaves[employeeName] = filteredLeaves;
            window.showToast('Urlop został usunięty.', 2000);

            // Refresh view
            const employees = EmployeeManager.getAll();
            renderGanttView(employees, appState.leaves, currentYear);
            setupGanttInteractions();
        } catch (error) {
            console.error('Błąd podczas usuwania urlopu:', error);
            window.showToast('Wystąpił błąd podczas usuwania. Spróbuj ponownie.', 5000);
        }
    };

    /**
     * Handle leave type changed
     */
    const handleGanttLeaveTypeChanged = async (
        employeeName: string,
        leaveId: string,
        newType: string
    ): Promise<void> => {
        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];
            const leaveIndex = employeeLeaves.findIndex(l => l.id === leaveId);

            if (leaveIndex === -1) return;

            const targetLeave = employeeLeaves[leaveIndex];
            const validation = mergeOrValidateLeave(employeeLeaves, {
                id: leaveId,
                startDate: targetLeave.startDate,
                endDate: targetLeave.endDate,
                type: newType,
            });

            if (!validation.success) {
                window.showToast(validation.reason, 3500);
                const employees = EmployeeManager.getAll();
                renderGanttView(employees, allLeaves, currentYear);
                setupGanttInteractions();
                return;
            }

            pushUndo(employeeName, employeeLeaves);

            await saveLeavesData(employeeName, validation.mergedLeaves);
            appState.leaves[employeeName] = validation.mergedLeaves;
            window.showToast('Typ urlopu został zmieniony.', 2000);

            // Refresh view
            const employees = EmployeeManager.getAll();
            renderGanttView(employees, appState.leaves, currentYear);
            setupGanttInteractions();
        } catch (error) {
            console.error('Błąd podczas zmiany typu urlopu:', error);
            window.showToast('Wystąpił błąd podczas zmiany typu. Spróbuj ponownie.', 5000);
        }
    };

    const showMonthlyView = async (): Promise<void> => {
        ganttViewBtn?.classList.remove('active');
        monthlyViewBtn?.classList.add('active');
        summaryViewBtn?.classList.remove('active');
        careViewBtn?.classList.remove('active');

        if (ganttViewContainer) ganttViewContainer.style.display = 'none';
        if (ganttMobileViewContainer) ganttMobileViewContainer.style.display = 'none';
        if (monthlyViewContainer) monthlyViewContainer.style.display = '';
        if (careViewContainer) careViewContainer.style.display = 'none';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'flex';
        if (toggleAllMonthsBtn) toggleAllMonthsBtn.style.display = 'none';

        generateTableHeaders();
        const employees = EmployeeManager.getAll();
        generateTableRows(employees);
        const allLeaves = await getAllLeavesData();
        appState.leaves = allLeaves;
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

    const handleToggleAllMonths = async (): Promise<void> => {
        let allExpanded = true;
        for (let i = 0; i < 12; i++) {
            if (!isMonthExpanded(i)) {
                allExpanded = false;
                break;
            }
        }

        if (allExpanded) {
            collapseAllMonths();
        } else {
            expandAllMonths();
        }

        // Refresh view
        const employees = EmployeeManager.getAll();
        const allLeaves = await getAllLeavesData();
        renderGanttView(employees, allLeaves, currentYear);
        setupMonthToggle();
        setupGanttInteractions();
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
        ganttViewBtn?.classList.remove('active');
        monthlyViewBtn?.classList.remove('active');
        summaryViewBtn?.classList.add('active');
        careViewBtn?.classList.remove('active');

        if (ganttViewContainer) ganttViewContainer.style.display = 'none';
        if (ganttMobileViewContainer) ganttMobileViewContainer.style.display = 'none';
        if (monthlyViewContainer) monthlyViewContainer.style.display = '';
        if (careViewContainer) careViewContainer.style.display = 'none';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'none';
        if (toggleAllMonthsBtn) toggleAllMonthsBtn.style.display = 'none';

        const allLeaves = await getAllLeavesData();
        if (leavesHeaderRow && leavesTableBody) {
            LeavesSummary.render(leavesHeaderRow, leavesTableBody, allLeaves, currentYear);
        }
    };

    const showCareView = async (): Promise<void> => {
        ganttViewBtn?.classList.remove('active');
        monthlyViewBtn?.classList.remove('active');
        summaryViewBtn?.classList.remove('active');
        careViewBtn?.classList.add('active');

        if (ganttViewContainer) ganttViewContainer.style.display = 'none';
        if (ganttMobileViewContainer) ganttMobileViewContainer.style.display = 'none';
        if (monthlyViewContainer) monthlyViewContainer.style.display = 'none';
        if (careViewContainer) careViewContainer.style.display = 'block';
        if (leavesFilterContainer) leavesFilterContainer.style.display = 'none';
        if (toggleAllMonthsBtn) toggleAllMonthsBtn.style.display = 'none';

        const allLeaves = await getAllLeavesData();
        if (careViewContainer) {
            LeavesCareSummary.render(careViewContainer, allLeaves, currentYear);
        }
    };

    /**
     * Wrapper dla eksportu PDF - przekazuje aktualny rok i zapewnia wyrenderowanie tabeli
     */
    const handlePrintLeaves = async (): Promise<void> => {
        generateTableHeaders();
        const employees = EmployeeManager.getAll();
        generateTableRows(employees);
        const allLeaves = await getAllLeavesData();
        appState.leaves = allLeaves;
        renderAllEmployeeLeaves(allLeaves);

        printLeavesTableToPdf({ year: currentYear });

        if (!monthlyViewBtn?.classList.contains('active')) {
            await refreshCurrentView();
        }
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

            const fullName = EmployeeManager.getFullNameById(emp.id);
            const nameTd = document.createElement('td');
            nameTd.classList.add('employee-name-cell');
            nameTd.style.cursor = 'pointer';
            nameTd.setAttribute('title', 'Kliknij przycisk, aby dodać urlop');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'employee-name-text';
            nameSpan.textContent = fullName;
            nameTd.appendChild(nameSpan);
            tr.appendChild(nameTd);

            months.forEach((_, monthIndex) => {
                const monthTd = document.createElement('td');
                monthTd.classList.add('day-cell');
                monthTd.dataset.month = String(monthIndex);
                monthTd.setAttribute('data-label', months[monthIndex]);
                monthTd.setAttribute('tabindex', '0');
                const actionBtn = document.createElement('button');
                actionBtn.type = 'button';
                actionBtn.className = 'month-cell-action';
                actionBtn.textContent = 'Dodaj';
                actionBtn.setAttribute('aria-label', `Dodaj urlop w miesiącu ${months[monthIndex]}`);
                monthTd.appendChild(actionBtn);
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

    const saveLeavesData = async (employeeName: string, leaves: LeaveEntry[], silent = false): Promise<void> => {
        try {
            await db.collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .set({ [employeeName]: leaves }, { merge: true });
            if (!silent) {
                window.showToast('Urlopy zapisane pomyślnie.', 2000);
            }
        } catch (error) {
            console.error('Błąd podczas zapisu urlopów do Firestore:', error);
            window.showToast('Wystąpił błąd podczas zapisu urlopów. Spróbuj ponownie.', 5000);
            throw error;
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

        nameCell.setAttribute('title', `Zaplanowano: ${plannedDays} / ${totalLimit}\nUżyj przycisku Dodaj urlop, aby otworzyć kalendarz`);
    };

    const renderAllEmployeeLeaves = (allLeaves: Record<string, LeaveEntry[]>): void => {
        leavesTableBody?.querySelectorAll('tr[data-employee]').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const employeeName = tr.dataset.employee || '';
            renderSingleEmployeeLeaves(employeeName, allLeaves[employeeName] || []);
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
                    div.dataset.leaveId = leave.id;
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

                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.className = 'leave-block-remove';
                    removeButton.innerHTML = '&times;';
                    removeButton.setAttribute('aria-label', `Usuń ${leaveTypeName || 'urlop'} ${formatDate(start)} - ${formatDate(end)}`);
                    div.appendChild(removeButton);

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

            const actions = document.createElement('div');
            actions.className = 'month-cell-actions';

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'month-cell-action';
            editButton.textContent = cell.classList.contains('has-content') ? 'Edytuj' : 'Dodaj';
            editButton.setAttribute(
                'aria-label',
                `${cell.classList.contains('has-content') ? 'Edytuj' : 'Dodaj'} urlop w miesiącu ${months[monthIndex]}`
            );
            actions.appendChild(editButton);

            if (cell.classList.contains('has-content')) {
                const clearButton = document.createElement('button');
                clearButton.type = 'button';
                clearButton.className = 'month-cell-clear';
                clearButton.textContent = 'Usuń';
                clearButton.setAttribute('aria-label', `Usuń urlopy z miesiąca ${months[monthIndex]}`);
                actions.appendChild(clearButton);
            }

            cell.appendChild(actions);
        }
    };

    const deleteSingleLeave = async (employeeName: string, leaveId: string): Promise<void> => {
        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];
            const leaveToDelete = employeeLeaves.find((leave) => leave.id === leaveId);
            if (!leaveToDelete) return;

            const start = toUTCDate(leaveToDelete.startDate);
            const end = toUTCDate(leaveToDelete.endDate);
            const formatDate = (d: Date): string => `${d.getUTCDate().toString().padStart(2, '0')}.${(d.getUTCMonth() + 1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
            if (!globalThis.confirm(`Usunąć urlop ${employeeName}: ${formatDate(start)} - ${formatDate(end)}?`)) {
                return;
            }

            pushUndo(employeeName, employeeLeaves);

            const updatedLeaves = employeeLeaves.filter((leave) => leave.id !== leaveId);
            await saveLeavesData(employeeName, updatedLeaves);
            appState.leaves[employeeName] = updatedLeaves;
            renderSingleEmployeeLeaves(employeeName, updatedLeaves);
        } catch (error) {
            console.error('Błąd podczas usuwania urlopu:', error);
            window.showToast('Wystąpił błąd podczas usuwania urlopu. Spróbuj ponownie.', 5000);
        }
    };

    const clearCellLeaves = async (cell: HTMLTableCellElement | null): Promise<void> => {
        if (!cell) return;
        const employeeName = (cell.closest('tr') as HTMLTableRowElement).dataset.employee || '';
        const monthToClear = parseInt(cell.dataset.month || '0', 10);
        const monthName = months[monthToClear] || 'wybrany miesiąc';
        if (!globalThis.confirm(`Usunąć urlopy pracownika ${employeeName} widoczne w miesiącu ${monthName} ${currentYear}?`)) {
            return;
        }

        try {
            const allLeaves = await getAllLeavesData();
            const employeeLeaves = allLeaves[employeeName] || [];

            pushUndo(employeeName, employeeLeaves);

            const monthStart = new Date(Date.UTC(currentYear, monthToClear, 1));
            const monthEnd = new Date(Date.UTC(currentYear, monthToClear + 1, 0));
            const dayBeforeMonthStart = new Date(Date.UTC(currentYear, monthToClear, 0));
            const dayAfterMonthEnd = new Date(Date.UTC(currentYear, monthToClear + 1, 1));

            const remainingLeaves: LeaveEntry[] = [];
            for (const leave of employeeLeaves) {
                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);

                if (end < monthStart || start > monthEnd) {
                    remainingLeaves.push(leave);
                } else if (start >= monthStart && end <= monthEnd) {
                    continue;
                } else if (start < monthStart && end > monthEnd) {
                    remainingLeaves.push({
                        ...leave,
                        endDate: toDateString(dayBeforeMonthStart),
                    });
                    remainingLeaves.push({
                        ...leave,
                        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                        startDate: toDateString(dayAfterMonthEnd),
                    });
                } else if (start < monthStart && end >= monthStart && end <= monthEnd) {
                    remainingLeaves.push({
                        ...leave,
                        endDate: toDateString(dayBeforeMonthStart),
                    });
                } else if (start >= monthStart && start <= monthEnd && end > monthEnd) {
                    remainingLeaves.push({
                        ...leave,
                        startDate: toDateString(dayAfterMonthEnd),
                    });
                }
            }

            await saveLeavesData(employeeName, remainingLeaves);
            appState.leaves[employeeName] = remainingLeaves;
            renderSingleEmployeeLeaves(employeeName, remainingLeaves);
        } catch (error) {
            console.error('Błąd podczas czyszczenia urlopów w komórce:', error);
            window.showToast('Wystąpił błąd podczas czyszczenia urlopów. Spróbuj ponownie.', 5000);
        }
    };

    return { init, destroy };
})();

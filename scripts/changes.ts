// scripts/changes.ts
import { debugLog, AppConfig } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { escapeHTML, toUTCDate } from './utils.js';
import {
    PdfColors,
    PdfStyles,
    PdfDefaultStyle,
    PdfTableLayoutCompact,
    PdfPageConfig,
    PdfHeaderColors,
} from './pdf-config.js';
import type { FirestoreDbWrapper } from './types/firebase';
import { generateTwoWeekPeriods, type RotationPeriod as Period } from './changes-rotation.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Stan komórki w harmonogramie zmian
 */
interface ChangesCellState {
    /** Lista ID przypisanych pracowników */
    assignedEmployees?: string[];
    /** Zastępstwa urlopowe: klucz = ID pracownika na urlopie, wartość = ID zastępcy */
    substitutes?: Record<string, string>;
}

/**
 * Stan aplikacji
 */
interface AppState {
    changesCells: Record<string, Record<number, ChangesCellState>>;
}

/**
 * Wpis urlopu pracownika
 */
interface LeaveEntry {
    startDate: string;
    endDate: string;
    type: string;
}

/**
 * Interfejs publicznego API Changes
 */
interface ChangesAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Moduł harmonogramu zmian (przeglądarka i wydruk PDF)
 */
export const Changes: ChangesAPI = (() => {
    let changesTableBody: HTMLElement | null = null;
    let changesHeaderRow: HTMLElement | null = null;
    let yearSelect: HTMLSelectElement | null = null;
    let printButton: HTMLElement | null = null;
    let appState: AppState = { changesCells: {} };
    let currentYear = new Date().getUTCFullYear();
    let cachedLeavesData: Record<string, LeaveEntry[]> = {};
    let isDestroyed = false;
    let abortController: AbortController | null = null;

    const handleAppSearch = (e: Event): void => {
        const searchTerm = ((e as CustomEvent<{ searchTerm?: string }>)?.detail?.searchTerm || '').toLowerCase();
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const hasEmployee = Array.from((row as HTMLTableRowElement).cells).some((cell, index) => {
                if (index === 0) return false;
                return cell.textContent?.toLowerCase().includes(searchTerm) || false;
            });
            (row as HTMLElement).style.display = hasEmployee || searchTerm === '' ? '' : 'none';
        });
    };

    /**
     * Sprawdza czy pracownik jest na urlopie w danym okresie
     */
    const isEmployeeOnLeave = (employeeId: string, periodStart: string, periodEnd: string): boolean => {
        const employees = EmployeeManager.getAll();
        const employee = employees[employeeId];
        if (!employee) return false;

        const employeeName = employee.displayName || employee.name;
        if (!employeeName) return false;

        const employeeLeaves = cachedLeavesData[employeeName];
        if (!Array.isArray(employeeLeaves)) return false;

        const start = toUTCDate(periodStart);
        const end = toUTCDate(periodEnd);

        return employeeLeaves.some((leave) => {
            if (leave.type !== 'vacation') return false;
            const leaveStart = toUTCDate(leave.startDate);
            const leaveEnd = toUTCDate(leave.endDate);
            return !(leaveEnd < start || leaveStart > end);
        });
    };

    const renderTable = (periods: Period[]): void => {
        if (!changesHeaderRow || !changesTableBody) return;

        changesHeaderRow.innerHTML = '';
        const headers = [
            'Okres', 'HYDRO 7:00-14:30', 'MASAŻ 7-14:30', 'FIZYKO 7-14:30', 'SALA 7-14:30',
            'MASAŻ 10:30-18:00', 'FIZYKO 10:30-18:00', 'SALA 10:30-18:00', 'URLOPY',
        ];
        headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            changesHeaderRow!.appendChild(th);
        });

        changesTableBody.innerHTML = '';
        periods.forEach((period, index) => {
            const tr = document.createElement('tr');
            tr.dataset.startDate = period.start;
            tr.dataset.endDate = period.end;
            tr.dataset.periodIndex = String(index);
            const start = toUTCDate(period.start);
            const end = toUTCDate(period.end);

            tr.innerHTML = `
                <td class="period-cell">
                    <span class="collapse-toggle"><i class="fas fa-chevron-down"></i></span>
                    ${start.getUTCDate()}.${(start.getUTCMonth() + 1).toString().padStart(2, '0')} - ${end.getUTCDate()}.${(end.getUTCMonth() + 1).toString().padStart(2, '0')}
                </td>
                <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                <td class="leaves-cell"></td>
            `;
            changesTableBody!.appendChild(tr);
        });
    };

    const getAllLeavesData = async (): Promise<Record<string, unknown>> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            return docSnap.exists ? (docSnap.data() as Record<string, unknown>) || {} : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    const populateLeavesColumn = (allLeavesData: Record<string, unknown>): void => {
        const now = new Date();
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const periodStart = toUTCDate(tr.dataset.startDate || '');
            const periodEnd = toUTCDate(tr.dataset.endDate || '');
            const leavesCell = tr.querySelector('.leaves-cell');
            if (!leavesCell) return;

            let leavesHtml = '';
            const employees = EmployeeManager.getAll();

            for (const employeeId in employees) {
                const employee = employees[employeeId];
                if (employee.isHidden || employee.isScheduleOnly) continue;

                const employeeName = employee.displayName || employee.name;
                if (!employeeName) continue;
                const employeeLeaves = allLeavesData[employeeName] as LeaveEntry[] | undefined;

                if (Array.isArray(employeeLeaves)) {
                    employeeLeaves.forEach((leave) => {
                        const leaveStart = toUTCDate(leave.startDate);
                        const leaveEnd = toUTCDate(leave.endDate);

                        if (leave.type === 'vacation' && !(leaveEnd < periodStart || leaveStart > periodEnd)) {
                            const lastName = EmployeeManager.getLastNameById(employeeId);
                            const endDay = leaveEnd.getUTCDate().toString().padStart(2, '0');
                            const endMonth = (leaveEnd.getUTCMonth() + 1).toString().padStart(2, '0');

                            let dateRange = '';
                            const tooltipText = `Urlop: ${leave.startDate} - ${leave.endDate}`;

                            if (leaveStart < periodStart) {
                                dateRange = `do ${endDay}.${endMonth}`;
                            } else {
                                const startDay = leaveStart.getUTCDate().toString().padStart(2, '0');
                                const startMonth = (leaveStart.getUTCMonth() + 1).toString().padStart(2, '0');

                                if (startMonth === endMonth) {
                                    if (startDay === endDay) {
                                        dateRange = `${startDay}.${startMonth}`;
                                    } else {
                                        dateRange = `${startDay}-${endDay}.${startMonth}`;
                                    }
                                } else {
                                    dateRange = `${startDay}.${startMonth}-${endDay}.${endMonth}`;
                                }
                            }

                            const escapedName = escapeHTML(lastName || employeeName);
                            leavesHtml += `<span class="leave-entry" title="${tooltipText}">${escapedName} <small>(${dateRange})</small></span><br>`;
                        }
                    });
                }
            }
            leavesCell.innerHTML = leavesHtml;

            if (periodEnd < today) {
                tr.classList.add('past-period', 'collapsed');
                tr.classList.remove('expanded');
            } else {
                tr.classList.add('expanded');
                tr.classList.remove('collapsed');
            }
        });
    };

    const loadChanges = async (): Promise<void> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear}`);
            const prevDocRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear - 1}`);
            const [docSnap, prevDocSnap] = await Promise.all([docRef.get(), prevDocRef.get()]);

            const savedData = docSnap.exists ? (docSnap.data() as AppState | undefined) : undefined;
            const prevSavedData = prevDocSnap.exists ? (prevDocSnap.data() as AppState | undefined) : undefined;

            const mergedCells: Record<string, Record<number, ChangesCellState>> = {
                ...(prevSavedData?.changesCells || {}),
                ...(savedData?.changesCells || {}),
            };
            appState.changesCells = mergedCells;
        } catch (error) {
            console.error('Error loading changes from Firestore:', error);
        }
    };

    /**
     * Pobiera listę pracowników na urlopie w danym okresie
     */
    const getEmployeesOnLeaveForPeriod = (periodStart: string, periodEnd: string): string[] => {
        const start = toUTCDate(periodStart);
        const end = toUTCDate(periodEnd);
        const employeesOnLeave: string[] = [];
        const employees = EmployeeManager.getAll();

        for (const employeeId in employees) {
            const employee = employees[employeeId];
            if (employee.isHidden || employee.isScheduleOnly) continue;

            const employeeName = employee.displayName || employee.name;
            if (!employeeName) continue;

            const employeeLeaves = cachedLeavesData[employeeName];
            if (!Array.isArray(employeeLeaves)) continue;

            for (const leave of employeeLeaves) {
                if (leave.type !== 'vacation') continue;

                const leaveStart = toUTCDate(leave.startDate);
                const leaveEnd = toUTCDate(leave.endDate);

                if (!(leaveEnd < start || leaveStart > end)) {
                    const lastName = EmployeeManager.getLastNameById(employeeId);
                    employeesOnLeave.push(lastName || employeeName);
                    break;
                }
            }
        }
        return employeesOnLeave;
    };

    const renderChangesContent = (): void => {
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const period = tr.dataset.startDate || '';
            const periodEnd = tr.dataset.endDate || '';

            const employeesOnLeave = getEmployeesOnLeaveForPeriod(period, periodEnd);

            Array.from(tr.cells).forEach((cell, index) => {
                if (index === 0 || cell.classList.contains('leaves-cell')) return;

                const hasAssignedEmployees =
                    appState.changesCells[period]?.[index]?.assignedEmployees &&
                    appState.changesCells[period][index].assignedEmployees!.length > 0;

                if (hasAssignedEmployees) {
                    const cellState = appState.changesCells[period][index];
                    const assignedIds = cellState.assignedEmployees!;
                    const substitutes = cellState.substitutes || {};

                    const employeeNames = assignedIds.map((id) => {
                        const name = escapeHTML(EmployeeManager.getFullNameById(id));
                        const isOnLeave = isEmployeeOnLeave(id, period, periodEnd);
                        const substituteId = substitutes[id];

                        if (isOnLeave && substituteId) {
                            const substituteName = escapeHTML(EmployeeManager.getFullNameById(substituteId));
                            return `<span class="employee-on-leave">${name}</span> <span class="substitute-separator">/</span> <span class="substitute-name">${substituteName}</span>`;
                        } else if (isOnLeave) {
                            return `<span class="employee-on-leave" title="Na urlopie">${name} <span class="leave-warning-icon">⚠</span></span>`;
                        }
                        return name;
                    }).join('<br>');

                    const countBadge = `<div class="employee-count-badge">${assignedIds.length} os.</div>`;
                    cell.innerHTML = employeeNames + countBadge;
                    cell.classList.remove('has-leave-placeholder', 'empty-cell');
                } else {
                    cell.classList.add('empty-cell');

                    if (employeesOnLeave.length > 0) {
                        cell.innerHTML = `<span class="leave-placeholder">${employeesOnLeave.map((name) => escapeHTML(name)).join(', ')}</span>`;
                        cell.classList.add('has-leave-placeholder');
                    } else {
                        cell.innerHTML = '';
                        cell.classList.remove('has-leave-placeholder');
                    }
                }
            });
        });
    };

    const printChangesTableToPdf = (): void => {
        const table = document.getElementById('changesTable');
        if (!table) return;

        const tableHeaders = Array.from(table.querySelectorAll('thead th'))
            .map((th, index) => ({
                text: th.textContent || '',
                style: 'tableHeader',
                fillColor: index === 0 ? PdfHeaderColors.firstColumn : PdfHeaderColors.dataColumns,
                color: PdfHeaderColors.text,
            }));

        const tableBody = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            const tr = row as HTMLTableRowElement;
            const cells = Array.from(tr.cells);

            return cells.map((cell, cellIndex) => {
                let textContent = '';

                if (cellIndex === 0) {
                    textContent = cell.textContent || '';
                } else if (cellIndex === 8) {
                    const leaveEntries = cell.querySelectorAll('.leave-entry');
                    if (leaveEntries.length > 0) {
                        textContent = Array.from(leaveEntries)
                            .map((entry) => entry.textContent?.trim() || '')
                            .join('\n');
                    } else {
                        textContent = cell.textContent || '';
                    }
                } else {
                    const period = tr.dataset.startDate || '';
                    const cellState = appState.changesCells[period]?.[cellIndex];
                    if (cellState?.assignedEmployees) {
                        textContent = cellState.assignedEmployees.map((id) => EmployeeManager.getLastNameById(id)).join('\n');
                    }
                }

                return {
                    text: textContent,
                    fillColor: cellIndex === 0 ? PdfColors.slate100 : null,
                    alignment: cellIndex === 0 ? 'left' : 'center',
                };
            });
        });

        const docDefinition = {
            ...PdfPageConfig,
            content: [
                { text: `Grafik Zmian - ${currentYear}`, style: 'header' },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', '*', '*', '*', '*', '*', '*', '*', '*'],
                        body: [tableHeaders, ...tableBody],
                    },
                    layout: PdfTableLayoutCompact,
                },
            ],
            styles: {
                ...PdfStyles,
                tableHeader: {
                    bold: true,
                    fontSize: 10,
                    alignment: 'center' as const,
                },
            },
            defaultStyle: PdfDefaultStyle,
        };

        if (typeof pdfMake !== 'undefined') {
            pdfMake.createPdf(docDefinition).download(`grafik-zmian-${currentYear}.pdf`);
        } else {
            console.error('pdfMake is not defined');
            window.showToast('Błąd: Biblioteka PDF nie została załadowana.', 3000);
        }
    };

    const populateYearSelect = (): void => {
        if (!yearSelect) return;
        const yearNow = new Date().getUTCFullYear();
        const startYear = yearNow - 2;
        const endYear = yearNow + 5;

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
        const signal = abortController?.signal;
        yearSelect.addEventListener('change', (e) => { void handleYearChange(e); }, signal ? { signal } : undefined);
    };

    const handleYearChange = async (e: Event): Promise<void> => {
        currentYear = parseInt((e.target as HTMLSelectElement).value, 10);
        await refreshView();
    };

    const refreshView = async (): Promise<void> => {
        if (isDestroyed) return;
        const periods = generateTwoWeekPeriods(currentYear);
        renderTable(periods);
        await loadChanges();
        if (isDestroyed) return;
        const allLeaves = await getAllLeavesData();
        if (isDestroyed) return;
        cachedLeavesData = allLeaves as Record<string, LeaveEntry[]>;
        renderChangesContent();
        populateLeavesColumn(allLeaves);
    };

    const init = async (): Promise<void> => {
        isDestroyed = false;
        abortController = new AbortController();
        const { signal } = abortController;

        const getElements = (): boolean => {
            changesTableBody = document.getElementById('changesTableBody');
            changesHeaderRow = document.getElementById('changesHeaderRow');
            yearSelect = document.getElementById('changesYearSelect') as HTMLSelectElement | null;
            return !!(changesTableBody && changesHeaderRow && yearSelect);
        };

        if (!getElements()) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (isDestroyed) return;
            if (!getElements()) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (isDestroyed) return;
                if (!getElements()) {
                    console.error('Changes module: Required elements not found. Aborting initialization.');
                    return;
                }
            }
        }

        printButton = document.getElementById('printChangesTable');
        if (printButton) {
            printButton.addEventListener('click', printChangesTableToPdf, { signal });
        }

        document.getElementById('quickPlanningBtn')?.addEventListener('click', () => {
            window.location.hash = 'changes-rotation';
        }, { signal });

        document.addEventListener('app:search', handleAppSearch, { signal });

        populateYearSelect();
        await refreshView();
        if (isDestroyed) return;
        await EmployeeManager.load();
        if (isDestroyed) return;

        setupAccordion();
    };

    const setupAccordion = (): void => {
        const tableBody = document.getElementById('changesTableBody');
        if (!tableBody) return;

        const signal = abortController?.signal;

        tableBody.addEventListener('click', (event: Event) => {
            const target = event.target as HTMLElement;
            const firstCell = target.closest('td:first-child');

            if (firstCell) {
                const row = firstCell.closest('tr');
                if (row) {
                    const isCollapsed = row.classList.contains('collapsed');
                    if (isCollapsed) {
                        row.classList.remove('collapsed');
                        row.classList.add('expanded');
                    } else {
                        row.classList.add('collapsed');
                        row.classList.remove('expanded');
                    }
                }
                event.stopPropagation();
            }
        }, signal ? { capture: true, signal } : true);

        const now = new Date();
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

        const rows = tableBody.querySelectorAll('tr');
        rows.forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const startDateStr = tr.dataset.startDate;
            const endDateStr = tr.dataset.endDate;

            if (startDateStr && endDateStr) {
                const periodStart = toUTCDate(startDateStr);
                const periodEnd = toUTCDate(endDateStr);

                if (today >= periodStart && today <= periodEnd) {
                    tr.classList.add('expanded', 'current-period');
                    tr.classList.remove('collapsed');

                    setTimeout(() => {
                        if (!isDestroyed) {
                            tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 100);
                }
            }
        });
    };

    const destroy = (): void => {
        isDestroyed = true;
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        debugLog('Changes module destroyed');
    };

    return { init, destroy };
})();

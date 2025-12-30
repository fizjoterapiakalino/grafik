// scripts/leaves-summary.ts
import { EmployeeManager } from './employee-manager.js';
import { countWorkdays } from './common.js';
import type { LeaveEntry } from './types';

/**
 * Interfejs publicznego API LeavesSummary
 */
interface LeavesSummaryAPI {
    render(
        tableHeader: HTMLTableRowElement,
        tableBody: HTMLTableSectionElement,
        allLeavesData: Record<string, LeaveEntry[]>,
        year?: number
    ): void;
}

/**
 * Moduł podsumowania urlopów
 */
export const LeavesSummary: LeavesSummaryAPI = (() => {
    const getRemainingDaysColor = (days: number): string => {
        if (days > 10) return '#d4edda';
        if (days > 2) return '#fff3cd';
        if (days > 0) return '#ffeeba';
        return '#f8d7da';
    };

    const render = (
        tableHeader: HTMLTableRowElement,
        tableBody: HTMLTableSectionElement,
        allLeavesData: Record<string, LeaveEntry[]>,
        year?: number
    ): void => {
        const employees = EmployeeManager.getAll();
        const currentYear = year || new Date().getUTCFullYear();
        const summaryDate = new Date();

        const yearStart = new Date(Date.UTC(currentYear, 0, 1));
        const yearEnd = new Date(Date.UTC(currentYear, 11, 31));

        tableHeader.innerHTML = '';
        tableBody.innerHTML = '';
        tableBody.dataset.year = String(currentYear);

        tableHeader.innerHTML = `
            <th>Pracownik</th>
            <th>Należny</th>
            <th>Zaległy</th>
            <th>Łącznie</th>
            <th>Wykorzystano (${currentYear})</th>
            <th>Zaplanowano (${currentYear})</th>
            <th>Pozostało</th>
        `;

        const sortedEmployees = Object.entries(employees)
            .filter(([, emp]) => !emp.isHidden && !emp.isScheduleOnly)
            .sort(([, empA], [, empB]) => EmployeeManager.compareEmployees(empA, empB));

        sortedEmployees.forEach(([employeeId, employee]) => {
            const employeeDisplayName = employee.displayName || employee.name;
            if (!employee) return;

            const employeeLeaves = allLeavesData[employeeDisplayName || ''] || [];

            const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, currentYear);
            const entitlement = leaveInfo.entitlement;
            const carriedOver = leaveInfo.carriedOver;
            const total = entitlement + carriedOver;

            let usedDays = 0;
            let scheduledDays = 0;

            employeeLeaves.forEach((leave) => {
                const leaveStart = new Date(leave.startDate + 'T00:00:00Z');
                const leaveEnd = new Date(leave.endDate + 'T00:00:00Z');

                const start = leaveStart < yearStart ? yearStart : leaveStart;
                const end = leaveEnd > yearEnd ? yearEnd : leaveEnd;

                if (start <= end) {
                    const days = countWorkdays(
                        start.toISOString().split('T')[0],
                        end.toISOString().split('T')[0]
                    );

                    if (leave.type === 'vacation' || !leave.type) {
                        if (start > summaryDate) {
                            scheduledDays += days;
                        } else if (end <= summaryDate) {
                            usedDays += days;
                        } else {
                            if (leaveStart > summaryDate) {
                                scheduledDays += days;
                            } else {
                                usedDays += days;
                            }
                        }
                    }
                }
            });

            const remaining = total - usedDays - scheduledDays;

            const row = tableBody.insertRow();
            row.dataset.employeeId = employeeId;
            row.innerHTML = `
                <td>${EmployeeManager.getFullNameById(employeeId)}</td>
                <td>${entitlement}</td>
                <td class="editable-carried-over" contenteditable="true" 
                    title="Kliknij, aby edytować urlop zaległy"
                    style="cursor: pointer; background: #fffde7; font-weight: bold; text-align: center;">${carriedOver}</td>
                <td class="total-leave"><strong>${total}</strong></td>
                <td>${usedDays}</td>
                <td>${scheduledDays}</td>
                <td class="remaining-leave" style="background-color: ${getRemainingDaysColor(remaining)};"><strong>${remaining}</strong></td>
            `;
        });

        if (!tableBody.dataset.listenerAttached) {
            tableBody.addEventListener('blur', async (event) => {
                const target = event.target as HTMLElement;
                if (target.classList.contains('editable-carried-over')) {
                    const cell = target;
                    const row = cell.closest('tr') as HTMLTableRowElement | null;
                    if (!row) return;
                    const employeeId = row.dataset.employeeId;
                    if (!employeeId) return;
                    const newValue = parseInt(cell.textContent || '0', 10);
                    const yearForEdit = parseInt(tableBody.dataset.year || '0', 10);

                    if (isNaN(newValue) || newValue < 0) {
                        window.showToast('Proszę podać poprawną liczbę dni.', 3000);
                        const oldInfo = EmployeeManager.getLeaveInfoById(employeeId, yearForEdit);
                        cell.textContent = String(oldInfo.carriedOver);
                        return;
                    }

                    await EmployeeManager.updateCarriedOverLeave(employeeId, yearForEdit, newValue);

                    const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, yearForEdit);
                    const newTotal = leaveInfo.entitlement + newValue;

                    const used = parseInt(row.cells[4].textContent || '0', 10);
                    const scheduled = parseInt(row.cells[5].textContent || '0', 10);
                    const newRemaining = newTotal - used - scheduled;

                    const totalCell = row.querySelector('.total-leave');
                    if (totalCell) totalCell.innerHTML = `<strong>${newTotal}</strong>`;

                    const remainingCell = row.querySelector('.remaining-leave') as HTMLElement | null;
                    if (remainingCell) {
                        remainingCell.innerHTML = `<strong>${newRemaining}</strong>`;
                        remainingCell.style.backgroundColor = getRemainingDaysColor(newRemaining);
                    }

                    window.showToast(`Zaktualizowano urlop zaległy na rok ${yearForEdit}.`, 2000);
                }
            }, true);

            tableBody.addEventListener('keydown', (event) => {
                const target = event.target as HTMLElement;
                if (target.classList.contains('editable-carried-over') && (event as KeyboardEvent).key === 'Enter') {
                    event.preventDefault();
                    target.blur();
                }
            });

            tableBody.dataset.listenerAttached = 'true';
        }
    };

    return { render };
})();

// Backward compatibility
declare global {
    interface Window {
        LeavesSummary: LeavesSummaryAPI;
    }
}

window.LeavesSummary = LeavesSummary;

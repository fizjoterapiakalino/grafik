// scripts/leaves-summary.ts
import { EmployeeManager } from './employee-manager.js';
import { AppConfig, countWorkdays } from './common.js';
import { escapeHTML, toUTCDate, toDateString, formatLocalIsoDate } from './utils.js';
import type { LeaveEntry } from './types';

/**
 * Interfejs publicznego API LeavesSummary
 */
export interface LeavesSummaryAPI {
    render(
        tableHeader: HTMLTableRowElement,
        tableBody: HTMLTableSectionElement,
        allLeavesData: Record<string, LeaveEntry[]>,
        year?: number
    ): void;
}

/**
 * Interfejs publicznego API LeavesCareSummary
 */
export interface LeavesCareSummaryAPI {
    render(container: HTMLElement, allLeavesData: Record<string, LeaveEntry[]>, year?: number): void;
}

const getSortedEmployees = () =>
    Object.entries(EmployeeManager.getAll())
        .filter(([, emp]) => !emp.isHidden && !emp.isScheduleOnly)
        .sort(([, empA], [, empB]) => EmployeeManager.compareEmployees(empA, empB));

interface ClampedLeaveDays {
    days: number;
    start: Date;
    end: Date;
    leaveStart: Date;
    leaveEnd: Date;
}

const getClampedLeaveDays = (
    leave: LeaveEntry,
    yearStart: Date,
    yearEnd: Date
): ClampedLeaveDays | null => {
    const leaveStart = toUTCDate(leave.startDate);
    const leaveEnd = toUTCDate(leave.endDate);
    const start = leaveStart < yearStart ? yearStart : leaveStart;
    const end = leaveEnd > yearEnd ? yearEnd : leaveEnd;

    if (start > end) return null;

    const days = countWorkdays(
        toDateString(start),
        toDateString(end)
    );
    return { days, start, end, leaveStart, leaveEnd };
};

const getRemainingDaysColor = (days: number): string => {
    if (days > 10) return '#d4edda';
    if (days > 2) return '#fff3cd';
    if (days > 0) return '#ffeeba';
    return '#f8d7da';
};

/**
 * Moduł podsumowania urlopów
 */
export const LeavesSummary: LeavesSummaryAPI = {
    render(
        tableHeader: HTMLTableRowElement,
        tableBody: HTMLTableSectionElement,
        allLeavesData: Record<string, LeaveEntry[]>,
        year?: number
    ): void {
        const currentYear = year || new Date().getUTCFullYear();
        const todayIso = formatLocalIsoDate();
        const summaryDate = toUTCDate(todayIso);
        const yearStart = new Date(Date.UTC(currentYear, 0, 1));
        const yearEnd = new Date(Date.UTC(currentYear, 11, 31));

        tableHeader.innerHTML = `
            <th>Pracownik</th>
            <th>Należny</th>
            <th>Zaległy</th>
            <th>Łącznie</th>
            <th>Wykorzystano (${currentYear})</th>
            <th>Zaplanowano (${currentYear})</th>
            <th>Pozostało</th>
        `;
        tableBody.innerHTML = '';
        tableBody.dataset.year = String(currentYear);

        const sortedEmployees = getSortedEmployees();

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
                const clamped = getClampedLeaveDays(leave, yearStart, yearEnd);
                if (!clamped) return;

                if (leave.type === 'vacation' || !leave.type) {
                    if (clamped.start > summaryDate) {
                        scheduledDays += clamped.days;
                    } else if (clamped.end <= summaryDate) {
                        usedDays += clamped.days;
                    } else {
                        // Urlop w bieżącym roku trwa w dniu dzisiejszym (clamped.leaveStart <= summaryDate && clamped.leaveEnd > summaryDate)
                        // Dni robocze od clamped.leaveStart (przycięte do bieżącego roku) do summaryDate (włącznie) zalicz do usedDays
                        const usedWorkdays = countWorkdays(
                            toDateString(clamped.start),
                            toDateString(summaryDate)
                        );
                        usedDays += usedWorkdays;

                        // Dni robocze od summaryDate + 1 dzień UTC do clamped.leaveEnd (przycięte do bieżącego roku) zalicz do scheduledDays
                        const nextDayUtc = new Date(summaryDate.getTime() + 86400000);
                        if (nextDayUtc <= clamped.end) {
                            const scheduledWorkdays = countWorkdays(
                                toDateString(nextDayUtc),
                                toDateString(clamped.end)
                            );
                            scheduledDays += scheduledWorkdays;
                        }
                    }
                }
            });

            const remaining = total - usedDays - scheduledDays;

            const row = tableBody.insertRow();
            row.dataset.employeeId = employeeId;
            row.innerHTML = `
                <td>${escapeHTML(EmployeeManager.getFullNameById(employeeId))}</td>
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
    }
};

/**
 * Moduł podsumowania opieki
 */
export const LeavesCareSummary: LeavesCareSummaryAPI = {
    render(container: HTMLElement, allLeavesData: Record<string, LeaveEntry[]>, year?: number): void {
        container.innerHTML = '';
        const currentYear = year || new Date().getUTCFullYear();
        const yearStart = new Date(Date.UTC(currentYear, 0, 1));
        const yearEnd = new Date(Date.UTC(currentYear, 11, 31));

        const table = document.createElement('table');
        table.className = 'summary-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Pracownik</th>
                    <th>Opieka (Dziecko zdrowe do 14 r.ż) [${currentYear}]</th>
                    <th>Opieka (Dziecko chore) [${currentYear}]</th>
                    <th>Opieka (Inny członek rodziny) [${currentYear}]</th>
                    <th>Suma wykorzystana</th>
                </tr>
            </thead>
        `;

        const tbody = document.createElement('tbody');
        const sortedEmployees = getSortedEmployees();

        sortedEmployees.forEach(([id, emp]) => {
            const employeeKey = emp.displayName || emp.name;
            if (!employeeKey) return;

            const fullName = EmployeeManager.getFullNameById(id);
            const employeeLeaves = allLeavesData[employeeKey] || [];

            let usedArt188Days = 0;
            let usedSickChildDays = 0;
            let usedFamilyMemberDays = 0;

            employeeLeaves.forEach((leave) => {
                const clamped = getClampedLeaveDays(leave, yearStart, yearEnd);
                if (!clamped) return;

                switch (leave.type) {
                    case 'child_care_art_188':
                        usedArt188Days += clamped.days;
                        break;
                    case 'sick_child_care':
                        usedSickChildDays += clamped.days;
                        break;
                    case 'family_member_care':
                        usedFamilyMemberDays += clamped.days;
                        break;
                }
            });

            const totalUsed = usedArt188Days + usedSickChildDays + usedFamilyMemberDays;
            const row = document.createElement('tr');
            const art188Limit = AppConfig.leaves.careLimits.child_care_art_188;
            const sickChildLimit = AppConfig.leaves.careLimits.sick_child_care;
            const familyMemberLimit = AppConfig.leaves.careLimits.family_member_care;

            const art188Percentage = (usedArt188Days / art188Limit) * 100;
            const sickChildPercentage = (usedSickChildDays / sickChildLimit) * 100;
            const familyMemberPercentage = (usedFamilyMemberDays / familyMemberLimit) * 100;

            const getCellStyle = (percentage: number): string => `
                background: linear-gradient(to right, #e0f7fa ${percentage}%, transparent ${percentage}%);
                color: #333;
            `;

            row.innerHTML = `
                <td>${escapeHTML(fullName)}</td>
                <td style="${getCellStyle(art188Percentage)}">${usedArt188Days} / ${art188Limit} dni</td>
                <td style="${getCellStyle(sickChildPercentage)}">${usedSickChildDays} / ${sickChildLimit} dni</td>
                <td style="${getCellStyle(familyMemberPercentage)}">${usedFamilyMemberDays} / ${familyMemberLimit} dni</td>
                <td><strong>${totalUsed} dni</strong></td>
            `;
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    }
};

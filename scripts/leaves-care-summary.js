// scripts/leaves-care-summary.js
import { EmployeeManager } from './employee-manager.js';
import { AppConfig, countWorkdays } from './common.js';

export const LeavesCareSummary = (() => {
    const render = (container, allLeavesData, year) => {
        container.innerHTML = ''; // Wyczyść kontener
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
        const employees = EmployeeManager.getAll();
        const sortedEmployeeNames = Object.values(employees)
            .filter((emp) => !emp.isHidden)
            .map((emp) => emp.displayName || emp.name)
            .filter(Boolean);

        sortedEmployeeNames.forEach((employeeName) => {
            const employeeLeaves = allLeavesData[employeeName] || [];

            let usedArt188Days = 0;
            let usedSickChildDays = 0;
            let usedFamilyMemberDays = 0;

            employeeLeaves.forEach((leave) => {
                const leaveStart = new Date(leave.startDate + 'T00:00:00Z');
                const leaveEnd = new Date(leave.endDate + 'T00:00:00Z');

                // Determine intersection with the current year
                const start = leaveStart < yearStart ? yearStart : leaveStart;
                const end = leaveEnd > yearEnd ? yearEnd : leaveEnd;

                if (start <= end) {
                    const days = countWorkdays(
                        start.toISOString().split('T')[0],
                        end.toISOString().split('T')[0]
                    );

                    switch (leave.type) {
                        case 'child_care_art_188':
                            usedArt188Days += days;
                            break;
                        case 'sick_child_care':
                            usedSickChildDays += days;
                            break;
                        case 'family_member_care':
                            usedFamilyMemberDays += days;
                            break;
                    }
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

            const getCellStyle = (percentage) => `
                background: linear-gradient(to right, #e0f7fa ${percentage}%, transparent ${percentage}%);
                color: #333;
            `;

            row.innerHTML = `
                <td>${employeeName}</td>
                <td style="${getCellStyle(art188Percentage)}">${usedArt188Days} / ${art188Limit} dni</td>
                <td style="${getCellStyle(sickChildPercentage)}">${usedSickChildDays} / ${sickChildLimit} dni</td>
                <td style="${getCellStyle(familyMemberPercentage)}">${usedFamilyMemberDays} / ${familyMemberLimit} dni</td>
                <td><strong>${totalUsed} dni</strong></td>
            `;
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    };

    return {
        render,
    };
})();

// Backward compatibility
window.LeavesCareSummary = LeavesCareSummary;

const LeavesCareSummary = (() => {
    const render = (container, allLeavesData) => {
        container.innerHTML = ''; // Wyczyść kontener

        const table = document.createElement('table');
        table.className = 'summary-table';

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Pracownik</th>
                    <th>Opieka (Dziecko zdrowe do 14 r.ż)</th>
                    <th>Opieka (Dziecko chore)</th>
                    <th>Opieka (Inny członek rodziny)</th>
                    <th>Suma wykorzystana</th>
                </tr>
            </thead>
        `;

        const tbody = document.createElement('tbody');
        const employees = EmployeeManager.getAll();
        const sortedEmployeeNames = Object.values(employees).map(emp => emp.name).filter(Boolean).sort();

        sortedEmployeeNames.forEach(employeeName => {
            const employeeLeaves = allLeavesData[employeeName] || [];

            let usedArt188Days = 0;
            let usedSickChildDays = 0;
            let usedFamilyMemberDays = 0;

            employeeLeaves.forEach(leave => {
                const days = countWorkdays(leave.startDate, leave.endDate);
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
            });

            const totalUsed = usedArt188Days + usedSickChildDays + usedFamilyMemberDays;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${employeeName}</td>
                <td>${usedArt188Days} / ${AppConfig.leaves.careLimits.child_care_art_188} dni</td>
                <td>${usedSickChildDays} / ${AppConfig.leaves.careLimits.sick_child_care} dni</td>
                <td>${usedFamilyMemberDays} / ${AppConfig.leaves.careLimits.family_member_care} dni</td>
                <td><strong>${totalUsed} dni</strong></td>
            `;
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    };

    return {
        render
    };
})();

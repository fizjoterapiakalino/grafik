// scripts/leaves-summary.js
import { EmployeeManager } from './employee-manager.js';
import { countWorkdays } from './common.js';

export const LeavesSummary = (() => {
    /**
     * Zwraca kolor tła w zależności od liczby pozostałych dni urlopu.
     * @param {number} days - Liczba pozostałych dni.
     * @returns {string} Kolor tła w formacie hex.
     */
    const getRemainingDaysColor = (days) => {
        if (days > 10) return '#d4edda'; // Zielony
        if (days > 2) return '#fff3cd'; // Żółty
        if (days > 0) return '#ffeeba'; // Pomarańczowy
        return '#f8d7da'; // Czerwony
    };

    /**
     * Renderuje tabelę podsumowania rocznego urlopów w istniejącej strukturze tabeli.
     * @param {HTMLElement} tableHeader - Element <tr> nagłówka tabeli.
     * @param {HTMLElement} tableBody - Element <tbody> tabeli.
     * @param {object} allLeavesData - Obiekt z danymi urlopowymi wszystkich pracowników.
     * @param {number} [year] - Rok, dla którego generowane jest podsumowanie.
     */
    const render = (tableHeader, tableBody, allLeavesData, year) => {
        const employees = EmployeeManager.getAll();
        const currentYear = year || new Date().getUTCFullYear();
        const summaryDate = new Date(); // Do określenia czy urlop jest przeszły czy przyszły

        const yearStart = new Date(Date.UTC(currentYear, 0, 1));
        const yearEnd = new Date(Date.UTC(currentYear, 11, 31));

        // Wyczyść istniejącą zawartość tabeli
        tableHeader.innerHTML = '';
        tableBody.innerHTML = '';

        // Wygeneruj nowy nagłówek dla podsumowania
        tableHeader.innerHTML = `
            <th>Pracownik</th>
            <th>Należny</th>
            <th>Zaległy</th>
            <th>Łącznie</th>
            <th>Wykorzystano (${currentYear})</th>
            <th>Zaplanowano (${currentYear})</th>
            <th>Pozostało</th>
        `;

        // Przetwórz dane i wygeneruj wiersze
        for (const employeeId in employees) {
            const employee = employees[employeeId];
            if (employee.isHidden) continue;
            const employeeDisplayName = employee.displayName || employee.name;
            if (!employee || !employeeDisplayName) continue;

            const employeeLeaves = allLeavesData[employeeDisplayName] || [];

            const entitlement = employee.leaveEntitlement || 0;
            const carriedOver = employee.carriedOverLeave || 0;
            const total = entitlement + carriedOver;

            let usedDays = 0;
            let scheduledDays = 0;

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

                    // FIX: Only count days if leave type is 'vacation' (or missing, assuming default is vacation)
                    // We should not subtract 'sick_child_care', 'child_care_art_188' etc. from entitlement.
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
            row.innerHTML = `
                <td>${employeeDisplayName}</td>
                <td>${entitlement}</td>
                <td>${carriedOver}</td>
                <td><strong>${total}</strong></td>
                <td>${usedDays}</td>
                <td>${scheduledDays}</td>
                <td style="background-color: ${getRemainingDaysColor(remaining)};"><strong>${remaining}</strong></td>
            `;
        }
    };

    // Publiczne API modułu
    return {
        render,
    };
})();

// Backward compatibility
window.LeavesSummary = LeavesSummary;

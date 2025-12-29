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
        tableBody.dataset.year = currentYear; // Przechowuj rok w dataset dla event listenera

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
        const sortedEmployees = Object.entries(employees)
            .filter(([_, emp]) => !emp.isHidden && !emp.isScheduleOnly)
            .sort(([, empA], [, empB]) => EmployeeManager.compareEmployees(empA, empB));

        sortedEmployees.forEach(([employeeId, employee]) => {
            const employeeDisplayName = employee.displayName || employee.name;
            if (!employee) return;

            const employeeLeaves = allLeavesData[employeeDisplayName] || [];

            const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, currentYear);
            const entitlement = leaveInfo.entitlement;
            const carriedOver = leaveInfo.carriedOver;
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

        // Dodaj obsługę edycji (jeśli jeszcze nie ma - delegacja na tableBody)
        if (!tableBody.dataset.listenerAttached) {
            tableBody.addEventListener('blur', async (event) => {
                if (event.target.classList.contains('editable-carried-over')) {
                    const cell = event.target;
                    const row = cell.closest('tr');
                    const employeeId = row.dataset.employeeId;
                    const newValue = parseInt(cell.textContent, 10);
                    const yearForEdit = parseInt(tableBody.dataset.year, 10);

                    if (isNaN(newValue) || newValue < 0) {
                        window.showToast('Proszę podać poprawną liczbę dni.', 3000, 'error');
                        const oldInfo = EmployeeManager.getLeaveInfoById(employeeId, yearForEdit);
                        cell.textContent = oldInfo.carriedOver;
                        return;
                    }

                    // Zapisz zmianę
                    await EmployeeManager.updateCarriedOverLeave(employeeId, yearForEdit, newValue);

                    // Zaktualizuj widok wiersza (jeśli chcemy bez pełnego renderowania)
                    const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, yearForEdit);
                    const total = leaveInfo.entitlement + newValue;

                    // Ponowne obliczenie remaining (można to zrobić lepiej, ale tu upraszczamy)
                    // Pobieramy dane z wiersza
                    const used = parseInt(row.cells[4].textContent, 10);
                    const scheduled = parseInt(row.cells[5].textContent, 10);
                    const remaining = total - used - scheduled;

                    row.querySelector('.total-leave').innerHTML = `<strong>${total}</strong>`;
                    const remainingCell = row.querySelector('.remaining-leave');
                    remainingCell.innerHTML = `<strong>${remaining}</strong>`;
                    remainingCell.style.backgroundColor = getRemainingDaysColor(remaining);

                    window.showToast(`Zaktualizowano urlop zaległy na rok ${yearForEdit}.`, 2000);
                }
            }, true); // useCapture for blur

            tableBody.addEventListener('keydown', (event) => {
                if (event.target.classList.contains('editable-carried-over') && event.key === 'Enter') {
                    event.preventDefault();
                    event.target.blur();
                }
            });

            tableBody.dataset.listenerAttached = 'true';
        }
    };

    // Publiczne API modułu
    return {
        render,
    };
})();

// Backward compatibility
window.LeavesSummary = LeavesSummary;

// scripts/changes.js
import { db } from './firebase-config.js';
import { AppConfig, isHoliday } from './common.js';
import { EmployeeManager } from './employee-manager.js';

export const Changes = (() => {
    let changesTableBody, changesHeaderRow;
    let appState = {
        changesCells: {},
    };
    let activeCell = null;
    let currentYear = new Date().getUTCFullYear();
    let yearSelect;
    let clipboard = null;

    const isWeekend = (date) => {
        const day = date.getUTCDay();
        return day === 0 || day === 6; // Niedziela lub Sobota
    };

    const handleAppSearch = (e) => {
        const { searchTerm } = e.detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const hasEmployee = Array.from(row.cells).some((cell, index) => {
                if (index === 0) return false; // Skip period column
                return cell.textContent.toLowerCase().includes(lowerCaseSearchTerm);
            });
            row.style.display = hasEmployee || lowerCaseSearchTerm === '' ? '' : 'none';
        });
    };

    const copyCell = (cell) => {
        if (!cell) return;
        const period = cell.parentElement.dataset.startDate;
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex];

        if (cellState && cellState.assignedEmployees) {
            clipboard = [...cellState.assignedEmployees];
            window.showToast('Skopiowano.');
        } else {
            clipboard = [];
            window.showToast('Skopiowano pustą komórkę.');
        }
    };

    const pasteCell = (cell) => {
        if (!cell || !clipboard) return;

        updateCellState(cell, (state) => {
            state.assignedEmployees = [...clipboard];
        });
        window.showToast('Wklejono.');
    };

    const clearCell = (cell) => {
        if (!cell) return;
        updateCellState(cell, (state) => {
            state.assignedEmployees = [];
        });
        window.showToast('Wyczyszczono.');
    };

    const generateTwoWeekPeriods = (year) => {
        const periods = [];
        let currentDate = new Date(Date.UTC(year, 0, 1));

        // Idziemy wstecz do najbliższego poniedziałku, aby objąć tydzień w którym wypada 1 stycznia.
        // To rozwiązuje problem przesunięcia o tydzień (np. start 30 grudnia zamiast 6 stycznia).
        while (currentDate.getUTCDay() !== 1) {
            currentDate.setUTCDate(currentDate.getUTCDate() - 1);
        }

        while (currentDate.getUTCFullYear() <= year) {
            const startDate = new Date(currentDate);
            let endDate = new Date(startDate);
            let workDaysCount = 0;

            while (workDaysCount < 10) {
                if (!isWeekend(endDate)) {
                    workDaysCount++;
                }
                if (workDaysCount < 10) {
                    endDate.setUTCDate(endDate.getUTCDate() + 1);
                }
            }

            periods.push({
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            });

            currentDate = new Date(endDate);
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            while (isWeekend(currentDate)) {
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
        return periods;
    };

    const renderTable = (periods) => {
        changesHeaderRow.innerHTML = '';
        const headers = [
            'Okres',
            'HYDRO 7:00-14:30',
            'MASAŻ 7-14:30',
            'FIZYKO 7-14:30',
            'SALA 7-14:30',
            'MASAŻ 10:30-18:00',
            'FIZYKO 10:30-18:00',
            'SALA 10:30-18:00',
            'URLOPY',
        ];
        headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            changesHeaderRow.appendChild(th);
        });

        changesTableBody.innerHTML = '';
        periods.forEach((period) => {
            const tr = document.createElement('tr');
            tr.dataset.startDate = period.start;
            tr.dataset.endDate = period.end;
            const start = new Date(period.start);
            const end = new Date(period.end);
            tr.innerHTML = `
                <td>${start.getUTCDate()}.${(start.getUTCMonth() + 1).toString().padStart(2, '0')} - ${end.getUTCDate()}.${(end.getUTCMonth() + 1).toString().padStart(2, '0')}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td class="leaves-cell"></td>
            `;
            changesTableBody.appendChild(tr);
        });

        // Make cells editable
        document.querySelectorAll('#changesTableBody td').forEach((cell) => {
            if (!cell.classList.contains('leaves-cell')) {
                cell.addEventListener('click', handleCellClick);
            }
        });
    };

    const getAllLeavesData = async () => {
        try {
            const docRef = db
                .collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves);
            const doc = await docRef.get();
            return doc.exists ? doc.data() : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    const populateLeavesColumn = (allLeavesData) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const periodStart = new Date(row.dataset.startDate);
            const periodEnd = new Date(row.dataset.endDate);
            const leavesCell = row.querySelector('.leaves-cell');
            let leavesHtml = '';

            const employees = EmployeeManager.getAll();

            for (const employeeId in employees) {
                const employee = employees[employeeId];
                if (employee.isHidden || employee.isScheduleOnly) continue;

                const employeeName = employee.displayName || employee.name;
                const employeeLeaves = allLeavesData[employeeName];

                if (Array.isArray(employeeLeaves)) {
                    employeeLeaves.forEach((leave) => {
                        const leaveStart = new Date(leave.startDate);
                        const leaveEnd = new Date(leave.endDate);

                        if (leave.type === 'vacation' && !(leaveEnd < periodStart || leaveStart > periodEnd)) {
                            const lastName = EmployeeManager.getLastNameById(employeeId);
                            // Fallback to full name if last name is not available
                            leavesHtml += `${lastName || employeeName}<br>`;
                        }
                    });
                }
            }
            leavesCell.innerHTML = leavesHtml;

            if (periodEnd < today) {
                row.classList.add('past-period');
            }
        });
    };

    const handleCellClick = (event) => {
        const cell = event.target.closest('td');
        if (!cell) return;
        activeCell = cell;
        openEmployeeSelectionModal(cell);
    };

    const openEmployeeSelectionModal = (cell) => {
        const modal = document.getElementById('employeeSelectionModal');
        const employeeListDiv = document.getElementById('employeeList');
        const saveBtn = document.getElementById('saveEmployeeSelection');
        const cancelBtn = document.getElementById('cancelEmployeeSelection');
        const searchInput = document.getElementById('employeeSearchInput');

        employeeListDiv.innerHTML = ''; // Clear list
        searchInput.value = ''; // Clear search input

        const allEmployees = Object.fromEntries(
            Object.entries(EmployeeManager.getAll()).filter(([, employee]) => !employee.isHidden && !employee.isScheduleOnly),
        );
        const period = cell.parentElement.dataset.startDate;
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex] || {};
        const assignedEmployees = new Set(cellState.assignedEmployees || []);

        const allAssignedEmployeesInRow = new Set();
        if (appState.changesCells[period]) {
            Object.values(appState.changesCells[period]).forEach((cellData) => {
                if (cellData.assignedEmployees) {
                    cellData.assignedEmployees.forEach((id) => allAssignedEmployeesInRow.add(id));
                }
            });
        }

        for (const id in allEmployees) {
            const employee = allEmployees[id];
            const employeeEl = document.createElement('div');
            employeeEl.classList.add('employee-list-item');
            employeeEl.textContent = EmployeeManager.getFullNameById(id);
            employeeEl.dataset.employeeId = id;

            if (assignedEmployees.has(id)) {
                employeeEl.classList.add('selected-employee');
            }

            // Removed uniqueness constraint to allow duplicate employees
            // if (allAssignedEmployeesInRow.has(id) && !assignedEmployees.has(id)) {
            //     employeeEl.classList.add('disabled-employee');
            // }

            employeeEl.addEventListener('click', () => {
                // if (!employeeEl.classList.contains('disabled-employee')) {
                employeeEl.classList.toggle('selected-employee');
                // }
            });

            employeeListDiv.appendChild(employeeEl);
        }

        const filterEmployees = () => {
            const searchTerm = searchInput.value.toLowerCase();
            employeeListDiv.querySelectorAll('.employee-list-item').forEach((item) => {
                if (item.textContent.toLowerCase().includes(searchTerm)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        };

        searchInput.addEventListener('input', filterEmployees);

        modal.style.display = 'flex';

        const closeModal = () => {
            modal.style.display = 'none';
            saveBtn.onclick = null;
            cancelBtn.onclick = null;
            searchInput.removeEventListener('input', filterEmployees);
        };

        saveBtn.onclick = () => {
            const selectedEmployees = [];
            employeeListDiv.querySelectorAll('.selected-employee').forEach((el) => {
                selectedEmployees.push(el.dataset.employeeId);
            });

            updateCellState(cell, (state) => {
                state.assignedEmployees = selectedEmployees;
            });
            window.showToast('Zapisano zmiany.');
            closeModal();
        };

        cancelBtn.onclick = closeModal;
    };

    const updateCellState = (cell, updateFn) => {
        if (!cell) return;
        const period = cell.parentElement.dataset.startDate;
        const columnIndex = cell.cellIndex;
        if (!appState.changesCells[period]) appState.changesCells[period] = {};
        let cellState = appState.changesCells[period][columnIndex] || {};

        updateFn(cellState);

        appState.changesCells[period][columnIndex] = cellState;

        renderChangesAndSave();
    };

    const saveChanges = async () => {
        try {
            await db
                .collection(AppConfig.firestore.collections.schedules)
                .doc(`changesSchedule_${currentYear}`)
                .set(appState, { merge: true });
            window.setSaveStatus('saved');
        } catch (error) {
            console.error('Error saving changes to Firestore:', error);
            window.setSaveStatus('error');
        }
    };

    const loadChanges = async () => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear}`);
            const doc = await docRef.get();
            if (doc.exists) {
                const savedData = doc.data();
                appState.changesCells = savedData.changesCells || {};
            } else {
                appState.changesCells = {}; // Reset if no data for the year
            }
        } catch (error) {
            console.error('Error loading changes from Firestore:', error);
        }
    };

    const renderChangesContent = () => {
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const period = row.dataset.startDate;
            Array.from(row.cells).forEach((cell, index) => {
                if (appState.changesCells[period]?.[index]?.assignedEmployees) {
                    const employeeNames = appState.changesCells[period][index].assignedEmployees
                        .map((id) => EmployeeManager.getFullNameById(id))
                        .join('<br>');
                    cell.innerHTML = employeeNames;
                }
            });
        });
    };

    const renderChangesAndSave = () => {
        renderChangesContent();
        saveChanges();
    };

    const printChangesTableToPdf = () => {
        const table = document.getElementById('changesTable');
        const tableHeaders = Array.from(table.querySelectorAll('thead th')).map((th) => ({
            text: th.textContent,
            style: 'tableHeader',
        }));

        const tableBody = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            return Array.from(row.cells).map((cell, cellIndex) => {
                if (cellIndex === 0 || cellIndex === 8) {
                    // Kolumna Okres i Urlopy
                    return cell.innerHTML.replace(/<br\s*[/]?>>/gi, '\n');
                }
                const period = row.dataset.startDate;
                const cellState = appState.changesCells[period]?.[cellIndex];
                if (cellState?.assignedEmployees) {
                    return cellState.assignedEmployees.map((id) => EmployeeManager.getLastNameById(id)).join('\n');
                }
                return '';
            });
        });

        const docDefinition = {
            pageOrientation: 'landscape',
            content: [
                { text: 'Grafik Zmian', style: 'header' },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        body: [tableHeaders, ...tableBody],
                    },
                    layout: {
                        fillColor: function (rowIndex, node, columnIndex) {
                            return rowIndex === 0 ? '#4CAF50' : null;
                        },
                    },
                },
            ],
            styles: {
                header: {
                    fontSize: 18,
                    bold: true,
                    margin: [0, 0, 0, 10],
                },
                tableExample: {
                    margin: [0, 5, 0, 15],
                },
                tableHeader: {
                    bold: true,
                    fontSize: 10,
                    color: 'white',
                },
            },
            defaultStyle: {
                font: 'Roboto', // pdfmake uses Roboto by default which supports Polish characters
            },
        };

        pdfMake.createPdf(docDefinition).download(`grafik-zmian-${currentYear}.pdf`);
    };

    const populateYearSelect = () => {
        const yearNow = new Date().getUTCFullYear();
        const startYear = yearNow - 2;
        const endYear = yearNow + 5;

        yearSelect.innerHTML = '';

        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
        yearSelect.addEventListener('change', handleYearChange);
    };

    const handleYearChange = async (e) => {
        currentYear = parseInt(e.target.value, 10);
        await refreshView();
    };

    const refreshView = async () => {
        const periods = generateTwoWeekPeriods(currentYear);
        renderTable(periods);
        await loadChanges();
        renderChangesContent();
        const allLeaves = await getAllLeavesData();
        populateLeavesColumn(allLeaves);
    };

    const init = async () => {
        // Małe opóźnienie i ponowna próba, jeśli elementy nie zostaną znalezione natychmiast
        // (rozwiązuje specyficzne dla Firefox problemy z synchronizacją po innerHTML)
        const getElements = () => {
            changesTableBody = document.getElementById('changesTableBody');
            changesHeaderRow = document.getElementById('changesHeaderRow');
            yearSelect = document.getElementById('changesYearSelect');
            return changesTableBody && changesHeaderRow && yearSelect;
        };

        if (!getElements()) {
            // Pierwsza próba po 50ms
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (!getElements()) {
                // Druga próba po dodatkowych 100ms
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (!getElements()) {
                    const missing = [];
                    if (!document.getElementById('changesTableBody')) missing.push('changesTableBody');
                    if (!document.getElementById('changesHeaderRow')) missing.push('changesHeaderRow');
                    if (!document.getElementById('changesYearSelect')) missing.push('changesYearSelect');

                    console.error(`Changes module: Required elements not found (${missing.join(', ')}). Aborting initialization.`);
                    return;
                }
            }
        }

        const printButton = document.getElementById('printChangesTable');
        if (printButton) {
            printButton.addEventListener('click', printChangesTableToPdf);
        }

        document.addEventListener('app:search', handleAppSearch);

        populateYearSelect();
        await refreshView();
        await EmployeeManager.load();

        const contextMenuItems = [
            { id: 'ctxCopyCell', action: (cell) => copyCell(cell) },
            { id: 'ctxPasteCell', action: (cell) => pasteCell(cell) },
            { id: 'ctxClearCell', action: (cell) => clearCell(cell) },
        ];
        window.initializeContextMenu('changesContextMenu', '#changesTableBody td:not(.leaves-cell)', contextMenuItems);
    };

    const destroy = () => {
        const printButton = document.getElementById('printChangesTable');
        document.removeEventListener('app:search', handleAppSearch);
        if (printButton) {
            printButton.removeEventListener('click', printChangesTableToPdf);
        }
        if (window.destroyContextMenu) {
            window.destroyContextMenu('changesContextMenu');
        }
        console.log('Changes module destroyed');
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
window.Changes = Changes;

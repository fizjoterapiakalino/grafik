document.addEventListener('DOMContentLoaded', () => {
    // === POCZĄTEK MODYFIKACJI ===
    // Adres URL Twojej wdrożonej aplikacji internetowej Google Apps Script
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzu0mPeOZvjxnTJmvELkRdYMqFjxnhJHUdHbYJHojO06m9im_eoqQOQ3UzKtdgK8VPq6Q/exec';
    // === KONIEC MODYFIKACJI ===

    // Caching DOM elements
    const loadingOverlay = document.getElementById('loadingOverlay');
    const mainTable = document.getElementById('mainScheduleTable');
    const tableHeaderRow = document.getElementById('tableHeaderRow');
    const tbody = mainTable.querySelector('tbody');
    const contextMenu = document.getElementById('contextMenu');
    const addBreakOption = document.getElementById('addBreakOption');
    const removeBreakOption = document.getElementById('removeBreakOption');
    const clearCellOption = document.getElementById('clearCellOption');
    const addPatientOption = document.getElementById('addPatientOption');
    const massagOption = document.getElementById('massagOption'); // Z menu PPM
    const pnfOption = document.getElementById('pnfOption'); // Z menu PPM
    const saveConfirmation = document.getElementById('saveConfirmation');
    const undoButton = document.getElementById('undoButton');

    // Elementy paska narzędzi
    const actionToolbar = document.getElementById('actionToolbar');
    const toolbarSplitCell = document.getElementById('toolbarSplitCell');
    const toolbarAddBreak = document.getElementById('toolbarAddBreak');
    const toolbarMassage = document.getElementById('toolbarMassage');
    const toolbarPnf = document.getElementById('toolbarPnf');
    const toolbarClear = document.getElementById('toolbarClear');
    const toolbarRemoveBreak = document.getElementById('toolbarRemoveBreak');
    const cellSettingsIcon = document.getElementById('cellSettingsIcon');

    let currentCell = null; // Zawsze odnosi się do TD (rodzica dla menu kontekstowego)
    let draggedCell = null;
    let activeCell = null; // Może być TD, TH lub wewnętrznym DIV w przypadku split-cell
    let previouslyHighlightedTimeCell = null;

    const undoStack = [];
    const redoStack = [];
    const MAX_UNDO_STATES = 20;

    // Constants for configuration
    const NUMBER_OF_EMPLOYEES = 13;
    const START_HOUR = 7;
    const END_HOUR = 17;
    const DEFAULT_CELL_COLOR = '#e0e0e0';
    const CONTENT_CELL_COLOR = '#ffffff';
    const BREAK_TEXT = 'Przerwa';

    // --- FUNKCJE OBSŁUGI WYSOKOŚCI WIERSZY ---

    /**
     * Odświeża wysokość wiersza dla podanej komórki, pozwalając przeglądarce na jej automatyczne dostosowanie.
     * @param {HTMLElement} cell Element (TD, TH lub DIV wewnątrz TD), którego wiersz wymaga aktualizacji.
     */
    const refreshRowHeight = (cell) => {
        if (!cell) return;
        const parentRow = cell.closest('tr');
        if (parentRow) {
            parentRow.style.height = 'auto';
        }
    };

    /** Odświeża wysokość wszystkich wierszy w tabeli. */
    const refreshAllRowHeights = () => {
        document.querySelectorAll('#mainScheduleTable tbody tr').forEach(row => {
            row.style.height = 'auto';
        });
    };

    // --- FUNKCJE PODŚWIETLANIA DUPLIKATÓW ---

    /** Usuwa wszystkie istniejące podświetlenia duplikatów. */
    const clearDuplicateHighlights = () => {
        document.querySelectorAll('.duplicate-highlight').forEach(el => {
            el.classList.remove('duplicate-highlight');
        });
    };

    /**
     * Pobiera tekst z aktywnego elementu (TD, TH, lub DIV wewnątrz split-cell).
     * @param {HTMLElement} element Aktywny element.
     * @returns {string} Tekst elementu.
     */
    const getElementText = (element) => {
        if (!element || element.classList.contains('break-cell')) return '';
        // Klonujemy element, aby nie modyfikować DOM podczas odczytu
        const clone = element.cloneNode(true);
        // Usuwamy z klona wszystkie ikony, aby nie wchodziły do tekstu
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach(icon => icon.remove());
        // Zwracamy czysty tekst
        return clone.textContent.trim();
    };

    /**
     * Znajduje i podświetla wszystkie komórki z tekstem identycznym do podanego.
     * @param {string} searchText Tekst do wyszukania.
     */
    const highlightDuplicates = (searchText) => {
        clearDuplicateHighlights();
        const cleanedSearchText = searchText.trim().toLowerCase();

        if (cleanedSearchText === '' || cleanedSearchText === BREAK_TEXT.toLowerCase()) {
            return; // Nie szukaj pustych wartości ani przerw
        }

        const allCells = document.querySelectorAll('td.editable-cell');
        const matchingCells = [];

        allCells.forEach(cell => {
            const cellText = getElementText(cell).toLowerCase();
            if (cellText.includes(cleanedSearchText)) {
                matchingCells.push(cell);
            }
        });

        if (matchingCells.length > 1) {
            matchingCells.forEach(td => td.classList.add('duplicate-highlight'));
        }
    };

    const hideAllCellActions = () => {
        if (actionToolbar) actionToolbar.classList.remove('visible');
        if (cellSettingsIcon) cellSettingsIcon.style.display = 'none';
    };

    const showCellSettingsIcon = (cell) => {
        if (!cell || !cellSettingsIcon) return;
        hideAllCellActions(); // Ukryj wszystkie inne aktywne kontrolki
        currentCell = cell;

        const rect = cell.getBoundingClientRect();
        // Pozycjonuj w prawym górnym rogu komórki
        const top = rect.top + window.scrollY + 3;
        const left = rect.right + window.scrollX - cellSettingsIcon.offsetWidth - 3;

        cellSettingsIcon.style.top = `${top}px`;
        cellSettingsIcon.style.left = `${left}px`;
        cellSettingsIcon.style.display = 'flex';
    };

    const showFullActionToolbar = () => {
        if (!currentCell || !actionToolbar) return;

        if (cellSettingsIcon) cellSettingsIcon.style.display = 'none';

        const isBreak = currentCell.classList.contains('break-cell');
        toolbarAddBreak.style.display = isBreak ? 'none' : 'flex';
        toolbarRemoveBreak.style.display = isBreak ? 'flex' : 'none';
        toolbarSplitCell.style.display = isBreak ? 'none' : 'flex';
        toolbarMassage.style.display = isBreak ? 'none' : 'flex';
        toolbarPnf.style.display = isBreak ? 'none' : 'flex';
        toolbarClear.style.display = 'flex';

        const rect = currentCell.getBoundingClientRect();
        const top = rect.top + window.scrollY - actionToolbar.offsetHeight - 5;
        let left = rect.left + window.scrollX + (rect.width / 2) - (actionToolbar.offsetWidth / 2);
        left = Math.max(left, 10);

        actionToolbar.style.top = `${top}px`;
        actionToolbar.style.left = `${left}px`;
        actionToolbar.classList.add('visible');
    };
  

    // Funkcja pomocnicza do zamiany pierwszej litery na wielką
    const capitalizeFirstLetter = (string) => {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    };

    const setActiveCell = (cell) => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
            if (activeCell.tagName === 'DIV' && activeCell.parentNode.classList.contains('active-cell')) {
                 activeCell.parentNode.classList.remove('active-cell');
            }
            if (activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
        }
        // Ukryj wszystkie otwarte akcje komórek
        hideAllCellActions();
        if (activeCell) {
            clearDuplicateHighlights(); // Usuń stare podświetlenia
        }
        activeCell = cell;
        if (activeCell) {
            activeCell.classList.add('active-cell');
            if (activeCell.tagName === 'DIV') {
                activeCell.parentNode.classList.add('active-cell');
            }
            activeCell.focus();
            highlightDuplicates(getElementText(activeCell)); // Podświetl duplikaty dla nowej aktywnej komórki
            const parentTd = activeCell.closest('td');
            if (parentTd && parentTd.classList.contains('editable-cell')) {
                showCellSettingsIcon(parentTd);
            }
        } else {
            hideAllCellActions();
        }
    };

    const enterEditMode = (element, clearContent = false, initialChar = '') => {
        if (!element || element.classList.contains('break-cell') || element.getAttribute('contenteditable') === 'true') {
            return;
        }

        // Jeśli element to TD i jest już split-cell, to edytuj pierwszy div w nim
        if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
            const firstDiv = element.children[0];
            if (firstDiv) {
                enterEditMode(firstDiv, clearContent, initialChar); // Rekurencyjne wywołanie
                setActiveCell(firstDiv);
            }
            return; // Przerwij, główna komórka TD nie jest bezpośrednio edytowalna w tym trybie
        }

        // Standardowa logika dla TD (nie split-cell), TH, lub DIV w split-cell
        const isEditableTarget = (element.tagName === 'TD' && !element.classList.contains('split-cell')) ||
                                 (element.tagName === 'TH' && element.classList.contains('editable-header')) ||
                                 (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell'));

        if (!isEditableTarget) {
            return;
        }

        // Tylko dla TD (nie split-cell) i TH, wyczyść innerHTML aby pozbyć się np. <br>
        if (element.tagName === 'TD' || element.tagName === 'TH') {
            element.innerHTML = element.textContent;
        }

        element.setAttribute('contenteditable', 'true');
        element.classList.remove('massage-text', 'pnf-text');
        element.querySelectorAll('.cell-icon').forEach(icon => icon.remove());
        delete element.dataset.isMassage;

        if (clearContent) {
            element.textContent = initialChar;
        } else if (initialChar) {
            element.textContent += initialChar;
        }

        element.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false); // Ustaw kursor na końcu
        sel.removeAllRanges();
        sel.addRange(range);
    };

    const exitEditMode = (element) => {
        if (!element || element.getAttribute('contenteditable') === 'false') return;

        // Zamień pierwszą literę na wielką
        element.textContent = capitalizeFirstLetter(element.textContent.trim());

        element.setAttribute('contenteditable', 'false');
        
        const parentCell = element.tagName === 'DIV' ? element.parentNode : element;

        // Jeśli to przerwa, nic nie zmieniaj poza contenteditable na false
        if (parentCell.classList.contains('break-cell')) {
            Array.from(parentCell.children).forEach(child => child.setAttribute('contenteditable', 'false'));
            return;
        }

        // LOGIKA DZIELENIA KOMÓRKI NA PODSTAWIE "/"
        // Stosowana TYLKO gdy edytowany był bezpośrednio element TD i nie był to wcześniej split-cell
        if (element.tagName === 'TD' && element.textContent.includes('/') && !element.classList.contains('split-cell')) {
            const parts = element.textContent.split('/', 2); // Podziel tylko po pierwszym slashu
            const part1Content = parts[0].trim();
            const part2Content = parts[1] ? parts[1].trim() : '';

            element.innerHTML = ''; // Wyczyść istniejącą zawartość
            element.classList.add('split-cell');
            element.classList.remove('massage-text', 'pnf-text'); // Usuń style z rodzica TD
            delete element.dataset.isMassage;

            const div1 = document.createElement('div');
            div1.textContent = capitalizeFirstLetter(part1Content);
            div1.setAttribute('contenteditable', 'false'); // Ustawiamy na false po zakończeniu edycji
            div1.setAttribute('tabindex', '0');
            // Styl masażu przeniesiony z głównej komórki (jeśli była) na pierwszą część
            if (element.dataset.isMassage === 'true') { // Sprawdź dataset TD, nie usunąłeś go jeszcze
                 div1.classList.add('massage-text');
                 div1.dataset.isMassage = 'true';
            }
            element.appendChild(div1);

            const div2 = document.createElement('div');
            div2.textContent = capitalizeFirstLetter(part2Content);
            div2.setAttribute('contenteditable', 'false'); // Ustawiamy na false po zakończeniu edycji
            div2.setAttribute('tabindex', '0');
            element.appendChild(div2);

            element.style.backgroundColor = CONTENT_CELL_COLOR;
            return; // Zakończ, bo struktura komórki została zmieniona
        }

        // LOGIKA DLA ISTNIEJĄCYCH SPLIT-CELL (czyli element jest DIVEM wewnątrz TD.split-cell LUB TD było split-cell)
        if (parentCell.classList.contains('split-cell')) {
            const part1 = parentCell.children[0];
            const part2 = parentCell.children[1];

            // Przywróć styl masażu dla każdej części osobno
            if (part1) {
                part1.classList.toggle('massage-text', part1.dataset.isMassage === 'true');
                part1.classList.toggle('pnf-text', part1.dataset.isPnf === 'true');
            }
            if (part2) {
                part2.classList.toggle('massage-text', part2.dataset.isMassage === 'true');
                part2.classList.toggle('pnf-text', part2.dataset.isPnf === 'true');
            }

            // Jeśli obie części są puste, przywróć komórkę do stanu pojedynczego TD
            if (part1 && part1.textContent.trim() === '' && part2 && part2.textContent.trim() === '') {
                parentCell.innerHTML = '';
                parentCell.classList.remove('split-cell', 'massage-text', 'pnf-text');
                delete parentCell.dataset.isMassage;
                parentCell.style.backgroundColor = DEFAULT_CELL_COLOR;
            } else {
                parentCell.style.backgroundColor = CONTENT_CELL_COLOR;
            }
        } else { // Standardowa komórka TD (która nie stała się split-cell) lub TH
            if (element.tagName === 'TD') { // Tylko TD mają style tła i masażu
                element.classList.toggle('massage-text', element.dataset.isMassage === 'true');
                element.classList.toggle('pnf-text', element.dataset.isPnf === 'true');

                if (getElementText(element).trim() !== '' || element.querySelectorAll('.cell-icon').length > 0) {
                    element.style.backgroundColor = CONTENT_CELL_COLOR;
                } else {
                    element.style.backgroundColor = DEFAULT_CELL_COLOR;
                }
            }
        }
        highlightDuplicates(getElementText(element)); // Uaktualnij podświetlenie po edycji
        refreshRowHeight(element); // Odśwież wysokość wiersza po edycji
        saveSchedule(); // Zapisz zmiany
        pushStateToUndoStack(); // Dodaj stan po zakończeniu edycji!
    };

    const generateScheduleTable = () => {
        tableHeaderRow.innerHTML = '<th>Godz.</th>';
        tbody.innerHTML = '';

        for (let i = 0; i < NUMBER_OF_EMPLOYEES; i++) {
            const th = document.createElement('th');
            th.textContent = `Pracownik ${i + 1}`;
            th.classList.add('editable-header');
            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            tableHeaderRow.appendChild(th);
        }

        for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === END_HOUR && minute === 30) {
                    continue;
                }

                const tr = tbody.insertRow();
                const displayMinute = minute === 0 ? '00' : String(minute);
                const timeString = `${hour}:${displayMinute}`;

                const timeCell = tr.insertCell();
                timeCell.textContent = timeString;

                for (let i = 0; i < NUMBER_OF_EMPLOYEES; i++) {
                    const editableCell = tr.insertCell();
                    editableCell.classList.add('editable-cell');
                    editableCell.setAttribute('contenteditable', 'false');
                    editableCell.setAttribute('data-time', timeString);
                    editableCell.setAttribute('data-employee-index', i);
                    editableCell.setAttribute('draggable', 'true');
                    editableCell.setAttribute('tabindex', '0');
                }
            }
        }
    };

    // Helper function to apply cell data to a DOM cell
    const applyCellDataToDom = (cell, cellObj) => {
        cell.className = 'editable-cell'; // Reset klas, zostawiamy tylko podstawową
        cell.setAttribute('contenteditable', 'false'); // Główna komórka TD nie jest contenteditable
        cell.innerHTML = ''; // Usuń wszystkie wewnętrzne elementy
        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;

        if (cellObj.isBreak) {
            cell.textContent = BREAK_TEXT;
            cell.classList.add('break-cell');
            cell.style.backgroundColor = DEFAULT_CELL_COLOR;
        } else if (cellObj.isSplit) {
            const createPart = (content, isMassage, isPnf) => {
                const div = document.createElement('div');
                div.setAttribute('contenteditable', 'false');
                div.setAttribute('tabindex', '0');
                let htmlContent = '';
                if (isMassage) {
                    div.classList.add('massage-text');
                    div.dataset.isMassage = 'true';
                    htmlContent += '<i class="fas fa-hand-paper cell-icon"></i>';
                }
                if (isPnf) {
                    div.classList.add('pnf-text');
                    div.dataset.isPnf = 'true';
                    htmlContent += '<i class="fas fa-brain cell-icon"></i>';
                }
                // Używamy span, aby tekst był obok ikon
                htmlContent += `<span>${capitalizeFirstLetter(content || '')}</span>`;
                div.innerHTML = htmlContent;
                return div;
            };

            cell.classList.add('split-cell');
            cell.style.backgroundColor = CONTENT_CELL_COLOR;

            const div1 = createPart(cellObj.content1, cellObj.isMassage1, cellObj.isPnf1);
            cell.appendChild(div1);

            const div2 = createPart(cellObj.content2, cellObj.isMassage2, cellObj.isPnf2);
            cell.appendChild(div2);
        } else { // Standard cell
            let htmlContent = '';
            if (cellObj.isMassage) {
                cell.classList.add('massage-text');
                cell.dataset.isMassage = 'true';
                htmlContent += '<i class="fas fa-hand-paper cell-icon"></i>';
            }
            if (cellObj.isPnf) {
                cell.classList.add('pnf-text');
                cell.dataset.isPnf = 'true';
                htmlContent += '<i class="fas fa-brain cell-icon"></i>';
            }
            htmlContent += `<span>${capitalizeFirstLetter(cellObj.content || '')}</span>`;
            cell.innerHTML = htmlContent;
            cell.style.backgroundColor = (getElementText(cell).trim() !== '' || cell.querySelectorAll('.cell-icon').length > 0) ? CONTENT_CELL_COLOR : DEFAULT_CELL_COLOR;
        }
    };

    const loadSchedule = async () => {
        let savedData = {};
        try {
            const response = await fetch(WEB_APP_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (Object.keys(data).length === 0) {
              savedData = { employeeHeaders: {}, scheduleCells: {} };
            } else {
              savedData = data;
            }
        } catch (error) {
            console.error('Błąd podczas ładowania danych:', error);
            alert('Nie udało się załadować grafiku. Sprawdź połączenie z internetem i konsolę.');
            savedData = { employeeHeaders: {}, scheduleCells: {} };
        }

        document.querySelectorAll('th.editable-header').forEach(th => {
            const index = th.getAttribute('data-employee-index');
            if (savedData.employeeHeaders && savedData.employeeHeaders[index]) {
                th.textContent = capitalizeFirstLetter(savedData.employeeHeaders[index]); // Kapitalizacja nagłówków
            }
        });

        document.querySelectorAll('td.editable-cell').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');

            if (savedData.scheduleCells && savedData.scheduleCells[time] && savedData.scheduleCells[time][employeeIndex]) {
                applyCellDataToDom(cell, savedData.scheduleCells[time][employeeIndex]);
            } else {
                cell.className = 'editable-cell'; // Reset do stanu bazowego
                cell.setAttribute('contenteditable', 'false');
                cell.textContent = '';
                cell.style.backgroundColor = DEFAULT_CELL_COLOR;
                delete cell.dataset.isMassage;
                cell.innerHTML = '';
            }
        });
        refreshAllRowHeights(); // Upewnij się, że wszystkie wiersze mają poprawną wysokość po załadowaniu
    };

    const saveSchedule = async () => {
        const scheduleData = {
            employeeHeaders: {},
            scheduleCells: {}
        };

        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            scheduleData.employeeHeaders[index] = headerTh.textContent; // Zapisujemy tekst jak jest
        });

        document.querySelectorAll('td[data-time]').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');

            if (!scheduleData.scheduleCells[time]) {
                scheduleData.scheduleCells[time] = {};
            }

            if (cell.classList.contains('break-cell')) {
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content: BREAK_TEXT,
                    isBreak: true,
                    isSplit: false,
                    isMassage: false,
                    isPnf: false
                };
            } else if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0];
                const part2 = cell.children[1];
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content1: part1 ? part1.textContent : '',
                    content2: part2 ? part2.textContent : '',
                    isSplit: true,
                    isBreak: false,
                    isMassage1: !!(part1 && part1.classList.contains('massage-text')),
                    isMassage2: !!(part2 && part2.classList.contains('massage-text')),
                    isPnf1: !!(part1 && part1.classList.contains('pnf-text')),
                    isPnf2: !!(part2 && part2.classList.contains('pnf-text'))
                };
            } else {
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content: getElementText(cell),
                    isBreak: false,
                    isSplit: false,
                    isMassage: cell.classList.contains('massage-text'),
                    isPnf: cell.classList.contains('pnf-text')
                };
            }
        });

        try {
            const response = await fetch(WEB_APP_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8',
                },
                body: JSON.stringify(scheduleData)
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            await response.json();
            showSaveConfirmation();
        } catch (error) {
                console.error('Błąd podczas zapisywania danych:', error);
                alert('Wystąpił błąd podczas zapisu. Sprawdź konsolę.');
        }
    };

    let saveConfirmationTimeout;
    const showSaveConfirmation = () => {
        clearTimeout(saveConfirmationTimeout);
        saveConfirmation.classList.add('show');
        saveConfirmationTimeout = setTimeout(() => {
            saveConfirmation.classList.remove('show');
        }, 2000);
    };

    const getCurrentTableState = () => {
        const state = {};
        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            state[`header_${index}`] = headerTh.textContent;
        });

        document.querySelectorAll('td.editable-cell').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');
            if (!state[time]) {
                state[time] = {};
            }
            if (cell.classList.contains('break-cell')) {
                state[time][employeeIndex] = {
                    content: cell.textContent,
                    isBreak: true,
                    isSplit: false,
                    isMassage: false,
                    isPnf: false
                };
            } else if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0];
                const part2 = cell.children[1];
                state[time][employeeIndex] = {
                    content1: part1 ? part1.textContent : '',
                    content2: part2 ? part2.textContent : '',
                    isSplit: true,
                    isBreak: false,
                    isMassage1: !!(part1 && part1.classList.contains('massage-text')),
                    isMassage2: !!(part2 && part2.classList.contains('massage-text')),
                    isPnf1: !!(part1 && part1.classList.contains('pnf-text')),
                    isPnf2: !!(part2 && part2.classList.contains('pnf-text'))
                };
            } else {
                state[time][employeeIndex] = {
                    content: getElementText(cell),
                    isBreak: false,
                    isSplit: false,
                    isMassage: cell.classList.contains('massage-text'),
                    isPnf: cell.classList.contains('pnf-text')
                };
            }
        });
        return state;
    };

    const applyTableState = (state) => {
        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            if (state[`header_${index}`] !== undefined) {
                headerTh.textContent = capitalizeFirstLetter(state[`header_${index}`]); // Kapitalizacja przy przywracaniu
            }
        });

        document.querySelectorAll('td.editable-cell').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');
            if (state[time] && state[time][employeeIndex] !== undefined) {
                applyCellDataToDom(cell, state[time][employeeIndex]);
            } else {
                cell.className = 'editable-cell'; // Reset do stanu bazowego
                cell.setAttribute('contenteditable', 'false');
                cell.textContent = '';
                cell.style.backgroundColor = DEFAULT_CELL_COLOR;
                delete cell.dataset.isMassage;
                cell.innerHTML = '';
            }
        });
        refreshAllRowHeights(); // Odśwież wysokość wszystkich wierszy po przywróceniu stanu
        saveSchedule();
        clearTimeout(saveConfirmationTimeout);
        saveConfirmation.classList.remove('show');
    };

    const pushStateToUndoStack = () => {
        const currentState = getCurrentTableState();
        if (undoStack.length > 0 && JSON.stringify(undoStack[undoStack.length - 1]) === JSON.stringify(currentState)) {
            return;
        }
        undoStack.push(currentState);
        if (undoStack.length > MAX_UNDO_STATES) {
            undoStack.shift();
        }
        redoStack.length = 0;
        updateUndoRedoButtons();
    };

    const undoLastAction = () => {
        if (undoStack.length > 1) {
            const currentState = undoStack.pop();
            redoStack.push(currentState);
            const prevState = undoStack[undoStack.length - 1];
            applyTableState(prevState);
            updateUndoRedoButtons();
        }
    };

    const updateUndoRedoButtons = () => {
        undoButton.disabled = undoStack.length <= 1;
    };

    mainTable.addEventListener('paste', (event) => {
        const target = event.target;
        const actualCellOrDiv = (target.tagName === 'TD' || target.tagName === 'TH' || target.tagName === 'DIV') ? target : null;

        if (actualCellOrDiv && actualCellOrDiv.getAttribute('contenteditable') === 'true') {
            // Stan zostanie zapisany w exitEditMode
        }
    });

    const highlightCurrentTime = () => {
        const now = new Date();
        let currentHour = now.getHours();
        let currentMinute = now.getMinutes();

        let targetTimeStr;
        if (currentMinute < 15) {
            targetTimeStr = `${currentHour}:00`;
        } else if (currentMinute >= 15 && currentMinute < 45) {
            targetTimeStr = `${currentHour}:30`;
        } else {
            currentHour++;
            targetTimeStr = `${currentHour}:00`;
        }

        if (targetTimeStr.endsWith(':0')) {
            targetTimeStr += '0';
        }

        if (previouslyHighlightedTimeCell) {
            previouslyHighlightedTimeCell.classList.remove('current-time-highlight');
            previouslyHighlightedTimeCell.style.backgroundColor = '';
        }

        const timeCells = Array.from(document.querySelectorAll('td:first-child'));
        let currentHourCell = timeCells.find(cell => cell.textContent === targetTimeStr);

        if (currentHourCell) {
            currentHourCell.classList.add('current-time-highlight');
            previouslyHighlightedTimeCell = currentHourCell;
        }
    };

    highlightCurrentTime();
    setInterval(highlightCurrentTime, 60 * 1000);

    mainTable.addEventListener('click', (event) => {
        const target = event.target;
        const clickedElement = (target.tagName === 'TD' && target.classList.contains('editable-cell')) ||
                               (target.tagName === 'TH' && target.classList.contains('editable-header')) ||
                               (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target : null;

        if (clickedElement) {
            if (activeCell === clickedElement && clickedElement.getAttribute('contenteditable') === 'true') {
                return;
            }
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
            setActiveCell(clickedElement);
        } else {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    });

    mainTable.addEventListener('dblclick', (event) => {
        const target = event.target;
        const dblClickedElement = (target.tagName === 'TD' && target.classList.contains('editable-cell')) ||
                                  (target.tagName === 'TH' && target.classList.contains('editable-header')) ||
                                  (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target : null;

        if (dblClickedElement) {
            enterEditMode(dblClickedElement);
        }
    });

    const getEditableCellsInRow = (rowElement) => {
        if (rowElement.id === 'tableHeaderRow') {
            return Array.from(rowElement.querySelectorAll('th.editable-header'));
        }
        return Array.from(rowElement.querySelectorAll('td.editable-cell'));
    };

    document.addEventListener('keydown', (event) => {
        const target = document.activeElement;
        let nextElement = null;

        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            undoLastAction();
            return;
        }

        const isPrintableKey = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;

        const actualActiveElement = (target.tagName === 'TD' && target.classList.contains('editable-cell')) ||
                                    (target.tagName === 'TH' && target.classList.contains('editable-header')) ||
                                    (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target : null;

        if (actualActiveElement && actualActiveElement.getAttribute('contenteditable') !== 'true' && isPrintableKey) {
            event.preventDefault();
            enterEditMode(actualActiveElement, actualActiveElement.textContent.trim() === '', event.key);
            return;
        }

        if (actualActiveElement && actualActiveElement.getAttribute('contenteditable') === 'true') {
            if (event.key === 'Enter') {
                event.preventDefault();
                exitEditMode(actualActiveElement); // Wyjdź z trybu edycji aktualnej komórki/diva

                const parentCell = actualActiveElement.tagName === 'DIV' ? actualActiveElement.parentNode : actualActiveElement;
                const currentRow = parentCell.closest('tr');
                const rowCells = getEditableCellsInRow(currentRow);
                const currentIndexInRow = rowCells.indexOf(parentCell);

                // Logika przejścia do następnej komórki
                if (parentCell.classList.contains('split-cell')) {
                    if (actualActiveElement === parentCell.children[0] && parentCell.children[1]) {
                        nextElement = parentCell.children[1]; // Przejdź do drugiej części split-cell
                    } else {
                        // Jeśli to była druga część, przejdź do następnej komórki w wierszu
                        nextElement = rowCells[currentIndexInRow + 1];
                        if (!nextElement) {
                            const nextRow = currentRow.nextElementSibling;
                            if (nextRow) {
                                nextElement = getEditableCellsInRow(nextRow)[0];
                                if (nextElement && nextElement.classList.contains('split-cell')) {
                                    nextElement = nextElement.children[0];
                                }
                            } else {
                                // Jeśli brak następnego wiersza, owiń do pierwszej komórki nagłówka lub pierwszej komórki danych
                                nextElement = mainTable.querySelector('th.editable-header') || mainTable.querySelector('td.editable-cell');
                                if (nextElement && nextElement.classList.contains('split-cell')) {
                                    nextElement = nextElement.children[0];
                                }
                            }
                        }
                    }
                } else { // Standardowa komórka TD lub TH
                    nextElement = rowCells[currentIndexInRow + 1];
                    if (!nextElement) {
                        const nextRow = currentRow.nextElementSibling;
                        if (nextRow) {
                            nextElement = getEditableCellsInRow(nextRow)[0];
                            if (nextElement && nextElement.classList.contains('split-cell')) {
                                nextElement = nextElement.children[0];
                            }
                        } else {
                            nextElement = mainTable.querySelector('th.editable-header') || mainTable.querySelector('td.editable-cell');
                            if (nextElement && nextElement.classList.contains('split-cell')) {
                                nextElement = nextElement.children[0];
                            }
                        }
                    }
                }
            } else if (event.key === 'Tab') {
                exitEditMode(actualActiveElement);
                return;
            } else if (event.key === 'Escape') {
                exitEditMode(actualActiveElement);
                return;
            }

            if (nextElement) {
                setActiveCell(nextElement);
            }
            return;
        }

        if (activeCell && (activeCell.tagName === 'TD' || activeCell.tagName === 'TH' || (activeCell.tagName === 'DIV' && activeCell.parentNode.classList.contains('split-cell')))) {
            if (event.key === 'Delete') {
                const actualCellToDelete = activeCell.tagName === 'DIV' ? activeCell.parentNode : activeCell;

                if (actualCellToDelete.classList.contains('break-cell')) {
                    actualCellToDelete.textContent = '';
                    actualCellToDelete.classList.remove('break-cell');
                    actualCellToDelete.setAttribute('contenteditable', 'false');
                    actualCellToDelete.style.backgroundColor = DEFAULT_CELL_COLOR;
                } else if (actualCellToDelete.classList.contains('split-cell')) {
                    actualCellToDelete.innerHTML = '';
                    actualCellToDelete.classList.remove('split-cell', 'massage-text');
                    actualCellToDelete.style.backgroundColor = DEFAULT_CELL_COLOR;
                    delete actualCellToDelete.dataset.isMassage;
                } else if (actualCellToDelete.classList.contains('editable-cell') || actualCellToDelete.classList.contains('editable-header')) {
                    actualCellToDelete.textContent = '';
                    actualCellToDelete.classList.remove('massage-text');
                    delete actualCellToDelete.dataset.isMassage;
                    if (actualCellToDelete.classList.contains('editable-cell')) {
                        actualCellToDelete.style.backgroundColor = DEFAULT_CELL_COLOR;
                    }
                }
                saveSchedule();
                pushStateToUndoStack();
                event.preventDefault();
                return;
            } else if (event.key === 'Enter') {
                event.preventDefault();
                enterEditMode(activeCell);
                return;
            }

            const currentParentTd = activeCell.tagName === 'DIV' ? activeCell.parentNode : activeCell;
            const currentRow = currentParentTd.closest('tr');
            const rowCells = getEditableCellsInRow(currentRow);
            const currentIndexInRow = rowCells.indexOf(currentParentTd);
    
            switch (event.key) {
                case 'ArrowRight':
                    if (activeCell.tagName === 'DIV' && activeCell === currentParentTd.children[0] && currentParentTd.children[1]) {
                        nextElement = currentParentTd.children[1];
                    } else {
                        nextElement = rowCells[currentIndexInRow + 1];
                        if (!nextElement) {
                            const nextRow = currentRow.nextElementSibling;
                            if (nextRow) {
                                const nextRowCells = getEditableCellsInRow(nextRow);
                                // Znajdź pierwszą komórkę, która NIE jest komórką czasową (pierwsza kolumna)
                                nextElement = nextRowCells.find(cell => cell.cellIndex !== 0);
                                if (nextElement && nextElement.classList.contains('split-cell')) {
                                    nextElement = nextElement.children[0];
                                }
                            } else {
                                nextElement = mainTable.querySelector('th.editable-header') || mainTable.querySelector('td.editable-cell');
                                if (nextElement && nextElement.classList.contains('split-cell')) {
                                    nextElement = nextElement.children[0];
                                }
                            }
                        }
                    }
                    break;
                case 'ArrowLeft':
                    if (activeCell.tagName === 'DIV' && activeCell === currentParentTd.children[1] && currentParentTd.children[0]) {
                        nextElement = currentParentTd.children[0];
                    } else {
                        nextElement = rowCells[currentIndexInRow - 1];
                        if (!nextElement) {
                            const prevRow = currentRow.previousElementSibling;
                            if (prevRow) {
                                const cellsInPrevRow = getEditableCellsInRow(prevRow).filter(cell => cell.cellIndex !== 0); // Wyklucz komórki czasowe
                                // Znajdź ostatnią komórkę, która NIE jest komórką czasową (pierwsza kolumna)

                                nextElement = cellsInPrevRow[cellsInPrevRow.length - 1];
                                if (nextElement && nextElement.classList.contains('split-cell')) {
                                     nextElement = nextElement.children[1];
                                }
                            } else {
                                const lastRow = mainTable.querySelector('tbody').lastElementChild;
                                if (lastRow) {
                                    const cellsInLastRow = getEditableCellsInRow(lastRow);
                                    nextElement = cellsInLastRow[cellsInLastRow.length - 1];
                                    if (nextElement && nextElement.classList.contains('split-cell')) {
                                        nextElement = nextElement.children[1];
                                    }
                                }
                            }
                        }
                    }
                    break;
                case 'ArrowDown':
                    const nextRow = currentRow.nextElementSibling;
                    if (nextRow) {
                        const nextRowCells = getEditableCellsInRow(nextRow);
                        let potentialNextCell = nextRowCells[currentIndexInRow];
                        if (potentialNextCell && potentialNextCell.cellIndex !== 0) { // Upewnij się, że to nie komórka czasowa


                            nextElement = potentialNextCell.classList.contains('split-cell') ? potentialNextCell.children[0] : potentialNextCell;
                        } else {
                            nextElement = nextRowCells[0];
                            if (nextElement && nextElement.classList.contains('split-cell')) {
                                nextElement = nextElement.children[0];
                            }
                        }
                    } else {
                        nextElement = mainTable.querySelector('th.editable-header') || mainTable.querySelector('td.editable-cell');
                        if (nextElement && nextElement.classList.contains('split-cell')) {
                            nextElement = nextElement.children[0];
                        }
                    }
                    break;
                case 'ArrowUp':
                    const prevRow = currentRow.previousElementSibling;
                    if (prevRow) {
                        const prevRowCells = getEditableCellsInRow(prevRow);
                        let potentialPrevCell = prevRowCells[currentIndexInRow];
                        if (potentialPrevCell && potentialPrevCell.cellIndex !== 0) { // Upewnij się, że to nie komórka czasowa


                            nextElement = potentialPrevCell.classList.contains('split-cell') ? potentialPrevCell.children[0] : potentialPrevCell;
                        } else {
                            nextElement = prevRowCells[0];
                            if (nextElement && nextElement.classList.contains('split-cell')) {
                                nextElement = nextElement.children[0];
                            }
                        }
                    } else {
                        const lastRow = mainTable.querySelector('tbody').lastElementChild;
                        if (lastRow) {
                            const lastRowCells = getEditableCellsInRow(lastRow);
                            nextElement = lastRowCells[currentIndexInRow];
                            if (nextElement && nextElement.classList.contains('split-cell')) {
                                nextElement = nextElement.children[0];
                            } else if (!nextElement) {
                                 nextElement = lastRowCells[0];
                                 if (nextElement && nextElement.classList.contains('split-cell')) {
                                     nextElement = nextElement.children[0];
                                 }
                            }
                        } else {
                            nextElement = mainTable.querySelector('th.editable-header');
                        }
                    }
                    break;
            }

            if (nextElement) {
                event.preventDefault();
                setActiveCell(nextElement);
            }
        }
    });

    mainTable.addEventListener('contextmenu', (event) => {
        const target = event.target;
        const parentCell = (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target.parentNode : target;

        if (parentCell.tagName === 'TD' && parentCell.classList.contains('editable-cell')) {
            event.preventDefault();
            hideAllCellActions(); // Ukryj inne menu, jeśli jest otwarte
            currentCell = parentCell;

            const isBreak = currentCell.classList.contains('break-cell');

            if (isBreak) {
                addBreakOption.style.display = 'none';
                removeBreakOption.style.display = 'flex';
                clearCellOption.style.display = 'none';
                addPatientOption.style.display = 'none';
                massagOption.style.display = 'none';
                pnfOption.style.display = 'none';
            } else {
                addBreakOption.style.display = 'flex';
                removeBreakOption.style.display = 'none';
                clearCellOption.style.display = 'flex';
                addPatientOption.style.display = 'flex';
                massagOption.style.display = 'flex';
                pnfOption.style.display = 'flex';
            }

            contextMenu.classList.add('visible');
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
        } else {
            contextMenu.classList.remove('visible');
        }
    });

    document.addEventListener('click', (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.classList.remove('visible');
        }

        // Sprawdź, czy kliknięto poza aktywną komórką i jej kontrolkami
        const clickedOutside = !event.target.closest('.active-cell') &&
                               !event.target.closest('.action-toolbar') &&
                               !event.target.closest('.cell-settings-icon') &&
                               !event.target.closest('.context-menu');

        if (clickedOutside) {
            hideAllCellActions();
        }

        const clickedOutsideEditable = !activeCell ||
                                     (!activeCell.contains(event.target) &&
                                      !contextMenu.contains(event.target) &&
                                      !event.target.closest('.context-menu') &&
                                      !event.target.closest('.action-toolbar') &&
                                      !event.target.closest('.cell-settings-icon'));

        if (activeCell && activeCell.getAttribute('contenteditable') === 'true' && clickedOutsideEditable) {
            exitEditMode(activeCell);
        }
    });

    addBreakOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell')) {
            pushStateToUndoStack();
            currentCell.textContent = BREAK_TEXT;
            currentCell.classList.add('break-cell');
            currentCell.classList.remove('massage-text', 'split-cell', 'pnf-text');
            delete currentCell.dataset.isMassage;
            currentCell.setAttribute('contenteditable', 'false');
            clearDuplicateHighlights();
            currentCell.innerHTML = BREAK_TEXT;
            currentCell.style.backgroundColor = DEFAULT_CELL_COLOR;
            saveSchedule();
            refreshRowHeight(currentCell);
        }
        contextMenu.classList.remove('visible');
    });

    removeBreakOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();
            // Reset do standardowej pustej komórki
            currentCell.classList.remove('break-cell', 'massage-text', 'split-cell', 'pnf-text');
            currentCell.setAttribute('contenteditable', 'false');
            currentCell.textContent = '';
            clearDuplicateHighlights();
            currentCell.innerHTML = ''; // Upewnij się, że nie ma żadnych wiszących divów
            currentCell.style.backgroundColor = DEFAULT_CELL_COLOR;
            delete currentCell.dataset.isMassage;
            saveSchedule();
            refreshRowHeight(currentCell);
        }
        contextMenu.classList.remove('visible');
    });

    clearCellOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();
            // Reset do standardowej pustej komórki
            currentCell.classList.remove('massage-text', 'split-cell', 'pnf-text');
            delete currentCell.dataset.isMassage;
            currentCell.setAttribute('contenteditable', 'false');
            clearDuplicateHighlights();
            currentCell.textContent = '';
            currentCell.innerHTML = ''; // Upewnij się, że nie ma żadnych wiszących divów
            currentCell.style.backgroundColor = DEFAULT_CELL_COLOR;
            saveSchedule();
            refreshRowHeight(currentCell);
        }
        contextMenu.classList.remove('visible');
    });

    addPatientOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();

            if (!currentCell.classList.contains('split-cell')) {
                const existingContent = currentCell.textContent.trim();
                currentCell.textContent = '';
                currentCell.classList.add('split-cell');
                currentCell.classList.remove('massage-text', 'pnf-text');
                delete currentCell.dataset.isMassage;

                const div1 = document.createElement('div');
                div1.textContent = capitalizeFirstLetter(existingContent); // Kapitalizacja
                div1.setAttribute('tabindex', '0');
                div1.setAttribute('contenteditable', 'true'); // Natychmiast edytowalne po dodaniu
                if (currentCell.dataset.isMassage === 'true') { // Sprawdź dataset TD
                     div1.classList.add('massage-text');
                     div1.dataset.isMassage = 'true';
                }
                currentCell.appendChild(div1);

                const div2 = document.createElement('div');
                div2.textContent = '';
                div2.setAttribute('tabindex', '0');
                div2.setAttribute('contenteditable', 'true'); // Natychmiast edytowalne po dodaniu
                currentCell.appendChild(div2);

                setActiveCell(div1);
            } else {
                const part1 = currentCell.children[0];
                if (part1) {
                    enterEditMode(part1); // Wejdź w tryb edycji pierwszego div'a
                    setActiveCell(part1);
                }
            }
            saveSchedule();
            refreshRowHeight(currentCell);
        }
        contextMenu.classList.remove('visible');
    });

    const toggleSpecialStyle = (styleClass, dataAttribute) => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();
            const targetElements = currentCell.classList.contains('split-cell')
                ? Array.from(currentCell.children)
                : [currentCell];

            targetElements.forEach(el => {
                el.classList.toggle(styleClass);
                if (el.classList.contains(styleClass)) {
                    el.dataset[dataAttribute] = 'true';
                } else {
                    delete el.dataset[dataAttribute];
                }
            });

            // Przeładuj komórkę, aby dodać/usunąć ikony
            const state = getCurrentTableState();
            const time = currentCell.dataset.time;
            const employeeIndex = currentCell.dataset.employeeIndex;
            applyCellDataToDom(currentCell, state[time][employeeIndex]);

            saveSchedule();
            refreshRowHeight(currentCell);
        }
        contextMenu.classList.remove('visible');
    };

    massagOption.addEventListener('click', () => {
        toggleSpecialStyle('massage-text', 'isMassage');
    });

    pnfOption.addEventListener('click', () => {
        toggleSpecialStyle('pnf-text', 'isPnf');
    });

    cellSettingsIcon.addEventListener('click', (event) => {
        event.stopPropagation(); // Zapobiegaj zamknięciu przez document.click
        showFullActionToolbar();
    });

    // --- OBSŁUGA PRZYCISKÓW PASKA NARZĘDZI ---
    toolbarAddBreak.addEventListener('click', () => {
        addBreakOption.click();
        hideAllCellActions();
    });

    toolbarRemoveBreak.addEventListener('click', () => {
        removeBreakOption.click();
        hideAllCellActions();
    });

    toolbarClear.addEventListener('click', () => {
        // Działa zarówno dla przerw jak i zwykłych komórek
        if (currentCell && currentCell.classList.contains('break-cell')) {
            removeBreakOption.click();
        } else {
            clearCellOption.click();
        }
        hideAllCellActions();
    });

    toolbarSplitCell.addEventListener('click', () => {
        addPatientOption.click();
        // Nie trzeba ukrywać, bo `addPatientOption` wywoła `setActiveCell`,
        // co z kolei wywoła `showCellSettingsIcon`, które na początku ukrywa wszystko.
    });

    toolbarMassage.addEventListener('click', () => {
        massagOption.click();
        // Nie ukrywamy paska, aby umożliwić przełączanie wielu stylów
    });
    toolbarPnf.addEventListener('click', () => {
        pnfOption.click();
        // Nie ukrywamy paska, aby umożliwić przełączanie wielu stylów
    });

    mainTable.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (target.tagName === 'TD' && target.classList.contains('editable-cell') && target.getAttribute('contenteditable') !== 'true' && !target.classList.contains('break-cell')) {
            draggedCell = target;
            const dataToTransfer = {
                content: getElementText(target),
                isMassage: target.classList.contains('massage-text'),
                isPnf: target.classList.contains('pnf-text'),
                isSplit: target.classList.contains('split-cell'),
                content1: target.classList.contains('split-cell') ? getElementText(target.children[0]) : undefined,
                content2: target.classList.contains('split-cell') ? getElementText(target.children[1]) : undefined,
                isMassage1: target.classList.contains('split-cell') ? target.children[0]?.classList.contains('massage-text') : undefined,
                isMassage2: target.classList.contains('split-cell') ? target.children[1]?.classList.contains('massage-text') : undefined,
                isPnf1: target.classList.contains('split-cell') ? target.children[0]?.classList.contains('pnf-text') : undefined,
                isPnf2: target.classList.contains('split-cell') ? target.children[1]?.classList.contains('pnf-text') : undefined
            };
            event.dataTransfer.setData('application/json', JSON.stringify(dataToTransfer));
            event.dataTransfer.effectAllowed = 'move';

            draggedCell.classList.add('is-dragging');
        } else {
            event.preventDefault();
        }
    });

    mainTable.addEventListener('dragover', (event) => {
        event.preventDefault();
        const target = event.target;
        const dropTargetCell = (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target.parentNode : target;

        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));

        if (dropTargetCell.tagName === 'TD' && dropTargetCell.classList.contains('editable-cell') && dropTargetCell.getAttribute('contenteditable') !== 'true' && !dropTargetCell.classList.contains('break-cell') && draggedCell !== dropTargetCell) {
            event.dataTransfer.dropEffect = 'move';
            dropTargetCell.classList.add('drag-over-target');
        } else {
            event.dataTransfer.dropEffect = 'none';
        }
    });

    mainTable.addEventListener('dragleave', (event) => {
        if (event.target.classList.contains('drag-over-target')) {
            event.target.classList.remove('drag-over-target');
        }
    });

    mainTable.addEventListener('drop', (event) => {
        event.preventDefault();
        const target = event.target;
        const dropTargetCell = (target.tagName === 'DIV' && target.parentNode.classList.contains('split-cell')) ? target.parentNode : target;

        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));

        if (dropTargetCell.tagName === 'TD' && dropTargetCell.classList.contains('editable-cell') && dropTargetCell.getAttribute('contenteditable') !== 'true' && !dropTargetCell.classList.contains('break-cell') && draggedCell && draggedCell !== dropTargetCell) {

            pushStateToUndoStack();

            const draggedData = JSON.parse(event.dataTransfer.getData('application/json'));

            const targetData = {
                content: getElementText(dropTargetCell),
                isMassage: dropTargetCell.classList.contains('massage-text'),
                isPnf: dropTargetCell.classList.contains('pnf-text'),
                isSplit: dropTargetCell.classList.contains('split-cell'),
                content1: dropTargetCell.classList.contains('split-cell') ? getElementText(dropTargetCell.children[0]) : undefined,
                content2: dropTargetCell.classList.contains('split-cell') ? getElementText(dropTargetCell.children[1]) : undefined,
                isMassage1: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[0]?.classList.contains('massage-text') : undefined,
                isMassage2: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[1]?.classList.contains('massage-text') : undefined,
                isPnf1: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[0]?.classList.contains('pnf-text') : undefined,
                isPnf2: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[1]?.classList.contains('pnf-text') : undefined
            };

            applyCellDataToDom(dropTargetCell, draggedData);
            applyCellDataToDom(draggedCell, targetData);

            draggedCell.classList.remove('is-dragging');
            refreshRowHeight(draggedCell);
            refreshRowHeight(dropTargetCell);
            clearDuplicateHighlights();
            draggedCell = null;
            saveSchedule();
        }
    });

    mainTable.addEventListener('dragend', (event) => {
        if (draggedCell) {
            draggedCell.classList.remove('is-dragging');
            draggedCell = null;
        }
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
    });

    undoButton.addEventListener('click', undoLastAction);

    const hideLoadingOverlay = () => {
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            // Usuń element z DOM po zakończeniu animacji, aby nie blokował interakcji
            setTimeout(() => {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            }, 300); // Musi pasować do czasu transition w CSS
        }
    };

    generateScheduleTable();
    loadSchedule().then(() => {
        refreshAllRowHeights(); // Upewnij się, że wysokość jest poprawna po załadowaniu
        pushStateToUndoStack();
    }).catch(error => {
        console.error("Błąd podczas inicjalizacji strony grafiku:", error);
    }).finally(() => {
        hideLoadingOverlay();
    });
});

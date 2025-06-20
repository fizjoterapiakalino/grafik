document.addEventListener('DOMContentLoaded', () => {
    // === POCZĄTEK MODYFIKACJI ===
    // Adres URL Twojej wdrożonej aplikacji internetowej Google Apps Script
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzu0mPeOZvjxnTJmvELkRdYMqFjxnhJHUdHbYJHojO06m9im_eoqQOQ3UzKtdgK8VPq6Q/exec';
    // === KONIEC MODYFIKACJI ===

    const mainTable = document.getElementById('mainScheduleTable');
    const tableHeaderRow = document.getElementById('tableHeaderRow');
    const tbody = mainTable.querySelector('tbody');
    const contextMenu = document.getElementById('contextMenu');
    const addBreakOption = document.getElementById('addBreakOption');
    const removeBreakOption = document.getElementById('removeBreakOption');
    const clearCellOption = document.getElementById('clearCellOption');
    const addPatientOption = document.getElementById('addPatientOption');
    const massagOption = document.getElementById('massagOption');
    const dateTimeText = document.getElementById('dateTimeText');
    const saveConfirmation = document.getElementById('saveConfirmation');
    const undoButton = document.getElementById('undoButton');

    let currentCell = null; // Zawsze odnosi się do TD (rodzica dla menu kontekstowego)
    let draggedCell = null;
    let activeCell = null; // Może być TD, TH lub wewnętrznym DIV w przypadku split-cell
    let previouslyHighlightedTimeCell = null;

    const undoStack = [];
    const redoStack = [];
    const MAX_UNDO_STATES = 20;

    const numberOfEmployees = 13;
    const startHour = 7;
    const endHour = 17;

    const updateDateTimeHeader = () => {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    setInterval(updateDateTimeHeader, 1000);
    updateDateTimeHeader();

    const setActiveCell = (cell) => {
        if (activeCell) {
            // Usuń klasę 'active-cell' z poprzedniego aktywnego elementu
            activeCell.classList.remove('active-cell');
            // Jeśli poprzedni aktywny element był DIV, usuń klasę również z jego rodzica TD
            if (activeCell.tagName === 'DIV' && activeCell.parentNode.classList.contains('active-cell')) {
                 activeCell.parentNode.classList.remove('active-cell');
            }
            // Upewnij się, że wychodzimy z trybu edycji, jeśli poprzednia komórka była edytowalna
            if (activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
        }
        activeCell = cell;
        if (activeCell) {
            activeCell.classList.add('active-cell');
            // Jeśli aktywny element to DIV, dodaj klasę 'active-cell' również do rodzica TD
            if (activeCell.tagName === 'DIV') {
                activeCell.parentNode.classList.add('active-cell');
            }
            activeCell.focus(); // Ustaw focus na aktywnej komórce/elemencie
        }
    };

    const enterEditMode = (element, clearContent = false, initialChar = '') => {
        // Element może być TD, TH lub DIV w split-cell
        if (!element || element.classList.contains('break-cell') || element.getAttribute('contenteditable') === 'true') {
            return;
        }

        // PUSH STATE Został przeniesiony do exitEditMode() i po innych akcjach modyfikujących.

        // Jeśli to TD i nie jest split-cell, upewnij się, że nie ma wewnętrznych divów i ustaw contenteditable
        if (element.tagName === 'TD' && !element.classList.contains('split-cell')) {
            element.innerHTML = element.textContent; // Usuń wszelkie potencjalne br/inne tagi
            element.setAttribute('contenteditable', 'true');
            element.classList.remove('massage-text');
            delete element.dataset.isMassage;
        } else if (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell')) {
            // Jeśli to DIV w split-cell, ustaw contenteditable na nim
            element.setAttribute('contenteditable', 'true');
            element.classList.remove('massage-text'); // Tymczasowo usuń klasę, zostanie przywrócona przez exitEditMode
            delete element.dataset.isMassage; // Tymczasowo usuń flagę
        } else if (element.tagName === 'TH' && element.classList.contains('editable-header')) {
            // Jeśli to TH, ustaw contenteditable na nim
            element.setAttribute('contenteditable', 'true');
        } else {
            return; // Nieoczekiwany element
        }

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
        // Element może być TD, TH lub DIV w split-cell
        if (!element || element.getAttribute('contenteditable') === 'false') return;

        element.setAttribute('contenteditable', 'false');
        saveSchedule(); // Zapisz zmiany
        pushStateToUndoStack(); // Dodaj stan po zakończeniu edycji!

        // Zawsze operuj na TD dla decyzji o stanie całej komórki
        const parentCell = element.tagName === 'DIV' ? element.parentNode : element;

        // Resetowanie stylów i flag dla całej komórki
        if (parentCell.classList.contains('break-cell')) {
            // Jeśli to przerwa, nic nie zmieniaj poza contenteditable na false
            // Dzieci divów też nie powinny być edytowalne
            Array.from(parentCell.children).forEach(child => child.setAttribute('contenteditable', 'false'));
            return; // Nic więcej do zrobienia dla przerw
        }

        // Sprawdź, czy komórka jest split-cell
        if (parentCell.classList.contains('split-cell')) {
            const part1 = parentCell.children[0];
            const part2 = parentCell.children[1];

            // Przywróć styl masażu dla każdej części osobno
            if (part1 && part1.dataset.isMassage === 'true') {
                part1.classList.add('massage-text');
            } else if (part1) {
                part1.classList.remove('massage-text');
            }
            if (part2 && part2.dataset.isMassage === 'true') {
                part2.classList.add('massage-text');
            } else if (part2) {
                part2.classList.remove('massage-text');
            }

            // Jeśli obie części są puste, przywróć komórkę do stanu pojedynczego
            if (part1 && part1.textContent.trim() === '' && part2 && part2.textContent.trim() === '') {
                parentCell.innerHTML = '';
                parentCell.classList.remove('split-cell', 'massage-text');
                delete parentCell.dataset.isMassage;
                parentCell.style.backgroundColor = '#e0e0e0'; // Domyślny kolor
            } else {
                parentCell.style.backgroundColor = '#ffffff'; // Białe tło dla komórek z zawartością
            }
        } else { // Standardowa komórka TD lub TH
            if (element.tagName === 'TD') { // Tylko TD mają style tła i masażu
                if (element.dataset.isMassage === 'true') {
                    element.classList.add('massage-text');
                } else {
                    element.classList.remove('massage-text');
                }

                if (element.textContent.trim() !== '') {
                    element.style.backgroundColor = '#ffffff';
                } else {
                    element.style.backgroundColor = '#e0e0e0';
                }
            }
        }
    };

    const generateScheduleTable = () => {
        tableHeaderRow.innerHTML = '<th>Godz.</th>';
        tbody.innerHTML = '';

        // Usunięto odczyt z localStorage - dane zostaną załadowane przez loadSchedule()
        const savedEmployeeHeaders = {};

        for (let i = 0; i < numberOfEmployees; i++) {
            const th = document.createElement('th');
            th.textContent = savedEmployeeHeaders[i] || `Pracownik ${i + 1}`;
            th.classList.add('editable-header');
            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            tableHeaderRow.appendChild(th);
        }

        for (let hour = startHour; hour <= endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === 17 && minute === 30) { // Ograniczenie do godziny 17:00
                    continue;
                }

                const tr = tbody.insertRow();
                const displayMinute = minute === 0 ? '00' : minute;
                const timeString = `${hour}:${displayMinute}`;

                const timeCell = tr.insertCell();
                timeCell.textContent = timeString;

                for (let i = 0; i < numberOfEmployees; i++) {
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

    // === POCZĄTEK MODYFIKACJI ===
    // NOWA WERSJA `loadSchedule` KOMUNIKUJĄCA SIĘ Z ARKUSZEM GOOGLE
    const loadSchedule = async () => {
        let savedData = {};
        try {
            const response = await fetch(WEB_APP_URL);
            savedData = await response.json();
            if (Object.keys(savedData).length === 0) {
              // Jeśli z bazy danych nic nie przyszło (np. jest pusta), użyj pustego obiektu
              savedData = {};
            }
        } catch (error) {
            console.error('Błąd podczas ładowania danych:', error);
            alert('Nie udało się załadować grafiku. Sprawdź połączenie z internetem i konsolę.');
            savedData = {}; // W razie błędu, ładuj pusty grafik
        }
        
        // Aktualizacja nagłówków pracowników
        document.querySelectorAll('th.editable-header').forEach(th => {
            const index = th.getAttribute('data-employee-index');
            if (savedData.employeeHeaders && savedData.employeeHeaders[index]) {
                th.textContent = savedData.employeeHeaders[index];
            }
        });

        // Ta część kodu do wypełniania komórek pozostaje prawie identyczna
        document.querySelectorAll('td.editable-cell').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');

            if (savedData.scheduleCells && savedData.scheduleCells[time] && savedData.scheduleCells[time][employeeIndex]) {
                const cellObj = savedData.scheduleCells[time][employeeIndex];

                if (cellObj.isBreak) {
                    cell.textContent = 'Przerwa';
                    cell.classList.add('break-cell');
                    cell.classList.remove('split-cell', 'massage-text');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = 'Przerwa';
                    delete cell.dataset.isMassage;
                    cell.style.backgroundColor = '#e0e0e0';
                } else if (cellObj.isSplit) {
                    cell.classList.add('split-cell');
                    cell.classList.remove('break-cell', 'massage-text');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = '';

                    const div1 = document.createElement('div');
                    div1.textContent = cellObj.content1 || '';
                    div1.setAttribute('contenteditable', 'false');
                    div1.setAttribute('tabindex', '0');
                    if (cellObj.isMassage1) {
                        div1.classList.add('massage-text');
                        div1.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div1);

                    const div2 = document.createElement('div');
                    div2.textContent = cellObj.content2 || '';
                    div2.setAttribute('contenteditable', 'false');
                    div2.setAttribute('tabindex', '0');
                    if (cellObj.isMassage2) {
                        div2.classList.add('massage-text');
                        div2.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div2);

                    cell.style.backgroundColor = '#ffffff';

                } else {
                    cell.textContent = cellObj.content;
                    cell.classList.remove('break-cell', 'split-cell');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = cellObj.content;

                    if (cellObj.isMassage) {
                        cell.classList.add('massage-text');
                        cell.dataset.isMassage = 'true';
                    } else {
                        cell.classList.remove('massage-text');
                        delete cell.dataset.isMassage;
                    }

                    if (cell.textContent.trim() !== '') {
                        cell.style.backgroundColor = '#ffffff';
                    } else {
                        cell.style.backgroundColor = '#e0e0e0';
                    }
                }
            } else {
                // Jeśli nie ma danych, upewnij się, że komórka jest pusta i ma domyślny styl
                cell.classList.remove('break-cell', 'split-cell', 'massage-text');
                cell.setAttribute('contenteditable', 'false');
                cell.textContent = '';
                cell.style.backgroundColor = '#e0e0e0';
                delete cell.dataset.isMassage;
                cell.innerHTML = '';
            }
        });
    };
    
    // NOWA WERSJA `saveSchedule` KOMUNIKUJĄCA SIĘ Z ARKUSZEM GOOGLE
    const saveSchedule = async () => {
        const scheduleData = {
            employeeHeaders: {},
            scheduleCells: {}
        };

        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            scheduleData.employeeHeaders[index] = headerTh.textContent;
        });

        document.querySelectorAll('td[data-time]').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');

            if (!scheduleData.scheduleCells[time]) {
                scheduleData.scheduleCells[time] = {};
            }

            if (cell.classList.contains('break-cell')) {
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content: 'Przerwa', // Zawsze zapisuj "Przerwa" jako tekst
                    isBreak: true,
                    isSplit: false,
                    isMassage: false // Przerwa nie może być masażem
                };
            } else if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0];
                const part2 = cell.children[1];
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content1: part1 ? part1.textContent : '',
                    content2: part2 ? part2.textContent : '',
                    isSplit: true,
                    isBreak: false,
                    isMassage1: part1 ? part1.classList.contains('massage-text') : false,
                    isMassage2: part2 ? part2.classList.contains('massage-text') : false
                };
            } else { // Standardowa komórka
                scheduleData.scheduleCells[time][employeeIndex] = {
                    content: cell.textContent,
                    isBreak: false,
                    isSplit: false,
                    isMassage: cell.classList.contains('massage-text')
                };
            }
        });
        
        try {
            // Zamiast localStorage, wysyłamy dane do Google Apps Script
            const response = await fetch(WEB_APP_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8', // Apps Script lepiej radzi sobie z text/plain dla prostych POST
                },
                body: JSON.stringify(scheduleData)
            });
            await response.json(); // Oczekujemy na odpowiedź
            showSaveConfirmation();
        } catch (error) {
            console.error('Błąd podczas zapisywania danych:', error);
            alert('Wystąpił błąd podczas zapisu. Sprawdź konsolę.');
        }
    };
    // === KONIEC MODYFIKACJI ===


    let saveConfirmationTimeout;
    const showSaveConfirmation = () => {
        clearTimeout(saveConfirmationTimeout);
        saveConfirmation.classList.add('show');
        saveConfirmationTimeout = setTimeout(() => {
            saveConfirmation.classList.remove('show');
        }, 2000);
    };

    // --- Funkcje do Undo/Redo ---
    const getCurrentTableState = () => {
        const state = {};
        // Zapisz nagłówki
        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            state[`header_${index}`] = headerTh.textContent;
        });

        // Zapisz komórki
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
                    isMassage: false
                };
            } else if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0];
                const part2 = cell.children[1];
                state[time][employeeIndex] = {
                    content1: part1 ? part1.textContent : '',
                    content2: part2 ? part2.textContent : '',
                    isSplit: true,
                    isBreak: false,
                    isMassage1: part1 ? part1.classList.contains('massage-text') : false,
                    isMassage2: part2 ? part2.classList.contains('massage-text') : false
                };
            } else {
                state[time][employeeIndex] = {
                    content: cell.textContent,
                    isBreak: false,
                    isSplit: false,
                    isMassage: cell.classList.contains('massage-text')
                };
            }
        });
        return state;
    };

    const applyTableState = (state) => {
        // Przywróć nagłówki
        document.querySelectorAll('th[data-employee-index]').forEach(headerTh => {
            const index = headerTh.getAttribute('data-employee-index');
            if (state[`header_${index}`] !== undefined) {
                headerTh.textContent = state[`header_${index}`];
            }
        });

        // Przywróć komórki
        document.querySelectorAll('td.editable-cell').forEach(cell => {
            const time = cell.getAttribute('data-time');
            const employeeIndex = cell.getAttribute('data-employee-index');
            if (state[time] && state[time][employeeIndex] !== undefined) {
                const cellObj = state[time][employeeIndex];

                if (cellObj.isBreak) {
                    cell.textContent = 'Przerwa';
                    cell.classList.add('break-cell');
                    cell.classList.remove('split-cell', 'massage-text');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = 'Przerwa';
                    delete cell.dataset.isMassage;
                    cell.style.backgroundColor = '#e0e0e0';
                } else if (cellObj.isSplit) {
                    cell.classList.add('split-cell');
                    cell.classList.remove('break-cell', 'massage-text');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = '';

                    const div1 = document.createElement('div');
                    div1.textContent = cellObj.content1 || '';
                    div1.setAttribute('contenteditable', 'false');
                    div1.setAttribute('tabindex', '0');
                    if (cellObj.isMassage1) {
                        div1.classList.add('massage-text');
                        div1.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div1);

                    const div2 = document.createElement('div');
                    div2.textContent = cellObj.content2 || '';
                    div2.setAttribute('contenteditable', 'false');
                    div2.setAttribute('tabindex', '0');
                    if (cellObj.isMassage2) {
                        div2.classList.add('massage-text');
                        div2.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div2);
                    cell.style.backgroundColor = '#ffffff';

                } else {
                    cell.textContent = cellObj.content;
                    cell.classList.remove('break-cell', 'split-cell');
                    cell.setAttribute('contenteditable', 'false');
                    cell.innerHTML = cellObj.content;

                    if (cellObj.isMassage) {
                        cell.classList.add('massage-text');
                        cell.dataset.isMassage = 'true';
                    } else {
                        cell.classList.remove('massage-text');
                        delete cell.dataset.isMassage;
                    }

                    if (cell.textContent.trim() !== '') {
                        cell.style.backgroundColor = '#ffffff';
                    } else {
                        cell.style.backgroundColor = '#e0e0e0';
                    }
                }
            } else {
                // Jeśli komórka nie istnieje w stanie, wyczyść ją
                cell.classList.remove('break-cell', 'split-cell', 'massage-text');
                cell.setAttribute('contenteditable', 'false');
                cell.textContent = '';
                cell.style.backgroundColor = '#e0e0e0';
                delete cell.dataset.isMassage;
                cell.innerHTML = '';
            }
        });
        saveSchedule(); // Zapisz zaaplikowany stan
        clearTimeout(saveConfirmationTimeout);
        saveConfirmation.classList.remove('show');
    };

    const pushStateToUndoStack = () => {
        const currentState = getCurrentTableState();
        if (undoStack.length > 0 && JSON.stringify(undoStack[undoStack.length - 1]) === JSON.stringify(currentState)) {
            return; // Nie dodawaj duplikatów
        }
        undoStack.push(currentState);
        if (undoStack.length > MAX_UNDO_STATES) {
            undoStack.shift();
        }
        redoStack.length = 0; // Wyczyść redo stack po nowej akcji
        updateUndoRedoButtons();
    };

    const undoLastAction = () => {
        if (undoStack.length > 1) { // Cofamy tylko, jeśli jest więcej niż jeden stan (stan początkowy + co najmniej jedna zmiana)
            const currentState = undoStack.pop();
            redoStack.push(currentState);
            const prevState = undoStack[undoStack.length - 1];
            applyTableState(prevState);
            updateUndoRedoButtons();
        }
    };

    const updateUndoRedoButtons = () => {
        undoButton.disabled = undoStack.length <= 1; // Wyłącz, jeśli tylko stan początkowy
    };

    mainTable.addEventListener('paste', (event) => {
        const target = event.target;
        const actualCellOrDiv = (target.tagName === 'TD' || target.tagName === 'TH' || target.tagName === 'DIV') ? target : null;

        if (actualCellOrDiv && actualCellOrDiv.getAttribute('contenteditable') === 'true') {
            // Po wklejeniu zawartości, stan zostanie zapisany w exitEditMode
        }
    });

    const highlightCurrentTime = () => {
        const now = new Date();
        let currentHour = now.getHours();
        let currentMinute = now.getMinutes();

        let targetTimeStr;
        // Zaokrąglij do najbliższej pełnej lub połówkowej godziny
        if (currentMinute < 15) {
            targetTimeStr = `${currentHour}:00`;
        } else if (currentMinute >= 15 && currentMinute < 45) {
            targetTimeStr = `${currentHour}:30`;
        } else {
            currentHour++;
            targetTimeStr = `${currentHour}:00`;
        }

        // Upewnij się, że minuty są dwucyfrowe
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


    // --- Event Listeners (pozostają bez zmian) ---

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
                exitEditMode(actualActiveElement);

                const parentCell = actualActiveElement.tagName === 'DIV' ? actualActiveElement.parentNode : actualActiveElement;
                const currentRow = parentCell.closest('tr');
                const rowCells = getEditableCellsInRow(currentRow);
                const currentIndexInRow = rowCells.indexOf(parentCell);

                if (parentCell.classList.contains('split-cell')) {
                    if (actualActiveElement === parentCell.children[0] && parentCell.children[1]) {
                        nextElement = parentCell.children[1];
                    } else {
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
                } else {
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
                    actualCellToDelete.style.backgroundColor = '#e0e0e0';
                } else if (actualCellToDelete.classList.contains('split-cell')) {
                    actualCellToDelete.innerHTML = '';
                    actualCellToDelete.classList.remove('split-cell', 'massage-text');
                    actualCellToDelete.style.backgroundColor = '#e0e0e0';
                    delete actualCellToDelete.dataset.isMassage;
                } else if (actualCellToDelete.classList.contains('editable-cell') || actualCellToDelete.classList.contains('editable-header')) {
                    actualCellToDelete.textContent = '';
                    actualCellToDelete.classList.remove('massage-text');
                    delete actualCellToDelete.dataset.isMassage;
                    if (actualCellToDelete.classList.contains('editable-cell')) {
                        actualCellToDelete.style.backgroundColor = '#e0e0e0';
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
                    break;
                case 'ArrowLeft':
                    if (activeCell.tagName === 'DIV' && activeCell === currentParentTd.children[1] && currentParentTd.children[0]) {
                        nextElement = currentParentTd.children[0];
                    } else {
                        nextElement = rowCells[currentIndexInRow - 1];
                        if (!nextElement) {
                            const prevRow = currentRow.previousElementSibling;
                            if (prevRow) {
                                const cellsInPrevRow = getEditableCellsInRow(prevRow);
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
                        if (potentialNextCell) {
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
                        if (potentialPrevCell) {
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
            currentCell = parentCell;

            if (currentCell.classList.contains('break-cell')) {
                addBreakOption.style.display = 'none';
                removeBreakOption.style.display = 'block';
                clearCellOption.style.display = 'none';
                addPatientOption.style.display = 'none';
                massagOption.style.display = 'none';
            } else {
                addBreakOption.style.display = 'block';
                removeBreakOption.style.display = 'none';
                clearCellOption.style.display = 'block';
                addPatientOption.style.display = 'block';
                massagOption.style.display = 'block';
            }

            contextMenu.style.display = 'block';
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
        } else {
            contextMenu.style.display = 'none';
        }
    });

    document.addEventListener('click', (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.style.display = 'none';
        }

        const clickedOutsideEditable = !activeCell ||
                                     (!activeCell.contains(event.target) &&
                                      !contextMenu.contains(event.target) &&
                                      !event.target.closest('.context-menu'));

        if (activeCell && activeCell.getAttribute('contenteditable') === 'true' && clickedOutsideEditable) {
            exitEditMode(activeCell);
        }
    });

    addBreakOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell')) {
            pushStateToUndoStack();
            currentCell.textContent = 'Przerwa';
            currentCell.classList.add('break-cell');
            currentCell.classList.remove('massage-text', 'split-cell');
            delete currentCell.dataset.isMassage;
            currentCell.setAttribute('contenteditable', 'false');
            currentCell.innerHTML = 'Przerwa';
            currentCell.style.backgroundColor = '#e0e0e0';
            saveSchedule();
        }
        contextMenu.style.display = 'none';
    });

    removeBreakOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();
            currentCell.textContent = '';
            currentCell.classList.remove('break-cell', 'massage-text', 'split-cell');
            currentCell.setAttribute('contenteditable', 'false');
            currentCell.style.backgroundColor = '#e0e0e0';
            delete currentCell.dataset.isMassage;
            currentCell.innerHTML = '';
            saveSchedule();
        }
        contextMenu.style.display = 'none';
    });

    clearCellOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();
            currentCell.textContent = '';
            currentCell.classList.remove('massage-text', 'split-cell');
            delete currentCell.dataset.isMassage;
            currentCell.setAttribute('contenteditable', 'false');
            currentCell.style.backgroundColor = '#e0e0e0';
            currentCell.innerHTML = '';
            saveSchedule();
        }
        contextMenu.style.display = 'none';
    });

    addPatientOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();

            if (!currentCell.classList.contains('split-cell')) {
                const existingContent = currentCell.textContent.trim();
                currentCell.textContent = '';
                currentCell.classList.add('split-cell');
                currentCell.classList.remove('massage-text');
                delete currentCell.dataset.isMassage;

                const div1 = document.createElement('div');
                div1.textContent = existingContent;
                div1.setAttribute('tabindex', '0');
                div1.setAttribute('contenteditable', 'true');
                if (currentCell.classList.contains('massage-text')) {
                     div1.classList.add('massage-text');
                     div1.dataset.isMassage = 'true';
                }
                currentCell.appendChild(div1);

                const div2 = document.createElement('div');
                div2.textContent = '';
                div2.setAttribute('tabindex', '0');
                div2.setAttribute('contenteditable', 'true');
                currentCell.appendChild(div2);

                setActiveCell(div1);
            } else {
                const part1 = currentCell.children[0];
                if (part1) {
                    enterEditMode(part1);
                    setActiveCell(part1);
                }
            }
            saveSchedule();
        }
        contextMenu.style.display = 'none';
    });

    massagOption.addEventListener('click', () => {
        if (currentCell && currentCell.classList.contains('editable-cell') && !currentCell.classList.contains('break-cell')) {
            pushStateToUndoStack();

            if (currentCell.classList.contains('split-cell')) {
                const part1 = currentCell.children[0];
                const part2 = currentCell.children[1];

                if (part1) {
                    part1.classList.toggle('massage-text');
                    if (part1.classList.contains('massage-text')) {
                        part1.dataset.isMassage = 'true';
                    } else {
                        delete part1.dataset.isMassage;
                    }
                }
                if (part2) {
                    part2.classList.toggle('massage-text');
                    if (part2.classList.contains('massage-text')) {
                        part2.dataset.isMassage = 'true';
                    } else {
                        delete part2.dataset.isMassage;
                    }
                }
            } else {
                currentCell.classList.toggle('massage-text');
                if (currentCell.classList.contains('massage-text')) {
                    currentCell.dataset.isMassage = 'true';
                } else {
                    delete currentCell.dataset.isMassage;
                }
            }
            saveSchedule();
        }
        contextMenu.style.display = 'none';
    });


    mainTable.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (target.tagName === 'TD' && target.classList.contains('editable-cell') && target.getAttribute('contenteditable') !== 'true' && !target.classList.contains('break-cell')) {
            draggedCell = target;
            const dataToTransfer = {
                content: target.textContent,
                isMassage: target.classList.contains('massage-text'),
                isSplit: target.classList.contains('split-cell'),
                content1: target.classList.contains('split-cell') ? target.children[0]?.textContent : undefined,
                content2: target.classList.contains('split-cell') ? target.children[1]?.textContent : undefined,
                isMassage1: target.classList.contains('split-cell') ? target.children[0]?.classList.contains('massage-text') : undefined,
                isMassage2: target.classList.contains('split-cell') ? target.children[1]?.classList.contains('massage-text') : undefined
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
                content: dropTargetCell.textContent,
                isMassage: dropTargetCell.classList.contains('massage-text'),
                isSplit: dropTargetCell.classList.contains('split-cell'),
                content1: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[0]?.textContent : undefined,
                content2: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[1]?.textContent : undefined,
                isMassage1: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[0]?.classList.contains('massage-text') : undefined,
                isMassage2: dropTargetCell.classList.contains('split-cell') ? dropTargetCell.children[1]?.classList.contains('massage-text') : undefined
            };

            const setCellContentAndStyle = (cell, data) => {
                cell.classList.remove('break-cell', 'split-cell', 'massage-text');
                cell.setAttribute('contenteditable', 'false');
                cell.innerHTML = '';
                delete cell.dataset.isMassage;

                if (data.isBreak) {
                    cell.textContent = 'Przerwa';
                    cell.classList.add('break-cell');
                    cell.style.backgroundColor = '#e0e0e0';
                } else if (data.isSplit) {
                    cell.classList.add('split-cell');
                    const div1 = document.createElement('div');
                    div1.textContent = data.content1 || '';
                    div1.setAttribute('contenteditable', 'false');
                    div1.setAttribute('tabindex', '0');
                    if (data.isMassage1) {
                        div1.classList.add('massage-text');
                        div1.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div1);

                    const div2 = document.createElement('div');
                    div2.textContent = data.content2 || '';
                    div2.setAttribute('contenteditable', 'false');
                    div2.setAttribute('tabindex', '0');
                    if (data.isMassage2) {
                        div2.classList.add('massage-text');
                        div2.dataset.isMassage = 'true';
                    }
                    cell.appendChild(div2);
                    cell.style.backgroundColor = '#ffffff';
                } else {
                    cell.textContent = data.content;
                    if (data.isMassage) {
                        cell.classList.add('massage-text');
                        cell.dataset.isMassage = 'true';
                    }
                    cell.style.backgroundColor = cell.textContent.trim() !== '' ? '#ffffff' : '#e0e0e0';
                }
            };

            setCellContentAndStyle(dropTargetCell, draggedData);
            setCellContentAndStyle(draggedCell, targetData);

            draggedCell.classList.remove('is-dragging');
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

    // === POCZĄTEK MODYFIKACJI ===
    // ZMIENIONY SPOSÓB WYWOŁANIA POCZĄTKOWYCH FUNKCJI
    generateScheduleTable();
    // Używamy .then(), ponieważ loadSchedule jest teraz funkcją asynchroniczną
    loadSchedule().then(() => {
        pushStateToUndoStack(); // Dodaj stan początkowy DOPIERO po załadowaniu danych
    });
    // === KONIEC MODYFIKACJI ===
});
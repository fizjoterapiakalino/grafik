document.addEventListener('DOMContentLoaded', () => {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const mainTable = document.getElementById('mainScheduleTable');
    const tableHeaderRow = document.getElementById('tableHeaderRow');
    const tbody = mainTable.querySelector('tbody');
    const contextMenu = document.getElementById('contextMenu');
    const undoButton = document.getElementById('undoButton');
    const searchInput = document.getElementById('searchInput');
    const clearSearchButton = document.getElementById('clearSearchButton');

    // Context Menu Options
    const contextSplitCell = document.getElementById('contextSplitCell');
    const contextAddBreak = document.getElementById('contextAddBreak');
    const contextMassage = document.getElementById('contextMassage');
    const contextPnf = document.getElementById('contextPnf');
    const contextClear = document.getElementById('contextClear');
    const contextRemoveBreak = document.getElementById('contextRemoveBreak');

    let currentCell = null; // The TD cell that the context menu is acting upon
    let draggedCell = null;
    let activeCell = null; // The currently focused element for keyboard nav (TD, TH, or DIV)

    // --- MODEL STANU APLIKACJI ---
    const appState = {
        employeeHeaders: {},
        scheduleCells: {}
    };

    const undoManager = new UndoManager({
        maxStates: MAX_UNDO_STATES,
        onUpdate: (manager) => {
            undoButton.disabled = !manager.canUndo();
        }
    });

    const refreshRowHeight = (cell) => {
        if (!cell) return;
        const parentRow = cell.closest('tr');
        if (parentRow) {
            parentRow.style.height = 'auto';
        }
    };

    const refreshAllRowHeights = () => {
        document.querySelectorAll('#mainScheduleTable tbody tr').forEach(row => {
            row.style.height = 'auto';
        });
    };

    const clearDuplicateHighlights = () => {
        document.querySelectorAll('.duplicate-highlight').forEach(el => {
            el.classList.remove('duplicate-highlight');
        });
    };

    const getElementText = (element) => {
        if (!element || element.classList.contains('break-cell')) return '';
        const clone = element.cloneNode(true);
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach(icon => icon.remove());
        const spans = clone.querySelectorAll('span');
        let text = '';
        if (spans.length > 0) {
            spans.forEach(span => { text += span.textContent + ' ' });
        } else {
            text = clone.textContent;
        }
        return text.trim();
    };

    const highlightDuplicates = (searchText) => {
        clearDuplicateHighlights();
        const cleanedSearchText = searchText.trim().toLowerCase();
        if (cleanedSearchText === '' || cleanedSearchText === BREAK_TEXT.toLowerCase()) {
            return;
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

    const filterTable = (searchTerm) => {
        searchAndHighlight(searchTerm, '#mainScheduleTable', 'td.editable-cell, th');
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
            clearDuplicateHighlights();
        }
        
        activeCell = cell;

        if (activeCell) {
            activeCell.classList.add('active-cell');
            if (activeCell.tagName === 'DIV') {
                activeCell.parentNode.classList.add('active-cell');
            }
            activeCell.focus();
            highlightDuplicates(getElementText(activeCell));
        }
    };

    const enterEditMode = (element, clearContent = false, initialChar = '') => {
        if (!element || element.classList.contains('break-cell') || element.getAttribute('contenteditable') === 'true') {
            return;
        }

        if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
            const firstDiv = element.querySelector('div');
            if (firstDiv) {
                enterEditMode(firstDiv, clearContent, initialChar);
                setActiveCell(firstDiv);
            }
            return;
        }

        const isEditableTarget = (element.tagName === 'TD' && !element.classList.contains('split-cell')) ||
                                 (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell'));

        if (!isEditableTarget) return;

        undoManager.pushState(getCurrentTableState());
        
        const originalValue = getElementText(element);
        element.dataset.originalValue = originalValue; // Store original value

        element.innerHTML = getElementText(element);
        element.setAttribute('contenteditable', 'true');
        element.classList.remove('massage-text', 'pnf-text');
        delete element.dataset.isMassage;
        delete element.dataset.isPnf;

        if (clearContent) {
            element.textContent = initialChar;
        } else if (initialChar) {
            element.textContent += initialChar;
        }

        element.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    };

    const exitEditMode = (element) => {
        if (!element || element.getAttribute('contenteditable') !== 'true') return;

        const newText = capitalizeFirstLetter(element.textContent.trim());
        element.setAttribute('contenteditable', 'false');

        const parentCell = element.closest('td');
        if (!parentCell) return;

        const employeeIndex = parentCell.dataset.employeeIndex;
        const time = parentCell.dataset.time;

        const duplicate = findDuplicateEntry(newText, time, employeeIndex);

        const updateSchedule = (isMove = false) => {
            if (isMove && duplicate) {
                // Clear the old entry
                const oldCellState = appState.scheduleCells[duplicate.time][duplicate.employeeIndex];
                if (oldCellState.content?.toLowerCase() === newText.toLowerCase()) {
                     delete oldCellState.content;
                }
                 if (oldCellState.content1?.toLowerCase() === newText.toLowerCase()) {
                     delete oldCellState.content1;
                }
                if (oldCellState.content2?.toLowerCase() === newText.toLowerCase()) {
                     delete oldCellState.content2;
                }
                // If the split cell is now empty, remove the split
                if (oldCellState.isSplit && !oldCellState.content1 && !oldCellState.content2) {
                    delete oldCellState.isSplit;
                }
            }

            // Set the new entry
            if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
            if (!appState.scheduleCells[time][employeeIndex]) appState.scheduleCells[time][employeeIndex] = {};
            let cellState = appState.scheduleCells[time][employeeIndex];

            if (newText.includes('/')) {
                const parts = newText.split('/', 2);
                cellState = { isSplit: true, content1: parts[0], content2: parts[1] };
            } else if (cellState.isSplit) {
                const isFirstDiv = element === parentCell.querySelector('div:first-child');
                if(isFirstDiv) cellState.content1 = newText;
                else cellState.content2 = newText;
                if(!cellState.content1 && !cellState.content2) cellState = {};
            } else {
                cellState = { content: newText };
            }
            appState.scheduleCells[time][employeeIndex] = cellState;

            renderTable();
            saveSchedule();
            undoManager.pushState(getCurrentTableState());
        };

        if (duplicate) {
            showDuplicateConfirmationDialog(
                duplicate,
                () => updateSchedule(true), // onMove
                () => updateSchedule(false), // onAdd
                () => { // onCancel
                    renderTable(); // Przywróć oryginalny stan komórki
                }
            );
        } else {
            updateSchedule(false);
        }
    };

    const findDuplicateEntry = (text, currentTime, currentEmployeeIndex) => {
        if (!text) return null;
        const lowerCaseText = text.toLowerCase();
        for (const time in appState.scheduleCells) {
            for (const employeeIndex in appState.scheduleCells[time]) {
                if (time === currentTime && employeeIndex === currentEmployeeIndex) {
                    continue; // Pomiń bieżącą komórkę
                }
                const cellData = appState.scheduleCells[time][employeeIndex];
                if (cellData.content?.toLowerCase() === lowerCaseText ||
                    cellData.content1?.toLowerCase() === lowerCaseText ||
                    cellData.content2?.toLowerCase() === lowerCaseText) {
                    return { time, employeeIndex, cellData };
                }
            }
        }
        return null;
    };

    const showDuplicateConfirmationDialog = (duplicateInfo, onMove, onAdd, onCancel) => {
        const modal = document.getElementById('duplicateModal');
        const modalText = document.getElementById('duplicateModalText');
        const moveBtn = document.getElementById('moveEntryBtn');
        const addBtn = document.getElementById('addAnywayBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        const employeeName = appState.employeeHeaders[duplicateInfo.employeeIndex] || `Pracownik ${parseInt(duplicateInfo.employeeIndex) + 1}`;
        modalText.innerHTML = `Znaleziono identyczny wpis dla "<b>${employeeName}</b>" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`;

        modal.style.display = 'block';

        const closeAndCleanup = () => {
            modal.style.display = 'none';
            moveBtn.onclick = null;
            addBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        moveBtn.onclick = () => {
            closeAndCleanup();
            onMove();
        };

        addBtn.onclick = () => {
            closeAndCleanup();
            onAdd();
        };

        cancelBtn.onclick = () => {
            closeAndCleanup();
            if(onCancel) onCancel();
        };
    };

    const renderTable = () => {
        // Renderowanie nagłówków
        tableHeaderRow.innerHTML = '<th>Godz.</th>';
        for (let i = 0; i < NUMBER_OF_EMPLOYEES; i++) {
            const th = document.createElement('th');
            const headerText = appState.employeeHeaders[i] || `Pracownik ${i + 1}`;
            th.textContent = capitalizeFirstLetter(headerText);
            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            tableHeaderRow.appendChild(th);
        }

        // Renderowanie wierszy i komórek
        tbody.innerHTML = '';
        for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === END_HOUR && minute === 30) continue;
                const tr = tbody.insertRow();
                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                tr.insertCell().textContent = timeString;

                for (let i = 0; i < NUMBER_OF_EMPLOYEES; i++) {
                    const cell = tr.insertCell();
                    const cellData = appState.scheduleCells[timeString]?.[i] || {};
                    applyCellDataToDom(cell, cellData);
                    cell.setAttribute('data-time', timeString);
                    cell.setAttribute('data-employee-index', i);
                    cell.setAttribute('draggable', 'true');
                    cell.setAttribute('tabindex', '0');
                }
            }
        }
        refreshAllRowHeights();
    };

    const applyCellDataToDom = (cell, cellObj) => {
        cell.className = 'editable-cell';
        cell.innerHTML = '';
        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;

        if (cell.tagName === 'TH') {
             cell.textContent = cellObj.content || '';
             return;
        }

        if (cellObj.isBreak) {
            cell.textContent = BREAK_TEXT;
            cell.classList.add('break-cell');
            cell.style.backgroundColor = DEFAULT_CELL_COLOR;
        } else if (cellObj.isSplit) {
            const createPart = (content, isMassage, isPnf) => {
                const div = document.createElement('div');
                div.setAttribute('tabindex', '0');
                let htmlContent = `<span>${capitalizeFirstLetter(content || '')}</span>`;
                if (isMassage) {
                    div.classList.add('massage-text');
                    div.dataset.isMassage = 'true';
                }
                if (isPnf) {
                    div.classList.add('pnf-text');
                    div.dataset.isPnf = 'true';
                }
                div.innerHTML = htmlContent;
                return div;
            };
            cell.classList.add('split-cell');
            cell.style.backgroundColor = CONTENT_CELL_COLOR;
            cell.appendChild(createPart(cellObj.content1, cellObj.isMassage1, cellObj.isPnf1));
            cell.appendChild(createPart(cellObj.content2, cellObj.isMassage2, cellObj.isPnf2));
        } else {
            let htmlContent = `<span>${capitalizeFirstLetter(cellObj.content || '')}</span>`;
            if (cellObj.isMassage) {
                cell.classList.add('massage-text');
                cell.dataset.isMassage = 'true';
            }
             if (cellObj.isPnf) {
                cell.classList.add('pnf-text');
                cell.dataset.isPnf = 'true';
            }
            cell.innerHTML = htmlContent;
            cell.style.backgroundColor = (getElementText(cell).trim() !== '') ? CONTENT_CELL_COLOR : DEFAULT_CELL_COLOR;
        }
    };

    const loadSchedule = async () => {
        try {
            const docRef = db.collection("schedules").doc("mainSchedule");
            const doc = await docRef.get();

            if (doc.exists) {
                const savedData = doc.data();
                appState.employeeHeaders = savedData.employeeHeaders || {};
                appState.scheduleCells = savedData.scheduleCells || {};

                // Sprawdzenie i aktualizacja cache
                const cachedHeaders = sessionStorage.getItem('employeeHeaders');
                if (cachedHeaders) {
                    appState.employeeHeaders = JSON.parse(cachedHeaders);
                } else {
                    sessionStorage.setItem('employeeHeaders', JSON.stringify(appState.employeeHeaders));
                    const employeeNames = Object.values(appState.employeeHeaders);
                    sessionStorage.setItem('employeeNames', JSON.stringify(employeeNames));
                }
            } else {
                console.log("No schedule found, creating a new one.");
                // Zainicjuj pusty stan, jeśli nie ma danych w Firestore
                for (let i = 0; i < NUMBER_OF_EMPLOYEES; i++) {
                    appState.employeeHeaders[i] = `Pracownik ${i + 1}`;
                }
            }
        } catch (error) {
            console.error('Error loading data from Firestore:', error);
            window.showToast('Błąd ładowania grafiku z Firestore', 5000);
        }
        renderTable();
    };

    const saveSchedule = async () => {
        console.log("Attempting to save schedule...");
        try {
            await db.collection("schedules").doc("mainSchedule").set(appState);
            console.log("Schedule successfully written to Firestore.");
            window.showToast('Zapisano w Firestore!', 2000);
        } catch (error) {
            console.error('Error saving data to Firestore:', error);
            window.showToast('Błąd zapisu do Firestore!', 5000);
        }
    };

    const getCurrentTableStateForCell = (cell) => {
        if(cell.tagName === 'TH') {
            return { content: getElementText(cell) };
        }
        if (cell.classList.contains('break-cell')) {
            return { content: BREAK_TEXT, isBreak: true };
        }
        if (cell.classList.contains('split-cell')) {
            const part1 = cell.children[0];
            const part2 = cell.children[1];
            return {
                content1: getElementText(part1), content2: getElementText(part2),
                isSplit: true,
                isMassage1: part1?.dataset.isMassage === 'true', isMassage2: part2?.dataset.isMassage === 'true',
                isPnf1: part1?.dataset.isPnf === 'true', isPnf2: part2?.dataset.isPnf === 'true'
            };
        }
        return {
            content: getElementText(cell),
            isMassage: cell.dataset.isMassage === 'true',
            isPnf: cell.dataset.isPnf === 'true'
        };
    };
    
    const getCurrentTableState = () => {
        // Zwraca kopię stanu, aby uniknąć mutacji
        return JSON.parse(JSON.stringify(appState));
    };

    const applyTableState = (state) => {
        if (!state) return;
        appState.employeeHeaders = state.employeeHeaders;
        appState.scheduleCells = state.scheduleCells;
        renderTable();
        saveSchedule();
    };

    const undoLastAction = () => {
        const prevState = undoManager.undo();
        if (prevState) {
            applyTableState(prevState);
        }
    };
    
    // Event Listeners
    mainTable.addEventListener('click', (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"]');
        if (target) {
            if (activeCell === target && target.getAttribute('contenteditable') === 'true') return;
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') exitEditMode(activeCell);
            setActiveCell(target);
        } else {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') exitEditMode(activeCell);
            setActiveCell(null);
        }
    });

    mainTable.addEventListener('dblclick', (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"]');
        if (target) enterEditMode(target);
    });

    mainTable.addEventListener('contextmenu', (event) => {
        const target = event.target.closest('td.editable-cell');
        if (target) {
            event.preventDefault();
            setActiveCell(target);
            currentCell = target;

            const isBreak = currentCell.classList.contains('break-cell');
            contextAddBreak.style.display = isBreak ? 'none' : 'flex';
            contextRemoveBreak.style.display = isBreak ? 'flex' : 'none';
            contextClear.style.display = isBreak ? 'none' : 'flex';
            contextSplitCell.style.display = isBreak ? 'none' : 'flex';
            contextMassage.style.display = isBreak ? 'none' : 'flex';
            contextPnf.style.display = isBreak ? 'none' : 'flex';
            
            contextMenu.classList.add('visible');
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
        }
    });

    document.addEventListener('click', (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.classList.remove('visible');
        }
        if (!event.target.closest('.active-cell')) {
             if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    });

    // Context Menu Actions
    const updateCellState = (updateFn) => {
        if (!currentCell) return;
        undoManager.pushState(getCurrentTableState());
        const time = currentCell.dataset.time;
        const employeeIndex = currentCell.dataset.employeeIndex;
        if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
        let cellState = appState.scheduleCells[time][employeeIndex] || {};
        
        updateFn(cellState);

        appState.scheduleCells[time][employeeIndex] = cellState;
        
        renderTable();
        saveSchedule();
        undoManager.pushState(getCurrentTableState());
        contextMenu.classList.remove('visible');
    };

    contextAddBreak.addEventListener('click', () => updateCellState(state => {
        state.isBreak = true;
        window.showToast('Dodano przerwę');
    }));

    contextRemoveBreak.addEventListener('click', () => updateCellState(state => {
        delete state.isBreak;
        window.showToast('Usunięto przerwę');
    }));
    
    contextClear.addEventListener('click', () => updateCellState(state => {
        // Usuwa wszystkie właściwości z obiektu stanu komórki, skutecznie go czyszcząc
        Object.keys(state).forEach(key => delete state[key]);
        window.showToast('Wyczyszczono komórkę');
    }));

    contextSplitCell.addEventListener('click', () => updateCellState(state => {
        state.content1 = state.content || '';
        state.content2 = '';
        delete state.content;
        state.isSplit = true;
        window.showToast('Podzielono komórkę');
    }));

    const toggleSpecialStyle = (dataAttribute) => {
        updateCellState(state => {
            state[dataAttribute] = !state[dataAttribute];
             if (state.isSplit) {
                state[`${dataAttribute}1`] = state[dataAttribute];
                state[`${dataAttribute}2`] = state[dataAttribute];
            }
            window.showToast('Zmieniono styl');
        });
    };

    contextMassage.addEventListener('click', () => toggleSpecialStyle('isMassage', 'isMassage'));
    contextPnf.addEventListener('click', () => toggleSpecialStyle('isPnf', 'isPnf'));

    // Drag and Drop
    mainTable.addEventListener('dragstart', (event) => {
        const target = event.target.closest('td.editable-cell');
        if (target && !target.classList.contains('break-cell')) {
            draggedCell = target;
            event.dataTransfer.setData('application/json', JSON.stringify(getCurrentTableStateForCell(target)));
            event.dataTransfer.effectAllowed = 'move';
            draggedCell.classList.add('is-dragging');
        } else {
            event.preventDefault();
        }
    });

    mainTable.addEventListener('dragover', (event) => {
        event.preventDefault();
        const dropTargetCell = event.target.closest('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell !== dropTargetCell) {
            event.dataTransfer.dropEffect = 'move';
            dropTargetCell.classList.add('drag-over-target');
        } else {
            event.dataTransfer.dropEffect = 'none';
        }
    });

    mainTable.addEventListener('dragleave', (event) => {
        event.target.closest('.drag-over-target')?.classList.remove('drag-over-target');
    });

    mainTable.addEventListener('drop', (event) => {
        event.preventDefault();
        const dropTargetCell = event.target.closest('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
        
        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell && draggedCell !== dropTargetCell) {
            undoManager.pushState(getCurrentTableState());

            const sourceTime = draggedCell.dataset.time;
            const sourceIndex = draggedCell.dataset.employeeIndex;
            const targetTime = dropTargetCell.dataset.time;
            const targetIndex = dropTargetCell.dataset.employeeIndex;

            // Zamiana danych w stanie
            const sourceData = appState.scheduleCells[sourceTime]?.[sourceIndex] || {};
            const targetData = appState.scheduleCells[targetTime]?.[targetIndex] || {};

            if (!appState.scheduleCells[sourceTime]) appState.scheduleCells[sourceTime] = {};
            appState.scheduleCells[sourceTime][sourceIndex] = targetData;
            
            if (!appState.scheduleCells[targetTime]) appState.scheduleCells[targetTime] = {};
            appState.scheduleCells[targetTime][targetIndex] = sourceData;

            renderTable();
            saveSchedule();
            undoManager.pushState(getCurrentTableState());
        }
    });

    mainTable.addEventListener('dragend', () => {
        draggedCell?.classList.remove('is-dragging');
        draggedCell = null;
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
    });
    
    // Keyboard Navigation
    document.addEventListener('keydown', (event) => {
         if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            undoLastAction();
            return;
        }

        const target = document.activeElement;
        const isEditing = target.getAttribute('contenteditable') === 'true';

        if(isEditing) {
            if (event.key === 'Escape') exitEditMode(target);
            if (event.key === 'Enter') {
                 event.preventDefault();
                 exitEditMode(target);
                 const parentCell = target.closest('td');
                 if (parentCell) {
                     const nextRow = parentCell.closest('tr').nextElementSibling;
                     if (nextRow) {
                         const nextCell = nextRow.cells[parentCell.cellIndex];
                         setActiveCell(nextCell);
                     }
                 }
            }
            return;
        }
        
        if (!activeCell) return;

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            const cellToClear = activeCell.closest('td.editable-cell');
            if (cellToClear) {
                currentCell = cellToClear; // Ustawienie globalnej referencji dla updateCellState
                updateCellState(state => {
                    // Usuwa wszystkie właściwości z obiektu stanu komórki, skutecznie go czyszcząc
                    Object.keys(state).forEach(key => delete state[key]);
                    window.showToast('Wyczyszczono komórkę');
                });
            }
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            enterEditMode(activeCell);
            return;
        }
        
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            enterEditMode(activeCell, true, event.key);
            return;
        }

        let nextElement = null;
        const currentParentTd = activeCell.closest('td, th');
        const currentRow = currentParentTd.closest('tr');
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(currentParentTd);

        switch (event.key) {
            case 'ArrowRight':
                 if(activeCell.tagName === 'DIV' && activeCell.nextElementSibling) {
                     nextElement = activeCell.nextElementSibling;
                 } else {
                     const nextCell = currentRow.cells[currentIndexInRow + 1];
                     if(nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                 }
                break;
            case 'ArrowLeft':
                 if(activeCell.tagName === 'DIV' && activeCell.previousElementSibling) {
                     nextElement = activeCell.previousElementSibling;
                 } else {
                    const prevCell = currentRow.cells[currentIndexInRow - 1];
                    if (prevCell && prevCell.matches('.editable-cell, .editable-header')) {
                         nextElement = Array.from(prevCell.querySelectorAll('div')).pop() || prevCell;
                    }
                 }
                break;
            case 'ArrowDown':
                const nextRow = currentRow.nextElementSibling;
                if(nextRow) {
                    const nextCell = nextRow.cells[currentIndexInRow];
                    if (nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                }
                break;
            case 'ArrowUp':
                const prevRow = currentRow.previousElementSibling;
                 if(prevRow) {
                    const prevCell = prevRow.cells[currentIndexInRow];
                    if (prevCell) nextElement = prevCell.querySelector('div') || prevCell;
                }
                break;
        }

        if (nextElement) {
            event.preventDefault();
            setActiveCell(nextElement);
        }
    });

    // --- WYSZUKIWARKA ---
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim();
        filterTable(searchTerm);
        clearSearchButton.style.display = searchTerm ? 'block' : 'none';
    });

    clearSearchButton.addEventListener('click', () => {
        searchInput.value = '';
        filterTable('');
        clearSearchButton.style.display = 'none';
        searchInput.focus();
    });

    // --- INICJALIZACJA ---
    const init = async () => {
        await loadSchedule(); // Ładuje dane i renderuje tabelę
        undoManager.initialize(getCurrentTableState());
        hideLoadingOverlay(loadingOverlay);
    };

    init();
});

const ScheduleEvents = (() => {
    let _dependencies = {};
    let mainTable;
    let activeCell = null;
    let draggedCell = null;

    // --- Nazwane funkcje obsługi zdarzeń ---

    const _handleMainTableClick = (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"]');
        if (target) {
            if (activeCell === target && target.getAttribute('contenteditable') === 'true') return;
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') _dependencies.exitEditMode(activeCell);
            setActiveCell(target);
        } else {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') _dependencies.exitEditMode(activeCell);
            setActiveCell(null);
        }
    };

    const _handleMainTableDblClick = (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"]');
        if (target) _dependencies.enterEditMode(target);
    };

    const _handleDocumentClick = (event) => {
        if (!event.target.closest('.active-cell') && !event.target.closest('#contextMenu')) {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    };
    
    const _handleDragLeave = (event) => {
        const target = event.target.closest('.drag-over-target');
        if(target) target.classList.remove('drag-over-target');
    };

    const _handleAppSearch = (e) => {
        const { searchTerm } = e.detail;
        const searchAndHighlight = (term, tableSelector, cellSelector) => {
            const table = document.querySelector(tableSelector);
            if (!table) return;
            table.querySelectorAll(cellSelector).forEach(cell => {
                const cellText = cell.textContent.toLowerCase();
                if (term && cellText.includes(term.toLowerCase())) {
                    cell.classList.add('search-highlight');
                } else {
                    cell.classList.remove('search-highlight');
                }
            });
        };
        searchAndHighlight(searchTerm, '#mainScheduleTable', 'td.editable-cell, th');
    };

    // (reszta nazwanych funkcji, które już istnieją, jak _handleKeyDown, _handleDragStart, etc.)
    // ... (istniejący kod od clearDuplicateHighlights do _handleKeyDown) ...
    const clearDuplicateHighlights = () => {
        document.querySelectorAll('.duplicate-highlight').forEach(el => {
            el.classList.remove('duplicate-highlight');
        });
    };

    const highlightDuplicates = (searchText) => {
        clearDuplicateHighlights();
        const cleanedSearchText = searchText.trim().toLowerCase();
        if (cleanedSearchText === '' || cleanedSearchText === AppConfig.schedule.breakText.toLowerCase()) {
            return;
        }
        const allCells = document.querySelectorAll('td.editable-cell');
        const matchingCells = [];
        allCells.forEach(cell => {
            const cellText = _dependencies.ui.getElementText(cell).toLowerCase();
            if (cellText.includes(cleanedSearchText)) {
                matchingCells.push(cell);
            }
        });
        if (matchingCells.length > 1) {
            matchingCells.forEach(td => td.classList.add('duplicate-highlight'));
        }
    };

    const setActiveCell = (cell) => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
            if (activeCell.tagName === 'DIV' && activeCell.parentNode.classList.contains('active-cell')) {
                 activeCell.parentNode.classList.remove('active-cell');
            }
            if (activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            clearDuplicateHighlights();
        }
        
        activeCell = cell;

        // Dezaktywuj wszystkie przyciski akcji
        document.querySelectorAll('.schedule-action-buttons .action-icon-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.disabled = true;
        });

        if (activeCell) {
            activeCell.classList.add('active-cell');
            if (activeCell.tagName === 'DIV') {
                activeCell.parentNode.classList.add('active-cell');
            }
            activeCell.focus();
            highlightDuplicates(_dependencies.ui.getElementText(activeCell));

            // Aktywuj przyciski, gdy komórka jest zaznaczona
            document.querySelectorAll('.schedule-action-buttons .action-icon-btn').forEach(btn => {
                btn.classList.add('active');
                btn.disabled = false;
            });

            // Specyficzne warunki aktywacji dla niektórych przycisków
            const patientInfoBtn = document.getElementById('btnPatientInfo');
            if (patientInfoBtn) {
                const hasPatientInfo = !activeCell.classList.contains('break-cell') && _dependencies.ui.getElementText(activeCell).trim() !== '';
                patientInfoBtn.classList.toggle('active', hasPatientInfo);
                patientInfoBtn.disabled = !hasPatientInfo;
            }
        }
    };

    const _handleDragStart = (event) => {
        const target = event.target.closest('td.editable-cell');
        if (target && !target.classList.contains('break-cell')) {
            draggedCell = target;
            event.dataTransfer.setData('application/json', JSON.stringify(_dependencies.getCurrentTableStateForCell(target)));
            event.dataTransfer.effectAllowed = 'move';
            draggedCell.classList.add('is-dragging');
        } else {
            event.preventDefault();
        }
    };

    const _handleDragOver = (event) => {
        event.preventDefault();
        const dropTargetCell = event.target.closest('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell !== dropTargetCell) {
            event.dataTransfer.dropEffect = 'move';
            dropTargetCell.classList.add('drag-over-target');
        } else {
            event.dataTransfer.dropEffect = 'none';
        }
    };

    const _handleDrop = (event) => {
        event.preventDefault();
        const dropTargetCell = event.target.closest('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
        
        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell && draggedCell !== dropTargetCell) {
            _dependencies.undoManager.pushState(_dependencies.getCurrentTableState());

            const sourceTime = draggedCell.dataset.time;
            const sourceIndex = draggedCell.dataset.employeeIndex;
            const targetTime = dropTargetCell.dataset.time;
            const targetIndex = dropTargetCell.dataset.employeeIndex;

            const sourceData = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};
            const targetData = _dependencies.appState.scheduleCells[targetTime]?.[targetIndex] || {};

            if (!_dependencies.appState.scheduleCells[sourceTime]) _dependencies.appState.scheduleCells[sourceTime] = {};
            _dependencies.appState.scheduleCells[sourceTime][sourceIndex] = targetData;
            
            if (!_dependencies.appState.scheduleCells[targetTime]) _dependencies.appState.scheduleCells[targetTime] = {};
            _dependencies.appState.scheduleCells[targetTime][targetIndex] = sourceData;

            _dependencies.renderAndSave();
            _dependencies.undoManager.pushState(_dependencies.getCurrentTableState());
        }
    };

    const _handleDragEnd = () => {
        draggedCell?.classList.remove('is-dragging');
        draggedCell = null;
        document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
    };

    const _handleArrowNavigation = (key, activeCell) => {
        let nextElement = null;
        const currentParentTd = activeCell.closest('td, th');
        const currentRow = currentParentTd.closest('tr');
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(currentParentTd);

        switch (key) {
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
            setActiveCell(nextElement);
        }
    };

    const _handleKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            _dependencies.undoLastAction();
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
            event.preventDefault();
            if (activeCell) {
                if (_dependencies.ui.getElementText(activeCell).trim() !== '') {
                    window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, state => { state.isBreak = true; window.showToast('Dodano przerwę'); });
            } else {
                window.showToast('Wybierz komórkę, aby dodać przerwę.', 3000);
            }
            return;
        }

        const target = document.activeElement;
        const isEditing = target.getAttribute('contenteditable') === 'true';

        if(isEditing) {
            if (event.key === 'Escape') _dependencies.exitEditMode(target);
            if (event.key === 'Enter') {
                 event.preventDefault();
                 _dependencies.exitEditMode(target);
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
                const time = cellToClear.dataset.time;
                const employeeIndex = cellToClear.dataset.employeeIndex;
                _dependencies.updateCellState(cellToClear, state => {
                    Object.keys(state).forEach(key => delete state[key]);
                    window.showToast('Wyczyszczono komórkę');
                });
                const newCell = document.querySelector(`td[data-time="${time}"][data-employee-index="${employeeIndex}"]`);
                if (newCell) {
                    const focusTarget = newCell.querySelector('div[tabindex="0"]') || newCell;
                    setActiveCell(focusTarget);
                    focusTarget.focus();
                } else {
                    setActiveCell(null);
                }
            }
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            _dependencies.enterEditMode(activeCell);
            return;
        }
        
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            _dependencies.enterEditMode(activeCell, true, event.key);
            return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            _handleArrowNavigation(event.key, activeCell);
        }
    };


    const initialize = (deps) => {
        _dependencies = deps;
        mainTable = document.getElementById('mainScheduleTable');

        if (!mainTable) {
            console.error("ScheduleEvents.initialize: mainScheduleTable not found. Aborting initialization.");
            return;
        }

        mainTable.addEventListener('click', _handleMainTableClick);
        mainTable.addEventListener('dblclick', _handleMainTableDblClick);
        document.addEventListener('click', _handleDocumentClick);

        mainTable.addEventListener('dragstart', _handleDragStart);
        mainTable.addEventListener('dragover', _handleDragOver);
        mainTable.addEventListener('dragleave', _handleDragLeave);
        mainTable.addEventListener('drop', _handleDrop);
        mainTable.addEventListener('dragend', _handleDragEnd);
        
        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);

        const contextMenuItems = [
            { id: 'contextPatientInfo', class: 'info', condition: cell => !cell.classList.contains('break-cell') && _dependencies.ui.getElementText(cell).trim() !== '', action: (cell, event) => _dependencies.openPatientInfoModal(event.target.closest('div[tabindex="0"]') || event.target.closest('td.editable-cell')) },
            { id: 'contextAddBreak', action: cell => {
                if (_dependencies.ui.getElementText(cell).trim() !== '') {
                    window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                    return;
                }
                _dependencies.updateCellState(cell, state => { state.isBreak = true; window.showToast('Dodano przerwę'); });
            }},
            { id: 'contextClear', class: 'danger', action: cell => _dependencies.updateCellState(cell, state => { Object.keys(state).forEach(key => delete state[key]); window.showToast('Wyczyszczono komórkę'); }) },
            { id: 'contextSplitCell', action: cell => _dependencies.updateCellState(cell, state => { state.content1 = state.content || ''; state.content2 = ''; delete state.content; state.isSplit = true; window.showToast('Podzielono komórkę'); }) },
            { id: 'contextMergeCells', class: 'info', condition: cell => cell.classList.contains('split-cell'), action: cell => _dependencies.mergeSplitCell(cell) },
            { id: 'contextMassage', action: cell => _dependencies.toggleSpecialStyle(cell, 'isMassage') },
            { id: 'contextPnf', action: cell => _dependencies.toggleSpecialStyle(cell, 'isPnf') },
            { id: 'contextEveryOtherDay', action: cell => _dependencies.toggleSpecialStyle(cell, 'isEveryOtherDay') } // Nowa opcja
        ];
        window.initializeContextMenu('contextMenu', 'td.editable-cell', contextMenuItems);

        // Obsługa kliknięć dla nowych przycisków akcji
        document.getElementById('btnPatientInfo')?.addEventListener('click', () => {
            if (activeCell && !activeCell.classList.contains('break-cell') && _dependencies.ui.getElementText(activeCell).trim() !== '') {
                _dependencies.openPatientInfoModal(activeCell);
            } else {
                window.showToast('Wybierz komórkę z pacjentem, aby wyświetlić informacje.', 3000);
            }
        });
        document.getElementById('btnSplitCell')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.updateCellState(activeCell, state => { state.content1 = state.content || ''; state.content2 = ''; delete state.content; state.isSplit = true; window.showToast('Podzielono komórkę'); });
            } else {
                window.showToast('Wybierz komórkę do podzielenia.', 3000);
            }
        });
        document.getElementById('btnMergeCells')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.mergeSplitCell(activeCell);
            } else {
                window.showToast('Wybierz podzieloną komórkę do scalenia.', 3000);
            }
        });
        document.getElementById('btnAddBreak')?.addEventListener('click', () => {
            if (activeCell) {
                if (_dependencies.ui.getElementText(activeCell).trim() !== '') {
                    window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, state => { state.isBreak = true; window.showToast('Dodano przerwę'); });
            } else {
                window.showToast('Wybierz komórkę, aby dodać przerwę.', 3000);
            }
        });
        document.getElementById('btnMassage')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.toggleSpecialStyle(activeCell, 'isMassage');
            } else {
                window.showToast('Wybierz komórkę, aby oznaczyć jako Masaż.', 3000);
            }
        });
        document.getElementById('btnPnf')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.toggleSpecialStyle(activeCell, 'isPnf');
            } else {
                window.showToast('Wybierz komórkę, aby oznaczyć jako PNF.', 3000);
            }
        });
        document.getElementById('btnEveryOtherDay')?.addEventListener('click', () => { // Obsługa nowego przycisku
            if (activeCell) {
                _dependencies.toggleSpecialStyle(activeCell, 'isEveryOtherDay');
            } else {
                window.showToast('Wybierz komórkę, aby oznaczyć jako Co 2 Dni.', 3000);
            }
        });
        document.getElementById('btnClearCell')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.updateCellState(activeCell, state => { Object.keys(state).forEach(key => delete state[key]); window.showToast('Wyczyszczono komórkę'); });
            } else {
                window.showToast('Wybierz komórkę do wyczyszczenia.', 3000);
            }
        });
    };

    const destroy = () => {
        if (mainTable) {
            mainTable.removeEventListener('click', _handleMainTableClick);
            mainTable.removeEventListener('dblclick', _handleMainTableDblClick);
            mainTable.removeEventListener('dragstart', _handleDragStart);
            mainTable.removeEventListener('dragover', _handleDragOver);
            mainTable.removeEventListener('dragleave', _handleDragLeave);
            mainTable.removeEventListener('drop', _handleDrop);
            mainTable.removeEventListener('dragend', _handleDragEnd);
        }
        document.removeEventListener('click', _handleDocumentClick);
        document.removeEventListener('keydown', _handleKeyDown);
        document.removeEventListener('app:search', _handleAppSearch);
        
        if (window.destroyContextMenu) {
            window.destroyContextMenu('contextMenu');
        }
        
        activeCell = null;
        console.log("ScheduleEvents destroyed");
    };

    return {
        initialize,
        destroy
    };
})();

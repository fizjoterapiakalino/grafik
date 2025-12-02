// scripts/schedule-events.js
import { AppConfig } from './common.js';
import { auth } from './firebase-config.js';
import { initializeContextMenu, destroyContextMenu } from './context-menu.js';

export const ScheduleEvents = (() => {
    let _dependencies = {};
    let mainTable;
    let activeCell = null;
    let draggedCell = null;

    // --- Nazwane funkcje obsługi zdarzeń ---

    const _handleMainTableClick = (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"]');

        // Wykrywanie urządzenia dotykowego
        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

        if (target) {
            // SCENARIUSZ MOBILNY (Dotyk):
            // Drugie tapnięcie w zaznaczoną komórkę -> wejście w tryb edycji (klawiatura)
            if (isTouchDevice && activeCell === target) {
                if (target.getAttribute('contenteditable') !== 'true') {
                    event.stopPropagation(); // Zapobiegaj bąbelkowaniu do document click
                    _dependencies.enterEditMode(target);
                    return;
                }
            }

            // SCENARIUSZ STANDARDOWY (Mysz i logika ogólna):
            if (activeCell === target && target.getAttribute('contenteditable') === 'true') {
                return;
            }

            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                // Check if we are clicking the same logical cell (even if element reference changed due to re-render)
                const activeTd = activeCell.closest('td');
                const targetTd = target.closest('td');
                const isSameLogical = activeTd && targetTd &&
                    activeTd.dataset.time === targetTd.dataset.time &&
                    activeTd.dataset.employeeIndex === targetTd.dataset.employeeIndex;

                if (isSameLogical) {
                    // Update active cell to the new target
                    setActiveCell(target);
                    // Force edit mode on the new target
                    _dependencies.enterEditMode(target);
                    return;
                }

                _dependencies.exitEditMode(activeCell);
            }

            setActiveCell(target);
        } else {
            // Kliknięcie w tło
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    };

    const _handleMainTableDblClick = (event) => {
        const target = event.target.closest('td.editable-cell, div[tabindex="0"], .card-body.editable-cell');
        if (target) _dependencies.enterEditMode(target);
    };

    const _handleDocumentClick = (event) => {

        // Fix for mobile/general editing: If the target is no longer in the DOM (e.g. replaced by edit mode), ignore it.
        if (!document.body.contains(event.target)) {
            return;
        }

        if (!event.target.closest('.active-cell') && !event.target.closest('#contextMenu')) {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    };

    const _handleDragLeave = (event) => {
        const target = event.target.closest('.drag-over-target');
        if (target) target.classList.remove('drag-over-target');
    };

    const _handleAppSearch = (e) => {
        const { searchTerm } = e.detail;
        const searchAndHighlight = (term, tableSelector, cellSelector) => {
            const table = document.querySelector(tableSelector);
            if (!table) return;
            table.querySelectorAll(cellSelector).forEach((cell) => {
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
        document.querySelectorAll('.duplicate-highlight').forEach((el) => {
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
        allCells.forEach((cell) => {
            const cellText = _dependencies.ui.getElementText(cell).toLowerCase();
            if (cellText.includes(cleanedSearchText)) {
                matchingCells.push(cell);
            }
        });
        if (matchingCells.length > 1) {
            matchingCells.forEach((td) => td.classList.add('duplicate-highlight'));
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
        document.querySelectorAll('.schedule-action-buttons .action-icon-btn').forEach((btn) => {
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
            document.querySelectorAll('.schedule-action-buttons .action-icon-btn').forEach((btn) => {
                btn.classList.add('active');
                btn.disabled = false;
            });

            // Specyficzne warunki aktywacji dla niektórych przycisków
            const patientInfoBtn = document.getElementById('btnPatientInfo');
            if (patientInfoBtn) {
                const hasPatientInfo =
                    !activeCell.classList.contains('break-cell') &&
                    _dependencies.ui.getElementText(activeCell).trim() !== '';
                patientInfoBtn.classList.toggle('active', hasPatientInfo);
                patientInfoBtn.disabled = !hasPatientInfo;
            }

            const addBreakBtn = document.getElementById('btnAddBreak');
            if (addBreakBtn) {
                const isBreak = activeCell.classList.contains('break-cell');
                addBreakBtn.classList.toggle('active', true); // Always active if cell selected
                addBreakBtn.disabled = false;

                if (isBreak) {
                    addBreakBtn.classList.add('btn-danger');
                    addBreakBtn.title = 'Usuń przerwę';
                    // Opcjonalnie zmiana ikony, jeśli jest dostępna
                } else {
                    addBreakBtn.classList.remove('btn-danger');
                    addBreakBtn.title = 'Dodaj przerwę';
                }
            }
        }
    };

    const _handleDragStart = (event) => {
        const target = event.target.closest('td.editable-cell');
        if (target && !target.classList.contains('break-cell')) {
            draggedCell = target;
            event.dataTransfer.setData(
                'application/json',
                JSON.stringify(_dependencies.getCurrentTableStateForCell(target)),
            );
            event.dataTransfer.effectAllowed = 'move';
            draggedCell.classList.add('is-dragging');
        } else {
            event.preventDefault();
        }
    };



    const _handleDragOver = (event) => {
        event.preventDefault();
        const dropTargetCell = event.target.closest('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));
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
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (
            dropTargetCell &&
            !dropTargetCell.classList.contains('break-cell') &&
            draggedCell &&
            draggedCell !== dropTargetCell
        ) {
            const sourceTime = draggedCell.dataset.time;
            const sourceIndex = draggedCell.dataset.employeeIndex;
            const targetTime = dropTargetCell.dataset.time;
            const targetIndex = dropTargetCell.dataset.employeeIndex;

            // Determine target part if split
            let targetPart = null;
            if (event.target.tagName === 'DIV' && event.target.parentNode.classList.contains('split-cell-wrapper')) {
                targetPart = event.target === event.target.parentNode.children[0] ? 1 : 2;
            }

            // Get source content to copy (read-only access to state)
            const sourceCellState = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};

            // Helper to safely copy value or null
            const safeCopy = (val) => val === undefined ? null : val;
            const safeBool = (val) => val === undefined ? false : val;

            const sourceContentString = sourceCellState.isSplit
                ? `${sourceCellState.content1 || ''}/${sourceCellState.content2 || ''}`
                : sourceCellState.content;

            if (!sourceContentString || sourceContentString.trim() === '') {
                return; // Don't drag empty cells
            }

            const updates = [
                // Update Target Cell
                {
                    time: targetTime,
                    employeeIndex: targetIndex,
                    updateFn: (targetState) => {
                        if (targetPart && targetState.isSplit) {
                            // Dropping into a specific part of a split cell
                            // We assume source is NOT split for simplicity in this specific interaction, 
                            // OR we take the "content" if source is simple.
                            // If source IS split, we might need to decide what to take. 
                            // Current logic in _handleDrop (original) took everything.
                            // Let's assume we take the "primary" content or just 'content' if it was a simple drag.
                            // But wait, draggedCell is the element. If draggedCell was a split part, we should know.
                            // The dragstart event sets dataTransfer, but here we access state directly.
                            // Let's assume we are dragging a whole cell or a simple cell.
                            // If source is split, dragging "it" usually means the whole cell.
                            // But if we drop into a PART, we probably only want the content.

                            // Simplified logic: If source is split, take combined? No, that's messy.
                            // Let's assume source is simple for now, or take content1 if split.
                            // Better: Check if dragged element was a part.
                            // draggedCell is the TD. We don't track the specific div in draggedCell variable easily 
                            // unless we updated _handleDragStart.
                            // For now, let's use the logic: If source is split, take content1/2 based on... nothing?
                            // Let's stick to: If source is split, we shouldn't be dragging "it" easily into a part without more logic.
                            // BUT, if source is simple:

                            let contentToMove = sourceCellState.content;
                            let isMassage = sourceCellState.isMassage;
                            let isPnf = sourceCellState.isPnf;
                            let isEveryOtherDay = sourceCellState.isEveryOtherDay;
                            let treatmentData = {
                                startDate: sourceCellState.treatmentStartDate,
                                extensionDays: sourceCellState.treatmentExtensionDays,
                                endDate: sourceCellState.treatmentEndDate,
                                additionalInfo: sourceCellState.additionalInfo
                            };

                            if (sourceCellState.isSplit) {
                                // If dragging a split cell, this is ambiguous. 
                                // For now, let's just take content1 as a fallback or block it.
                                // Or maybe we just don't support dragging split cells INTO parts yet.
                                // Let's assume source is simple.
                                contentToMove = sourceCellState.content1; // Fallback
                            }

                            targetState[`content${targetPart}`] = safeCopy(contentToMove);
                            targetState[`isMassage${targetPart}`] = safeBool(isMassage);
                            targetState[`isPnf${targetPart}`] = safeBool(isPnf);
                            targetState[`isEveryOtherDay${targetPart}`] = safeBool(isEveryOtherDay);

                            targetState[`treatmentData${targetPart}`] = {
                                startDate: safeCopy(treatmentData.startDate),
                                extensionDays: safeCopy(treatmentData.extensionDays),
                                endDate: safeCopy(treatmentData.endDate),
                                additionalInfo: safeCopy(treatmentData.additionalInfo)
                            };

                            // Clear top-level data to avoid ambiguity
                            targetState.treatmentStartDate = null;
                            targetState.treatmentExtensionDays = null;
                            targetState.treatmentEndDate = null;
                            targetState.additionalInfo = null;
                            targetState.content = null;
                            targetState.isMassage = null;
                            targetState.isPnf = null;
                            targetState.isEveryOtherDay = null;

                        } else {
                            // Standard overwrite (target is not split, or we are dropping onto the cell container)
                            // Clear target content first
                            const contentKeys = [
                                'content', 'content1', 'content2', 'isSplit',
                                'isMassage', 'isPnf', 'isEveryOtherDay',
                                'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo',
                                'treatmentData1', 'treatmentData2',
                                'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2'
                            ];
                            for (const key of contentKeys) {
                                delete targetState[key];
                            }
                            // Copy from source
                            for (const key of contentKeys) {
                                if (sourceCellState[key] !== undefined) {
                                    targetState[key] = sourceCellState[key];
                                }
                            }
                        }
                    },
                },
                // Update Source Cell
                {
                    time: sourceTime,
                    employeeIndex: sourceIndex,
                    updateFn: (sourceState) => {
                        // If we moved into a part, we still clear the whole source?
                        // Yes, "Move" implies the source is emptied.
                        // Unless we dragged a PART of a split cell.
                        // But _handleDragStart sets draggedCell to TD.
                        // So we clear the whole source TD.

                        const contentKeys = [
                            'content', 'content1', 'content2', 'isSplit',
                            'isMassage', 'isPnf', 'isEveryOtherDay',
                            'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo',
                            'treatmentData1', 'treatmentData2',
                            'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2'
                        ];
                        for (const key of contentKeys) {
                            sourceState[key] = null;
                        }
                    },
                },
            ];

            _dependencies.updateMultipleCells(updates);
        }
    };

    const _handleDragEnd = () => {
        draggedCell?.classList.remove('is-dragging');
        draggedCell = null;
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));
    };

    const _handleArrowNavigation = (key, activeCell) => {
        let nextElement = null;
        const currentParentTd = activeCell.closest('td, th');
        const currentRow = currentParentTd.closest('tr');
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(currentParentTd);

        switch (key) {
            case 'ArrowRight':
                if (activeCell.tagName === 'DIV' && activeCell.nextElementSibling) {
                    nextElement = activeCell.nextElementSibling;
                } else {
                    const nextCell = currentRow.cells[currentIndexInRow + 1];
                    if (nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                }
                break;
            case 'ArrowLeft':
                if (activeCell.tagName === 'DIV' && activeCell.previousElementSibling) {
                    nextElement = activeCell.previousElementSibling;
                } else {
                    const prevCell = currentRow.cells[currentIndexInRow - 1];
                    if (prevCell && prevCell.matches('.editable-cell, .editable-header')) {
                        nextElement = Array.from(prevCell.querySelectorAll('div')).pop() || prevCell;
                    }
                }
                break;
            case 'ArrowDown': {
                const nextRow = currentRow.nextElementSibling;
                if (nextRow) {
                    const nextCell = nextRow.cells[currentIndexInRow];
                    if (nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                }
                break;
            }
            case 'ArrowUp': {
                const prevRow = currentRow.previousElementSibling;
                if (prevRow) {
                    const prevCell = prevRow.cells[currentIndexInRow];
                    if (prevCell) nextElement = prevCell.querySelector('div') || prevCell;
                }
                break;
            }
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
                _dependencies.updateCellState(activeCell, (state) => {
                    state.isBreak = true;
                    window.showToast('Dodano przerwę');
                });
            } else {
                window.showToast('Wybierz komórkę, aby dodać przerwę.', 3000);
            }
            return;
        }

        const target = document.activeElement;
        const isEditing = target.getAttribute('contenteditable') === 'true';

        if (isEditing) {
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
                _dependencies.clearCell(cellToClear);
                const time = cellToClear.dataset.time;
                const employeeIndex = cellToClear.dataset.employeeIndex;
                const newCell = document.querySelector(
                    `td[data-time="${time}"][data-employee-index="${employeeIndex}"]`,
                );
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
            console.error('ScheduleEvents.initialize: mainScheduleTable not found. Aborting initialization.');
            return;
        }

        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            appRoot.addEventListener('click', _handleMainTableClick);
            appRoot.addEventListener('dblclick', _handleMainTableDblClick);
            // Keep drag events on table for now as drag-drop is likely desktop only or needs more work for mobile
            mainTable.addEventListener('dragstart', _handleDragStart);
            mainTable.addEventListener('dragover', _handleDragOver);
            mainTable.addEventListener('dragleave', _handleDragLeave);
            mainTable.addEventListener('drop', _handleDrop);
            mainTable.addEventListener('dragend', _handleDragEnd);
        } else {
            console.error('ScheduleEvents.initialize: app-root not found.');
        }

        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);

        const contextMenuItems = [
            {
                id: 'contextPatientInfo',
                class: 'info',
                condition: (cell) =>
                    !cell.classList.contains('break-cell') && _dependencies.ui.getElementText(cell).trim() !== '',
                action: (cell, event) =>
                    _dependencies.openPatientInfoModal(
                        event.target.closest('div[tabindex="0"]') || event.target.closest('td.editable-cell'),
                    ),
            },
            {
                id: 'contextAddBreak',
                action: (cell) => {
                    if (_dependencies.ui.getElementText(cell).trim() !== '') {
                        window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                        return;
                    }
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = true;
                        window.showToast('Dodano przerwę');
                    });
                },
                condition: (cell) => !cell.classList.contains('break-cell'),
            },
            {
                id: 'contextRemoveBreak',
                class: 'danger',
                action: (cell) => {
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = false;
                        window.showToast('Usunięto przerwę');
                    });
                },
                condition: (cell) => cell.classList.contains('break-cell'),
            },
            {
                id: 'contextShowHistory',
                condition: (cell) => {
                    const cellState =
                        _dependencies.appState.scheduleCells[cell.dataset.time]?.[cell.dataset.employeeIndex];
                    return cellState && cellState.history && cellState.history.length > 0;
                },
                action: (cell) => _dependencies.showHistoryModal(cell),
            },
            { id: 'contextClear', class: 'danger', action: (cell) => _dependencies.clearCell(cell) },
            {
                id: 'contextSplitCell',
                action: (cell) =>
                    _dependencies.updateCellState(cell, (state) => {
                        // Helper to safely copy value or null
                        const safeCopy = (val) => val === undefined ? null : val;

                        // Migrate content
                        state.content1 = safeCopy(state.content || '');
                        state.content2 = '';
                        state.content = null;

                        // Migrate flags
                        if (state.isMassage) {
                            state.isMassage1 = true;
                            state.isMassage = null;
                        }
                        if (state.isPnf) {
                            state.isPnf1 = true;
                            state.isPnf = null;
                        }
                        if (state.isEveryOtherDay) {
                            state.isEveryOtherDay1 = true;
                            state.isEveryOtherDay = null;
                        }

                        // Migrate treatment data
                        state.treatmentData1 = {
                            startDate: safeCopy(state.treatmentStartDate),
                            extensionDays: safeCopy(state.treatmentExtensionDays),
                            endDate: safeCopy(state.treatmentEndDate),
                            additionalInfo: safeCopy(state.additionalInfo),
                        };

                        // Clean up old treatment data
                        state.treatmentStartDate = null;
                        state.treatmentExtensionDays = null;
                        state.treatmentEndDate = null;
                        state.additionalInfo = null;

                        state.isSplit = true;
                        window.showToast('Podzielono komórkę');
                    }),
                condition: (cell) => !cell.classList.contains('split-cell') && !cell.classList.contains('break-cell'),
            },
            {
                id: 'contextMergeCells',
                class: 'info',
                condition: (cell) => {
                    if (!cell.classList.contains('split-cell')) return false;
                    const parts = cell.querySelectorAll('.split-cell-wrapper > div');
                    if (parts.length < 2) return true;
                    const text1 = _dependencies.ui.getElementText(parts[0]).trim();
                    const text2 = _dependencies.ui.getElementText(parts[1]).trim();
                    return text1 === '' || text2 === '';
                },
                action: (cell) => _dependencies.mergeSplitCell(cell),
            },
            { id: 'contextMassage', action: (cell) => _dependencies.toggleSpecialStyle(cell, 'isMassage') },
            { id: 'contextPnf', action: (cell) => _dependencies.toggleSpecialStyle(cell, 'isPnf') },
            { id: 'contextEveryOtherDay', action: (cell) => _dependencies.toggleSpecialStyle(cell, 'isEveryOtherDay') },
            {
                id: 'contextClearFormatting',
                action: (cell) => {
                    _dependencies.updateCellState(cell, (state) => {
                        state.isMassage = false;
                        state.isPnf = false;
                        state.isEveryOtherDay = false;
                        if (state.isSplit) {
                            state.isMassage1 = false;
                            state.isMassage2 = false;
                            state.isPnf1 = false;
                            state.isPnf2 = false;
                            state.isEveryOtherDay1 = false;
                            state.isEveryOtherDay2 = false;
                        }
                        window.showToast('Wyczyszczono formatowanie');
                    });
                },
            },
        ];
        initializeContextMenu('contextMenu', '.editable-cell', contextMenuItems);

        // Obsługa kliknięć dla nowych przycisków akcji
        document.getElementById('btnPatientInfo')?.addEventListener('click', () => {
            if (
                activeCell &&
                !activeCell.classList.contains('break-cell') &&
                _dependencies.ui.getElementText(activeCell).trim() !== ''
            ) {
                _dependencies.openPatientInfoModal(activeCell);
            } else {
                window.showToast('Wybierz komórkę z pacjentem, aby wyświetlić informacje.', 3000);
            }
        });
        document.getElementById('btnSplitCell')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.updateCellState(activeCell, (state) => {
                    // Migrate content
                    state.content1 = state.content || '';
                    state.content2 = '';
                    delete state.content;

                    // Migrate flags
                    if (state.isMassage) {
                        state.isMassage1 = true;
                        delete state.isMassage;
                    }
                    if (state.isPnf) {
                        state.isPnf1 = true;
                        delete state.isPnf;
                    }
                    if (state.isEveryOtherDay) {
                        state.isEveryOtherDay1 = true;
                        delete state.isEveryOtherDay;
                    }

                    // Migrate treatment data
                    state.treatmentData1 = {
                        startDate: state.treatmentStartDate,
                        extensionDays: state.treatmentExtensionDays,
                        endDate: state.treatmentEndDate,
                        additionalInfo: state.additionalInfo,
                    };

                    // Clean up old treatment data
                    delete state.treatmentStartDate;
                    delete state.treatmentExtensionDays;
                    delete state.treatmentEndDate;
                    delete state.additionalInfo;

                    state.isSplit = true;
                    window.showToast('Podzielono komórkę');
                });
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
                if (activeCell.classList.contains('break-cell')) {
                    _dependencies.updateCellState(activeCell, (state) => {
                        state.isBreak = false;
                        window.showToast('Usunięto przerwę');
                    });
                } else {
                    if (_dependencies.ui.getElementText(activeCell).trim() !== '') {
                        window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                        return;
                    }
                    _dependencies.updateCellState(activeCell, (state) => {
                        state.isBreak = true;
                        window.showToast('Dodano przerwę');
                    });
                }
            } else {
                window.showToast('Wybierz komórkę, aby zarządzać przerwą.', 3000);
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
        document.getElementById('btnEveryOtherDay')?.addEventListener('click', () => {
            // Obsługa nowego przycisku
            if (activeCell) {
                _dependencies.toggleSpecialStyle(activeCell, 'isEveryOtherDay');
            } else {
                window.showToast('Wybierz komórkę, aby oznaczyć jako Co 2 Dni.', 3000);
            }
        });
        document.getElementById('btnClearCell')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.clearCell(activeCell);
            } else {
                window.showToast('Wybierz komórkę do wyczyszczenia.', 3000);
            }
        });
    };

    const destroy = () => {
        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            appRoot.removeEventListener('click', _handleMainTableClick);
            appRoot.removeEventListener('dblclick', _handleMainTableDblClick);
        }
        if (mainTable) {
            mainTable.removeEventListener('dragstart', _handleDragStart);
            mainTable.removeEventListener('dragover', _handleDragOver);
            mainTable.removeEventListener('dragleave', _handleDragLeave);
            mainTable.removeEventListener('drop', _handleDrop);
            mainTable.removeEventListener('dragend', _handleDragEnd);
        }
        document.removeEventListener('click', _handleDocumentClick);
        document.removeEventListener('keydown', _handleKeyDown);
        document.removeEventListener('app:search', _handleAppSearch);

        destroyContextMenu('contextMenu');

        activeCell = null;
        console.log('ScheduleEvents destroyed');
    };

    return {
        initialize,
        destroy,
        _handleDragStart,
        _handleDrop,
        _handleDragOver,
        _handleDragLeave,
        _handleDragEnd,
    };
})();

window.ScheduleEvents = ScheduleEvents;

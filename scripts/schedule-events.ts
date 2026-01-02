// scripts/schedule-events.ts
import { debugLog } from './common.js';
import { AppConfig } from './common.js';
import { initializeContextMenu, destroyContextMenu } from './context-menu.js';
import { safeCopy } from './utils.js';
import { ScheduleDragDrop } from './schedule-drag-drop.js';
import type { CellState } from './types/index.js';

interface AppState {
    scheduleCells: Record<string, Record<string, CellState>>;
}

interface ScheduleUI {
    getElementText(element: HTMLElement | null): string;
}

/**
 * Zależności od zewnętrznych modułów
 */
interface Dependencies {
    appState: AppState;
    ui: ScheduleUI;
    enterEditMode(element: HTMLElement, clearContent?: boolean, initialChar?: string): void;
    exitEditMode(element: HTMLElement): void;
    updateCellState(cell: HTMLElement, updateFn: (state: CellState) => void): void;
    updateMultipleCells(updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[]): void;
    getCurrentTableStateForCell(cell: HTMLElement): unknown;
    undoLastAction(): void;
    clearCell(cell: HTMLElement): void;
    openPatientInfoModal(element: HTMLElement): void;
    showHistoryModal(cell: HTMLElement): void;
    mergeSplitCell(cell: HTMLElement): void;
    toggleSpecialStyle(cell: HTMLElement, attribute: string): void;
}

/**
 * Interfejs publicznego API ScheduleEvents
 */
interface ScheduleEventsAPI {
    initialize(deps: Dependencies): void;
    destroy(): void;
}

/**
 * Moduł wydarzeń harmonogramu
 */
export const ScheduleEvents: ScheduleEventsAPI = (() => {
    let _dependencies: Dependencies;
    let mainTable: HTMLTableElement | null = null;
    let activeCell: HTMLElement | null = null;
    let copiedCellState: CellState | null = null;

    const _handleMainTableClick = (event: MouseEvent): void => {
        const target = (event.target as HTMLElement).closest('td.editable-cell, div[tabindex="0"]') as HTMLElement | null;

        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

        if (target) {
            if (isTouchDevice && activeCell === target) {
                if (target.getAttribute('contenteditable') !== 'true') {
                    event.stopPropagation();
                    _dependencies.enterEditMode(target);
                    return;
                }
            }

            if (activeCell === target && target.getAttribute('contenteditable') === 'true') {
                return;
            }

            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                const activeTd = activeCell.closest('td') as HTMLTableCellElement | null;
                const targetTd = target.closest('td') as HTMLTableCellElement | null;
                const isSameLogical =
                    activeTd && targetTd &&
                    activeTd.dataset.time === targetTd.dataset.time &&
                    activeTd.dataset.employeeIndex === targetTd.dataset.employeeIndex;

                if (isSameLogical) {
                    setActiveCell(target);
                    _dependencies.enterEditMode(target);
                    return;
                }

                _dependencies.exitEditMode(activeCell);
            }

            setActiveCell(target);
        } else {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    };

    const _handleMainTableDblClick = (event: MouseEvent): void => {
        const target = (event.target as HTMLElement).closest('td.editable-cell, div[tabindex="0"], .card-body.editable-cell') as HTMLElement | null;
        if (target) _dependencies.enterEditMode(target);
    };

    const _handleDocumentClick = (event: MouseEvent): void => {
        if (!document.body.contains(event.target as Node)) {
            return;
        }

        if (!(event.target as HTMLElement).closest('.active-cell') && !(event.target as HTMLElement).closest('#contextMenu')) {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    };

    const _handleAppSearch = (e: Event): void => {
        const { searchTerm } = (e as CustomEvent<{ searchTerm: string }>).detail;
        const searchAndHighlight = (term: string, tableSelector: string, cellSelector: string): void => {
            const table = document.querySelector(tableSelector);
            if (!table) return;
            table.querySelectorAll<HTMLElement>(cellSelector).forEach((cell) => {
                const cellText = (cell.textContent || '').toLowerCase();
                if (term && cellText.includes(term.toLowerCase())) {
                    cell.classList.add('search-highlight');
                } else {
                    cell.classList.remove('search-highlight');
                }
            });
        };
        searchAndHighlight(searchTerm, '#mainScheduleTable', 'td.editable-cell, th');
    };

    const clearDuplicateHighlights = (): void => {
        document.querySelectorAll('.duplicate-highlight').forEach((el) => {
            el.classList.remove('duplicate-highlight');
        });
    };

    const highlightDuplicates = (searchText: string): void => {
        clearDuplicateHighlights();
        const cleanedSearchText = searchText.trim().toLowerCase();
        if (cleanedSearchText === '' || cleanedSearchText === AppConfig.schedule.breakText.toLowerCase()) {
            return;
        }
        const allCells = document.querySelectorAll<HTMLTableCellElement>('td.editable-cell');
        const matchingCells: HTMLTableCellElement[] = [];
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

    const setActiveCell = (cell: HTMLElement | null): void => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
            if (activeCell.tagName === 'DIV' && activeCell.parentElement?.classList.contains('active-cell')) {
                activeCell.parentElement.classList.remove('active-cell');
            }
            if (activeCell.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            clearDuplicateHighlights();
        }

        activeCell = cell;

        document.querySelectorAll<HTMLButtonElement>('.schedule-action-buttons .action-icon-btn').forEach((btn) => {
            btn.classList.remove('active');
            btn.disabled = true;
        });

        if (activeCell) {
            activeCell.classList.add('active-cell');
            if (activeCell.tagName === 'DIV' && activeCell.parentElement) {
                activeCell.parentElement.classList.add('active-cell');
            }
            activeCell.focus();
            highlightDuplicates(_dependencies.ui.getElementText(activeCell));

            document.querySelectorAll<HTMLButtonElement>('.schedule-action-buttons .action-icon-btn').forEach((btn) => {
                btn.classList.add('active');
                btn.disabled = false;
            });

            const patientInfoBtn = document.getElementById('btnPatientInfo') as HTMLButtonElement | null;
            if (patientInfoBtn) {
                const hasPatientInfo =
                    !activeCell.classList.contains('break-cell') &&
                    _dependencies.ui.getElementText(activeCell).trim() !== '';
                patientInfoBtn.classList.toggle('active', hasPatientInfo);
                patientInfoBtn.disabled = !hasPatientInfo;
            }

            const addBreakBtn = document.getElementById('btnAddBreak') as HTMLButtonElement | null;
            if (addBreakBtn) {
                const isBreak = activeCell.classList.contains('break-cell');
                addBreakBtn.classList.toggle('active', true);
                addBreakBtn.disabled = false;

                if (isBreak) {
                    addBreakBtn.classList.add('btn-danger');
                    addBreakBtn.title = 'Usuń przerwę';
                } else {
                    addBreakBtn.classList.remove('btn-danger');
                    addBreakBtn.title = 'Dodaj przerwę';
                }
            }
        }
    };

    const _handleArrowNavigation = (key: string, currentCell: HTMLElement): void => {
        let nextElement: HTMLElement | null = null;
        const currentParentTd = currentCell.closest('td, th') as HTMLTableCellElement | null;
        const currentRow = currentParentTd?.closest('tr') as HTMLTableRowElement | null;
        if (!currentParentTd || !currentRow) return;

        const currentIndexInRow = Array.from(currentRow.cells).indexOf(currentParentTd);

        switch (key) {
            case 'ArrowRight':
                if (currentCell.tagName === 'DIV' && currentCell.nextElementSibling) {
                    nextElement = currentCell.nextElementSibling as HTMLElement;
                } else {
                    const nextCell = currentRow.cells[currentIndexInRow + 1];
                    if (nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                }
                break;
            case 'ArrowLeft':
                if (currentCell.tagName === 'DIV' && currentCell.previousElementSibling) {
                    nextElement = currentCell.previousElementSibling as HTMLElement;
                } else {
                    const prevCell = currentRow.cells[currentIndexInRow - 1];
                    if (prevCell && prevCell.matches('.editable-cell, .editable-header')) {
                        nextElement = Array.from(prevCell.querySelectorAll<HTMLElement>('div')).pop() || prevCell;
                    }
                }
                break;
            case 'ArrowDown': {
                const nextRow = currentRow.nextElementSibling as HTMLTableRowElement | null;
                if (nextRow) {
                    const nextCell = nextRow.cells[currentIndexInRow];
                    if (nextCell) nextElement = nextCell.querySelector('div') || nextCell;
                }
                break;
            }
            case 'ArrowUp': {
                const prevRow = currentRow.previousElementSibling as HTMLTableRowElement | null;
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

    const _handleKeyDown = (event: KeyboardEvent): void => {
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

        // Ctrl+C - Kopiuj zaznaczoną komórkę
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (activeCell && !activeCell.classList.contains('break-cell')) {
                const parentCell = activeCell.closest('td[data-time][data-employee-index]') as HTMLTableCellElement | null;
                if (parentCell) {
                    const time = parentCell.dataset.time || '';
                    const employeeIndex = parentCell.dataset.employeeIndex || '';
                    const currentState = _dependencies.appState.scheduleCells[time]?.[employeeIndex];

                    if (currentState && Object.keys(currentState).length > 0) {
                        // Głęboka kopia stanu komórki
                        copiedCellState = JSON.parse(JSON.stringify(currentState));
                        window.showToast('Skopiowano komórkę');
                    } else {
                        window.showToast('Brak danych do skopiowania', 2000);
                    }
                }
            } else if (!activeCell) {
                window.showToast('Wybierz komórkę, aby skopiować.', 2000);
            }
            return;
        }

        // Ctrl+V - Wklej do zaznaczonej komórki
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
            event.preventDefault();
            if (!activeCell) {
                window.showToast('Wybierz komórkę, aby wkleić.', 2000);
                return;
            }
            if (!copiedCellState) {
                window.showToast('Brak skopiowanej komórki.', 2000);
                return;
            }

            _dependencies.updateCellState(activeCell, (state) => {
                // Kopiuj wszystkie właściwości ze skopiowanego stanu
                Object.assign(state, JSON.parse(JSON.stringify(copiedCellState)));
                window.showToast('Wklejono komórkę');
            });
            return;
        }

        const target = document.activeElement as HTMLElement;
        const isEditing = target?.getAttribute('contenteditable') === 'true';

        if (isEditing) {
            if (event.key === 'Escape') _dependencies.exitEditMode(target);
            if (event.key === 'Enter') {
                event.preventDefault();
                _dependencies.exitEditMode(target);
                const parentCell = target.closest('td') as HTMLTableCellElement | null;
                if (parentCell) {
                    const nextRow = parentCell.closest('tr')?.nextElementSibling as HTMLTableRowElement | null;
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
            const cellToClear = activeCell.closest('td.editable-cell') as HTMLTableCellElement | null;
            if (cellToClear) {
                _dependencies.clearCell(cellToClear);
                const time = cellToClear.dataset.time;
                const employeeIndex = cellToClear.dataset.employeeIndex;
                const newCell = document.querySelector<HTMLTableCellElement>(
                    `td[data-time="${time}"][data-employee-index="${employeeIndex}"]`
                );
                if (newCell) {
                    const focusTarget = newCell.querySelector<HTMLElement>('div[tabindex="0"]') || newCell;
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

    const initialize = (deps: Dependencies): void => {
        _dependencies = deps;
        mainTable = document.getElementById('mainScheduleTable') as HTMLTableElement | null;

        if (!mainTable) {
            console.error('ScheduleEvents.initialize: mainScheduleTable not found. Aborting initialization.');
            return;
        }

        // Inicjalizacja modułu Drag & Drop
        ScheduleDragDrop.initialize({
            appState: deps.appState,
            getCurrentTableStateForCell: deps.getCurrentTableStateForCell,
            updateMultipleCells: deps.updateMultipleCells,
        });

        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            appRoot.addEventListener('click', _handleMainTableClick as EventListener);
            appRoot.addEventListener('dblclick', _handleMainTableDblClick as EventListener);
            mainTable.addEventListener('dragstart', ScheduleDragDrop.handleDragStart as EventListener);
            mainTable.addEventListener('dragover', ScheduleDragDrop.handleDragOver as EventListener);
            mainTable.addEventListener('dragleave', ScheduleDragDrop.handleDragLeave as EventListener);
            mainTable.addEventListener('drop', ScheduleDragDrop.handleDrop as EventListener);
            mainTable.addEventListener('dragend', ScheduleDragDrop.handleDragEnd);
        } else {
            console.error('ScheduleEvents.initialize: app-root not found.');
        }

        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);

        const contextMenuItems = [
            {
                id: 'contextPatientInfo',
                class: 'info',
                condition: (cell: HTMLElement) =>
                    !cell.classList.contains('break-cell') && _dependencies.ui.getElementText(cell).trim() !== '',
                action: (_cell: HTMLElement, event?: MouseEvent) =>
                    _dependencies.openPatientInfoModal(
                        (event?.target as HTMLElement)?.closest('div[tabindex="0"]') as HTMLElement ||
                        (event?.target as HTMLElement)?.closest('td.editable-cell') as HTMLElement
                    ),
            },
            {
                id: 'contextAddBreak',
                action: (cell: HTMLElement) => {
                    if (_dependencies.ui.getElementText(cell).trim() !== '') {
                        window.showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                        return;
                    }
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = true;
                        window.showToast('Dodano przerwę');
                    });
                },
                condition: (cell: HTMLElement) => !cell.classList.contains('break-cell'),
            },
            {
                id: 'contextRemoveBreak',
                class: 'danger',
                action: (cell: HTMLElement) => {
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = false;
                        window.showToast('Usunięto przerwę');
                    });
                },
                condition: (cell: HTMLElement) => cell.classList.contains('break-cell'),
            },
            {
                id: 'contextShowHistory',
                condition: (cell: HTMLElement): boolean => {
                    const cellState = _dependencies.appState.scheduleCells[cell.dataset.time || '']?.[cell.dataset.employeeIndex || ''];
                    return !!(cellState && cellState.history && cellState.history.length > 0);
                },
                action: (cell: HTMLElement) => _dependencies.showHistoryModal(cell),
            },
            { id: 'contextClear', class: 'danger', action: (cell: HTMLElement) => _dependencies.clearCell(cell) },
            {
                id: 'contextSplitCell',
                action: (cell: HTMLElement) =>
                    _dependencies.updateCellState(cell, (state) => {
                        state.content1 = safeCopy(state.content || '') as string;
                        state.content2 = '';
                        state.content = null;

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

                        state.treatmentData1 = {
                            startDate: safeCopy(state.treatmentStartDate),
                            extensionDays: safeCopy(state.treatmentExtensionDays),
                            endDate: safeCopy(state.treatmentEndDate),
                            additionalInfo: safeCopy(state.additionalInfo),
                        };

                        state.treatmentStartDate = null;
                        state.treatmentExtensionDays = null;
                        state.treatmentEndDate = null;
                        state.additionalInfo = null;

                        state.isSplit = true;
                        window.showToast('Podzielono komórkę');
                    }),
                condition: (cell: HTMLElement) => !cell.classList.contains('split-cell') && !cell.classList.contains('break-cell'),
            },
            {
                id: 'contextMergeCells',
                class: 'info',
                condition: (cell: HTMLElement) => {
                    if (!cell.classList.contains('split-cell')) return false;
                    const parts = cell.querySelectorAll('.split-cell-wrapper > div');
                    if (parts.length < 2) return true;
                    const text1 = _dependencies.ui.getElementText(parts[0] as HTMLElement).trim();
                    const text2 = _dependencies.ui.getElementText(parts[1] as HTMLElement).trim();
                    return text1 === '' || text2 === '';
                },
                action: (cell: HTMLElement) => _dependencies.mergeSplitCell(cell),
            },
            { id: 'contextMassage', action: (cell: HTMLElement) => _dependencies.toggleSpecialStyle(cell, 'isMassage') },
            { id: 'contextPnf', action: (cell: HTMLElement) => _dependencies.toggleSpecialStyle(cell, 'isPnf') },
            { id: 'contextEveryOtherDay', action: (cell: HTMLElement) => _dependencies.toggleSpecialStyle(cell, 'isEveryOtherDay') },
            {
                id: 'contextClearFormatting',
                action: (cell: HTMLElement) => {
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

        // Obsługa kliknięć dla przycisków akcji
        document.getElementById('btnPatientInfo')?.addEventListener('click', () => {
            if (activeCell && !activeCell.classList.contains('break-cell') && _dependencies.ui.getElementText(activeCell).trim() !== '') {
                _dependencies.openPatientInfoModal(activeCell);
            } else {
                window.showToast('Wybierz komórkę z pacjentem, aby wyświetlić informacje.', 3000);
            }
        });

        document.getElementById('btnSplitCell')?.addEventListener('click', () => {
            if (activeCell) {
                _dependencies.updateCellState(activeCell, (state) => {
                    state.content1 = state.content || '';
                    state.content2 = '';
                    delete state.content;

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

                    state.treatmentData1 = {
                        startDate: state.treatmentStartDate,
                        extensionDays: state.treatmentExtensionDays,
                        endDate: state.treatmentEndDate,
                        additionalInfo: state.additionalInfo,
                    };

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

    const destroy = (): void => {
        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            appRoot.removeEventListener('click', _handleMainTableClick as EventListener);
            appRoot.removeEventListener('dblclick', _handleMainTableDblClick as EventListener);
        }
        if (mainTable) {
            mainTable.removeEventListener('dragstart', ScheduleDragDrop.handleDragStart as EventListener);
            mainTable.removeEventListener('dragover', ScheduleDragDrop.handleDragOver as EventListener);
            mainTable.removeEventListener('dragleave', ScheduleDragDrop.handleDragLeave as EventListener);
            mainTable.removeEventListener('drop', ScheduleDragDrop.handleDrop as EventListener);
            mainTable.removeEventListener('dragend', ScheduleDragDrop.handleDragEnd);
        }
        document.removeEventListener('click', _handleDocumentClick as EventListener);
        document.removeEventListener('keydown', _handleKeyDown);
        document.removeEventListener('app:search', _handleAppSearch);

        destroyContextMenu('contextMenu');
        ScheduleDragDrop.destroy();

        activeCell = null;
        debugLog('ScheduleEvents destroyed');
    };

    return {
        initialize,
        destroy,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ScheduleEvents: ScheduleEventsAPI;
    }
}

window.ScheduleEvents = ScheduleEvents;

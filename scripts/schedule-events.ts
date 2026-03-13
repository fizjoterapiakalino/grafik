// scripts/schedule-events.ts
import { debugLog, AppConfig } from './common.js';
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
        const target = (event.target as HTMLElement).closest<HTMLElement>('td.editable-cell, div[tabindex="0"]');
        const isTouchDevice = globalThis.matchMedia('(pointer: coarse)').matches;

        if (!target) {
            if (activeCell?.getAttribute('contenteditable') === 'true') {
                _dependencies.exitEditMode(activeCell);
            }
            setActiveCell(null);
            return;
        }

        if (isTouchDevice && activeCell === target && target.getAttribute('contenteditable') !== 'true') {
            event.stopPropagation();
            _dependencies.enterEditMode(target);
            return;
        }

        if (activeCell === target && target.getAttribute('contenteditable') === 'true') {
            return;
        }

        if (activeCell?.getAttribute('contenteditable') === 'true') {
            const activeTd = activeCell.closest('td');
            const targetTd = target.closest('td');
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
    };

    const _handleMainTableDblClick = (event: MouseEvent): void => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('td.editable-cell, div[tabindex="0"], .card-body.editable-cell');
        if (target) _dependencies.enterEditMode(target);
    };

    const _handleDocumentClick = (event: MouseEvent): void => {
        if (!document.body.contains(event.target as Node)) {
            return;
        }

        if (!(event.target as HTMLElement).closest('.active-cell') && !(event.target as HTMLElement).closest('#contextMenu')) {
            if (activeCell?.getAttribute('contenteditable') === 'true') {
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

    const _clearActiveCellState = (): void => {
        if (!activeCell) return;
        activeCell.classList.remove('active-cell');
        if (activeCell.tagName === 'DIV' && activeCell.parentElement?.classList.contains('active-cell')) {
            activeCell.parentElement.classList.remove('active-cell');
        }
        if (activeCell.getAttribute('contenteditable') === 'true') {
            _dependencies.exitEditMode(activeCell);
        }
        clearDuplicateHighlights();
    };

    const _updateActionButtonsState = (isEnabled: boolean, cell: HTMLElement | null): void => {
        document.querySelectorAll<HTMLButtonElement>('.schedule-action-buttons .action-icon-btn').forEach((btn) => {
            btn.classList.toggle('active', isEnabled);
            btn.disabled = !isEnabled;
        });

        if (!cell || !isEnabled) return;

        const patientInfoBtn = document.getElementById('btnPatientInfo') as HTMLButtonElement | null;
        if (patientInfoBtn) {
            const hasInfo = !cell.classList.contains('break-cell') &&
                          !cell.classList.contains('hydrotherapy-cell') &&
                          _dependencies.ui.getElementText(cell).trim() !== '';
            patientInfoBtn.classList.toggle('active', hasInfo);
            patientInfoBtn.disabled = !hasInfo;
        }

        const addBreakBtn = document.getElementById('btnAddBreak') as HTMLButtonElement | null;
        if (addBreakBtn) {
            const isBreak = cell.classList.contains('break-cell');
            addBreakBtn.classList.add('active');
            addBreakBtn.disabled = false;
            addBreakBtn.classList.toggle('btn-danger', isBreak);
            addBreakBtn.title = isBreak ? 'Usuń przerwę' : 'Dodaj przerwę';
        }

        const hydroBtn = document.getElementById('btnHydrotherapy') as HTMLButtonElement | null;
        if (hydroBtn) {
            const isHydro = cell.classList.contains('hydrotherapy-cell') || cell.dataset.isHydrotherapy === 'true';
            hydroBtn.classList.add('active');
            hydroBtn.classList.toggle('btn-hydro-active', isHydro);
            hydroBtn.title = isHydro ? 'Usuń Hydro.' : 'Dodano Hydro.';
            hydroBtn.disabled = cell.classList.contains('break-cell');
        }
    };

    const setActiveCell = (cell: HTMLElement | null): void => {
        _clearActiveCellState();
        activeCell = cell;
        _updateActionButtonsState(!!activeCell, activeCell);

        if (activeCell) {
            activeCell.classList.add('active-cell');
            if (activeCell.tagName === 'DIV' && activeCell.parentElement) {
                activeCell.parentElement.classList.add('active-cell');
            }
            activeCell.focus();
            highlightDuplicates(_dependencies.ui.getElementText(activeCell));
        }
    };

    const _handleArrowNavigation = (key: string, currentCell: HTMLElement): void => {
        const currentParentTd = currentCell.closest<HTMLTableCellElement>('td, th');
        const currentRow = currentParentTd?.closest('tr');
        if (!currentParentTd || !currentRow) return;

        const currentIndexInRow = Array.from(currentRow.cells).indexOf(currentParentTd);
        let nextElement: HTMLElement | null = null;

        if (key === 'ArrowRight') {
            if (currentCell.tagName === 'DIV' && currentCell.nextElementSibling) {
                nextElement = currentCell.nextElementSibling as HTMLElement;
            } else {
                const nextCell = currentRow.cells[currentIndexInRow + 1];
                nextElement = nextCell?.querySelector<HTMLElement>('div[tabindex="0"]') || nextCell || null;
            }
        } else if (key === 'ArrowLeft') {
            if (currentCell.tagName === 'DIV' && currentCell.previousElementSibling) {
                nextElement = currentCell.previousElementSibling as HTMLElement;
            } else {
                const prevCell = currentRow.cells[currentIndexInRow - 1];
                if (prevCell?.matches('.editable-cell, .editable-header')) {
                    nextElement = Array.from(prevCell.querySelectorAll<HTMLElement>('div[tabindex="0"]')).pop() || prevCell;
                }
            }
        } else if (key === 'ArrowDown') {
            const nextRow = currentRow.nextElementSibling as HTMLTableRowElement | null;
            const nextCell = nextRow?.cells[currentIndexInRow];
            nextElement = nextCell?.querySelector<HTMLElement>('div[tabindex="0"]') || nextCell || null;
        } else if (key === 'ArrowUp') {
            const prevRow = currentRow.previousElementSibling as HTMLTableRowElement | null;
            const prevCell = prevRow?.cells[currentIndexInRow];
            nextElement = prevCell?.querySelector<HTMLElement>('div[tabindex="0"]') || prevCell || null;
        }

        if (nextElement) setActiveCell(nextElement);
    };

    const _handleClipboardEvents = (event: KeyboardEvent): boolean => {
        if (!(event.ctrlKey || event.metaKey)) return false;

        if (event.key === 'c') {
            if (activeCell && !activeCell.classList.contains('break-cell')) {
                const parentCell = activeCell.closest<HTMLTableCellElement>('td[data-time][data-employee-index]');
                const time = parentCell?.dataset.time || '';
                const employeeIndex = parentCell?.dataset.employeeIndex || '';
                const currentState = _dependencies.appState.scheduleCells[time]?.[employeeIndex];

                if (currentState && Object.keys(currentState).length > 0) {
                    copiedCellState = structuredClone(currentState);
                    (globalThis as any).showToast('Skopiowano komórkę');
                } else {
                    (globalThis as any).showToast('Brak danych do skopiowania', 2000);
                }
            } else if (!activeCell) {
                (globalThis as any).showToast('Wybierz komórkę, aby skopiować.', 2000);
            }
            return true;
        }

        if (event.key === 'v') {
            event.preventDefault();
            if (!activeCell) {
                (globalThis as any).showToast('Wybierz komórkę, aby wkleić.', 2000);
            } else if (!copiedCellState) {
                (globalThis as any).showToast('Brak skopiowanej komórki.', 2000);
            } else {
                _dependencies.updateCellState(activeCell, (state) => {
                    Object.assign(state, structuredClone(copiedCellState));
                    (globalThis as any).showToast('Wklejono komórkę');
                });
            }
            return true;
        }

        return false;
    };

    const _handleKeyDown = (event: KeyboardEvent): void => {
        const focusedElement = document.activeElement as HTMLElement;
        const isInInputField = focusedElement?.tagName === 'INPUT' ||
            focusedElement?.tagName === 'TEXTAREA' ||
            focusedElement?.closest('.search-container');

        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            if (!isInInputField) {
                event.preventDefault();
                _dependencies.undoLastAction();
            }
            return;
        }

        if (isInInputField) return;

        if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
            event.preventDefault();
            if (activeCell) {
                if (_dependencies.ui.getElementText(activeCell).trim() !== '') {
                    (globalThis as any).showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, (state) => {
                    state.isBreak = true;
                    (globalThis as any).showToast('Dodano przerwę');
                });
            } else {
                (globalThis as any).showToast('Wybierz komórkę, aby dodać przerwę.', 3000);
            }
            return;
        }

        if (_handleClipboardEvents(event)) return;

        const target = document.activeElement as HTMLElement;
        const isEditing = target?.getAttribute('contenteditable') === 'true';

        if (isEditing) {
            if (event.key === 'Escape') _dependencies.exitEditMode(target);
            if (event.key === 'Enter') {
                event.preventDefault();
                _dependencies.exitEditMode(target);
                const parentCell = target.closest('td');
                const nextRow = parentCell?.closest('tr')?.nextElementSibling as HTMLTableRowElement | null;
                if (nextRow && parentCell) {
                    const nextCell = nextRow.cells[parentCell.cellIndex];
                    setActiveCell(nextCell);
                }
            }
            return;
        }

        if (!activeCell) return;

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            const cellToClear = activeCell.closest<HTMLTableCellElement>('td.editable-cell');
            if (cellToClear) {
                _dependencies.clearCell(cellToClear);
                const { time, employeeIndex } = cellToClear.dataset;
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

    const _setupActionButtons = (): void => {
        const buttons: Record<string, () => void> = {
            btnPatientInfo: () => {
                const text = activeCell ? _dependencies.ui.getElementText(activeCell).trim() : '';
                if (activeCell && !activeCell.classList.contains('break-cell') && text !== '') {
                    _dependencies.openPatientInfoModal(activeCell);
                } else {
                    (globalThis as any).showToast('Wybierz komórkę z pacjentem, aby wyświetlić informacje.', 3000);
                }
            },
            btnSplitCell: () => {
                if (!activeCell) {
                    (globalThis as any).showToast('Wybierz komórkę do podzielenia.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, (state) => {
                    Object.assign(state, {
                        content1: state.content || '',
                        content2: '',
                        treatmentData1: {
                            startDate: state.treatmentStartDate,
                            extensionDays: state.treatmentExtensionDays,
                            endDate: state.treatmentEndDate,
                            additionalInfo: state.additionalInfo,
                        },
                        isSplit: true
                    });
                    if (state.isMassage) { state.isMassage1 = true; delete state.isMassage; }
                    if (state.isPnf) { state.isPnf1 = true; delete state.isPnf; }
                    if (state.isEveryOtherDay) { state.isEveryOtherDay1 = true; delete state.isEveryOtherDay; }
                    delete state.content;
                    delete state.treatmentStartDate;
                    delete state.treatmentExtensionDays;
                    delete state.treatmentEndDate;
                    delete state.additionalInfo;
                    (globalThis as any).showToast('Podzielono komórkę');
                });
            },
            btnMergeCells: () => {
                if (activeCell) _dependencies.mergeSplitCell(activeCell);
                else (globalThis as any).showToast('Wybierz podzieloną komórkę do scalenia.', 3000);
            },
            btnAddBreak: () => {
                if (!activeCell) {
                    (globalThis as any).showToast('Wybierz komórkę, aby zarządzać przerwą.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, (state) => {
                    const isBreak = activeCell!.classList.contains('break-cell');
                    if (isBreak) {
                        state.isBreak = false;
                        (globalThis as any).showToast('Usunięto przerwę');
                    } else if (_dependencies.ui.getElementText(activeCell!).trim() !== '') {
                        (globalThis as any).showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                    } else {
                        state.isBreak = true;
                        (globalThis as any).showToast('Dodano przerwę');
                    }
                });
            },
            btnHydrotherapy: () => {
                if (!activeCell) {
                    (globalThis as any).showToast('Wybierz komórkę, aby dodać Hydroterapię.', 3000);
                    return;
                }
                if (activeCell.classList.contains('split-cell')) {
                    (globalThis as any).showToast('Najpierw scal komórkę, aby dodać Hydro.', 3000);
                    return;
                }
                if (activeCell.classList.contains('break-cell')) {
                    (globalThis as any).showToast('Najpierw usuń przerwę.', 3000);
                    return;
                }
                _dependencies.updateCellState(activeCell, (state) => {
                    const isCurrentlyHydro = !!state.isHydrotherapy;
                    Object.assign(state, {
                        isHydrotherapy: !isCurrentlyHydro,
                        content: isCurrentlyHydro ? '' : 'Hydro.',
                        isMassage: false,
                        isPnf: false,
                        isEveryOtherDay: false
                    });
                    (globalThis as any).showToast(isCurrentlyHydro ? 'Usunięto Hydro.' : 'Dodano Hydro.');
                });
            },
            btnMassage: () => activeCell ? _dependencies.toggleSpecialStyle(activeCell, 'isMassage') : (globalThis as any).showToast('Wybierz komórkę, aby oznaczyć jako Masaż.', 3000),
            btnPnf: () => activeCell ? _dependencies.toggleSpecialStyle(activeCell, 'isPnf') : (globalThis as any).showToast('Wybierz komórkę, aby oznaczyć jako PNF.', 3000),
            btnEveryOtherDay: () => activeCell ? _dependencies.toggleSpecialStyle(activeCell, 'isEveryOtherDay') : (globalThis as any).showToast('Wybierz komórkę, aby oznaczyć jako Co 2 Dni.', 3000),
            btnClearCell: () => activeCell ? _dependencies.clearCell(activeCell) : (globalThis as any).showToast('Wybierz komórkę do wyczyszczenia.', 3000),
        };

        Object.entries(buttons).forEach(([id, handler]) => {
            document.getElementById(id)?.addEventListener('click', handler);
        });

        document.querySelectorAll('.compact-legend .legend-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = (item as HTMLElement).dataset.type;
                if (!type) return;

                const selector = type === 'break' ? '.break-cell' : `[data-is-${type}="true"]`;
                const cells = document.querySelectorAll(selector);

                if (cells.length === 0) {
                    (globalThis as any).showToast(`Brak komórek typu: ${item.textContent?.trim()}`, 2000);
                    return;
                }

                cells.forEach(cell => {
                    cell.classList.add('legend-highlight');
                    setTimeout(() => cell.classList.remove('legend-highlight'), 3000);
                });
                (globalThis as any).showToast(`Podświetlono ${cells.length} komórek: ${item.textContent?.trim()}`);
            });
        });
    };

    const initialize = (deps: Dependencies): void => {
        _dependencies = deps;
        mainTable = document.getElementById('mainScheduleTable') as HTMLTableElement | null;

        if (!mainTable) {
            console.error('ScheduleEvents.initialize: mainScheduleTable not found.');
            return;
        }

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
        }

        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);

        const contextMenuItems = [
            {
                id: 'contextPatientInfo',
                class: 'info',
                condition: (cell: HTMLElement) =>
                    !cell.classList.contains('break-cell') &&
                    !cell.classList.contains('hydrotherapy-cell') &&
                    _dependencies.ui.getElementText(cell).trim() !== '',
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
                        (globalThis as any).showToast('Nie można dodać przerwy do zajętej komórki. Najpierw wyczyść komórkę.', 3000);
                        return;
                    }
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = true;
                        (globalThis as any).showToast('Dodano przerwę');
                    });
                },
                condition: (cell: HTMLElement) => !cell.classList.contains('break-cell'),
            },
            {
                id: 'contextHydrotherapy',
                condition: (cell: HTMLElement) => !cell.classList.contains('break-cell') && !cell.classList.contains('split-cell'),
                action: (cell: HTMLElement) => {
                    _dependencies.updateCellState(cell, (state) => {
                        Object.assign(state, { content: 'Hydro.', isHydrotherapy: true, isMassage: false, isPnf: false, isEveryOtherDay: false });
                        (globalThis as any).showToast('Dodano Hydro.');
                    });
                }
            },
            {
                id: 'contextRemoveBreak',
                class: 'danger',
                action: (cell: HTMLElement) => {
                    _dependencies.updateCellState(cell, (state) => {
                        state.isBreak = false;
                        (globalThis as any).showToast('Usunięto przerwę');
                    });
                },
                condition: (cell: HTMLElement) => cell.classList.contains('break-cell'),
            },
            {
                id: 'contextShowHistory',
                condition: (cell: HTMLElement): boolean => {
                    const cellState = _dependencies.appState.scheduleCells[cell.dataset.time || '']?.[cell.dataset.employeeIndex || ''];
                    return !!cellState?.history?.length;
                },
                action: (cell: HTMLElement) => _dependencies.showHistoryModal(cell),
            },
            { id: 'contextClear', class: 'danger', action: (cell: HTMLElement) => _dependencies.clearCell(cell) },
            {
                id: 'contextSplitCell',
                action: (cell: HTMLElement) =>
                    _dependencies.updateCellState(cell, (state) => {
                        Object.assign(state, {
                            content1: safeCopy(state.content || '') as string,
                            content2: '',
                            content: null,
                            treatmentData1: {
                                startDate: safeCopy(state.treatmentStartDate),
                                extensionDays: safeCopy(state.treatmentExtensionDays),
                                endDate: safeCopy(state.treatmentEndDate),
                                additionalInfo: safeCopy(state.additionalInfo),
                            },
                            treatmentStartDate: null,
                            treatmentExtensionDays: null,
                            treatmentEndDate: null,
                            additionalInfo: null,
                            isSplit: true
                        });
                        if (state.isMassage) { state.isMassage1 = true; state.isMassage = null; }
                        if (state.isPnf) { state.isPnf1 = true; state.isPnf = null; }
                        if (state.isEveryOtherDay) { state.isEveryOtherDay1 = true; state.isEveryOtherDay = null; }
                        (globalThis as any).showToast('Podzielono komórkę');
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
                    return !_dependencies.ui.getElementText(parts[0] as HTMLElement).trim() || !_dependencies.ui.getElementText(parts[1] as HTMLElement).trim();
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
                        Object.assign(state, { isMassage: false, isPnf: false, isEveryOtherDay: false });
                        if (state.isSplit) {
                            Object.assign(state, { isMassage1: false, isMassage2: false, isPnf1: false, isPnf2: false, isEveryOtherDay1: false, isEveryOtherDay2: false });
                        }
                        (globalThis as any).showToast('Wyczyszczono formatowanie');
                    });
                },
            },
        ];
        initializeContextMenu('contextMenu', '.editable-cell', contextMenuItems);
        _setupActionButtons();
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

(globalThis as any).ScheduleEvents = ScheduleEvents;

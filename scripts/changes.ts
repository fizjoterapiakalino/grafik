// scripts/changes.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import {
    PdfColors,
    PdfStyles,
    PdfDefaultStyle,
    PdfTableLayoutCompact,
    PdfPageConfig,
    PdfHeaderColors,
} from './pdf-config.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Stan komórki w harmonogramie zmian
 */
interface ChangesCellState {
    /** Lista ID przypisanych pracowników */
    assignedEmployees?: string[];
    /** Zastępstwa urlopowe: klucz = ID pracownika na urlopie, wartość = ID zastępcy */
    substitutes?: Record<string, string>;
}

/**
 * Stan aplikacji
 */
interface AppState {
    changesCells: Record<string, Record<number, ChangesCellState>>;
}

/**
 * Szablon obsady - przechowuje układ pracowników dla wszystkich kolumn
 */
interface ChangeTemplate {
    id: string;
    name: string;
    /** Mapa kolumn (1-7) do listy ID pracowników */
    columns: Record<number, string[]>;
    createdAt: string;
}

/**
 * Okres dwutygodniowy
 */
interface Period {
    start: string;
    end: string;
}

/**
 * Wpis urlopu pracownika
 */
interface LeaveEntry {
    startDate: string;
    endDate: string;
    type: string;
}

/**
 * Interfejs publicznego API Changes
 */
interface ChangesAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Moduł harmonogramu zmian
 */
export const Changes: ChangesAPI = (() => {
    let changesTableBody: HTMLElement | null = null;
    let changesHeaderRow: HTMLElement | null = null;
    let appState: AppState = { changesCells: {} };

    let currentYear = new Date().getUTCFullYear();
    let yearSelect: HTMLSelectElement | null = null;
    // Clipboard: tablica tablic - każdy element to lista pracowników z jednej komórki
    // Przy kopiowaniu wielu komórek zachowujemy kolejność (pozycje względne)
    let clipboard: string[][] | null = null;
    let activeCell: HTMLTableCellElement | null = null;
    let cachedLeavesData: Record<string, LeaveEntry[]> = {}; // Przechowuje dane o urlopach

    // Stos Undo dla cofania zmian
    let undoStack: string[] = [];
    const MAX_UNDO_STACK = 20;

    // Zaznaczenie wielu komórek
    let multiSelectedCells: Set<HTMLTableCellElement> = new Set();

    // Szablony obsady
    let templates: ChangeTemplate[] = [];
    let pendingTemplateRow: HTMLTableRowElement | null = null; // Wiersz dla którego zapisujemy/stosujemy szablon

    const TEMPLATES_STORAGE_KEY = 'changesTemplates';

    const isWeekend = (date: Date): boolean => {
        const day = date.getUTCDay();
        return day === 0 || day === 6;
    };

    const handleAppSearch = (e: Event): void => {
        const { searchTerm } = (e as CustomEvent<{ searchTerm: string }>).detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const hasEmployee = Array.from((row as HTMLTableRowElement).cells).some((cell, index) => {
                if (index === 0) return false;
                return cell.textContent?.toLowerCase().includes(lowerCaseSearchTerm) || false;
            });
            (row as HTMLElement).style.display = hasEmployee || lowerCaseSearchTerm === '' ? '' : 'none';
        });
    };

    /**
     * Sprawdza czy pracownik jest na urlopie w danym okresie
     */
    const isEmployeeOnLeave = (employeeId: string, periodStart: string, periodEnd: string): boolean => {
        const employees = EmployeeManager.getAll();
        const employee = employees[employeeId];
        if (!employee) return false;

        const employeeName = employee.displayName || employee.name;
        if (!employeeName) return false;

        const employeeLeaves = cachedLeavesData[employeeName];
        if (!Array.isArray(employeeLeaves)) return false;

        const start = new Date(periodStart);
        const end = new Date(periodEnd);

        return employeeLeaves.some(leave => {
            if (leave.type !== 'vacation') return false;
            const leaveStart = new Date(leave.startDate);
            const leaveEnd = new Date(leave.endDate);
            return !(leaveEnd < start || leaveStart > end);
        });
    };

    /**
     * Kopiuje komórkę lub wiele zaznaczonych komórek do schowka
     */
    const copyCell = (cell: HTMLTableCellElement): void => {
        if (!cell) return;

        // Jeśli są zaznaczone komórki (multi-select), kopiuj wszystkie posortowane wg kolumny
        if (multiSelectedCells.size > 0) {
            // Sortuj komórki wg indeksu kolumny
            const sortedCells = Array.from(multiSelectedCells).sort((a, b) => a.cellIndex - b.cellIndex);

            clipboard = sortedCells.map(c => {
                const row = c.parentElement as HTMLTableRowElement;
                const period = row.dataset.startDate || '';
                const colIdx = c.cellIndex;
                const cellState = appState.changesCells[period]?.[colIdx];
                return cellState?.assignedEmployees ? [...cellState.assignedEmployees] : [];
            });

            window.showToast(`Skopiowano ${clipboard.length} komórek.`);
            return;
        }

        // Pojedyncza komórka
        const period = (cell.parentElement as HTMLTableRowElement).dataset.startDate;
        if (!period) return;
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex];

        if (cellState?.assignedEmployees) {
            clipboard = [[...cellState.assignedEmployees]];
            window.showToast('Skopiowano.');
        } else {
            clipboard = [[]];
            window.showToast('Skopiowano pustą komórkę.');
        }
    };

    /**
     * Wkleja zawartość schowka do komórki (lub sekwencyjnie do kolejnych kolumn przy multi-paste)
     */
    const pasteCell = (cell: HTMLTableCellElement): void => {
        if (!cell || !clipboard || clipboard.length === 0) return;

        const row = cell.parentElement as HTMLTableRowElement;
        const period = row.dataset.startDate || '';
        const startColumnIndex = cell.cellIndex;
        const maxColumn = 7; // Ostatnia edytowalna kolumna (przed urlopami)

        // Zapisz stan przed zmianą
        pushUndoState();

        // Określ ile komórek możemy wkleić (ograniczenie do końca wiersza)
        const availableSlots = maxColumn - startColumnIndex + 1;
        const cellsToPaste = Math.min(clipboard.length, availableSlots);

        let pastedCount = 0;

        for (let i = 0; i < cellsToPaste; i++) {
            const targetColIndex = startColumnIndex + i;
            const employeesToPaste = clipboard[i];

            if (!employeesToPaste) continue;

            // Zbierz pracowników już przypisanych w INNYCH komórkach tego wiersza
            const employeesInOtherCells = new Set<string>();
            const periodCells = appState.changesCells[period] || {};
            for (const colIdx in periodCells) {
                if (Number(colIdx) !== targetColIndex) {
                    const otherCellEmployees = periodCells[Number(colIdx)]?.assignedEmployees || [];
                    otherCellEmployees.forEach((empId: string) => employeesInOtherCells.add(empId));
                }
            }

            // Filtruj pracowników - wklej tylko tych, którzy nie są w innych komórkach
            const validEmployees = employeesToPaste.filter(empId => !employeesInOtherCells.has(empId));

            // Zapisz do stanu
            if (!appState.changesCells[period]) appState.changesCells[period] = {};
            appState.changesCells[period][targetColIndex] = {
                assignedEmployees: [...validEmployees]
            };
            pastedCount++;
        }

        renderChangesAndSave();

        if (clipboard.length === 1) {
            window.showToast('Wklejono.');
        } else if (pastedCount < clipboard.length) {
            window.showToast(`Wklejono ${pastedCount}/${clipboard.length} komórek (brak miejsca dla pozostałych).`);
        } else {
            window.showToast(`Wklejono ${pastedCount} komórek.`);
        }
    };

    const clearCell = (cell: HTMLTableCellElement): void => {
        if (!cell) return;
        updateCellState(cell, (state) => {
            state.assignedEmployees = [];
        });
        window.showToast('Wyczyszczono.');
    };

    /**
     * Kopiuje obsadę z ostatniego niepustego wiersza do aktualnego
     */
    const copyFromPreviousRow = (currentRow: HTMLTableRowElement): void => {
        const currentPeriod = currentRow.dataset.startDate || '';
        if (!currentPeriod) return;

        // Szukaj ostatniego niepustego wiersza (idąc wstecz od aktualnego)
        let sourceRow = currentRow.previousElementSibling as HTMLTableRowElement | null;
        let sourcePeriod: string | null = null;

        while (sourceRow) {
            const period = sourceRow.dataset.startDate || '';
            const periodCells = appState.changesCells[period] || {};

            // Sprawdź czy ten wiersz ma jakichkolwiek przypisanych pracowników
            const hasEmployees = Object.values(periodCells).some(
                cell => cell.assignedEmployees && cell.assignedEmployees.length > 0
            );

            if (hasEmployees) {
                sourcePeriod = period;
                break;
            }
            sourceRow = sourceRow.previousElementSibling as HTMLTableRowElement | null;
        }

        if (!sourcePeriod) {
            window.showToast('Brak wypełnionego okresu do skopiowania.', 2000);
            return;
        }

        // Zapisz stan przed zmianą
        pushUndoState();

        const sourceCells = appState.changesCells[sourcePeriod] || {};

        // Kopiuj tylko kolumny 1-7 (pomijamy 0-daty i 8-urlopy)
        for (let colIdx = 1; colIdx <= 7; colIdx++) {
            const sourceEmployees = sourceCells[colIdx]?.assignedEmployees || [];
            if (!appState.changesCells[currentPeriod]) appState.changesCells[currentPeriod] = {};
            appState.changesCells[currentPeriod][colIdx] = {
                assignedEmployees: [...sourceEmployees]
            };
        }

        renderChangesAndSave();
        window.showToast('Skopiowano obsadę z ostatniego wypełnionego okresu.', 2000);
    };

    /**
     * Kopiuje obsadę z bieżącego wiersza do następnego okresu
     */
    const handleCopyRowToNext = (event: Event): void => {
        const btn = event.currentTarget as HTMLElement;
        const currentRow = btn.closest('tr') as HTMLTableRowElement;
        if (!currentRow) return;

        const currentPeriod = currentRow.dataset.startDate || '';
        const nextRow = currentRow.nextElementSibling as HTMLTableRowElement | null;

        if (!nextRow || !nextRow.dataset.startDate) {
            window.showToast('Brak następnego okresu.', 2000);
            return;
        }

        const nextPeriod = nextRow.dataset.startDate;
        const sourceCells = appState.changesCells[currentPeriod] || {};

        // Sprawdź czy bieżący wiersz ma jakieś dane
        const hasData = Object.keys(sourceCells).some(colIdx => {
            const col = Number(colIdx);
            const employees = sourceCells[col]?.assignedEmployees;
            return col >= 1 && col <= 7 && employees && employees.length > 0;
        });

        if (!hasData) {
            window.showToast('Bieżący okres jest pusty - brak danych do skopiowania.', 2000);
            return;
        }

        // Zapisz stan przed zmianą
        pushUndoState();

        // Kopiuj tylko kolumny 1-7 (pomijamy 0-daty, 8-urlopy, 9-akcje)
        if (!appState.changesCells[nextPeriod]) appState.changesCells[nextPeriod] = {};

        for (let colIdx = 1; colIdx <= 7; colIdx++) {
            const sourceCell = sourceCells[colIdx];
            const employees = sourceCell?.assignedEmployees;
            if (employees && employees.length > 0) {
                appState.changesCells[nextPeriod][colIdx] = {
                    assignedEmployees: [...employees],
                    // Nie kopiujemy zastępstw - urlopy się zmieniają między okresami
                };
            }
        }

        renderChangesAndSave();
        window.showToast(`Skopiowano obsadę do następnego okresu.`, 2000);
    };

    // =========================
    // SZABLONY OBSADY
    // =========================

    /** Ładuje szablony z localStorage */
    const loadTemplates = (): void => {
        try {
            const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
            templates = stored ? JSON.parse(stored) : [];
        } catch {
            templates = [];
        }
    };

    /** Zapisuje szablony do localStorage */
    const saveTemplates = (): void => {
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    };

    /** Generuje unikalny ID dla szablonu */
    const generateTemplateId = (): string => {
        return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    };

    /** Otwiera modal zapisu szablonu */
    const openSaveTemplateModal = (row: HTMLTableRowElement): void => {
        const period = row.dataset.startDate || '';
        const rowData = appState.changesCells[period] || {};

        // Sprawdź czy wiersz ma dane
        const hasData = Object.keys(rowData).some(colIdx => {
            const col = Number(colIdx);
            const employees = rowData[col]?.assignedEmployees;
            return col >= 1 && col <= 7 && employees && employees.length > 0;
        });

        if (!hasData) {
            window.showToast('Wiersz jest pusty - nie ma czego zapisać jako szablon.', 2000);
            return;
        }

        pendingTemplateRow = row;
        const modal = document.getElementById('saveTemplateModal');
        const input = document.getElementById('templateNameInput') as HTMLInputElement;

        if (modal && input) {
            input.value = '';
            modal.style.display = 'flex';
            input.focus();
        }
    };

    /** Zapisuje wiersz jako szablon */
    const saveRowAsTemplate = (): void => {
        const input = document.getElementById('templateNameInput') as HTMLInputElement;
        const modal = document.getElementById('saveTemplateModal');

        if (!input || !pendingTemplateRow) return;

        const name = input.value.trim();
        if (!name) {
            window.showToast('Podaj nazwę szablonu.', 2000);
            return;
        }

        const period = pendingTemplateRow.dataset.startDate || '';
        const rowData = appState.changesCells[period] || {};

        // Zbuduj obiekt kolumn
        const columns: Record<number, string[]> = {};
        for (let colIdx = 1; colIdx <= 7; colIdx++) {
            const employees = rowData[colIdx]?.assignedEmployees;
            if (employees && employees.length > 0) {
                columns[colIdx] = [...employees];
            }
        }

        const template: ChangeTemplate = {
            id: generateTemplateId(),
            name,
            columns,
            createdAt: new Date().toISOString(),
        };

        templates.push(template);
        saveTemplates();

        if (modal) modal.style.display = 'none';
        pendingTemplateRow = null;

        window.showToast(`Zapisano szablon "${name}".`, 2000);
    };

    /** Otwiera modal aplikacji szablonu */
    const openApplyTemplateModal = (row: HTMLTableRowElement): void => {
        loadTemplates();

        if (templates.length === 0) {
            window.showToast('Brak zapisanych szablonów. Najpierw zapisz szablon z istniejącego wiersza.', 3000);
            return;
        }

        pendingTemplateRow = row;
        const modal = document.getElementById('applyTemplateModal');
        const select = document.getElementById('templateSelect') as HTMLSelectElement;
        const preview = document.getElementById('applyTemplatePreview');

        if (modal && select) {
            // Wypełnij listę szablonów
            select.innerHTML = '<option value="">-- Wybierz szablon --</option>';
            templates.forEach(tpl => {
                const option = document.createElement('option');
                option.value = tpl.id;
                option.textContent = tpl.name;
                select.appendChild(option);
            });

            // Event na zmianę szablonu - pokaż podgląd
            select.onchange = () => {
                const selectedId = select.value;
                const tpl = templates.find(t => t.id === selectedId);

                if (preview && tpl) {
                    const columnNames = ['', 'HYDRO', 'MASAŻ', 'FIZYKO', 'SALA', 'MASAŻ', 'FIZYKO', 'SALA'];
                    const previewHtml = Object.entries(tpl.columns)
                        .map(([colIdx, empIds]) => {
                            const names = (empIds as string[]).map(id => EmployeeManager.getFullNameById(id)).join(', ');
                            return `<div><strong>${columnNames[Number(colIdx)] || 'Kol. ' + colIdx}:</strong> ${names}</div>`;
                        })
                        .join('');
                    preview.innerHTML = previewHtml || '<em>Pusty szablon</em>';
                } else if (preview) {
                    preview.innerHTML = '';
                }
            };

            if (preview) preview.innerHTML = '';
            modal.style.display = 'flex';
        }
    };

    /** Stosuje wybrany szablon do wiersza */
    const applyTemplateToRow = (): void => {
        const select = document.getElementById('templateSelect') as HTMLSelectElement;
        const modal = document.getElementById('applyTemplateModal');

        if (!select || !pendingTemplateRow) return;

        const selectedId = select.value;
        const template = templates.find(t => t.id === selectedId);

        if (!template) {
            window.showToast('Wybierz szablon.', 2000);
            return;
        }

        const period = pendingTemplateRow.dataset.startDate || '';

        // Zapisz stan przed zmianą
        pushUndoState();

        // Zastosuj szablon
        if (!appState.changesCells[period]) appState.changesCells[period] = {};

        for (let colIdx = 1; colIdx <= 7; colIdx++) {
            const employees = template.columns[colIdx];
            if (employees && employees.length > 0) {
                appState.changesCells[period][colIdx] = {
                    assignedEmployees: [...employees],
                };
            }
        }

        renderChangesAndSave();

        if (modal) modal.style.display = 'none';
        pendingTemplateRow = null;

        window.showToast(`Zastosowano szablon "${template.name}".`, 2000);
    };

    /** Usuwa szablon */
    const deleteTemplate = (templateId: string): void => {
        const tpl = templates.find(t => t.id === templateId);
        if (!tpl) return;

        if (confirm(`Czy na pewno chcesz usunąć szablon "${tpl.name}"?`)) {
            templates = templates.filter(t => t.id !== templateId);
            saveTemplates();
            renderTemplateList();
            window.showToast('Szablon usunięty.', 2000);
        }
    };

    /** Renderuje listę szablonów w modalu zarządzania */
    const renderTemplateList = (): void => {
        const list = document.getElementById('templateList');
        const preview = document.getElementById('templatePreview');

        if (!list) return;

        if (templates.length === 0) {
            list.innerHTML = `
                <div class="template-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>Brak zapisanych szablonów</p>
                    <small>Kliknij prawym przyciskiem na wiersz i wybierz "Zapisz jako szablon"</small>
                </div>
            `;
            return;
        }

        const columnNames = ['', 'HYDRO', 'MASAŻ', 'FIZYKO', 'SALA', 'MASAŻ', 'FIZYKO', 'SALA'];

        list.innerHTML = templates.map(tpl => `
            <div class="template-item" data-template-id="${tpl.id}">
                <span class="template-item-name">${tpl.name}</span>
                <div class="template-item-actions">
                    <button class="template-item-btn delete-btn" data-action="delete" title="Usuń"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');

        // Event listenery
        list.querySelectorAll('.template-item').forEach(item => {
            const itemEl = item as HTMLElement;

            // Kliknięcie na element - pokaż podgląd
            itemEl.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.template-item-btn')) return; // Ignoruj kliknięcia na przyciski

                const templateId = itemEl.dataset.templateId;
                const tpl = templates.find(t => t.id === templateId);

                // Oznacz jako wybrany
                list.querySelectorAll('.template-item').forEach(el => el.classList.remove('selected'));
                itemEl.classList.add('selected');

                // Pokaż podgląd
                if (preview && tpl) {
                    const previewGrid = Object.entries(tpl.columns)
                        .map(([colIdx, empIds]) => {
                            const names = (empIds as string[]).map(id => EmployeeManager.getFullNameById(id)).join('<br>');
                            return `
                                <div class="template-preview-cell">
                                    <div class="template-preview-cell-header">${columnNames[Number(colIdx)] || 'Kol. ' + colIdx}</div>
                                    <div class="template-preview-cell-content">${names || '—'}</div>
                                </div>
                            `;
                        })
                        .join('');
                    preview.innerHTML = `<div class="template-preview-grid">${previewGrid}</div>`;
                }
            });

            // Przycisk usuń
            itemEl.querySelector('.delete-btn')?.addEventListener('click', () => {
                const templateId = itemEl.dataset.templateId;
                if (templateId) deleteTemplate(templateId);
            });
        });
    };

    /** Otwiera modal zarządzania szablonami */
    const openTemplateManagerModal = (): void => {
        loadTemplates();
        renderTemplateList();

        const modal = document.getElementById('templateModal');
        const preview = document.getElementById('templatePreview');

        if (preview) {
            preview.innerHTML = '<p class="template-placeholder">Wybierz szablon, aby zobaczyć podgląd</p>';
        }

        if (modal) {
            modal.style.display = 'flex';
        }
    };

    /** Inicjalizuje UI szablonów */
    const initTemplateUI = (): void => {
        loadTemplates();

        // Przycisk "Szablony" w nagłówku
        const manageBtn = document.getElementById('manageTemplatesBtn');
        manageBtn?.addEventListener('click', openTemplateManagerModal);

        // Modal zarządzania szablonami - przycisk zamknij
        document.getElementById('closeTemplateModal')?.addEventListener('click', () => {
            const modal = document.getElementById('templateModal');
            if (modal) modal.style.display = 'none';
        });

        // Modal zapisu szablonu
        document.getElementById('confirmSaveTemplate')?.addEventListener('click', saveRowAsTemplate);
        document.getElementById('cancelSaveTemplate')?.addEventListener('click', () => {
            const modal = document.getElementById('saveTemplateModal');
            if (modal) modal.style.display = 'none';
            pendingTemplateRow = null;
        });

        // Modal aplikacji szablonu
        document.getElementById('confirmApplyTemplate')?.addEventListener('click', applyTemplateToRow);
        document.getElementById('cancelApplyTemplate')?.addEventListener('click', () => {
            const modal = document.getElementById('applyTemplateModal');
            if (modal) modal.style.display = 'none';
            pendingTemplateRow = null;
        });

        // Przycisk "Szybkie planowanie"
        document.getElementById('quickPlanningBtn')?.addEventListener('click', openMultiPeriodModal);

        // Modal szybkiego planowania
        document.getElementById('confirmMultiPeriodTemplate')?.addEventListener('click', applyTemplateToMultiplePeriods);
        document.getElementById('cancelMultiPeriodTemplate')?.addEventListener('click', () => {
            const modal = document.getElementById('multiPeriodTemplateModal');
            if (modal) modal.style.display = 'none';
        });

        // Opcje context menu są obsługiwane przez initializeContextMenu w init()
    };

    /** Pobiera listę okresów z obecnego roku */
    const getCurrentPeriods = (): { value: string; label: string }[] => {
        const periods = generateTwoWeekPeriods(currentYear);
        return periods.map(p => ({
            value: p.start,
            label: `${formatDate(new Date(p.start))} - ${formatDate(new Date(p.end))}`,
        }));
    };

    /** Formatuje datę do krótkiego formatu */
    const formatDate = (date: Date): string => {
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        return `${day}.${month}`;
    };

    /** Otwiera modal szybkiego planowania */
    const openMultiPeriodModal = (): void => {
        loadTemplates();

        if (templates.length === 0) {
            window.showToast('Brak zapisanych szablonów. Najpierw zapisz szablon z istniejącego wiersza.', 3000);
            return;
        }

        const modal = document.getElementById('multiPeriodTemplateModal');
        const templateSelect = document.getElementById('multiTemplateSelect') as HTMLSelectElement;
        const periodFromSelect = document.getElementById('periodFromSelect') as HTMLSelectElement;
        const periodToSelect = document.getElementById('periodToSelect') as HTMLSelectElement;
        const preview = document.getElementById('multiTemplatePreview');

        if (!modal || !templateSelect || !periodFromSelect || !periodToSelect) return;

        // Wypełnij listę szablonów
        templateSelect.innerHTML = '<option value="">-- Wybierz szablon --</option>';
        templates.forEach(tpl => {
            const option = document.createElement('option');
            option.value = tpl.id;
            option.textContent = tpl.name;
            templateSelect.appendChild(option);
        });

        // Wypełnij listę okresów
        const periods = getCurrentPeriods();
        const periodOptionsHtml = '<option value="">-- Wybierz --</option>' +
            periods.map(p => `<option value="${p.value}">${p.label}</option>`).join('');

        periodFromSelect.innerHTML = periodOptionsHtml;
        periodToSelect.innerHTML = periodOptionsHtml;

        // Event na zmianę szablonu - pokaż podgląd
        templateSelect.onchange = () => {
            const selectedId = templateSelect.value;
            const tpl = templates.find(t => t.id === selectedId);

            if (preview && tpl) {
                const columnNames = ['', 'HYDRO', 'MASAŻ', 'FIZYKO', 'SALA', 'MASAŻ', 'FIZYKO', 'SALA'];
                const previewHtml = Object.entries(tpl.columns)
                    .map(([colIdx, empIds]) => {
                        const names = (empIds as string[]).map(id => EmployeeManager.getFullNameById(id)).join(', ');
                        return `<div><strong>${columnNames[Number(colIdx)] || 'Kol. ' + colIdx}:</strong> ${names}</div>`;
                    })
                    .join('');
                preview.innerHTML = previewHtml || '<em>Pusty szablon</em>';
            } else if (preview) {
                preview.innerHTML = '';
            }
        };

        // Eventy na zmianę okresów - aktualizuj licznik
        const updatePeriodsCount = (): void => {
            const fromValue = periodFromSelect.value;
            const toValue = periodToSelect.value;
            const countSpan = document.getElementById('selectedPeriodsCount');

            if (!fromValue || !toValue || !countSpan) {
                if (countSpan) countSpan.textContent = 'Wybrano: 0 okresów';
                return;
            }

            const periods = getCurrentPeriods();
            const fromIndex = periods.findIndex(p => p.value === fromValue);
            const toIndex = periods.findIndex(p => p.value === toValue);

            if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) {
                countSpan.textContent = 'Wybrano: 0 okresów';
                return;
            }

            const count = toIndex - fromIndex + 1;
            countSpan.textContent = `Wybrano: ${count} ${count === 1 ? 'okres' : count < 5 ? 'okresy' : 'okresów'}`;
        };

        periodFromSelect.onchange = updatePeriodsCount;
        periodToSelect.onchange = updatePeriodsCount;

        // Reset
        if (preview) preview.innerHTML = '';
        document.getElementById('selectedPeriodsCount')!.textContent = 'Wybrano: 0 okresów';

        modal.style.display = 'flex';
    };

    /** Stosuje szablon do wielu okresów */
    const applyTemplateToMultiplePeriods = (): void => {
        const templateSelect = document.getElementById('multiTemplateSelect') as HTMLSelectElement;
        const periodFromSelect = document.getElementById('periodFromSelect') as HTMLSelectElement;
        const periodToSelect = document.getElementById('periodToSelect') as HTMLSelectElement;
        const modal = document.getElementById('multiPeriodTemplateModal');

        if (!templateSelect || !periodFromSelect || !periodToSelect) return;

        const selectedTemplateId = templateSelect.value;
        const template = templates.find(t => t.id === selectedTemplateId);

        if (!template) {
            window.showToast('Wybierz szablon.', 2000);
            return;
        }

        const fromValue = periodFromSelect.value;
        const toValue = periodToSelect.value;

        if (!fromValue || !toValue) {
            window.showToast('Wybierz zakres okresów.', 2000);
            return;
        }

        const periods = getCurrentPeriods();
        const fromIndex = periods.findIndex(p => p.value === fromValue);
        const toIndex = periods.findIndex(p => p.value === toValue);

        if (fromIndex === -1 || toIndex === -1 || fromIndex > toIndex) {
            window.showToast('Nieprawidłowy zakres okresów.', 2000);
            return;
        }

        // Zapisz stan przed zmianą
        pushUndoState();

        // Zastosuj szablon do każdego okresu w zakresie
        let appliedCount = 0;
        for (let i = fromIndex; i <= toIndex; i++) {
            const periodKey = periods[i].value;

            if (!appState.changesCells[periodKey]) {
                appState.changesCells[periodKey] = {};
            }

            for (let colIdx = 1; colIdx <= 7; colIdx++) {
                const employees = template.columns[colIdx];
                if (employees && employees.length > 0) {
                    appState.changesCells[periodKey][colIdx] = {
                        assignedEmployees: [...employees],
                    };
                }
            }
            appliedCount++;
        }

        renderChangesAndSave();

        if (modal) modal.style.display = 'none';

        window.showToast(`Zastosowano szablon "${template.name}" do ${appliedCount} ${appliedCount === 1 ? 'okresu' : appliedCount < 5 ? 'okresów' : 'okresów'}.`, 3000);
    };

    const generateTwoWeekPeriods = (year: number): Period[] => {
        const periods: Period[] = [];
        let currentDate = new Date(Date.UTC(year, 0, 1));

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

    const renderTable = (periods: Period[]): void => {
        if (!changesHeaderRow || !changesTableBody) return;

        changesHeaderRow.innerHTML = '';
        const headers = [
            'Okres', 'HYDRO 7:00-14:30', 'MASAŻ 7-14:30', 'FIZYKO 7-14:30', 'SALA 7-14:30',
            'MASAŻ 10:30-18:00', 'FIZYKO 10:30-18:00', 'SALA 10:30-18:00', 'URLOPY', 'Akcje',
        ];
        headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            if (headerText === 'Akcje') {
                th.classList.add('actions-header');
            }
            changesHeaderRow!.appendChild(th);
        });

        changesTableBody.innerHTML = '';
        periods.forEach((period, index) => {
            const tr = document.createElement('tr');
            tr.dataset.startDate = period.start;
            tr.dataset.endDate = period.end;
            tr.dataset.periodIndex = String(index);
            const start = new Date(period.start);
            const end = new Date(period.end);

            const isLastPeriod = index === periods.length - 1;
            const copyBtnHtml = isLastPeriod
                ? '<span class="no-action" title="Ostatni okres">—</span>'
                : '<button class="copy-row-btn" title="Kopiuj do następnego okresu"><i class="fas fa-arrow-down"></i> Kopiuj ↓</button>';

            tr.innerHTML = `
                <td>${start.getUTCDate()}.${(start.getUTCMonth() + 1).toString().padStart(2, '0')} - ${end.getUTCDate()}.${(end.getUTCMonth() + 1).toString().padStart(2, '0')}</td>
                <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                <td class="leaves-cell"></td>
                <td class="actions-cell">${copyBtnHtml}</td>
            `;
            changesTableBody!.appendChild(tr);
        });

        // Dodaj event listenery do komórek edytowalnych
        document.querySelectorAll('#changesTableBody td').forEach((cell) => {
            if (!cell.classList.contains('leaves-cell') &&
                !cell.classList.contains('actions-cell') &&
                (cell as HTMLTableCellElement).cellIndex !== 0) {
                const htmlCell = cell as HTMLTableCellElement;
                htmlCell.setAttribute('tabindex', '0');
                htmlCell.addEventListener('click', handleCellClick);
                htmlCell.addEventListener('dblclick', handleCellDblClick);
            }
        });

        // Dodaj event listenery do przycisków kopiowania
        document.querySelectorAll('.copy-row-btn').forEach((btn) => {
            btn.addEventListener('click', handleCopyRowToNext);
        });
    };

    const getAllLeavesData = async (): Promise<Record<string, unknown>> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            return docSnap.exists ? (docSnap.data() as Record<string, unknown>) || {} : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    const populateLeavesColumn = (allLeavesData: Record<string, unknown>): void => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const periodStart = new Date(tr.dataset.startDate || '');
            const periodEnd = new Date(tr.dataset.endDate || '');
            const leavesCell = tr.querySelector('.leaves-cell');
            if (!leavesCell) return;

            let leavesHtml = '';
            const employees = EmployeeManager.getAll();

            for (const employeeId in employees) {
                const employee = employees[employeeId];
                if (employee.isHidden || employee.isScheduleOnly) continue;

                const employeeName = employee.displayName || employee.name;
                if (!employeeName) continue;
                const employeeLeaves = allLeavesData[employeeName] as LeaveEntry[] | undefined;

                if (Array.isArray(employeeLeaves)) {
                    employeeLeaves.forEach((leave) => {
                        const leaveStart = new Date(leave.startDate);
                        const leaveEnd = new Date(leave.endDate);

                        // Sprawdź czy urlop pokrywa się z tym okresem
                        if (leave.type === 'vacation' && !(leaveEnd < periodStart || leaveStart > periodEnd)) {
                            const lastName = EmployeeManager.getLastNameById(employeeId);

                            // Formatuj datę końca urlopu
                            const endDay = leaveEnd.getDate().toString().padStart(2, '0');
                            const endMonth = (leaveEnd.getMonth() + 1).toString().padStart(2, '0');

                            let dateRange = '';
                            let tooltipText = `Urlop: ${leave.startDate} - ${leave.endDate}`;

                            // Sprawdź czy urlop zaczął się PRZED początkiem tego okresu
                            if (leaveStart < periodStart) {
                                // Urlop zaczął się wcześniej - pokazuj "do XX.XX"
                                dateRange = `do ${endDay}.${endMonth}`;
                            } else {
                                // Urlop zaczyna się w tym okresie - pokazuj pełny zakres
                                const startDay = leaveStart.getDate().toString().padStart(2, '0');
                                const startMonth = (leaveStart.getMonth() + 1).toString().padStart(2, '0');

                                if (startMonth === endMonth) {
                                    // Ten sam miesiąc
                                    dateRange = `${startDay}-${endDay}.${startMonth}`;
                                } else {
                                    // Różne miesiące
                                    dateRange = `${startDay}.${startMonth}-${endDay}.${endMonth}`;
                                }
                            }

                            leavesHtml += `<span class="leave-entry" title="${tooltipText}">${lastName || employeeName} <small>(${dateRange})</small></span><br>`;
                        }
                    });
                }
            }
            leavesCell.innerHTML = leavesHtml;

            if (periodEnd < today) {
                tr.classList.add('past-period');
            }
        });
    };

    /**
     * Ustawia aktywną (zaznaczoną) komórkę
     */
    const setActiveCell = (cell: HTMLTableCellElement | null): void => {
        // Usuń zaznaczenie z poprzedniej komórki
        if (activeCell) {
            activeCell.classList.remove('active-cell');
        }

        activeCell = cell;

        // Dodaj zaznaczenie do nowej komórki
        if (activeCell) {
            activeCell.classList.add('active-cell');
            activeCell.focus();
        }
    };

    /**
     * Obsługuje pojedyncze kliknięcie - zaznaczenie komórki
     */
    const handleCellClick = (event: Event): void => {
        const mouseEvent = event as MouseEvent;
        const cell = (event.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
        if (!cell || cell.cellIndex === 0) return; // Ignoruj pierwszą kolumnę (daty)

        // Ctrl+Click - zaznacz wiele komórek
        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
            toggleMultiSelection(cell);
            return;
        }

        // Normalne kliknięcie - wyczyść multi-select i zaznacz pojedynczą
        clearMultiSelection();
        setActiveCell(cell);
    };

    /**
     * Obsługuje podwójne kliknięcie - otwarcie modala
     */
    const handleCellDblClick = (event: Event): void => {
        const cell = (event.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
        if (!cell || cell.cellIndex === 0) return;

        openEmployeeSelectionModal(cell);
    };

    /**
     * Obsługuje klawisze na zaznaczonej komórce
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
        // Ctrl+S - Szybki zapis
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            saveChanges();
            window.showToast('Zapisano zmiany.', 2000);
            return;
        }

        // Ctrl+Z - Cofnij
        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            undoLastChange();
            return;
        }

        // Ctrl+C - Kopiuj
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (activeCell && activeCell.cellIndex !== 0) {
                copyCell(activeCell);
            }
            return;
        }

        // Ctrl+V - Wklej
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
            event.preventDefault();
            if (!clipboard) {
                window.showToast('Brak skopiowanej komórki.', 2000);
                return;
            }

            if (activeCell && activeCell.cellIndex !== 0) {
                pasteCell(activeCell);
            }
            return;
        }

        if (!activeCell) return;

        // Tab - Następna komórka
        if (event.key === 'Tab') {
            event.preventDefault();
            navigateWithArrows(event.shiftKey ? 'ArrowLeft' : 'ArrowRight');
            return;
        }

        // Enter - Otwórz modal
        if (event.key === 'Enter') {
            event.preventDefault();
            if (activeCell.cellIndex !== 0) {
                openEmployeeSelectionModal(activeCell);
            }
            return;
        }

        // Delete/Backspace - Wyczyść komórkę
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            if (activeCell.cellIndex !== 0) {
                clearCell(activeCell);
            }
            return;
        }

        // Escape - Odznacz komórkę i wyczyść multi-select
        if (event.key === 'Escape') {
            setActiveCell(null);
            clearMultiSelection();
            return;
        }

        // Nawigacja strzałkami
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            navigateWithArrows(event.key);
        }
    };

    /**
     * Nawigacja strzałkami między komórkami
     */
    const navigateWithArrows = (key: string): void => {
        if (!activeCell) return;

        const row = activeCell.parentElement as HTMLTableRowElement;
        const cellIndex = activeCell.cellIndex;
        let newCell: HTMLTableCellElement | null = null;

        switch (key) {
            case 'ArrowUp': {
                const prevRow = row.previousElementSibling as HTMLTableRowElement | null;
                if (prevRow) {
                    newCell = prevRow.cells[cellIndex] || null;
                }
                break;
            }
            case 'ArrowDown': {
                const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
                if (nextRow) {
                    newCell = nextRow.cells[cellIndex] || null;
                }
                break;
            }
            case 'ArrowLeft': {
                if (cellIndex > 1) { // Pomijamy kolumnę dat (index 0)
                    newCell = row.cells[cellIndex - 1] || null;
                }
                break;
            }
            case 'ArrowRight': {
                if (cellIndex < row.cells.length - 1 && cellIndex < 8) { // Pomijamy kolumnę urlopów (index 8)
                    newCell = row.cells[cellIndex + 1] || null;
                }
                break;
            }
        }

        if (newCell && !newCell.classList.contains('leaves-cell') && newCell.cellIndex !== 0) {
            setActiveCell(newCell);
        }
    };

    const openEmployeeSelectionModal = (cell: HTMLTableCellElement): void => {
        const modal = document.getElementById('employeeSelectionModal');
        const employeeListDiv = document.getElementById('employeeList');
        const saveBtn = document.getElementById('saveEmployeeSelection');
        const cancelBtn = document.getElementById('cancelEmployeeSelection');
        const searchInput = document.getElementById('employeeSearchInput') as HTMLInputElement | null;

        if (!modal || !employeeListDiv || !saveBtn || !cancelBtn || !searchInput) return;

        employeeListDiv.innerHTML = '';
        searchInput.value = '';

        const allEmployees = EmployeeManager.getAll();
        if (Object.keys(allEmployees).length === 0) {
            employeeListDiv.innerHTML = '<p style="text-align: center; color: var(--color-gray-500); padding: 20px;">Brak pracowników do wyświetlenia.</p>';
            modal.style.display = 'flex';
            cancelBtn.onclick = () => { modal.style.display = 'none'; };
            return;
        }
        const visibleEmployeesIds = Object.keys(allEmployees).filter((id) => {
            const emp = allEmployees[id];
            return !emp.isHidden && !emp.isScheduleOnly;
        });

        const row = cell.parentElement as HTMLTableRowElement;
        const period = row.dataset.startDate || '';
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex] || {};
        const assignedEmployees = new Set(cellState.assignedEmployees || []);

        // Zbierz wszystkich pracowników już przypisanych w innych komórkach tego wiersza
        const employeesInOtherCells = new Set<string>();
        const periodCells = appState.changesCells[period] || {};
        for (const colIdx in periodCells) {
            if (Number(colIdx) !== columnIndex) {
                const otherCellEmployees = periodCells[Number(colIdx)]?.assignedEmployees || [];
                otherCellEmployees.forEach((empId: string) => employeesInOtherCells.add(empId));
            }
        }

        // Grupowanie
        const groups: Record<string, string[]> = {
            first: [],
            second: [],
            other: [],
        };

        // Sortowanie alfabetyczne
        visibleEmployeesIds.sort((a, b) => EmployeeManager.compareEmployees(allEmployees[a], allEmployees[b]));

        visibleEmployeesIds.forEach((id) => {
            const group = allEmployees[id].shiftGroup || 'other';
            if (groups[group]) groups[group].push(id);
            else groups.other.push(id);
        });

        // Tymczasowe przechowywanie zastępstw (przed zapisem)
        const tempSubstitutes: Record<string, string> = { ...(cellState.substitutes || {}) };
        const periodEnd = row.dataset.endDate || '';

        const renderGroup = (title: string, ids: string[]) => {
            if (ids.length === 0) return;
            const header = document.createElement('div');
            header.className = 'employee-group-header';
            header.textContent = title;
            employeeListDiv.appendChild(header);

            ids.forEach((id) => {
                const employeeEl = document.createElement('div');
                employeeEl.classList.add('employee-list-item');

                const nameSpan = document.createElement('span');
                nameSpan.textContent = EmployeeManager.getFullNameById(id);
                employeeEl.appendChild(nameSpan);
                employeeEl.dataset.employeeId = id;

                const isOnLeave = isEmployeeOnLeave(id, period, periodEnd);

                if (assignedEmployees.has(id)) {
                    employeeEl.classList.add('selected-employee');

                    // Jeśli pracownik jest na urlopie, dodaj UI do wyboru zastępcy
                    if (isOnLeave) {
                        employeeEl.classList.add('on-leave');
                        nameSpan.innerHTML = `⚠ ${EmployeeManager.getFullNameById(id)} <small>(urlop)</small>`;

                        const substituteContainer = document.createElement('div');
                        substituteContainer.className = 'substitute-selector';

                        const substituteSelect = document.createElement('select');
                        substituteSelect.className = 'substitute-select';
                        substituteSelect.innerHTML = '<option value="">-- Wybierz zastępcę --</option>';

                        // Dodaj dostępnych pracowników do selecta
                        visibleEmployeesIds
                            .filter(empId => empId !== id && !assignedEmployees.has(empId))
                            .forEach(empId => {
                                const opt = document.createElement('option');
                                opt.value = empId;
                                opt.textContent = EmployeeManager.getFullNameById(empId);
                                if (tempSubstitutes[id] === empId) {
                                    opt.selected = true;
                                }
                                substituteSelect.appendChild(opt);
                            });

                        substituteSelect.addEventListener('change', (e) => {
                            const value = (e.target as HTMLSelectElement).value;
                            if (value) {
                                tempSubstitutes[id] = value;
                            } else {
                                delete tempSubstitutes[id];
                            }
                        });

                        substituteContainer.appendChild(substituteSelect);
                        employeeEl.appendChild(substituteContainer);
                    }
                } else if (employeesInOtherCells.has(id)) {
                    employeeEl.classList.add('disabled-employee');
                    employeeEl.setAttribute('title', 'Pracownik jest już przypisany do innej kolumny w tym okresie');
                } else if (isOnLeave) {
                    // Nieprzypisany pracownik na urlopie - oznacz ale pozwól kliknąć
                    nameSpan.innerHTML = `<span style="color: var(--color-warning);">⚠</span> ${EmployeeManager.getFullNameById(id)} <small style="color: var(--color-gray-400);">(urlop)</small>`;
                }

                employeeEl.addEventListener('click', (e) => {
                    // Nie pozwól kliknąć na wyszarzonych
                    if (employeeEl.classList.contains('disabled-employee')) return;
                    // Nie przełączaj jeśli kliknięto w select
                    if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'OPTION') return;
                    employeeEl.classList.toggle('selected-employee');
                });

                employeeListDiv.appendChild(employeeEl);
            });
        };

        renderGroup('Pierwsza zmiana', groups.first);
        renderGroup('Druga zmiana', groups.second);
        renderGroup('Pozostali', groups.other);

        const filterEmployees = (): void => {
            const searchTerm = searchInput.value.toLowerCase();

            // 1. Filtruj elementy
            employeeListDiv.querySelectorAll('.employee-list-item').forEach((item) => {
                const el = item as HTMLElement;
                const matches = !!el.textContent?.toLowerCase().includes(searchTerm);
                el.style.display = matches ? '' : 'none';
                el.dataset.visible = matches ? 'true' : 'false';
            });

            // 2. Obsłuż nagłówki
            let currentHeader: HTMLElement | null = null;
            let hasVisibleItems = false;

            Array.from(employeeListDiv.children).forEach(child => {
                if (child.classList.contains('employee-group-header')) {
                    if (currentHeader) {
                        currentHeader.style.display = hasVisibleItems ? '' : 'none';
                    }
                    currentHeader = child as HTMLElement;
                    hasVisibleItems = false;
                } else if (child.classList.contains('employee-list-item')) {
                    if ((child as HTMLElement).dataset.visible === 'true') {
                        hasVisibleItems = true;
                    }
                }
            });
            // Ostatni nagłówek
            if (currentHeader) {
                (currentHeader as HTMLElement).style.display = hasVisibleItems ? '' : 'none';
            }
        };

        searchInput.addEventListener('input', filterEmployees);
        modal.style.display = 'flex';

        const closeModal = (): void => {
            modal.style.display = 'none';
            saveBtn.onclick = null;
            cancelBtn.onclick = null;
            searchInput.removeEventListener('input', filterEmployees);
        };

        saveBtn.onclick = (): void => {
            const selectedEmployees: string[] = [];
            employeeListDiv.querySelectorAll('.selected-employee').forEach((el) => {
                const empEl = el as HTMLElement;
                if (empEl.dataset.employeeId) {
                    selectedEmployees.push(empEl.dataset.employeeId);
                }
            });

            // Usuń zastępstwa dla pracowników, którzy nie są już przypisani
            const validSubstitutes: Record<string, string> = {};
            for (const empId of selectedEmployees) {
                if (tempSubstitutes[empId]) {
                    validSubstitutes[empId] = tempSubstitutes[empId];
                }
            }

            updateCellState(cell, (state) => {
                state.assignedEmployees = selectedEmployees;
                // Firestore nie akceptuje undefined - usuwamy pole jeśli puste
                if (Object.keys(validSubstitutes).length > 0) {
                    state.substitutes = validSubstitutes;
                } else {
                    delete state.substitutes;
                }
            });
            window.showToast('Zapisano zmiany.');
            closeModal();
        };

        cancelBtn.onclick = closeModal;
    };

    /**
     * Zapisuje aktualny stan do stosu Undo
     */
    const pushUndoState = (): void => {
        const stateSnapshot = JSON.stringify(appState.changesCells);
        undoStack.push(stateSnapshot);
        if (undoStack.length > MAX_UNDO_STACK) {
            undoStack.shift();
        }
    };

    /**
     * Cofa ostatnią zmianę
     */
    const undoLastChange = (): void => {
        if (undoStack.length === 0) {
            window.showToast('Brak zmian do cofnięcia.', 2000);
            return;
        }
        const previousState = undoStack.pop();
        if (previousState) {
            appState.changesCells = JSON.parse(previousState);
            renderChangesContent();
            saveChanges();
            window.showToast('Cofnięto zmianę.', 2000);
        }
    };

    /**
     * Czyści zaznaczenie wielu komórek
     */
    const clearMultiSelection = (): void => {
        multiSelectedCells.forEach(cell => cell.classList.remove('multi-selected'));
        multiSelectedCells.clear();
    };

    /**
     * Dodaje/usuwa komórkę z zaznaczenia wielokrotnego
     */
    const toggleMultiSelection = (cell: HTMLTableCellElement): void => {
        if (multiSelectedCells.has(cell)) {
            multiSelectedCells.delete(cell);
            cell.classList.remove('multi-selected');
        } else {
            multiSelectedCells.add(cell);
            cell.classList.add('multi-selected');
        }
    };

    const updateCellState = (cell: HTMLTableCellElement, updateFn: (state: ChangesCellState) => void): void => {
        if (!cell) return;
        const period = (cell.parentElement as HTMLTableRowElement).dataset.startDate;
        if (!period) return;

        // Zapisz stan przed zmianą dla możliwości cofnięcia
        pushUndoState();

        const columnIndex = cell.cellIndex;
        if (!appState.changesCells[period]) appState.changesCells[period] = {};
        let cellState = appState.changesCells[period][columnIndex] || {};

        updateFn(cellState);

        appState.changesCells[period][columnIndex] = cellState;
        renderChangesAndSave();
    };

    const saveChanges = async (): Promise<void> => {
        try {
            await db.collection(AppConfig.firestore.collections.schedules)
                .doc(`changesSchedule_${currentYear}`)
                .set(appState, { merge: true });
            window.setSaveStatus('saved');
        } catch (error) {
            console.error('Error saving changes to Firestore:', error);
            window.setSaveStatus('error');
        }
    };

    const loadChanges = async (): Promise<void> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear}`);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                const savedData = docSnap.data() as AppState | undefined;
                appState.changesCells = savedData?.changesCells || {};
            } else {
                appState.changesCells = {};
            }
        } catch (error) {
            console.error('Error loading changes from Firestore:', error);
        }
    };

    /**
     * Pobiera listę pracowników na urlopie w danym okresie
     */
    const getEmployeesOnLeaveForPeriod = (periodStart: string, periodEnd: string): string[] => {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        const employeesOnLeave: string[] = [];
        const employees = EmployeeManager.getAll();

        for (const employeeId in employees) {
            const employee = employees[employeeId];
            if (employee.isHidden || employee.isScheduleOnly) continue;

            const employeeName = employee.displayName || employee.name;
            if (!employeeName) continue;

            const employeeLeaves = cachedLeavesData[employeeName];
            if (!Array.isArray(employeeLeaves)) continue;

            // Sprawdź czy pracownik ma urlop pokrywający się z tym okresem
            for (const leave of employeeLeaves) {
                if (leave.type !== 'vacation') continue;

                const leaveStart = new Date(leave.startDate);
                const leaveEnd = new Date(leave.endDate);

                // Sprawdź czy urlop pokrywa się z okresem
                if (!(leaveEnd < start || leaveStart > end)) {
                    const lastName = EmployeeManager.getLastNameById(employeeId);
                    employeesOnLeave.push(lastName || employeeName);
                    break; // Pracownik już dodany, przejdź do następnego
                }
            }
        }
        return employeesOnLeave;
    };

    const renderChangesContent = (): void => {
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const period = tr.dataset.startDate || '';
            const periodEnd = tr.dataset.endDate || '';

            // Pobierz pracowników na urlopie dla tego okresu
            const employeesOnLeave = getEmployeesOnLeaveForPeriod(period, periodEnd);

            Array.from(tr.cells).forEach((cell, index) => {
                // Ignoruj pierwszą kolumnę (daty), urlopy i akcje
                if (index === 0 || cell.classList.contains('leaves-cell') || cell.classList.contains('actions-cell')) return;

                const hasAssignedEmployees =
                    appState.changesCells[period]?.[index]?.assignedEmployees &&
                    appState.changesCells[period][index].assignedEmployees!.length > 0;

                if (hasAssignedEmployees) {
                    // Komórka ma przypisanych pracowników - wyświetl ich
                    const cellState = appState.changesCells[period][index];
                    const assignedIds = cellState.assignedEmployees!;
                    const substitutes = cellState.substitutes || {};

                    const employeeNames = assignedIds.map((id) => {
                        const name = EmployeeManager.getFullNameById(id);
                        const isOnLeave = isEmployeeOnLeave(id, period, periodEnd);
                        const substituteId = substitutes[id];

                        if (isOnLeave && substituteId) {
                            // Pracownik na urlopie z zastępcą
                            const substituteName = EmployeeManager.getFullNameById(substituteId);
                            return `<span class="employee-on-leave">${name}</span> <span class="substitute-separator">/</span> <span class="substitute-name">${substituteName}</span>`;
                        } else if (isOnLeave) {
                            // Pracownik na urlopie bez zastępcy
                            return `<span class="employee-on-leave" title="Na urlopie - kliknij dwukrotnie aby dodać zastępcę">${name} <span class="leave-warning-icon">⚠</span></span>`;
                        }
                        return name;
                    }).join('<br>');

                    // Dodaj licznik pracowników
                    const countBadge = `<div class="employee-count-badge">${assignedIds.length} os.</div>`;
                    cell.innerHTML = employeeNames + countBadge;
                    cell.classList.remove('has-leave-placeholder', 'empty-cell');
                } else {
                    // Komórka jest pusta - oznacz jako nieobsadzoną
                    cell.classList.add('empty-cell');

                    if (employeesOnLeave.length > 0) {
                        const placeholder = `<span class="leave-placeholder">${employeesOnLeave.join(', ')}</span>`;
                        cell.innerHTML = placeholder;
                        cell.classList.add('has-leave-placeholder');
                    } else {
                        cell.innerHTML = '';
                        cell.classList.remove('has-leave-placeholder');
                    }
                }
            });
        });
    };

    const renderChangesAndSave = (): void => {
        renderChangesContent();
        saveChanges();
    };

    const printChangesTableToPdf = (): void => {
        const table = document.getElementById('changesTable');
        if (!table) return;

        const tableHeaders = Array.from(table.querySelectorAll('thead th')).map((th, index) => ({
            text: th.textContent || '',
            style: 'tableHeader',
            fillColor: index === 0 ? PdfHeaderColors.firstColumn : PdfHeaderColors.dataColumns,
            color: PdfHeaderColors.text,
        }));

        const tableBody = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            const tr = row as HTMLTableRowElement;
            return Array.from(tr.cells).map((cell, cellIndex) => {
                let textContent = '';

                if (cellIndex === 0) {
                    // Kolumna okresu - użyj textContent
                    textContent = cell.textContent || '';
                } else if (cellIndex === 8) {
                    // Kolumna urlopów - pobierz tekst z każdego .leave-entry lub użyj textContent
                    const leaveEntries = cell.querySelectorAll('.leave-entry');
                    if (leaveEntries.length > 0) {
                        textContent = Array.from(leaveEntries)
                            .map(entry => entry.textContent?.trim() || '')
                            .join('\n');
                    } else {
                        // Fallback - usuń tagi HTML
                        textContent = cell.textContent || '';
                    }
                } else {
                    const period = tr.dataset.startDate || '';
                    const cellState = appState.changesCells[period]?.[cellIndex];
                    if (cellState?.assignedEmployees) {
                        textContent = cellState.assignedEmployees.map((id) => EmployeeManager.getLastNameById(id)).join('\n');
                    }
                }

                return {
                    text: textContent,
                    fillColor: cellIndex === 0 ? PdfColors.slate100 : null,
                    alignment: cellIndex === 0 ? 'left' : 'center',
                };
            });
        });

        const docDefinition = {
            ...PdfPageConfig,
            content: [
                { text: `Grafik Zmian - ${currentYear}`, style: 'header' },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', '*', '*', '*', '*', '*', '*', '*', '*'],
                        body: [tableHeaders, ...tableBody],
                    },
                    layout: PdfTableLayoutCompact,
                },
            ],
            styles: {
                ...PdfStyles,
                tableHeader: {
                    bold: true,
                    fontSize: 10,
                    alignment: 'center' as const,
                },
            },
            defaultStyle: PdfDefaultStyle,
        };

        pdfMake.createPdf(docDefinition).download(`grafik-zmian-${currentYear}.pdf`);
    };

    const populateYearSelect = (): void => {
        if (!yearSelect) return;
        const yearNow = new Date().getUTCFullYear();
        const startYear = yearNow - 2;
        const endYear = yearNow + 5;

        yearSelect.innerHTML = '';

        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
        yearSelect.addEventListener('change', handleYearChange);
    };

    const handleYearChange = async (e: Event): Promise<void> => {
        currentYear = parseInt((e.target as HTMLSelectElement).value, 10);
        await refreshView();
    };

    const refreshView = async (): Promise<void> => {
        const periods = generateTwoWeekPeriods(currentYear);
        renderTable(periods);
        await loadChanges();
        const allLeaves = await getAllLeavesData();
        cachedLeavesData = allLeaves as Record<string, LeaveEntry[]>;
        renderChangesContent();
        populateLeavesColumn(allLeaves);
    };

    const init = async (): Promise<void> => {
        const getElements = (): boolean => {
            changesTableBody = document.getElementById('changesTableBody');
            changesHeaderRow = document.getElementById('changesHeaderRow');
            yearSelect = document.getElementById('changesYearSelect') as HTMLSelectElement | null;
            return !!(changesTableBody && changesHeaderRow && yearSelect);
        };

        if (!getElements()) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (!getElements()) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (!getElements()) {
                    console.error('Changes module: Required elements not found. Aborting initialization.');
                    return;
                }
            }
        }

        const printButton = document.getElementById('printChangesTable');
        if (printButton) {
            printButton.addEventListener('click', printChangesTableToPdf);
        }

        document.addEventListener('app:search', handleAppSearch);
        document.addEventListener('keydown', handleKeyDown);

        populateYearSelect();
        await refreshView();
        await EmployeeManager.load();

        // Setup mobile accordion
        setupMobileAccordion();

        // Inicjalizacja szablonów
        initTemplateUI();

        const contextMenuItems = [
            { id: 'ctxCopyCell', action: (cell: HTMLElement) => copyCell(cell as HTMLTableCellElement) },
            { id: 'ctxPasteCell', action: (cell: HTMLElement) => pasteCell(cell as HTMLTableCellElement) },
            { id: 'ctxClearCell', action: (cell: HTMLElement) => clearCell(cell as HTMLTableCellElement) },
            {
                id: 'ctxCopyFromPrevious', action: (cell: HTMLElement) => {
                    const row = (cell as HTMLTableCellElement).parentElement as HTMLTableRowElement;
                    if (row) copyFromPreviousRow(row);
                }
            },
            {
                id: 'ctxSaveAsTemplate', action: (cell: HTMLElement) => {
                    const row = (cell as HTMLTableCellElement).parentElement as HTMLTableRowElement;
                    if (row) openSaveTemplateModal(row);
                }
            },
            {
                id: 'ctxApplyTemplate', action: (cell: HTMLElement) => {
                    const row = (cell as HTMLTableCellElement).parentElement as HTMLTableRowElement;
                    if (row) openApplyTemplateModal(row);
                }
            },
        ];
        window.initializeContextMenu('changesContextMenu', '#changesTableBody td:not(.leaves-cell)', contextMenuItems);
    };

    const setupMobileAccordion = (): void => {
        // Only setup on mobile screens
        if (window.innerWidth > 768) return;

        const tableBody = document.getElementById('changesTableBody');
        if (!tableBody) return;

        // Add click handlers for accordion toggle
        tableBody.addEventListener('click', (event: Event) => {
            const target = event.target as HTMLElement;
            const firstCell = target.closest('td:first-child');

            if (firstCell) {
                const row = firstCell.closest('tr');
                if (row) {
                    row.classList.toggle('expanded');
                }
                event.stopPropagation();
            }
        }, true);

        // Find and expand current period
        const today = new Date();
        today.setHours(0, 0, 0, 0);


        const rows = tableBody.querySelectorAll('tr');
        rows.forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const startDateStr = tr.dataset.startDate;
            const endDateStr = tr.dataset.endDate;

            if (startDateStr && endDateStr) {
                const periodStart = new Date(startDateStr);
                const periodEnd = new Date(endDateStr);

                // Check if today falls within this period
                if (today >= periodStart && today <= periodEnd) {
                    tr.classList.add('expanded', 'current-period');
                    // Scroll to current period
                    setTimeout(() => {
                        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }
        });
    };

    const destroy = (): void => {
        const printButton = document.getElementById('printChangesTable');
        document.removeEventListener('app:search', handleAppSearch);
        document.removeEventListener('keydown', handleKeyDown);
        if (printButton) {
            printButton.removeEventListener('click', printChangesTableToPdf);
        }
        if (window.destroyContextMenu) {
            window.destroyContextMenu('changesContextMenu');
        }
        setActiveCell(null);
        debugLog('Changes module destroyed');
    };

    return { init, destroy };
})();

// Backward compatibility
declare global {
    interface Window {
        Changes: ChangesAPI;
    }
}

window.Changes = Changes;

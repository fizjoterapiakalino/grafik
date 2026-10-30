// scripts/test-data-generator.ts
import { ScheduleData } from './schedule-data.js';
import { EmployeeManager } from './employee-manager.js';
import { ScheduleLogic } from './schedule-logic.js';
import {
    getActiveEmployeeIds,
    generateScheduleTimeSlots,
    isClinicalWorkday,
} from './statistics-helpers.js';
import { formatLocalIsoDate } from './utils.js';
import { ensureCellPatientIds } from './schedule-helpers.js';
import type { CellState } from './types/index.js';

/**
 * Pula co najmniej 120 polskich nazwisk (wyłącznie nazwiska, bez imion, inicjałów, kropek).
 */
const POLISH_SURNAMES: readonly string[] = [
    'Adamczyk',
    'Adamski',
    'Baran',
    'Baranowski',
    'Bąk',
    'Błaszczyk',
    'Borkowski',
    'Brzeziński',
    'Chmielewski',
    'Cieślak',
    'Czarnecki',
    'Czerwiński',
    'Dąbrowski',
    'Domański',
    'Duda',
    'Dudek',
    'Gajewski',
    'Głowacki',
    'Górecki',
    'Górski',
    'Grabowski',
    'Jabłoński',
    'Jakóbczyk',
    'Janik',
    'Jankowski',
    'Jasiński',
    'Jaworski',
    'Kaczmarek',
    'Kalinowski',
    'Kamiński',
    'Kania',
    'Kaźmierczak',
    'Kołodziej',
    'Kowalczyk',
    'Kowalski',
    'Kozłowski',
    'Krajewski',
    'Krawczyk',
    'Krawiec',
    'Król',
    'Kucharski',
    'Kwiatkowski',
    'Kwiecień',
    'Laskowski',
    'Lewandowski',
    'Lipiński',
    'Lis',
    'Maciejewski',
    'Majewski',
    'Makowski',
    'Malinowski',
    'Marciniak',
    'Markowski',
    'Matuszewski',
    'Mazur',
    'Michalak',
    'Michalski',
    'Mikołajczyk',
    'Morawski',
    'Mróz',
    'Nowak',
    'Nowakowski',
    'Nowicki',
    'Olszewski',
    'Orłowski',
    'Ostrowski',
    'Pachucki',
    'Partyka',
    'Pawlak',
    'Pawlicki',
    'Pawłowski',
    'Pelc',
    'Piasecki',
    'Pietrzak',
    'Piotrowski',
    'Podgórski',
    'Polak',
    'Porębski',
    'Przybylski',
    'Rogowski',
    'Romanowski',
    'Rosiak',
    'Rutkowski',
    'Rybarczyk',
    'Sadowski',
    'Sawicki',
    'Sikora',
    'Sikorski',
    'Skiba',
    'Skowroński',
    'Sobczak',
    'Sobolewski',
    'Sokołowski',
    'Sosnowski',
    'Staniszewski',
    'Stasiak',
    'Stefaniak',
    'Stępień',
    'Strzelecki',
    'Suchecki',
    'Swat',
    'Szczepaniak',
    'Szczepański',
    'Szewczyk',
    'Szostak',
    'Szuba',
    'Szulc',
    'Szweda',
    'Szymański',
    'Szymczak',
    'Śliwa',
    'Śliwiński',
    'Tokarski',
    'Tomaszewski',
    'Trojanowski',
    'Trzciński',
    'Turek',
    'Urban',
    'Urbański',
    'Walczak',
    'Warchoł',
    'Wasiak',
    'Wasilewski',
    'Wesołowski',
    'Węgrzyn',
    'Wieczorek',
    'Wilczyński',
    'Wilk',
    'Winiarski',
    'Wiśniewski',
    'Witkowski',
    'Włodarczyk',
    'Włodarski',
    'Wojciechowski',
    'Wojtas',
    'Wojtczak',
    'Woźniak',
    'Wójcik',
    'Wrona',
    'Wróbel',
    'Wróblewski',
    'Wysocki',
    'Zaborowski',
    'Zagórski',
    'Zając',
    'Zakrzewski',
    'Zalewski',
    'Zaremba',
    'Zaręba',
    'Zawada',
    'Zawadzki',
    'Zieliński',
    'Zięba',
    'Ziółkowski',
    'Zygmunt',
];

const shuffle = <T>(array: T[]): T[] => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
};

const getRecentClinicalWorkdays = (count: number = 18): string[] => {
    const dates: string[] = [];
    const cursor = new Date();
    for (let i = 0; i < 120 && dates.length < count; i++) {
        const iso = formatLocalIsoDate(cursor);
        if (isClinicalWorkday(iso)) {
            dates.push(iso);
        }
        cursor.setDate(cursor.getDate() - 1);
    }
    return dates;
};

const isOccupiedCell = (cell: CellState | undefined): boolean => {
    if (!cell) return false;
    if (cell.isBreak || cell.isHydrotherapy || cell.isHydrotherapy1 || cell.isHydrotherapy2) {
        return true;
    }
    const hasContent = (c: unknown): boolean => typeof c === 'string' && c.trim() !== '';
    return hasContent(cell.content) || hasContent(cell.content1) || hasContent(cell.content2);
};

export interface TestDataGeneratorOptions {
    hostname?: string;
}

export const TestDataGenerator = {
    abortController: null as AbortController | null,

    isLocal(hostnameOverride?: string): boolean {
        if (typeof window === 'undefined') return false;
        const hostname = hostnameOverride ?? window.location.hostname;
        return (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === ''
        );
    },

    init(options?: TestDataGeneratorOptions): void {
        if (!this.isLocal(options?.hostname)) return;
        if (document.getElementById('devTestGeneratorPanel')) return;

        const container = document.querySelector('.table-container');
        if (!container) return;

        this.injectStyles();

        const panel = document.createElement('div');
        panel.id = 'devTestGeneratorPanel';
        panel.className = 'dev-generator-panel';
        panel.innerHTML = `
            <div class="dev-generator-header">
                <i class="fas fa-vial"></i> Panel Generatora Testowego (Tylko DEV)
            </div>
            <div class="dev-generator-actions">
                <label class="dev-generator-field" for="devGeneratedPatientCount">
                    <span>Liczba nazwisk</span>
                    <input id="devGeneratedPatientCount" type="number" min="1" max="300" step="1" value="80">
                </label>
                <button id="btnDevGenTestData" class="dev-btn primary" title="Wypełnij losowymi pacjentami i zabiegami">
                    <i class="fas fa-magic"></i> Generuj Pacjentów
                </button>
                <button id="btnDevClearAllCells" class="dev-btn danger" title="Wyczyść cały grafik">
                    <i class="fas fa-trash-alt"></i> Wyczyść Grafik
                </button>
            </div>
        `;
        container.appendChild(panel);

        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        document.getElementById('btnDevGenTestData')?.addEventListener(
            'click',
            () => {
                this.generateData();
            },
            { signal }
        );

        document.getElementById('btnDevClearAllCells')?.addEventListener(
            'click',
            () => {
                this.clearAllData();
            },
            { signal }
        );
    },

    destroy(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        const panel = document.getElementById('devTestGeneratorPanel');
        if (panel) {
            panel.remove();
        }
    },

    injectStyles(): void {
        if (document.getElementById('devGeneratorStyles')) return;
        const style = document.createElement('style');
        style.id = 'devGeneratorStyles';
        style.textContent = `
            .dev-generator-panel {
                margin-top: 16px;
                padding: 16px;
                background-color: var(--color-gray-900);
                border: 1px solid var(--color-gray-700);
                border-radius: var(--border-radius-lg);
                color: white;
                display: flex;
                flex-direction: column;
                gap: 12px;
                box-shadow: var(--shadow-lg);
                font-family: var(--font-body);
                position: relative;
                z-index: 10;
            }
            .dev-generator-header {
                font-size: 0.85rem;
                font-weight: 800;
                color: var(--color-primary-300);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .dev-generator-actions {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                align-items: flex-end;
            }
            .dev-generator-field {
                display: inline-flex;
                flex-direction: column;
                gap: 4px;
                font-size: 0.75rem;
                font-weight: 700;
                color: var(--color-gray-200);
            }
            .dev-generator-field input {
                width: 112px;
                min-height: 34px;
                padding: 6px 10px;
                border: 1px solid var(--color-gray-600);
                border-radius: var(--border-radius-sm);
                background-color: var(--color-gray-800);
                color: white;
                font: inherit;
            }
            .dev-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 14px;
                border: none;
                border-radius: var(--border-radius-sm);
                font-weight: 700;
                cursor: pointer;
                transition: filter 0.2s;
            }
            .dev-btn.primary {
                background-color: var(--color-primary-600);
                color: white;
            }
            .dev-btn.danger {
                background-color: var(--color-danger);
                color: white;
            }
            .dev-btn:hover {
                filter: brightness(1.15);
            }
        `;
        document.head.appendChild(style);
    },

    clearAllData(): void {
        const appState = ScheduleData.getAppState();
        const scheduleCells = appState.scheduleCells || {};
        const updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[] = [];

        for (const time of Object.keys(scheduleCells)) {
            const row = scheduleCells[time];
            if (!row) continue;
            for (const empIdx of Object.keys(row)) {
                updates.push({
                    time,
                    employeeIndex: empIdx,
                    updateFn: (state: CellState) => {
                        for (const key of Object.keys(state)) {
                            delete (state as Record<string, unknown>)[key];
                        }
                    },
                });
            }
        }

        if (updates.length > 0) {
            ScheduleData.updateMultipleCells(updates);
        }

        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast('Wyczyszczono wszystkie komórki grafiku.', 3000);
        }
    },

    generateData(countOverride?: number): void {
        let requestedCount = countOverride;
        if (typeof requestedCount !== 'number' || isNaN(requestedCount)) {
            const countInput = document.getElementById('devGeneratedPatientCount') as HTMLInputElement | null;
            requestedCount = Number(countInput?.value);
        }
        if (isNaN(requestedCount) || requestedCount < 1) {
            requestedCount = 80;
        }
        requestedCount = Math.floor(requestedCount);

        const employees = EmployeeManager.getAll();
        const activeEmployeeIds = getActiveEmployeeIds(employees);
        if (activeEmployeeIds.length === 0) {
            if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast('Brak aktywnych pracowników w grafiku.', 4000);
            }
            return;
        }

        const timeSlots = generateScheduleTimeSlots();
        const appState = ScheduleData.getAppState();
        const scheduleCells = appState.scheduleCells || {};
        const availableCells: { time: string; employeeIndex: string }[] = [];

        for (const time of timeSlots) {
            for (const empIdx of activeEmployeeIds) {
                const cell = scheduleCells[time]?.[empIdx];
                if (!isOccupiedCell(cell)) {
                    availableCells.push({ time, employeeIndex: empIdx });
                }
            }
        }

        if (availableCells.length === 0) {
            if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast('Brak wolnych komórek w grafiku.', 4000);
            }
            return;
        }

        shuffle(availableCells);

        const usedSurnames = new Set<string>();
        for (const row of Object.values(scheduleCells)) {
            if (!row) continue;
            for (const cell of Object.values(row)) {
                if (!cell) continue;
                if (typeof cell.content === 'string' && cell.content.trim()) {
                    usedSurnames.add(cell.content.trim());
                }
                if (typeof cell.content1 === 'string' && cell.content1.trim()) {
                    usedSurnames.add(cell.content1.trim());
                }
                if (typeof cell.content2 === 'string' && cell.content2.trim()) {
                    usedSurnames.add(cell.content2.trim());
                }
            }
        }

        let unusedPool = POLISH_SURNAMES.filter((s) => !usedSurnames.has(s));
        shuffle(unusedPool);

        const pickSurname = (): string => {
            if (unusedPool.length === 0) {
                unusedPool = [...POLISH_SURNAMES];
                shuffle(unusedPool);
            }
            const surname = unusedPool.pop()!;
            usedSurnames.add(surname);
            return surname;
        };

        const clinicalWorkdays = getRecentClinicalWorkdays(18);
        const pickStartDate = (): string => {
            const idx = Math.floor(Math.random() * clinicalWorkdays.length);
            return clinicalWorkdays[idx];
        };

        const targetCount = Math.min(requestedCount, availableCells.length * 2);
        let splitCount = 0;
        let singleCount = 0;

        if (availableCells.length >= targetCount) {
            splitCount = 0;
            singleCount = targetCount;
        } else {
            splitCount = targetCount - availableCells.length;
            singleCount = availableCells.length - splitCount;
        }

        const updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[] = [];

        // Split cells
        for (let i = 0; i < splitCount; i++) {
            const { time, employeeIndex } = availableCells[i];
            const surname1 = pickSurname();
            const surname2 = pickSurname();
            const startDate1 = pickStartDate();
            const startDate2 = pickStartDate();
            const endDate1 = ScheduleLogic.calculateEndDate(startDate1, 0);
            const endDate2 = ScheduleLogic.calculateEndDate(startDate2, 0);

            updates.push({
                time,
                employeeIndex,
                updateFn: (state: CellState) => {
                    for (const key of Object.keys(state)) {
                        delete (state as Record<string, unknown>)[key];
                    }
                    state.isSplit = true;
                    state.content1 = surname1;
                    state.content2 = surname2;
                    state.treatmentData1 = {
                        startDate: startDate1,
                        extensionDays: 0,
                        endDate: endDate1,
                    };
                    state.treatmentData2 = {
                        startDate: startDate2,
                        extensionDays: 0,
                        endDate: endDate2,
                    };
                    ensureCellPatientIds(state);
                },
            });
        }

        // Single cells
        for (let i = splitCount; i < splitCount + singleCount; i++) {
            const { time, employeeIndex } = availableCells[i];
            const surname = pickSurname();
            const startDate = pickStartDate();
            const endDate = ScheduleLogic.calculateEndDate(startDate, 0);

            updates.push({
                time,
                employeeIndex,
                updateFn: (state: CellState) => {
                    for (const key of Object.keys(state)) {
                        delete (state as Record<string, unknown>)[key];
                    }
                    state.content = surname;
                    state.treatmentStartDate = startDate;
                    state.treatmentExtensionDays = 0;
                    state.treatmentEndDate = endDate;
                    ensureCellPatientIds(state);
                },
            });
        }

        ScheduleData.updateMultipleCells(updates);

        const limitMessage =
            requestedCount > targetCount
                ? ` Ograniczono do ${targetCount}, bo tabela nie ma więcej wolnych miejsc.`
                : '';
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(
                `Wygenerowano ${targetCount} nazwisk w ${updates.length} komórkach.${limitMessage}`,
                5000
            );
        }
    },
};

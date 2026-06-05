// scripts/test-data-generator.ts
import { ScheduleData } from './schedule-data.js';
import { EmployeeManager } from './employee-manager.js';
import { ScheduleLogic } from './schedule-logic.js';
import { AppConfig } from './common.js';
import type { CellState } from './types/index.js';

/**
 * Moduł generatora danych testowych
 * Uruchamia się tylko w środowisku lokalnym (baza testowa)
 */
export const TestDataGenerator = {
    isLocal(): boolean {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '' || hostname.startsWith('192.168.');
    },

    init(): void {
        if (!this.isLocal()) return;

        // Sprawdź czy panel już istnieje
        if (document.getElementById('devTestGeneratorPanel')) return;

        const container = document.querySelector('.table-container');
        if (!container) return;

        // Utwórz panel HTML
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
                    <input id="devGeneratedPatientCount" type="number" min="1" max="200" step="1" value="30">
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

        // Dodaj style CSS
        this.injectStyles();

        // Podepnij akcje
        document.getElementById('btnDevGenTestData')?.addEventListener('click', () => this.generateData());
        document.getElementById('btnDevClearAllCells')?.addEventListener('click', () => this.clearAllData());
    },

    destroy(): void {
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
                padding: 8px 16px;
                border-radius: var(--border-radius-sm);
                font-weight: 700;
                font-size: 0.85rem;
                border: none;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .dev-btn.primary {
                background-color: var(--color-primary-600);
                color: white;
            }
            .dev-btn.primary:hover {
                background-color: var(--color-primary-500);
            }
            .dev-btn.danger {
                background-color: var(--color-danger);
                color: white;
            }
            .dev-btn.danger:hover {
                background-color: #f87171;
            }
        `;
        document.head.appendChild(style);
    },

    generateData(): void {
        const surnames = [
            'Kowalski',
            'Nowak',
            'Zieliński',
            'Szymański',
            'Wiśniewski',
            'Kozłowski',
            'Jankowski',
            'Wojciechowski',
            'Kwiatkowski',
            'Mazur',
            'Krawczyk',
            'Piotrowski',
            'Grabowski',
            'Król',
            'Pawłowski',
            'Michalski',
            'Nowicki',
            'Adamczyk',
            'Dudek',
            'Zając',
            'Wieczorek',
            'Jabłoński',
            'Wróbel',
            'Majewski',
            'Olszewski',
            'Jaworski',
            'Malinowski',
            'Stępień',
            'Górski',
            'Rutkowski',
            'Michalak',
            'Sikora',
            'Baran',
            'Szewczyk',
            'Ostrowski',
            'Tomaszewski',
            'Pietrzak',
            'Wróblewski',
            'Zalewski',
            'Witkowski',
            'Walczak',
            'Włodarczyk',
            'Marciniak',
            'Sadowski',
            'Bąk',
            'Sokołowski',
            'Duda',
            'Chmielewski',
            'Borkowski',
            'Czarnecki',
            'Sawicki',
            'Urbański',
            'Kubiak',
            'Maciejewski',
            'Szczepański',
            'Kucharski',
            'Wilk',
            'Lis',
            'Mazurek',
            'Wysocki',
            'Adamski',
            'Kaźmierczak',
            'Sobczak',
            'Czerwiński',
            'Andrzejewski',
            'Cieślak',
            'Głowacki',
            'Zakrzewski',
            'Kołodziej',
            'Szulc',
            'Kaczmarek',
            'Słowik',
            'Madej',
            'Kowalczyk',
            'Wesołowski',
            'Błaszczyk',
            'Mikołajczyk',
            'Ciesielski',
            'Konieczny',
            'Makowski',
            'Kurek',
            'Wrona',
            'Mróz',
            'Bednarek',
            'Kaczor',
            'Urban',
            'Piątek',
            'Leśniak',
            'Orłowski',
            'Brzeziński',
            'Sowa',
            'Kopeć',
            'Kasprzak',
            'Cybulski',
            'Domagała',
            'Szczęsny',
            'Bielecki',
            'Tomczak',
            'Janik',
            'Kruk',
        ];
        const names = ['Jan', 'Anna', 'Piotr', 'Maria', 'Krzysztof', 'Katarzyna', 'Andrzej', 'Małgorzata', 'Janusz', 'Barbara', 'Tomasz', 'Krystyna', 'Marcin', 'Ewa', 'Paweł', 'Elżbieta', 'Michał', 'Zofia'];

        const employees = Object.keys(EmployeeManager.getAll());
        if (employees.length === 0) {
            window.showToast('Brak pracowników w systemie do generowania danych.', 3000);
            return;
        }

        const countInput = document.getElementById('devGeneratedPatientCount') as HTMLInputElement | null;
        const requestedPatientCount = Math.max(1, Math.floor(Number(countInput?.value) || 30));
        if (countInput) {
            countInput.value = String(requestedPatientCount);
        }

        const appState = ScheduleData.getAppState();
        const updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[] = [];
        const generatedNames: string[] = [];
        const surnameSet = new Set(surnames);
        const usedSurnames = new Set<string>();
        const usedDisplayNames = new Set<string>();

        const normalizeGeneratedSurname = (value: string | null | undefined): string | null => {
            const trimmed = String(value || '').trim();
            if (!trimmed || trimmed.toLowerCase() === 'hydro.') return null;
            if (surnameSet.has(trimmed)) return trimmed;

            const initialMatch = trimmed.match(/^(.+)\s+[A-ZĄĆĘŁŃÓŚŹŻ]\.$/u);
            if (initialMatch && surnameSet.has(initialMatch[1])) {
                return initialMatch[1];
            }

            return null;
        };

        const rememberExistingPatient = (value: string | null | undefined): void => {
            const trimmed = String(value || '').trim();
            const surname = normalizeGeneratedSurname(trimmed);
            if (!surname) return;

            usedSurnames.add(surname);
            usedDisplayNames.add(trimmed);
        };

        const hasOccupiedContent = (cellState: CellState | undefined): boolean => {
            if (!cellState) return false;
            if (cellState.isBreak || cellState.isHydrotherapy || cellState.isHydrotherapy1 || cellState.isHydrotherapy2) {
                return true;
            }
            if (cellState.isSplit) {
                return Boolean(String(cellState.content1 || '').trim() || String(cellState.content2 || '').trim());
            }
            return Boolean(String(cellState.content || '').trim());
        };

        for (const employeeCells of Object.values(appState.scheduleCells)) {
            for (const cellState of Object.values(employeeCells)) {
                if (cellState.isSplit) {
                    rememberExistingPatient(cellState.content1);
                    rememberExistingPatient(cellState.content2);
                } else {
                    rememberExistingPatient(cellState.content);
                }
            }
        }

        const availableUniqueSurnames = surnames.filter((surname) => !usedSurnames.has(surname));

        const takeRandom = <T,>(items: T[]): T | null => {
            if (items.length === 0) return null;
            const index = Math.floor(Math.random() * items.length);
            const [item] = items.splice(index, 1);
            return item;
        };

        const getRandomName = (): string | null => {
            const uniqueSurname = takeRandom(availableUniqueSurnames);
            if (uniqueSurname) {
                usedSurnames.add(uniqueSurname);
                usedDisplayNames.add(uniqueSurname);
                return uniqueSurname;
            }

            const duplicateCandidates: string[] = [];
            for (const surname of surnames) {
                for (const name of names) {
                    const displayName = `${surname} ${name.substring(0, 1)}.`;
                    if (!usedDisplayNames.has(displayName)) {
                        duplicateCandidates.push(displayName);
                    }
                }
            }

            const duplicateName = takeRandom(duplicateCandidates);
            if (!duplicateName) return null;

            const duplicateSurname = normalizeGeneratedSurname(duplicateName);
            if (duplicateSurname) {
                usedSurnames.add(duplicateSurname);
            }
            usedDisplayNames.add(duplicateName);
            return duplicateName;
        };

        const createTreatmentMeta = () => {
            const dateOffset = Math.floor(Math.random() * 15) - 13;
            const start = new Date();
            start.setDate(start.getDate() + dateOffset);
            const startStr = start.toISOString().split('T')[0];
            const extension = Math.random() < 0.3 ? Math.floor(Math.random() * 5) + 1 : 0;

            return {
                startDate: startStr,
                extensionDays: extension,
                endDate: ScheduleLogic.calculateEndDate(startStr, extension),
            };
        };

        const applyRandomTreatmentFlag = (state: CellState, part?: 1 | 2): void => {
            const randType = Math.floor(Math.random() * 4);
            if (part === 1) {
                if (randType === 1) state.isMassage1 = true;
                else if (randType === 2) state.isPnf1 = true;
                else if (randType === 3) state.isEveryOtherDay1 = true;
                return;
            }

            if (part === 2) {
                if (randType === 1) state.isMassage2 = true;
                else if (randType === 2) state.isPnf2 = true;
                else if (randType === 3) state.isEveryOtherDay2 = true;
                return;
            }

            if (randType === 1) state.isMassage = true;
            else if (randType === 2) state.isPnf = true;
            else if (randType === 3) state.isEveryOtherDay = true;
        };

        // Definiujemy godziny pracy
        const startHour = AppConfig.schedule.startHour;
        const endHour = AppConfig.schedule.endHour;
        const availableCells: { time: string; employeeIndex: string }[] = [];

        for (const empIdx of employees) {
            for (let hour = startHour; hour < endHour; hour++) {
                for (const minute of ['00', '30']) {
                    const timeStr = `${hour}:${minute}`;
                    const existingCell = appState.scheduleCells[timeStr]?.[empIdx];
                    if (!hasOccupiedContent(existingCell)) {
                        availableCells.push({ time: timeStr, employeeIndex: empIdx });
                    }
                }
            }
        }

        const targetPatientCount = Math.min(requestedPatientCount, availableCells.length * 2);
        if (targetPatientCount === 0) {
            window.showToast('Brak wolnych miejsc w grafiku. Generator nie nadpisuje istniejących wpisów.', 5000);
            return;
        }

        let remainingPatients = targetPatientCount;
        while (remainingPatients > 0 && availableCells.length > 0) {
            const cell = takeRandom(availableCells);
            if (!cell) break;

            const remainingCellsAfterThis = availableCells.length;
            const mustSplitToFit = remainingPatients > remainingCellsAfterThis + 1;
            const patientCountInCell = remainingPatients >= 2 && (mustSplitToFit || Math.random() < 0.25) ? 2 : 1;
            const firstName = getRandomName();
            const secondName = patientCountInCell === 2 ? getRandomName() : null;
            if (!firstName || (patientCountInCell === 2 && !secondName)) break;

            generatedNames.push(firstName);
            if (secondName) {
                generatedNames.push(secondName);
            }

            updates.push({
                time: cell.time,
                employeeIndex: cell.employeeIndex,
                updateFn: (state: CellState) => {
                    // Wyczyść obecny stan
                    for (const key in state) {
                        if (Object.prototype.hasOwnProperty.call(state, key)) {
                            delete state[key];
                        }
                    }

                    if (secondName) {
                        state.isSplit = true;
                        state.content1 = firstName;
                        state.content2 = secondName;
                        applyRandomTreatmentFlag(state, 1);
                        applyRandomTreatmentFlag(state, 2);
                        state.treatmentData1 = createTreatmentMeta();
                        state.treatmentData2 = createTreatmentMeta();
                    } else {
                        state.content = firstName;
                        applyRandomTreatmentFlag(state);
                        const treatmentMeta = createTreatmentMeta();
                        state.treatmentStartDate = treatmentMeta.startDate;
                        state.treatmentExtensionDays = treatmentMeta.extensionDays;
                        state.treatmentEndDate = treatmentMeta.endDate;
                    }
                },
            });

            remainingPatients -= patientCountInCell;
        }

        if (updates.length > 0) {
            ScheduleData.updateMultipleCells(updates);
            const limitMessage = requestedPatientCount > generatedNames.length ? ` Ograniczono do ${generatedNames.length}, bo tabela nie ma więcej wolnych miejsc.` : '';
            window.showToast(`Wygenerowano ${generatedNames.length} nazwisk w ${updates.length} komórkach.${limitMessage}`, 5000);
        }
    },

    clearAllData(): void {
        const appState = ScheduleData.getAppState();
        const updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[] = [];

        for (const time of Object.keys(appState.scheduleCells)) {
            for (const empIdx of Object.keys(appState.scheduleCells[time])) {
                updates.push({
                    time: time,
                    employeeIndex: empIdx,
                    updateFn: (state: CellState) => {
                        for (const key in state) {
                            if (Object.prototype.hasOwnProperty.call(state, key)) {
                                delete state[key];
                            }
                        }
                    },
                });
            }
        }

        if (updates.length > 0) {
            ScheduleData.updateMultipleCells(updates);
            window.showToast('Pomyślnie wyczyszczono cały grafik.');
        } else {
            window.showToast('Grafik jest pusty.');
        }
    },
};

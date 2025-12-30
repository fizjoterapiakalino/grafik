// scripts/schedule-modals.ts
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleLogic } from './schedule-logic.js';

/**
 * Informacja o duplikacie
 */
interface DuplicateInfo {
    employeeIndex: string;
    time: string;
}

/**
 * Stan komórki
 */
interface CellState {
    content?: string;
    content1?: string;
    content2?: string;
    isSplit?: boolean;
    treatmentStartDate?: string;
    treatmentExtensionDays?: number;
    treatmentEndDate?: string;
    additionalInfo?: string;
    history?: HistoryEntry[];
    [key: string]: unknown;
}

/**
 * Wpis historii
 */
interface HistoryEntry {
    oldValue: string;
    timestamp: string;
    userId: string;
}

/**
 * Interfejs publicznego API ScheduleModals
 */
interface ScheduleModalsAPI {
    showDuplicateConfirmationDialog(
        duplicateInfo: DuplicateInfo,
        onMove: () => void,
        onAdd: () => void,
        onCancel?: () => void
    ): void;
    showNumericConfirmationDialog(
        text: string,
        onConfirm: () => void,
        onCancel: () => void
    ): void;
    openPatientInfoModal(
        element: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void;
    showHistoryModal(
        cell: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void;
    openEmployeeSelectionModal(): void;
}

/**
 * Moduł modali harmonogramu
 */
export const ScheduleModals: ScheduleModalsAPI = (() => {
    const showDuplicateConfirmationDialog = (
        duplicateInfo: DuplicateInfo,
        onMove: () => void,
        onAdd: () => void,
        onCancel?: () => void
    ): void => {
        const modal = document.getElementById('duplicateModal');
        const modalText = document.getElementById('duplicateModalText');
        const moveBtn = document.getElementById('moveEntryBtn') as HTMLButtonElement | null;
        const addBtn = document.getElementById('addAnywayBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement | null;

        if (!modal || !modalText || !moveBtn || !addBtn || !cancelBtn) return;

        const employeeName = EmployeeManager.getNameById(duplicateInfo.employeeIndex);
        modalText.innerHTML = `Znaleziono identyczny wpis dla "<b>${employeeName}</b>" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`;
        modal.style.display = 'flex';

        const closeAndCleanup = (): void => {
            modal.style.display = 'none';
            moveBtn.onclick = null;
            addBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        moveBtn.onclick = (): void => {
            closeAndCleanup();
            onMove();
        };
        addBtn.onclick = (): void => {
            closeAndCleanup();
            onAdd();
        };
        cancelBtn.onclick = (): void => {
            closeAndCleanup();
            if (onCancel) onCancel();
        };
    };

    const showNumericConfirmationDialog = (
        text: string,
        onConfirm: () => void,
        onCancel: () => void
    ): void => {
        const modal = document.getElementById('numericConfirmationModal');
        const modalText = document.getElementById('numericConfirmationModalText');
        const confirmBtn = document.getElementById('confirmNumericBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('cancelNumericBtn') as HTMLButtonElement | null;

        if (!modal || !modalText || !confirmBtn || !cancelBtn) return;

        modalText.innerHTML = `Czy na pewno chcesz wprowadzić do grafiku ciąg cyfr: "<b>${text}</b>"?`;
        modal.style.display = 'flex';

        const closeAndCleanup = (): void => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        confirmBtn.onclick = (): void => {
            closeAndCleanup();
            onConfirm();
        };
        cancelBtn.onclick = (): void => {
            closeAndCleanup();
            onCancel();
        };
    };

    const openPatientInfoModal = (
        element: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void => {
        const patientName = ScheduleUI.getElementText(element);
        if (!patientName) {
            window.showToast('Brak pacjenta w tej komórce.', 3000);
            return;
        }

        const modal = document.getElementById('patientInfoModal');
        const patientNameInput = document.getElementById('patientName') as HTMLInputElement | null;
        const startDateInput = document.getElementById('treatmentStartDate') as HTMLInputElement | null;
        const extensionDaysInput = document.getElementById('treatmentExtensionDays') as HTMLInputElement | null;
        const endDateInput = document.getElementById('treatmentEndDate') as HTMLInputElement | null;
        const saveModalBtn = document.getElementById('savePatientInfoModal') as HTMLButtonElement | null;
        const closeModalBtn = document.getElementById('closePatientInfoModal') as HTMLButtonElement | null;
        const additionalInfoTextarea = document.getElementById('additionalInfo') as HTMLTextAreaElement | null;

        if (!modal || !patientNameInput || !startDateInput || !extensionDaysInput || !endDateInput || !saveModalBtn || !closeModalBtn || !additionalInfoTextarea) return;

        patientNameInput.value = patientName;

        const treatmentData = {
            startDate: cellState.treatmentStartDate,
            extensionDays: cellState.treatmentExtensionDays,
        };
        const currentAdditionalInfo = cellState.additionalInfo || '';

        startDateInput.value = treatmentData.startDate || '';
        extensionDaysInput.value = String(treatmentData.extensionDays || 0);
        additionalInfoTextarea.value = currentAdditionalInfo;

        const updateEndDate = (): void => {
            endDateInput.value = ScheduleLogic.calculateEndDate(startDateInput.value, parseInt(extensionDaysInput.value || '0', 10));
        };

        updateEndDate();

        const startDateChangeHandler = (): void => updateEndDate();
        const extensionInputHandler = (): void => updateEndDate();

        startDateInput.addEventListener('change', startDateChangeHandler);
        extensionDaysInput.addEventListener('input', extensionInputHandler);

        const closeModal = (): void => {
            startDateInput.removeEventListener('change', startDateChangeHandler);
            extensionDaysInput.removeEventListener('input', extensionInputHandler);
            modal.style.display = 'none';
        };

        saveModalBtn.onclick = (): void => {
            const newTreatmentData = {
                startDate: startDateInput.value,
                extensionDays: parseInt(extensionDaysInput.value, 10),
                endDate: endDateInput.value,
                additionalInfo: additionalInfoTextarea.value,
            };

            updateCellStateCallback((state) => {
                state.treatmentStartDate = newTreatmentData.startDate;
                state.treatmentExtensionDays = newTreatmentData.extensionDays;
                state.treatmentEndDate = newTreatmentData.endDate;
                state.additionalInfo = newTreatmentData.additionalInfo;
            });
            window.showToast('Zapisano daty zabiegów i informacje o pacjencie.');
            closeModal();
        };

        closeModalBtn.onclick = closeModal;
        modal.onclick = (event: MouseEvent): void => {
            if (event.target === modal) {
                closeModal();
            }
        };
        modal.style.display = 'flex';
    };

    const showHistoryModal = (
        _cell: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void => {
        const modal = document.getElementById('historyModal');
        const modalBody = document.getElementById('historyModalBody');
        const closeModalBtn = document.getElementById('closeHistoryModal') as HTMLButtonElement | null;

        if (!modal || !modalBody || !closeModalBtn) {
            console.error('History modal elements not found!');
            return;
        }

        if (!cellState || !cellState.history || cellState.history.length === 0) {
            modalBody.innerHTML = '<p>Brak historii dla tej komórki.</p>';
        } else {
            modalBody.innerHTML = `
                <ul class="history-list">
                    ${cellState.history
                    .map((entry) => `
                        <li class="history-item">
                            <div class="history-value">${entry.oldValue || '(pusty)'}</div>
                            <div class="history-meta">
                                <span>${new Date(entry.timestamp).toLocaleString('pl-PL')}</span>
                                <span>przez: ${EmployeeManager.getEmployeeByUid(entry.userId)?.name || 'Nieznany'}</span>
                            </div>
                            <button class="action-btn outline revert-btn" data-value="${entry.oldValue}" title="Przywróć tę wartość"><i class="fas fa-undo"></i> Przywróć</button>
                        </li>
                    `)
                    .join('')}
                </ul>
            `;
        }

        modalBody.querySelectorAll<HTMLButtonElement>('.revert-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const valueToRevert = btn.dataset.value || '';
                updateCellStateCallback((state) => {
                    if (valueToRevert.includes('/')) {
                        const parts = valueToRevert.split('/', 2);
                        state.isSplit = true;
                        state.content1 = parts[0];
                        state.content2 = parts[1];
                        delete state.content;
                    } else {
                        delete state.isSplit;
                        delete state.content1;
                        delete state.content2;
                        state.content = valueToRevert;
                    }
                });
                modal.style.display = 'none';
            });
        });

        const closeModal = (): void => {
            modal.style.display = 'none';
            modal.onclick = null;
            closeModalBtn.onclick = null;
        };

        closeModalBtn.onclick = closeModal;
        modal.onclick = (event: MouseEvent): void => {
            if (event.target === modal) {
                closeModal();
            }
        };

        modal.style.display = 'flex';
    };

    const openEmployeeSelectionModal = (): void => {
        window.showToast('Funkcja wyboru pracownika nie jest jeszcze zaimplementowana.');
    };

    return {
        showDuplicateConfirmationDialog,
        showNumericConfirmationDialog,
        openPatientInfoModal,
        showHistoryModal,
        openEmployeeSelectionModal,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ScheduleModals: ScheduleModalsAPI;
    }
}

window.ScheduleModals = ScheduleModals;

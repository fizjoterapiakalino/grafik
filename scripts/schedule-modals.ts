// scripts/schedule-modals.ts
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleLogic } from './schedule-logic.js';
import type { CellState } from './types/index.js';

/**
 * Informacja o duplikacie
 */
interface DuplicateInfo {
    employeeIndex: string;
    time: string;
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
        modalText.textContent = 'Znaleziono identyczny wpis dla "';
        const b = document.createElement('b');
        b.textContent = employeeName;
        modalText.appendChild(b);
        modalText.appendChild(document.createTextNode(`" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`));
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

        modalText.textContent = 'Czy na pewno chcesz wprowadzić do grafiku ciąg cyfr: "';
        const b = document.createElement('b');
        b.textContent = text;
        modalText.appendChild(b);
        modalText.appendChild(document.createTextNode('"?'));
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

        modalBody.innerHTML = ''; // Clear previous content safely

        if (!cellState || !cellState.history || cellState.history.length === 0) {
            const p = document.createElement('p');
            p.textContent = 'Brak historii dla tej komórki.';
            modalBody.appendChild(p);
        } else {
            const ul = document.createElement('ul');
            ul.className = 'history-list';

            cellState.history.forEach((entry) => {
                const li = document.createElement('li');
                li.className = 'history-item';

                const valueDiv = document.createElement('div');
                valueDiv.className = 'history-value';
                valueDiv.textContent = entry.oldValue || '(pusty)';
                li.appendChild(valueDiv);

                const metaDiv = document.createElement('div');
                metaDiv.className = 'history-meta';

                const timeSpan = document.createElement('span');
                timeSpan.textContent = new Date(entry.timestamp).toLocaleString('pl-PL');
                metaDiv.appendChild(timeSpan);

                const authorSpan = document.createElement('span');
                const authorName = EmployeeManager.getEmployeeByUid(entry.userId ?? '')?.name || 'Nieznany';
                authorSpan.textContent = ` przez: ${authorName}`;
                metaDiv.appendChild(authorSpan);

                li.appendChild(metaDiv);

                const revertBtn = document.createElement('button');
                revertBtn.className = 'action-btn outline revert-btn';
                revertBtn.dataset.value = entry.oldValue || '';
                revertBtn.title = 'Przywróć tę wartość';
                revertBtn.innerHTML = '<i class="fas fa-undo"></i> Przywróć'; // Icon is safe constant HTML
                li.appendChild(revertBtn);

                ul.appendChild(li);
            });
            modalBody.appendChild(ul);
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

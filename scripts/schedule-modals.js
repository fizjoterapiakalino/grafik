// scripts/schedule-modals.js
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';

export const ScheduleModals = (() => {
    const showDuplicateConfirmationDialog = (duplicateInfo, onMove, onAdd, onCancel) => {
        const modal = document.getElementById('duplicateModal');
        const modalText = document.getElementById('duplicateModalText');
        const moveBtn = document.getElementById('moveEntryBtn');
        const addBtn = document.getElementById('addAnywayBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        const employeeName = EmployeeManager.getNameById(duplicateInfo.employeeIndex);
        modalText.innerHTML = `Znaleziono identyczny wpis dla "<b>${employeeName}</b>" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`;
        modal.style.display = 'flex';

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
            if (onCancel) onCancel();
        };
    };

    const showNumericConfirmationDialog = (text, onConfirm, onCancel) => {
        const modal = document.getElementById('numericConfirmationModal');
        const modalText = document.getElementById('numericConfirmationModalText');
        const confirmBtn = document.getElementById('confirmNumericBtn');
        const cancelBtn = document.getElementById('cancelNumericBtn');

        modalText.innerHTML = `Czy na pewno chcesz wprowadzić do grafiku ciąg cyfr: "<b>${text}</b>"?`;
        modal.style.display = 'flex';

        const closeAndCleanup = () => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        confirmBtn.onclick = () => {
            closeAndCleanup();
            onConfirm();
        };
        cancelBtn.onclick = () => {
            closeAndCleanup();
            onCancel();
        };
    };

    const openPatientInfoModal = (element, cellState, updateCellStateCallback) => {
        const patientName = ScheduleUI.getElementText(element);
        if (!patientName) {
            window.showToast('Brak pacjenta w tej komórce.', 3000);
            return;
        }

        const modal = document.getElementById('patientInfoModal');
        const patientNameInput = document.getElementById('patientName');
        const startDateInput = document.getElementById('treatmentStartDate');
        const extensionDaysInput = document.getElementById('treatmentExtensionDays');
        const endDateInput = document.getElementById('treatmentEndDate');
        const saveModalBtn = document.getElementById('savePatientInfoModal');
        const closeModalBtn = document.getElementById('closePatientInfoModal');
        const additionalInfoTextarea = document.getElementById('additionalInfo');

        const parentCell = element.closest('td');

        const isSplitPart = element.tagName === 'DIV';
        const partIndex = isSplitPart ? (element === parentCell.querySelector('div:first-child') ? 1 : 2) : null;

        patientNameInput.value = patientName;

        const treatmentData = {
            startDate: cellState.treatmentStartDate,
            extensionDays: cellState.treatmentExtensionDays,
        };
        const currentAdditionalInfo = cellState.additionalInfo || '';

        startDateInput.value = treatmentData.startDate || '';
        extensionDaysInput.value = treatmentData.extensionDays || 0;
        additionalInfoTextarea.value = currentAdditionalInfo;

        const calculateEndDate = (startDate, extensionDays) => {
            if (!startDate) return '';
            let endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() - 1);
            let totalDays = 15 + parseInt(extensionDays || 0, 10);
            let daysAdded = 0;
            while (daysAdded < totalDays) {
                endDate.setDate(endDate.getDate() + 1);
                const dayOfWeek = endDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                    daysAdded++;
                }
            }
            return endDate.toISOString().split('T')[0];
        };

        const updateEndDate = () => {
            endDateInput.value = calculateEndDate(startDateInput.value, extensionDaysInput.value);
        };

        updateEndDate();

        const startDateChangeHandler = () => updateEndDate();
        const extensionInputHandler = () => updateEndDate();

        startDateInput.addEventListener('change', startDateChangeHandler);
        extensionDaysInput.addEventListener('input', extensionInputHandler);

        const closeModal = () => {
            startDateInput.removeEventListener('change', startDateChangeHandler);
            extensionDaysInput.removeEventListener('input', extensionInputHandler);
            modal.style.display = 'none';
        };

        saveModalBtn.onclick = () => {
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
        modal.onclick = (event) => {
            if (event.target === modal) {
                closeModal();
            }
        };
        modal.style.display = 'flex';
    };

    const showHistoryModal = (cell, cellState, updateCellStateCallback) => {
        const modal = document.getElementById('historyModal');
        const modalBody = document.getElementById('historyModalBody');
        const closeModalBtn = document.getElementById('closeHistoryModal');

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
                    .map(
                        (entry) => `
                        <li class="history-item">
                            <div class="history-value">${entry.oldValue || '(pusty)'}</div>
                            <div class="history-meta">
                                <span>${new Date(entry.timestamp).toLocaleString('pl-PL')}</span>
                                <span>przez: ${EmployeeManager.getEmployeeByUid(entry.userId)?.name || 'Nieznany'}</span>
                            </div>
                            <button class="action-btn revert-btn" data-value="${entry.oldValue}">Przywróć</button>
                        </li>
                    `,
                    )
                    .join('')}
                </ul>
            `;
        }

        modalBody.querySelectorAll('.revert-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const valueToRevert = btn.dataset.value;
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

        const closeModal = () => {
            modal.style.display = 'none';
            modal.onclick = null;
            closeModalBtn.onclick = null;
        };

        closeModalBtn.onclick = closeModal;
        modal.onclick = (event) => {
            if (event.target === modal) {
                closeModal();
            }
        };

        modal.style.display = 'flex';
    };

    const openEmployeeSelectionModal = () => {
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
window.ScheduleModals = ScheduleModals;

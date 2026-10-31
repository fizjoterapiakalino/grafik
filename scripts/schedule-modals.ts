// scripts/schedule-modals.ts
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleLogic } from './schedule-logic.js';
import { escapeHTML, formatLocalIsoDate } from './utils.js';
import { getTargetPart, getTodayDate } from './schedule-helpers.js';
import type { CellState, TreatmentData } from './types/index.js';

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
        onCancel?: () => void,
        onSharedPatient?: () => void
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
    openPatientAbsenceModal(
        element: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void;
    showHistoryModal(
        cell: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void;
}

/**
 * Moduł modali harmonogramu
 */
export const ScheduleModals: ScheduleModalsAPI = (() => {
    const showDuplicateConfirmationDialog = (
        duplicateInfo: DuplicateInfo,
        onMove: () => void,
        onAdd: () => void,
        onCancel?: () => void,
        onSharedPatient?: () => void
    ): void => {
        const modal = document.getElementById('duplicateModal');
        const modalText = document.getElementById('duplicateModalText');
        const moveBtn = document.getElementById('moveEntryBtn') as HTMLButtonElement | null;
        const addBtn = document.getElementById('addAnywayBtn') as HTMLButtonElement | null;
        const sharedBtn = document.getElementById('sharedPatientBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement | null;

        if (!modal || !modalText || !moveBtn || !addBtn || !cancelBtn) return;

        const employeeName = EmployeeManager.getNameById(duplicateInfo.employeeIndex);
        modalText.innerHTML = `Znaleziono identyczny wpis dla "<b>${employeeName}</b>" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`;
        modal.style.display = 'flex';

        const closeAndCleanup = (): void => {
            modal.style.display = 'none';
            moveBtn.onclick = null;
            addBtn.onclick = null;
            if (sharedBtn) sharedBtn.onclick = null;
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
        if (sharedBtn) {
            sharedBtn.onclick = (): void => {
                closeAndCleanup();
                if (onSharedPatient) onSharedPatient();
            };
        }
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

        const targetPart = cellState.isSplit ? (getTargetPart(element) ?? 1) : null;
        const partData = targetPart
            ? ((targetPart === 1 ? cellState.treatmentData1 : cellState.treatmentData2) as TreatmentData | undefined)
            : undefined;
        const treatmentData = targetPart
            ? {
                startDate: partData?.startDate,
                extensionDays: partData?.extensionDays,
            }
            : {
                startDate: cellState.treatmentStartDate,
                extensionDays: cellState.treatmentExtensionDays,
            };
        const currentAdditionalInfo = (targetPart ? partData?.additionalInfo : cellState.additionalInfo) || '';

        startDateInput.value = treatmentData.startDate || '';
        extensionDaysInput.value = String(treatmentData.extensionDays || 0);
        additionalInfoTextarea.value = currentAdditionalInfo;

        const updateEndDate = (): void => {
            const effectiveStart = startDateInput.value.trim() || getTodayDate();
            endDateInput.value = ScheduleLogic.calculateEndDate(effectiveStart, parseInt(extensionDaysInput.value || '0', 10));
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
            const effectiveStart = startDateInput.value.trim() || getTodayDate();
            const extDays = parseInt(extensionDaysInput.value || '0', 10);
            const endDate = ScheduleLogic.calculateEndDate(effectiveStart, extDays);
            const additionalInfo = additionalInfoTextarea.value;

            updateCellStateCallback((state) => {
                if (targetPart) {
                    const key = `treatmentData${targetPart}` as 'treatmentData1' | 'treatmentData2';
                    state[key] = {
                        startDate: effectiveStart,
                        extensionDays: extDays,
                        endDate,
                        additionalInfo,
                    };
                } else {
                    state.treatmentStartDate = effectiveStart;
                    state.treatmentExtensionDays = extDays;
                    state.treatmentEndDate = endDate;
                    state.additionalInfo = additionalInfo;
                }
            });
            window.showToast?.('Zapisano daty zabiegów i informacje o pacjencie.');
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

    const openPatientAbsenceModal = (
        element: HTMLElement,
        cellState: CellState,
        updateCellStateCallback: (updateFn: (state: CellState) => void) => void
    ): void => {
        const patientName = ScheduleUI.getElementText(element).trim();
        if (!patientName) {
            window.showToast?.('Brak pacjenta w tej komórce.', 3000);
            return;
        }

        const modal = document.getElementById('patientAbsenceModal');
        const subheadEl = document.getElementById('absencePatientSubhead');
        const prevMonthBtn = document.getElementById('absencePrevMonthBtn') as HTMLButtonElement | null;
        const nextMonthBtn = document.getElementById('absenceNextMonthBtn') as HTMLButtonElement | null;
        const monthYearLabel = document.getElementById('absenceMonthYearLabel');
        const calendarGrid = document.getElementById('absenceCalendarGrid');
        const selectedCountEl = document.getElementById('absenceSelectedCount');
        const clearAbsencesBtn = document.getElementById('clearAbsencesBtn') as HTMLButtonElement | null;
        const saveAbsenceModalBtn = document.getElementById('saveAbsenceModal') as HTMLButtonElement | null;
        const closeAbsenceModalBtn = document.getElementById('closeAbsenceModal') as HTMLButtonElement | null;

        if (
            !modal ||
            !subheadEl ||
            !prevMonthBtn ||
            !nextMonthBtn ||
            !monthYearLabel ||
            !calendarGrid ||
            !selectedCountEl ||
            !clearAbsencesBtn ||
            !saveAbsenceModalBtn ||
            !closeAbsenceModalBtn
        ) {
            console.error('Patient absence modal elements not found!');
            return;
        }

        const targetPart = cellState.isSplit ? (getTargetPart(element) ?? 1) : null;
        const partData = targetPart
            ? ((targetPart === 1 ? cellState.treatmentData1 : cellState.treatmentData2) as TreatmentData | undefined)
            : undefined;

        const initialAbsences: string[] = targetPart
            ? (partData?.absenceDates || (targetPart === 1 ? cellState.absenceDates1 : cellState.absenceDates2) || [])
            : (cellState.absenceDates || []);

        const selectedDates = new Set<string>(Array.isArray(initialAbsences) ? initialAbsences : []);

        const startDate = (targetPart ? partData?.startDate : cellState.treatmentStartDate) || '';
        const extDays = (targetPart ? partData?.extensionDays : cellState.treatmentExtensionDays) || 0;
        let endDate = (targetPart ? partData?.endDate : cellState.treatmentEndDate) || '';
        if (!endDate && startDate) {
            endDate = ScheduleLogic.calculateEndDate(startDate, extDays);
        }

        const formatDisplayDate = (isoStr?: string | null): string => {
            if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return '';
            const [y, m, d] = isoStr.split('-');
            return `${d}.${m}.${y}`;
        };

        const startDisp = formatDisplayDate(startDate);
        const endDisp = formatDisplayDate(endDate);
        const turnusText = startDisp && endDisp
            ? `Turnus: ${startDisp} - ${endDisp}`
            : (startDisp ? `Turnus od: ${startDisp}` : 'Brak danych turnusu');
        subheadEl.textContent = `Pacjent: ${patientName} | ${turnusText}`;

        const now = new Date();
        const todayIso = formatLocalIsoDate(now);

        let currentYear: number;
        let currentMonth: number;

        if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            const [sy, sm] = startDate.split('-').map(Number);
            currentYear = sy;
            currentMonth = sm - 1;
        } else if (selectedDates.size > 0) {
            const firstAbsence = Array.from(selectedDates).sort()[0];
            const [ay, am] = firstAbsence.split('-').map(Number);
            currentYear = ay;
            currentMonth = am - 1;
        } else {
            currentYear = now.getFullYear();
            currentMonth = now.getMonth();
        }

        const MONTH_NAMES = [
            'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
            'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
        ];
        const WEEKDAY_NAMES = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

        const updateSummary = (): void => {
            selectedCountEl.textContent = String(selectedDates.size);
        };

        const createDayButton = (
            dayNumber: number,
            dateStr: string,
            isOtherMonth: boolean,
            isWeekend: boolean
        ): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'absence-day-btn';
            btn.dataset.date = dateStr;

            if (isOtherMonth) btn.classList.add('other-month');
            if (isWeekend) btn.classList.add('is-weekend');

            const inTurnus = !!(startDate && endDate && dateStr >= startDate && dateStr <= endDate);
            if (inTurnus) btn.classList.add('in-turnus');

            if (dateStr === todayIso) btn.classList.add('is-today');

            const isAbsent = selectedDates.has(dateStr);
            if (isAbsent) btn.classList.add('is-absent');

            let contentHtml = `<span class="day-number">${dayNumber}</span>`;
            if (isAbsent) {
                contentHtml += `<span class="absence-day-warning" title="Nieobecność">⚠️</span>`;
            }
            btn.innerHTML = contentHtml;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selectedDates.has(dateStr)) {
                    selectedDates.delete(dateStr);
                } else {
                    selectedDates.add(dateStr);
                }
                updateSummary();
                renderCalendar();
            });

            return btn;
        };

        const renderCalendar = (): void => {
            monthYearLabel.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
            calendarGrid.innerHTML = '';

            WEEKDAY_NAMES.forEach((dayName) => {
                const header = document.createElement('div');
                header.className = 'absence-weekday';
                header.textContent = dayName;
                calendarGrid.appendChild(header);
            });

            const firstDay = new Date(currentYear, currentMonth, 1);
            const startingDay = (firstDay.getDay() + 6) % 7;
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

            for (let i = 0; i < startingDay; i++) {
                const dayNum = daysInPrevMonth - startingDay + 1 + i;
                const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
                const prevMonthIdx = currentMonth === 0 ? 11 : currentMonth - 1;
                const dateStr = `${prevMonthYear}-${String(prevMonthIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const dayOfWeek = i % 7;

                const btn = createDayButton(dayNum, dateStr, true, dayOfWeek === 5 || dayOfWeek === 6);
                calendarGrid.appendChild(btn);
            }

            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayOfWeek = (startingDay + day - 1) % 7;

                const btn = createDayButton(day, dateStr, false, dayOfWeek === 5 || dayOfWeek === 6);
                calendarGrid.appendChild(btn);
            }

            const totalFilled = startingDay + daysInMonth;
            const remainingDays = totalFilled % 7 === 0 ? 0 : 7 - (totalFilled % 7);
            for (let i = 1; i <= remainingDays; i++) {
                const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;
                const nextMonthIdx = currentMonth === 11 ? 0 : currentMonth + 1;
                const dateStr = `${nextMonthYear}-${String(nextMonthIdx + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                const dayOfWeek = (totalFilled + i - 1) % 7;

                const btn = createDayButton(i, dateStr, true, dayOfWeek === 5 || dayOfWeek === 6);
                calendarGrid.appendChild(btn);
            }
        };

        const handlePrevMonth = (): void => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar();
        };

        const handleNextMonth = (): void => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar();
        };

        prevMonthBtn.onclick = handlePrevMonth;
        nextMonthBtn.onclick = handleNextMonth;

        clearAbsencesBtn.onclick = (): void => {
            selectedDates.clear();
            updateSummary();
            renderCalendar();
        };

        const closeModal = (): void => {
            document.removeEventListener('keydown', keydownHandler);
            modal.removeEventListener('click', modalClickHandler);
            prevMonthBtn.onclick = null;
            nextMonthBtn.onclick = null;
            clearAbsencesBtn.onclick = null;
            saveAbsenceModalBtn.onclick = null;
            closeAbsenceModalBtn.onclick = null;
            modal.style.display = 'none';
        };

        const modalClickHandler = (event: MouseEvent): void => {
            if (event.target === modal) {
                closeModal();
            }
        };

        const keydownHandler = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
            } else if (e.key === 'Enter') {
                const activeEl = document.activeElement;
                if (
                    activeEl &&
                    (activeEl.classList.contains('absence-day-btn') ||
                        activeEl.id === 'absencePrevMonthBtn' ||
                        activeEl.id === 'absenceNextMonthBtn' ||
                        activeEl.id === 'clearAbsencesBtn' ||
                        activeEl.id === 'closeAbsenceModal')
                ) {
                    return;
                }
                e.preventDefault();
                saveAbsenceModalBtn.click();
            }
        };

        saveAbsenceModalBtn.onclick = (): void => {
            const sortedDates = Array.from(selectedDates).sort();
            updateCellStateCallback((state) => {
                if (targetPart) {
                    const key = `treatmentData${targetPart}` as 'treatmentData1' | 'treatmentData2';
                    if (!state[key]) {
                        state[key] = {};
                    }
                    (state[key] as TreatmentData).absenceDates = sortedDates;
                    const absenceKey = `absenceDates${targetPart}` as 'absenceDates1' | 'absenceDates2';
                    state[absenceKey] = sortedDates;
                } else {
                    state.absenceDates = sortedDates;
                }
            });
            window.showToast?.(
                sortedDates.length > 0
                    ? `Zapisano nieobecności pacjenta (${sortedDates.length} dni).`
                    : 'Wyczyszczono nieobecności pacjenta.'
            );
            closeModal();
        };

        closeAbsenceModalBtn.onclick = closeModal;
        document.addEventListener('keydown', keydownHandler);
        modal.addEventListener('click', modalClickHandler);

        updateSummary();
        renderCalendar();
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
                    .map((entry, idx) => {
                        const employeeName = EmployeeManager.getEmployeeByUid(entry.userId ?? '')?.name || 'Nieznany';
                        const safeValue = escapeHTML(entry.oldValue || '(pusty)');
                        const safeEmployee = escapeHTML(employeeName);
                        return `
                        <li class="history-item">
                            <div class="history-value">${safeValue}</div>
                            <div class="history-meta">
                                <span>${new Date(entry.timestamp).toLocaleString('pl-PL')}</span>
                                <span>przez: ${safeEmployee}</span>
                            </div>
                            <button class="action-btn outline revert-btn" data-history-index="${idx}" title="Przywróć tę wartość"><i class="fas fa-undo"></i> Przywróć</button>
                        </li>
                        `;
                    })
                    .join('')}
                </ul>
            `;
        }

        modalBody.querySelectorAll<HTMLButtonElement>('.revert-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const historyIdx = Number.parseInt(btn.dataset.historyIndex || '-1', 10);
                const historyEntry = historyIdx >= 0 ? cellState.history?.[historyIdx] : null;
                const valueToRevert = historyEntry ? (historyEntry.oldValue || '') : (btn.dataset.value || '');
                updateCellStateCallback((state) => {
                    if (valueToRevert.includes('/')) {
                        const parts = valueToRevert.split('/', 2);
                        state.isSplit = true;
                        state.content1 = parts[0];
                        state.content2 = parts[1];
                        delete state.patientId;
                        delete state.patientId1;
                        delete state.patientId2;
                        delete state.content;
                    } else {
                        delete state.isSplit;
                        delete state.content1;
                        delete state.content2;
                        delete state.patientId;
                        delete state.patientId1;
                        delete state.patientId2;
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

    return {
        showDuplicateConfirmationDialog,
        showNumericConfirmationDialog,
        openPatientInfoModal,
        openPatientAbsenceModal,
        showHistoryModal,
    };
})();

export const openPatientAbsenceModal = ScheduleModals.openPatientAbsenceModal;

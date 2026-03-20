// scripts/appointments.ts - Appointment Scheduler Module
import { db as dbRaw } from './firebase-config.js';
import { capitalizeFirstLetter, isHoliday } from './common.js';

interface DbWrapper {
    collection(name: string): {
        doc(id: string): {
            get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
            set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
            onSnapshot(
                callback: (snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }) => void,
                errorCallback?: (error: Error) => void
            ): () => void;
        };
    };
}

const db = dbRaw as unknown as DbWrapper;

interface AppointmentCell {
    patientName: string;
    startDate?: string;
    extensionDays?: number;
    endDate?: string;
    additionalInfo?: string;
}

type StationKey = 'station1' | 'station1b' | 'station2' | 'station2b';
type FilterMode = 'all' | 'active' | 'ending_today' | 'ending_tomorrow';

interface AppointmentData {
    [key: string]: {
        station1?: AppointmentCell;
        station1b?: AppointmentCell;
        station2?: AppointmentCell;
        station2b?: AppointmentCell;
    }
}

interface AppointmentsAPI {
    init(): void;
    destroy(): void;
}

export const Appointments: AppointmentsAPI = (() => {
    const SAVE_DEBOUNCE_MS = 450;
    const APPOINTMENTS_FEATURES = {
        treatmentBell: false,
        dateUnderPatientName: false,
        patientInfoModal: false
    } as const;

    let unsubscribe: (() => void) | null = null;
    let appointmentData: AppointmentData = {};
    let currentEditingCell: { time: string, station: StationKey } | null = null;
    let draggedData: { time: string, station: StationKey } | null = null;
    let pendingDeleteCell: { time: string, station: StationKey } | null = null;
    let listenersAbortController: AbortController | null = null;
    let saveDebounceTimers: Map<string, number> = new Map();
    let pendingCellUpdates: Map<string, AppointmentCell | null> = new Map();
    let isMoving: boolean = false; // Flag to prevent race conditions during move

    const init = async (): Promise<void> => {
        console.log('Appointments module initializing...');
        renderTable();
        subscribeToUpdates();
        setupEventListeners();
    };

    const destroy = (): void => {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        if (listenersAbortController) {
            listenersAbortController.abort();
            listenersAbortController = null;
        }
        saveDebounceTimers.forEach(timer => globalThis.clearTimeout(timer));
        saveDebounceTimers.clear();
        pendingCellUpdates.clear();
    };

    const calculateEndDate = (startDate: string | undefined, extensionDays?: number): string => {
        if (!startDate) return '';
        const endDate = new Date(startDate + 'T12:00:00Z');

        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const totalDays = 15 + Number.parseInt(String(extensionDays || 0), 10);
        let daysAdded = 0;
        while (daysAdded < totalDays) {
            endDate.setUTCDate(endDate.getUTCDate() + 1);
            const dayOfWeek = endDate.getUTCDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday(endDate)) {
                daysAdded++;
            }
        }
        return endDate.toISOString().split('T')[0];
    };

    const generateTimeSlots = (): string[] => {
        const slots: string[] = [];
        let curHour = 7;
        let curMin = 20;

        while (curHour < 17 || (curHour === 17 && curMin <= 40)) {
            const timeString = `${curHour.toString().padStart(2, '0')}:${curMin.toString().padStart(2, '0')}`;
            slots.push(timeString);

            curMin += 20;
            if (curMin >= 60) {
                curHour += 1;
                curMin = 0;
            }
        }
        return slots;
    };

    const getCellKey = (time: string, station: StationKey): string => `${time}__${station}`;



    const getCurrentFilterMode = (): FilterMode => {
        const filterEl = document.getElementById('appointmentsFilter') as HTMLSelectElement | null;
        const value = filterEl?.value as FilterMode | undefined;
        if (value === 'active' || value === 'ending_today' || value === 'ending_tomorrow') return value;
        return 'all';
    };

    const isCellMatchingFilter = (
        cell: AppointmentCell | undefined,
        mode: FilterMode,
        todayStr: string,
        tomorrowStr: string
    ): boolean => {
        if (mode === 'all') return true;
        if (!cell?.patientName) return false;

        const endDate = cell.endDate || '';
        if (mode === 'active') {
            return endDate === '' || endDate >= todayStr;
        }
        if (mode === 'ending_today') {
            return endDate === todayStr;
        }
        return endDate === tomorrowStr;
    };

    const applyRowFilterVisibility = (): void => {
        const mode = getCurrentFilterMode();
        const rows = document.querySelectorAll('#appointmentsTableBody tr[data-time]');

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        rows.forEach(row => {
            const htmlRow = row as HTMLElement;
            const time = htmlRow.dataset.time || '';
            const rowData = appointmentData[time] || {};
            const showRow =
                isCellMatchingFilter(rowData.station1, mode, todayStr, tomorrowStr) ||
                isCellMatchingFilter(rowData.station1b, mode, todayStr, tomorrowStr) ||
                isCellMatchingFilter(rowData.station2, mode, todayStr, tomorrowStr) ||
                isCellMatchingFilter(rowData.station2b, mode, todayStr, tomorrowStr);
            htmlRow.style.display = showRow ? '' : 'none';
        });
    };

    /* Tymczasowo wyłączone - funkcja nieużywana przy wyłączonym sprawdzaniu duplikatów
    const findPatientConflictStation = (time: string, station: StationKey, patientName: string): StationKey | null => {
        const normalized = normalizePatientName(patientName);
        if (!normalized) return null;

        const rowData = appointmentData[time];
        if (!rowData) return null;

        const stations: StationKey[] = ['station1', 'station1b', 'station2', 'station2b'];
        for (const s of stations) {
            if (s === station) continue;
            const otherName = normalizePatientName(rowData[s]?.patientName);
            if (otherName === normalized) return s;
        }
        return null;
    };
    */

    const buildUpdatedCellFromText = (time: string, station: StationKey, rawValue: string): AppointmentCell | null => {
        const currentCellData = appointmentData[time]?.[station] || { patientName: '' };
        const newName = capitalizeFirstLetter(rawValue.trim());

        if (!newName) return null;

        let newStartDate = currentCellData.startDate;
        if (!currentCellData.patientName && !newStartDate) {
            newStartDate = new Date().toISOString().split('T')[0];
        }

        return {
            ...currentCellData,
            patientName: newName,
            startDate: newStartDate,
            endDate: calculateEndDate(newStartDate, currentCellData.extensionDays)
        };
    };

    const scheduleCellSave = (time: string, station: StationKey, data: AppointmentCell | null): void => {
        const key = getCellKey(time, station);
        pendingCellUpdates.set(key, data);

        const existingTimer = saveDebounceTimers.get(key);
        if (existingTimer) {
            globalThis.clearTimeout(existingTimer);
        }

        const timer = globalThis.setTimeout(() => {
            void flushCellSave(time, station);
        }, SAVE_DEBOUNCE_MS) as unknown as number;
        saveDebounceTimers.set(key, timer);
    };

    const cancelPendingCellSave = (time: string, station: StationKey): void => {
        const key = getCellKey(time, station);
        const existingTimer = saveDebounceTimers.get(key);
        if (existingTimer) {
            globalThis.clearTimeout(existingTimer);
            saveDebounceTimers.delete(key);
        }
        pendingCellUpdates.delete(key);
    };

    const cleanupEmptyRow = (time: string): void => {
        const row = appointmentData[time];
        if (!row) return;
        if (!row.station1 && !row.station1b && !row.station2 && !row.station2b) {
            delete appointmentData[time];
        }
    };

    const compactAppointmentData = (): AppointmentData => {
        const compact: AppointmentData = {};
        for (const [time, row] of Object.entries(appointmentData)) {
            const hasAny = row.station1 || row.station1b || row.station2 || row.station2b;
            if (hasAny) {
                compact[time] = {
                    ...(row.station1 ? { station1: row.station1 } : {}),
                    ...(row.station1b ? { station1b: row.station1b } : {}),
                    ...(row.station2 ? { station2: row.station2 } : {}),
                    ...(row.station2b ? { station2b: row.station2b } : {}),
                };
            }
        }
        appointmentData = compact;
        return compact;
    };

    const flushCellSave = async (time: string, station: StationKey): Promise<void> => {
        const key = getCellKey(time, station);
        const existingTimer = saveDebounceTimers.get(key);
        if (existingTimer) {
            globalThis.clearTimeout(existingTimer);
            saveDebounceTimers.delete(key);
        }

        if (!pendingCellUpdates.has(key)) return;

        const data = pendingCellUpdates.get(key) ?? null;
        pendingCellUpdates.delete(key);
        await saveAppointment(time, station, data);
    };

    const renderTable = (): void => {
        const body = document.getElementById('appointmentsTableBody');
        if (!body) return;

        const timeSlots = generateTimeSlots();
        const stations: StationKey[] = ['station1', 'station1b', 'station2', 'station2b'];

        body.innerHTML = timeSlots.map(time => `
            <tr data-time="${time}">
                <td class="col-time">${time}</td>
                ${stations.map(station => `
                    <td class="cell-target" data-time="${time}" data-station="${station}">
                        <div class="editable-cell-container" draggable="true">
                            <span class="cell-text" contenteditable="true"></span>
                            <i class="fas fa-trash-alt appointment-delete-icon" style="display:none" title="Usuń pacjenta"></i>
                            <!-- <i class="fas fa-info-circle appointment-info-icon" style="display:none" title="Szczegóły pacjenta"></i> -->
                            <span class="cell-info-indicator"></span>
                        </div>
                    </td>
                `).join('')}
            </tr>
        `).join('');
    };

    const subscribeToUpdates = (): void => {
        const docRef = db.collection('appointments').doc('current');

        unsubscribe = docRef.onSnapshot(
            (snapshot) => {
                if (snapshot.exists) {
                    // Don't overwrite local state if we are in the middle of a move operation
                    if (isMoving) return;

                    const data = snapshot.data() as AppointmentData;
                    appointmentData = data || {};
                    updateUIContent();
                }
            },
            (error: Error) => {
                console.error('Error subscribing to appointments:', error);
            }
        );
    };
    const clearCellInfo = (deleteIcon: HTMLElement, infoEl: HTMLElement): void => {
        deleteIcon.style.display = 'none';
        infoEl.innerText = '';
        infoEl.className = 'cell-info-indicator';
    };

    const updateCellIndicator = (infoEl: HTMLElement, endDate: string): void => {
        infoEl.innerText = `Koniec: ${endDate}`;
        if (!APPOINTMENTS_FEATURES.treatmentBell) {
            infoEl.className = 'cell-info-indicator';
            return;
        }
        
        const todayStr = new Date().toISOString().split('T')[0];
        const isFinished = endDate <= todayStr;
        infoEl.className = `cell-info-indicator ${isFinished ? 'treatment-end-marker' : ''}`;
    };

    const updateUIContent = (): void => {
        const targets = document.querySelectorAll('.cell-target');

        targets.forEach(target => {
            const htmlTarget = target as HTMLElement;
            const time = htmlTarget.dataset.time || '';
            const station = htmlTarget.dataset.station as StationKey;

            const cellData = appointmentData[time]?.[station];
            const textEl = htmlTarget.querySelector('.cell-text') as HTMLElement;
            const deleteIcon = htmlTarget.querySelector('.appointment-delete-icon') as HTMLElement;
            const infoEl = htmlTarget.querySelector('.cell-info-indicator') as HTMLElement;

            if (textEl !== document.activeElement) {
                textEl.innerText = cellData?.patientName || '';
            }

            if (cellData?.patientName) {
                deleteIcon.style.display = 'block';
                if (APPOINTMENTS_FEATURES.dateUnderPatientName && cellData.endDate) {
                    updateCellIndicator(infoEl, cellData.endDate);
                } else {
                    infoEl.innerText = '';
                    infoEl.className = 'cell-info-indicator';
                }
            } else {
                clearCellInfo(deleteIcon, infoEl);
            }
        });

        applyRowFilterVisibility();
    };

    const openModal = (time: string, station: StationKey): void => {
        if (!APPOINTMENTS_FEATURES.patientInfoModal) return;

        currentEditingCell = { time, station };
        const cellData = appointmentData[time]?.[station] || { patientName: '' };

        const modal = document.getElementById('appointmentPatientInfoModal');
        const nameInput = document.getElementById('modalPatientName') as HTMLInputElement;
        const startInput = document.getElementById('appointmentStartDate') as HTMLInputElement;
        const extInput = document.getElementById('appointmentExtensionDays') as HTMLInputElement;
        const endInput = document.getElementById('appointmentEndDate') as HTMLInputElement;
        const infoInput = document.getElementById('appointmentAdditionalInfo') as HTMLTextAreaElement;

        if (!modal || !nameInput || !startInput || !extInput || !endInput || !infoInput) return;

        const today = new Date().toISOString().split('T')[0];
        nameInput.value = cellData.patientName;
        startInput.value = cellData.startDate || today;
        extInput.value = String(cellData.extensionDays || 0);
        infoInput.value = cellData.additionalInfo || '';

        nameInput.oninput = () => {
            nameInput.value = capitalizeFirstLetter(nameInput.value);
        };

        const updateEndDateDisplay = (): void => {
            endInput.value = calculateEndDate(startInput.value, Number.parseInt(extInput.value || '0', 10));
        };

        updateEndDateDisplay();

        startInput.onchange = updateEndDateDisplay;
        extInput.oninput = updateEndDateDisplay;

        modal.style.display = 'flex';
    };

    // Keeps the modal implementation available without triggering TS6133 or no-void.
    (globalThis as any)._openModal = openModal;

    const closeModal = (): void => {
        const modal = document.getElementById('appointmentPatientInfoModal');
        if (modal) modal.style.display = 'none';
        currentEditingCell = null;
    };

    const persistAllAppointments = async (): Promise<void> => {
        const docRef = db.collection('appointments').doc('current');
        const payload = compactAppointmentData();
        await docRef.set(payload);
    };

    const saveAppointment = async (time: string, station: StationKey, data: AppointmentCell | null): Promise<boolean> => {
        try {
            /* Tymczasowo wyłączone sprawdzanie duplikatów
            const conflictStation = data?.patientName ? findPatientConflictStation(time, station, data.patientName) : null;
            if (conflictStation) {
                window.showToast?.('Pacjent jest już wpisany w tym samym czasie na drugim stanowisku.', 3000);
                if (window.setSaveStatus) window.setSaveStatus('error');
                return false;
            }
            */

            if (!appointmentData[time]) appointmentData[time] = {};
            if (data) {
                appointmentData[time][station] = data;
            } else {
                delete appointmentData[time][station];
                cleanupEmptyRow(time);
            }
            updateUIContent();

            if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saving');
            await persistAllAppointments();

            if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saved');
            return true;
        } catch (err) {
            console.error('Error saving appointment:', err);
            if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('error');
            return false;
        }
    };

    const saveModalData = async (): Promise<void> => {
        if (!APPOINTMENTS_FEATURES.patientInfoModal) return;

        if (!currentEditingCell) return;

        const { time, station } = currentEditingCell;
        const nameInput = document.getElementById('modalPatientName') as HTMLInputElement;
        const startInput = document.getElementById('appointmentStartDate') as HTMLInputElement;
        const extInput = document.getElementById('appointmentExtensionDays') as HTMLInputElement;
        const infoInput = document.getElementById('appointmentAdditionalInfo') as HTMLTextAreaElement;

        const patientName = capitalizeFirstLetter(nameInput.value.trim());
        const startDate = startInput.value;
        const extensionDays = Number.parseInt(extInput.value || '0', 10);
        const additionalInfo = infoInput.value.trim();
        const endDate = calculateEndDate(startDate, extensionDays);

        if (!patientName) {
            await saveAppointment(time, station, null);
            closeModal();
            return;
        }

        const cellUpdate: AppointmentCell = {
            patientName,
            startDate,
            extensionDays,
            endDate,
            additionalInfo
        };

        const didSave = await saveAppointment(time, station, cellUpdate);
        if (didSave) {
            closeModal();
        }
    };

    const setupEventListeners = (): void => {
        const body = document.getElementById('appointmentsTableBody');
        if (!body) return;
        if (listenersAbortController) {
            listenersAbortController.abort();
        }
        listenersAbortController = new AbortController();
        const signal = listenersAbortController.signal;

        const setCursorToEnd = (element: HTMLElement) => {
            if (!element.innerText) return;
            const range = document.createRange();
            const selection = globalThis.getSelection();
            if (!selection) return;

            if (element.childNodes.length === 0) {
                element.appendChild(document.createTextNode(''));
            }

            const node = element.childNodes[0];
            const length = node.nodeValue ? node.nodeValue.length : 0;

            try {
                range.setStart(node, length);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (err) {
                // Fallback for edge cases
                console.warn('Set cursor failed', err);
            }
        };

        body.addEventListener('focusin', (e) => {
            const textEl = e.target as HTMLElement;
            if (!textEl.classList.contains('cell-text')) return;
            // Delay slightly to override default browser placement
            setTimeout(() => setCursorToEnd(textEl), 0);
        }, { signal });

        body.addEventListener('input', (e) => {
            const textEl = e.target as HTMLElement;
            if (!textEl.classList.contains('cell-text')) return;

            const target = textEl.closest<HTMLElement>('.cell-target');
            if (!target) return;
            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;

            const originalName = textEl.innerText;
            const capitalized = capitalizeFirstLetter(originalName);

            if (originalName !== capitalized) {
                textEl.innerText = capitalized;
                setCursorToEnd(textEl);
            }

            const updatedCell = buildUpdatedCellFromText(time, station, capitalized);
            scheduleCellSave(time, station, updatedCell);
        }, { signal });

        body.addEventListener('keydown', (e) => {
            const textEl = e.target as HTMLElement;
            if (!textEl.classList.contains('cell-text')) return;
            if (e.key !== 'Enter') return;

            e.preventDefault();
            const target = textEl.closest<HTMLElement>('.cell-target');
            if (!target) return;

            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;
            const updatedCell = buildUpdatedCellFromText(time, station, textEl.innerText);
            scheduleCellSave(time, station, updatedCell);
            void flushCellSave(time, station);
            textEl.blur();
        }, { signal });

        body.addEventListener('focusout', (e) => {
            const textEl = e.target as HTMLElement;
            if (!textEl.classList.contains('cell-text')) return;
            if (draggedData) return;
            const container = textEl.closest('.editable-cell-container') as HTMLElement | null;
            if (container?.classList.contains('is-dragging')) return;

            const target = textEl.closest<HTMLElement>('.cell-target');
            if (!target) return;

            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;
            const updatedCell = buildUpdatedCellFromText(time, station, textEl.innerText);
            scheduleCellSave(time, station, updatedCell);
            void flushCellSave(time, station);
        }, { signal });

        /* Czasowo wyłączone otwieranie modalu prawym przyciskiem
        body.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = (e.target as HTMLElement).closest('.cell-target') as HTMLElement | null;
            if (!target) return;

            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;
            openModal(time, station);
        }, { signal });
        */

        const handleDeleteIconClick = (deleteIcon: Element): void => {
            const target = deleteIcon.closest<HTMLElement>('.cell-target');
            if (!target) return;

            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;

            pendingDeleteCell = { time, station };
            const modal = document.getElementById('appointmentDeleteConfirmModal');
            if (!modal) return;

            modal.classList.add('is-popover');
            const modalContent = modal.querySelector<HTMLElement>('.modal-content');

            if (!modalContent) {
                modal.style.display = 'flex';
                return;
            }

            const rect = deleteIcon.getBoundingClientRect();
            const popoverWidth = 220;
            const popoverHeight = 100; // estimated

            let top = rect.bottom + globalThis.scrollY + 5;
            let left = rect.left + globalThis.scrollX - (popoverWidth / 2) + (rect.width / 2);

            if (left < 10) left = 10;
            if (left + popoverWidth > globalThis.innerWidth - 10) {
                left = globalThis.innerWidth - popoverWidth - 10;
            }
            if (top + popoverHeight > globalThis.innerHeight + globalThis.scrollY - 10) {
                top = rect.top + globalThis.scrollY - popoverHeight - 5;
            }

            modalContent.style.top = `${top}px`;
            modalContent.style.left = `${left}px`;
            modal.style.display = 'flex';
        };

        body.addEventListener('click', (e) => {
            const deleteIcon = (e.target as HTMLElement).closest('.appointment-delete-icon');
            if (deleteIcon) {
                handleDeleteIconClick(deleteIcon);
            }
        }, { signal });

        body.addEventListener('dragstart', (e) => {
            const container = (e.target as HTMLElement).closest<HTMLElement>('.editable-cell-container');
            if (!container) return;

            const target = container.closest<HTMLElement>('.cell-target');
            if (!target) return;

            const time = target.dataset.time || '';
            const station = target.dataset.station as StationKey;

            if (!appointmentData[time]?.[station]?.patientName) {
                e.preventDefault();
                return;
            }

            draggedData = { time, station };
            container.classList.add('is-dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
            }
        }, { signal });

        body.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = (e.target as HTMLElement).closest<HTMLElement>('.cell-target');
            if (target && e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
                target.classList.add('drag-over-target');
            }
        }, { signal });

        body.addEventListener('dragleave', (e) => {
            const target = (e.target as HTMLElement).closest<HTMLElement>('.cell-target');
            if (target) target.classList.remove('drag-over-target');
        }, { signal });

        body.addEventListener('drop', async (e) => {
            e.preventDefault();
            const dropTarget = (e.target as HTMLElement).closest<HTMLElement>('.cell-target');
            if (!dropTarget || !draggedData) return;

            dropTarget.classList.remove('drag-over-target');
            const targetTime = dropTarget.dataset.time || '';
            const targetStation = dropTarget.dataset.station as StationKey;

            if (targetTime === draggedData.time && targetStation === draggedData.station) return;

            const sourceTime = draggedData.time;
            const sourceStation = draggedData.station;
            const sourceData = appointmentData[sourceTime]?.[sourceStation];
            if (!sourceData) return;

            isMoving = true; // Lock onSnapshot updates

            const destinationData = appointmentData[targetTime]?.[targetStation];
            if (destinationData?.patientName) {
            if ((globalThis as any).showToast) (globalThis as any).showToast('To pole jest już zajęte. Najpierw je wyczyść.', 2500);
                return;
            }

            /* Tymczasowo wyłączone sprawdzanie duplikatów przy dropie
            const conflictStation = findPatientConflictStation(targetTime, targetStation, sourceData.patientName);
            if (conflictStation) {
                window.showToast?.('Pacjent jest już wpisany w tym samym czasie na drugim stanowisku.', 3000);
                return;
            }
            */

            if (!appointmentData[targetTime]) appointmentData[targetTime] = {};
            if (!appointmentData[sourceTime]) appointmentData[sourceTime] = {};

            // Cancel pending debounced saves that could restore stale values after move
            cancelPendingCellSave(sourceTime, sourceStation);
            cancelPendingCellSave(targetTime, targetStation);

            appointmentData[targetTime][targetStation] = { ...sourceData };

            const isCopying = e.ctrlKey;
            if (!isCopying) {
                delete appointmentData[sourceTime][sourceStation];
                cleanupEmptyRow(sourceTime);
            }
            updateUIContent();

            try {
                if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saving');
                await persistAllAppointments();
                if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saved');
                if ((globalThis as any).showToast) (globalThis as any).showToast(isCopying ? 'Skopiowano pacjenta' : 'Przeniesiono pacjenta');
            } catch (error) {
                console.error('Error moving appointment:', error);
                if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('error');
            } finally {
                isMoving = false; // Release lock
            }
        }, { signal });

        body.addEventListener('dragend', () => {
            document.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
            document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
            draggedData = null;
        }, { signal });

        const saveBtn = document.getElementById('savePatientInfoBtn');
        const closeBtn = document.getElementById('closePatientInfoBtn');
        const modal = document.getElementById('appointmentPatientInfoModal');
        const printBtn = document.getElementById('printAppointmentsBtn');
        const clearBtn = document.getElementById('clearAppointmentsBtn');
        const filterSelect = document.getElementById('appointmentsFilter') as HTMLSelectElement | null;

        if (APPOINTMENTS_FEATURES.patientInfoModal) {
            if (saveBtn) saveBtn.addEventListener('click', () => { void saveModalData(); }, { signal });
            if (closeBtn) closeBtn.addEventListener('click', closeModal, { signal });

            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) closeModal();
                }, { signal });
            }
        }

        if (printBtn) {
            printBtn.addEventListener('click', () => {
                if (typeof (globalThis as any).printAppointmentsToPdf === 'function') {
                    (globalThis as any).printAppointmentsToPdf(appointmentData);
                } else {
                    globalThis.print();
                }
            }, { signal });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (!confirm('Czy na pewno chcesz wyczyścić wszystkie wpisy w tabeli?')) return;

                try {
                    if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saving');
                    const docRef = db.collection('appointments').doc('current');
                    await docRef.set({});
                    appointmentData = {};
                    updateUIContent();
                    if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('saved');
                } catch (error) {
                    console.error('Error clearing appointments:', error);
                    if ((globalThis as any).setSaveStatus) (globalThis as any).setSaveStatus('error');
                }
            }, { signal });
        }

        if (filterSelect) {
            filterSelect.addEventListener('change', applyRowFilterVisibility, { signal });
        }

        // Delete Confirmation Modal Listeners
        const confirmDeleteBtn = document.getElementById('confirmDeleteAppointmentBtn');
        const cancelDeleteBtn = document.getElementById('cancelDeleteAppointmentBtn');
        const deleteModal = document.getElementById('appointmentDeleteConfirmModal');

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', async () => {
                if (pendingDeleteCell) {
                    const { time, station } = pendingDeleteCell;
                    cancelPendingCellSave(time, station);
                    await saveAppointment(time, station, null);
                }
                if (deleteModal) deleteModal.style.display = 'none';
                pendingDeleteCell = null;
            }, { signal });
        }

        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                if (deleteModal) deleteModal.style.display = 'none';
                pendingDeleteCell = null;
            }, { signal });
        }

        if (deleteModal) {
            deleteModal.addEventListener('click', (e) => {
                if (e.target === deleteModal) {
                    deleteModal.style.display = 'none';
                    pendingDeleteCell = null;
                }
            }, { signal });
        }
    };

    return {
        init,
        destroy
    };
})();

// Backward compatibility
declare global {
    interface Window {
        Appointments: AppointmentsAPI;
    }
}

(globalThis as unknown as { Appointments: AppointmentsAPI }).Appointments = Appointments;

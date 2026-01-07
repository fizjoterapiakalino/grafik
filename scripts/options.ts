// scripts/options.ts
import { debugLog } from './common.js';
import { db as dbRaw, auth as authRaw, FieldValue } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { BackupService } from './backup-service.js';
import type { FirestoreDbWrapper, FirebaseAuthWrapper } from './types/firebase';
import type { Employee } from './types';

const db = dbRaw as unknown as FirestoreDbWrapper;
const auth = authRaw as unknown as FirebaseAuthWrapper;

/**
 * Interfejs publicznego API Options
 */
interface OptionsAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Moduł opcji i zarządzania pracownikami
 */
export const Options: OptionsAPI = (() => {
    let loadingOverlay: HTMLElement | null;
    let employeeListContainer: HTMLElement | null;
    let employeeSearchInput: HTMLInputElement | null;
    let addEmployeeBtn: HTMLElement | null;
    let detailsPlaceholder: HTMLElement | null;
    let detailsEditForm: HTMLElement | null;
    let employeeFirstNameInput: HTMLInputElement | null;
    let employeeLastNameInput: HTMLInputElement | null;
    let employeeDisplayNameInput: HTMLInputElement | null;
    let employeeNumberInput: HTMLInputElement | null;
    let leaveEntitlementInput: HTMLInputElement | null;
    let saveEmployeeBtn: HTMLElement | null;
    let deleteEmployeeBtn: HTMLElement | null;
    let employeeUidInput: HTMLInputElement | null;
    let assignUidBtn: HTMLElement | null;
    let clearUidBtn: HTMLElement | null;
    let employeeIsHidden: HTMLInputElement | null;
    let employeeIsScheduleOnly: HTMLInputElement | null;

    let selectedEmployeeIndex: number | null = null;

    let createBackupBtn: HTMLElement | null;
    let restoreBackupBtn: HTMLElement | null;
    let lastBackupDateSpan: HTMLElement | null;

    const displayLastBackupDate = async (): Promise<void> => {
        try {
            const date = await BackupService.getLastBackupDate();
            if (lastBackupDateSpan) {
                lastBackupDateSpan.textContent = date ? date.toLocaleString('pl-PL') : 'Nigdy lub błąd';
            }
        } catch (error) {
            console.error('Błąd podczas pobierania daty kopii zapasowej:', error);
            if (lastBackupDateSpan) lastBackupDateSpan.textContent = 'Błąd odczytu';
        }
    };

    const showLoading = (show: boolean): void => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    const createBackup = async (): Promise<void> => {
        if (!confirm('Czy na pewno chcesz utworzyć nową kopię zapasową? Spowoduje to nadpisanie poprzedniej kopii.')) {
            return;
        }
        showLoading(true);
        try {
            await BackupService.performBackup(false);
            await displayLastBackupDate();
        } catch (error) {
            console.error('Błąd w options.createBackup', error);
        } finally {
            showLoading(false);
        }
    };

    const handleRestoreBackup = async (): Promise<void> => {
        try {
            const date = await BackupService.getLastBackupDate();
            if (!date) {
                window.showToast('Brak kopii zapasowej do przywrócenia.', 3000);
                return;
            }
        } catch {
            window.showToast('Błąd sprawdzania kopii.', 3000);
            return;
        }

        const modal = document.getElementById('restoreConfirmationModal');
        const confirmationInput = document.getElementById('restoreConfirmationInput') as HTMLInputElement | null;
        const confirmBtn = document.getElementById('confirmRestoreBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('cancelRestoreBtn');

        if (!modal || !confirmationInput || !confirmBtn || !cancelBtn) return;

        modal.style.display = 'flex';

        const onConfirm = async (): Promise<void> => {
            closeModal();
            showLoading(true);
            try {
                const backupData = await BackupService.restoreBackup();
                const scheduleDocWrapper = db.collection('schedules').doc('mainSchedule');
                const leavesDocWrapper = db.collection('leaves').doc('mainLeaves');

                const batch = db.batch();
                batch.set(scheduleDocWrapper, backupData.scheduleData || {});
                batch.set(leavesDocWrapper, backupData.leavesData || {});
                await batch.commit();

                window.showToast('Dane przywrócone pomyślnie! Odśwież stronę, aby zobaczyć zmiany.', 5000);
            } catch (error) {
                console.error('Błąd podczas przywracania danych:', error);
                window.showToast('Wystąpił błąd podczas przywracania danych.', 5000);
            } finally {
                showLoading(false);
            }
        };

        const onInput = (): void => {
            confirmBtn.disabled = confirmationInput.value.trim() !== 'PRZYWRÓĆ';
        };

        const closeModal = (): void => {
            modal.style.display = 'none';
            confirmationInput.value = '';
            confirmBtn.disabled = true;
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', closeModal);
            confirmationInput.removeEventListener('input', onInput);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', closeModal);
        confirmationInput.addEventListener('input', onInput);
    };

    const handleAssignUid = (): void => {
        const currentUser = auth.currentUser;
        if (currentUser && employeeUidInput) {
            const allEmployees = EmployeeManager.getAll();
            const existingEmployee = Object.values(allEmployees).find((emp) => emp.uid === currentUser.uid);
            if (existingEmployee && (existingEmployee as Employee & { id?: number }).id !== selectedEmployeeIndex) {
                window.showToast(`Ten użytkownik jest już przypisany do: ${existingEmployee.displayName}.`, 4000);
                return;
            }
            employeeUidInput.value = currentUser.uid;
        } else {
            window.showToast('Nie jesteś zalogowany.', 3000);
        }
    };

    const handleClearUid = (): void => {
        if (employeeUidInput) employeeUidInput.value = '';
    };

    const resetDetailsPanel = (): void => {
        selectedEmployeeIndex = null;
        if (detailsPlaceholder) detailsPlaceholder.style.display = 'flex';
        if (detailsEditForm) detailsEditForm.style.display = 'none';

        const activeItem = document.querySelector('.employee-list-item.active');
        if (activeItem) activeItem.classList.remove('active');
    };

    const renderEmployeeList = (): void => {
        const employees = EmployeeManager.getAll();
        if (!employeeListContainer) return;

        employeeListContainer.innerHTML = '';

        const employeeCount = Object.keys(employees).length;

        // Dodaj licznik pracowników
        const counterDiv = document.createElement('div');
        counterDiv.className = 'employee-counter';
        counterDiv.innerHTML = `Pracownicy: <strong>${employeeCount}</strong>`;
        employeeListContainer.appendChild(counterDiv);

        if (employeeCount === 0) {
            employeeListContainer.innerHTML += '<p class="empty-list-info">Brak pracowników. Dodaj pierwszego!</p>';
            return;
        }

        const sortedEmployees = Object.entries(employees)
            .map(([index, data]) => ({
                index: parseInt(index, 10),
                firstName: data.firstName,
                lastName: data.lastName,
                displayName: data.displayName || data.name,
                isAdmin: data.role === 'admin',
                isHidden: data.isHidden || false,
                isScheduleOnly: data.isScheduleOnly || false,
            }))
            .sort((a, b) => a.index - b.index);

        sortedEmployees.forEach(({ index, firstName, lastName, displayName, isAdmin, isHidden, isScheduleOnly }) => {
            const nameToDisplay = firstName && lastName ? `${firstName} ${lastName}` : displayName;
            if (!nameToDisplay) return;

            // Generuj inicjały
            const getInitials = (name: string): string => {
                const parts = name.trim().split(/\s+/);
                if (parts.length >= 2) {
                    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                }
                return name.substring(0, 2).toUpperCase();
            };

            const initials = getInitials(nameToDisplay);

            // Generuj badge'e statusu
            let badgesHtml = '';
            if (isAdmin || isHidden || isScheduleOnly) {
                badgesHtml = '<div class="employee-badges">';
                if (isAdmin) {
                    badgesHtml += '<span class="employee-badge admin" title="Administrator"><i class="fas fa-key"></i></span>';
                }
                if (isHidden) {
                    badgesHtml += '<span class="employee-badge hidden" title="Ukryty w grafiku"><i class="fas fa-eye-slash"></i></span>';
                }
                if (isScheduleOnly) {
                    badgesHtml += '<span class="employee-badge schedule-only" title="Tylko w grafiku"><i class="fas fa-running"></i></span>';
                }
                badgesHtml += '</div>';
            }

            const item = document.createElement('div');
            item.className = 'employee-list-item';
            item.dataset.employeeIndex = String(index);
            item.innerHTML = `
                <div class="employee-avatar">${initials}</div>
                <div class="employee-info">
                    <span class="employee-name">${nameToDisplay}</span>
                </div>
                ${badgesHtml}
            `;

            item.addEventListener('click', () => handleEmployeeSelect(index));
            employeeListContainer!.appendChild(item);
        });
    };

    const handleEmployeeSelect = (index: number): void => {
        selectedEmployeeIndex = index;
        const employee = EmployeeManager.getById(String(index));
        if (!employee) return;

        document.querySelectorAll('.employee-list-item').forEach((item) => {
            const el = item as HTMLElement;
            el.classList.toggle('active', el.dataset.employeeIndex === String(index));
        });

        if (detailsPlaceholder) detailsPlaceholder.style.display = 'none';
        if (detailsEditForm) detailsEditForm.style.display = 'block';
        if (employeeFirstNameInput) employeeFirstNameInput.value = employee.firstName || '';
        if (employeeLastNameInput) employeeLastNameInput.value = employee.lastName || '';
        if (employeeDisplayNameInput) employeeDisplayNameInput.value = employee.displayName || employee.name || '';
        if (employeeNumberInput) employeeNumberInput.value = (employee as Employee & { employeeNumber?: string }).employeeNumber || '';
        if (leaveEntitlementInput) leaveEntitlementInput.value = String(employee.leaveEntitlement || 26);

        const adminCheckbox = document.getElementById('employeeRoleAdmin') as HTMLInputElement | null;
        if (adminCheckbox) adminCheckbox.checked = employee.role === 'admin';
        if (employeeIsHidden) employeeIsHidden.checked = employee.isHidden || false;
        if (employeeIsScheduleOnly) employeeIsScheduleOnly.checked = employee.isScheduleOnly || false;
        if (employeeUidInput) employeeUidInput.value = employee.uid || '';
    };

    const filterEmployees = (): void => {
        if (!employeeSearchInput) return;
        const searchTerm = employeeSearchInput.value.toLowerCase();
        let visibleCount = 0;
        const totalCount = document.querySelectorAll('.employee-list-item').length;

        document.querySelectorAll('.employee-list-item').forEach((item) => {
            const el = item as HTMLElement;
            const name = el.querySelector('.employee-name')?.textContent?.toLowerCase() || '';
            const isVisible = name.includes(searchTerm);
            el.style.display = isVisible ? 'flex' : 'none';
            if (isVisible) visibleCount++;
        });

        // Aktualizuj licznik
        const counter = document.querySelector('.employee-counter');
        if (counter) {
            if (searchTerm) {
                counter.innerHTML = `Wyświetlono: <strong>${visibleCount}</strong> z ${totalCount}`;
            } else {
                counter.innerHTML = `Pracownicy: <strong>${totalCount}</strong>`;
            }
        }
    };

    const handleAddEmployee = async (): Promise<void> => {
        const displayName = prompt('Wpisz nazwę wyświetlaną nowego pracownika:');
        if (!displayName || displayName.trim() === '') {
            window.showToast('Anulowano. Nazwa wyświetlana nie może być pusta.', 3000);
            return;
        }
        const entitlement = parseInt(prompt('Podaj wymiar urlopu (np. 26):', '26') || '', 10);
        if (isNaN(entitlement)) {
            window.showToast('Anulowano. Wymiar urlopu musi być liczbą.', 3000);
            return;
        }

        showLoading(true);
        try {
            const allEmployees = EmployeeManager.getAll();
            const highestIndex = Object.keys(allEmployees).reduce(
                (max, index) => Math.max(max, parseInt(index, 10)),
                -1
            );
            const newIndex = highestIndex + 1;

            const newEmployee = {
                displayName: displayName.trim(),
                firstName: '',
                lastName: '',
                employeeNumber: '',
                leaveEntitlement: entitlement,
                carriedOverLeave: 0,
            };

            await db.collection('schedules').doc('mainSchedule').update({
                [`employees.${newIndex}`]: newEmployee,
            });

            await EmployeeManager.load();
            renderEmployeeList();
            window.showToast('Pracownik dodany pomyślnie!', 2000);
        } catch (error) {
            console.error('Błąd podczas dodawania pracownika:', error);
            window.showToast('Wystąpił błąd podczas dodawania pracownika. Spróbuj ponownie.', 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleSaveEmployee = async (): Promise<void> => {
        if (selectedEmployeeIndex === null) {
            window.showToast('Nie wybrano pracownika.', 3000);
            return;
        }

        const oldEmployee = EmployeeManager.getById(String(selectedEmployeeIndex));
        if (!oldEmployee) return;

        const newFirstName = employeeFirstNameInput?.value.trim() || '';
        const newLastName = employeeLastNameInput?.value.trim() || '';
        const newDisplayName = employeeDisplayNameInput?.value.trim() || '';
        const newEmployeeNumber = employeeNumberInput?.value.trim() || '';
        const newEntitlement = parseInt(leaveEntitlementInput?.value || '0', 10);

        const adminCheckbox = document.getElementById('employeeRoleAdmin') as HTMLInputElement | null;
        const isAdmin = adminCheckbox?.checked || false;
        const isHidden = employeeIsHidden?.checked || false;
        const newUid = employeeUidInput?.value.trim() || '';

        if (newDisplayName === '') {
            window.showToast('Nazwa wyświetlana nie może być pusta.', 3000);
            return;
        }
        if (isNaN(newEntitlement)) {
            window.showToast('Wartości urlopu muszą być poprawnymi liczbami.', 3000);
            return;
        }

        const updatedData: Partial<Employee> & { employeeNumber?: string } = {
            firstName: newFirstName,
            lastName: newLastName,
            displayName: newDisplayName,
            employeeNumber: newEmployeeNumber,
            leaveEntitlement: newEntitlement,
            role: isAdmin ? 'admin' : 'user',
            isHidden: isHidden,
            isScheduleOnly: employeeIsScheduleOnly?.checked || false,
            uid: newUid,
        };

        showLoading(true);
        try {
            await EmployeeManager.updateEmployee(String(selectedEmployeeIndex), updatedData);

            const oldNameKey = oldEmployee.displayName || oldEmployee.name;
            if (oldNameKey && oldNameKey !== newDisplayName) {
                const leavesRef = db.collection('leaves').doc('mainLeaves');
                const leavesDoc = await leavesRef.get();
                const leavesData = leavesDoc.data() as Record<string, unknown> | undefined;
                if (leavesDoc.exists && leavesData && leavesData[oldNameKey]) {
                    const employeeLeaveData = leavesData[oldNameKey];
                    delete leavesData[oldNameKey];
                    leavesData[newDisplayName] = employeeLeaveData;
                    await leavesRef.set(leavesData);
                }
            }

            await EmployeeManager.load();

            const listItem = employeeListContainer?.querySelector(
                `.employee-list-item[data-employee-index="${selectedEmployeeIndex}"]`
            );
            if (listItem) {
                const nameToDisplay = newFirstName && newLastName ? `${newFirstName} ${newLastName}` : newDisplayName;
                const span = listItem.querySelector('span');
                if (span) span.textContent = nameToDisplay;
            }
            window.showToast('Dane pracownika zaktualizowane.', 2000);
        } catch (error) {
            console.error('Błąd podczas zapisywania zmian pracownika:', error);
            window.showToast('Wystąpił błąd podczas zapisu. Spróbuj ponownie.', 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleDeleteEmployee = async (): Promise<void> => {
        if (selectedEmployeeIndex === null) return;

        const employee = EmployeeManager.getById(String(selectedEmployeeIndex));
        if (!employee) return;

        const modal = document.getElementById('deleteConfirmationModal');
        const employeeNameSpan = document.getElementById('employeeNameToDelete');
        const confirmationInput = document.getElementById('deleteConfirmationInput') as HTMLInputElement | null;
        const confirmBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('cancelDeleteBtn');

        if (!modal || !confirmationInput || !confirmBtn || !cancelBtn) return;

        if (employeeNameSpan) employeeNameSpan.textContent = employee.displayName || employee.name || '';
        modal.style.display = 'flex';

        const employeeName = employee.displayName || employee.name || '';

        const onConfirm = async (): Promise<void> => {
            closeModal();
            showLoading(true);
            try {
                await db.runTransaction(async (transaction) => {
                    const scheduleDocWrapper = db.collection('schedules').doc('mainSchedule');
                    const leavesDocWrapper = db.collection('leaves').doc('mainLeaves');
                    const scheduleDoc = await transaction.get(scheduleDocWrapper);
                    const leavesDoc = await transaction.get(leavesDocWrapper);

                    transaction.update(scheduleDocWrapper, {
                        [`employees.${selectedEmployeeIndex}`]: FieldValue.delete(),
                    });

                    const scheduleData = scheduleDoc.data() as Record<string, unknown> | undefined;
                    const scheduleCells = scheduleData?.scheduleCells as Record<string, Record<string, unknown>> | undefined;
                    if (scheduleCells) {
                        Object.keys(scheduleCells).forEach((time) => {
                            if (scheduleCells[time]?.[String(selectedEmployeeIndex)]) {
                                transaction.update(scheduleDocWrapper, {
                                    [`scheduleCells.${time}.${selectedEmployeeIndex}`]: FieldValue.delete(),
                                });
                            }
                        });
                    }

                    const leavesData = leavesDoc.data() as Record<string, unknown> | undefined;
                    if (leavesDoc.exists && leavesData && leavesData[employeeName]) {
                        transaction.update(leavesDocWrapper, { [employeeName]: FieldValue.delete() });
                    }
                });

                await EmployeeManager.load();
                renderEmployeeList();
                resetDetailsPanel();
                window.showToast('Pracownik usunięty pomyślnie.', 2000);
            } catch (error) {
                console.error('Błąd podczas usuwania pracownika:', error);
                window.showToast('Wystąpił błąd. Spróbuj ponownie.', 5000);
            } finally {
                showLoading(false);
            }
        };

        const onInput = (): void => {
            confirmBtn.disabled = confirmationInput.value.trim() !== employeeName;
        };

        const closeModal = (): void => {
            modal.style.display = 'none';
            confirmationInput.value = '';
            confirmBtn.disabled = true;
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', closeModal);
            confirmationInput.removeEventListener('input', onInput);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', closeModal);
        confirmationInput.addEventListener('input', onInput);
    };

    const init = async (): Promise<void> => {
        loadingOverlay = document.getElementById('loadingOverlay');
        employeeListContainer = document.getElementById('employeeListContainer');
        employeeSearchInput = document.getElementById('employeeSearchInput') as HTMLInputElement | null;
        addEmployeeBtn = document.getElementById('addEmployeeBtn');
        detailsPlaceholder = document.getElementById('detailsPlaceholder');
        detailsEditForm = document.getElementById('detailsEditForm');
        employeeFirstNameInput = document.getElementById('employeeFirstNameInput') as HTMLInputElement | null;
        employeeLastNameInput = document.getElementById('employeeLastNameInput') as HTMLInputElement | null;
        employeeDisplayNameInput = document.getElementById('employeeDisplayNameInput') as HTMLInputElement | null;
        employeeNumberInput = document.getElementById('employeeNumberInput') as HTMLInputElement | null;
        leaveEntitlementInput = document.getElementById('leaveEntitlementInput') as HTMLInputElement | null;
        saveEmployeeBtn = document.getElementById('saveEmployeeBtn');
        deleteEmployeeBtn = document.getElementById('deleteEmployeeBtn');
        employeeUidInput = document.getElementById('employeeUidInput') as HTMLInputElement | null;
        assignUidBtn = document.getElementById('assignUidBtn');
        clearUidBtn = document.getElementById('clearUidBtn');
        employeeIsHidden = document.getElementById('employeeIsHidden') as HTMLInputElement | null;
        employeeIsScheduleOnly = document.getElementById('employeeIsScheduleOnly') as HTMLInputElement | null;
        createBackupBtn = document.getElementById('createBackupBtn');
        restoreBackupBtn = document.getElementById('restoreBackupBtn');
        lastBackupDateSpan = document.getElementById('lastBackupDate');

        resetDetailsPanel();
        showLoading(true);
        try {
            await EmployeeManager.load();
            renderEmployeeList();
            await displayLastBackupDate();
        } catch (error) {
            console.error('Błąd inicjalizacji strony opcji:', error);
            window.showToast('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            showLoading(false);
        }

        employeeSearchInput?.addEventListener('input', filterEmployees);
        addEmployeeBtn?.addEventListener('click', handleAddEmployee);
        saveEmployeeBtn?.addEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn?.addEventListener('click', handleDeleteEmployee);
        assignUidBtn?.addEventListener('click', handleAssignUid);
        clearUidBtn?.addEventListener('click', handleClearUid);
        createBackupBtn?.addEventListener('click', createBackup);
        restoreBackupBtn?.addEventListener('click', handleRestoreBackup);
    };

    const destroy = (): void => {
        employeeSearchInput?.removeEventListener('input', filterEmployees);
        addEmployeeBtn?.removeEventListener('click', handleAddEmployee);
        saveEmployeeBtn?.removeEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn?.removeEventListener('click', handleDeleteEmployee);
        assignUidBtn?.removeEventListener('click', handleAssignUid);
        clearUidBtn?.removeEventListener('click', handleClearUid);
        createBackupBtn?.removeEventListener('click', createBackup);
        restoreBackupBtn?.removeEventListener('click', handleRestoreBackup);
        debugLog('Options module destroyed');
    };

    return { init, destroy };
})();

// Backward compatibility
declare global {
    interface Window {
        Options: OptionsAPI;
    }
}

window.Options = Options;

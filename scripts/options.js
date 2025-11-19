// scripts/options.js
import { db, auth } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';

export const Options = (() => {
    // --- SELEKTORY ELEMENTÓW DOM ---
    let loadingOverlay, employeeListContainer, employeeSearchInput, addEmployeeBtn,
        detailsPlaceholder, detailsEditForm, employeeFirstNameInput, employeeLastNameInput,
        employeeDisplayNameInput, employeeNumberInput, leaveEntitlementInput,
        carriedOverLeaveInput, saveEmployeeBtn, deleteEmployeeBtn, employeeUidInput,
        assignUidBtn, clearUidBtn, employeeIsHidden;

    // --- ZMIENNE STANU APLIKACJI ---
    let selectedEmployeeIndex = null;

    // --- NOWE SELEKTORY DLA KOPII ZAPASOWEJ ---
    let createBackupBtn, restoreBackupBtn, lastBackupDateSpan;

    // --- NOWE FUNKCJE DLA KOPII ZAPASOWEJ ---

    const getBackupDocRef = () => db.collection("backup").doc("latest");

    const displayLastBackupDate = async () => {
        try {
            const backupDoc = await getBackupDocRef().get();
            if (backupDoc.exists) {
                const backupData = backupDoc.data();
                if (backupData.backupDate) {
                    const date = backupData.backupDate.toDate();
                    lastBackupDateSpan.textContent = date.toLocaleString('pl-PL');
                } else {
                    lastBackupDateSpan.textContent = "Brak daty w kopii";
                }
            } else {
                lastBackupDateSpan.textContent = "Nigdy";
            }
        } catch (error) {
            console.error("Błąd podczas pobierania daty kopii zapasowej:", error);
            lastBackupDateSpan.textContent = "Błąd odczytu";
        }
    };

    const createBackup = async () => {
        if (!confirm("Czy na pewno chcesz utworzyć nową kopię zapasową? Spowoduje to nadpisanie poprzedniej kopii.")) {
            return;
        }
        showLoading(true);
        try {
            const scheduleRef = db.collection("schedules").doc("mainSchedule");
            const leavesRef = db.collection("leaves").doc("mainLeaves");

            const [scheduleDoc, leavesDoc] = await Promise.all([scheduleRef.get(), leavesRef.get()]);

            const backupData = {
                backupDate: new Date(),
                scheduleData: scheduleDoc.exists ? scheduleDoc.data() : {},
                leavesData: leavesDoc.exists ? leavesDoc.data() : {}
            };

            await getBackupDocRef().set(backupData);

            await displayLastBackupDate();
            window.showToast("Kopia zapasowa utworzona pomyślnie!", 3000);
        } catch (error) {
            console.error("Błąd podczas tworzenia kopii zapasowej:", error);
            window.showToast("Wystąpił błąd podczas tworzenia kopii zapasowej.", 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleRestoreBackup = async () => {
        const backupDoc = await getBackupDocRef().get();
        if (!backupDoc.exists) {
            window.showToast("Brak kopii zapasowej do przywrócenia.", 3000);
            return;
        }

        const modal = document.getElementById('restoreConfirmationModal');
        const confirmationInput = document.getElementById('restoreConfirmationInput');
        const confirmBtn = document.getElementById('confirmRestoreBtn');
        const cancelBtn = document.getElementById('cancelRestoreBtn');

        modal.style.display = 'flex';

        const onConfirm = async () => {
            closeModal();
            showLoading(true);
            try {
                const backupData = backupDoc.data();
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                const leavesRef = db.collection("leaves").doc("mainLeaves");

                const batch = db.batch();
                batch.set(scheduleRef, backupData.scheduleData || {});
                batch.set(leavesRef, backupData.leavesData || {});
                await batch.commit();

                window.showToast("Dane przywrócone pomyślnie! Odśwież stronę, aby zobaczyć zmiany.", 5000);
            } catch (error) {
                console.error("Błąd podczas przywracania danych:", error);
                window.showToast("Wystąpił błąd podczas przywracania danych.", 5000);
            } finally {
                showLoading(false);
            }
        };

        const onInput = () => {
            confirmBtn.disabled = confirmationInput.value.trim() !== "PRZYWRÓĆ";
        };

        const closeModal = () => {
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


    // --- NAZWANE FUNKCJE OBSŁUGI ZDARZEŃ ---
    const handleAssignUid = () => {
        const currentUser = auth.currentUser;
        if (currentUser) {
            // Sprawdź, czy ten UID nie jest już przypisany do innego pracownika
            const allEmployees = EmployeeManager.getAll();
            const existingEmployee = Object.values(allEmployees).find(emp => emp.uid === currentUser.uid);
            if (existingEmployee && existingEmployee.id !== selectedEmployeeIndex) {
                window.showToast(`Ten użytkownik jest już przypisany do: ${existingEmployee.displayName}.`, 4000);
                return;
            }
            employeeUidInput.value = currentUser.uid;
        } else {
            window.showToast("Nie jesteś zalogowany.", 3000);
        }
    };

    const handleClearUid = () => {
        employeeUidInput.value = '';
    };


    // --- FUNKCJE POMOCNICZE ---
    const showLoading = (show) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    const resetDetailsPanel = () => {
        selectedEmployeeIndex = null;
        detailsPlaceholder.style.display = 'flex';
        detailsEditForm.style.display = 'none';

        const activeItem = document.querySelector('.employee-list-item.active');
        if (activeItem) {
            activeItem.classList.remove('active');
        }
    };

    // --- RENDEROWANIE I OBSŁUGA LISTY PRACOWNIKÓW ---
    const renderEmployeeList = () => {
        const employees = EmployeeManager.getAll();
        employeeListContainer.innerHTML = '';
        if (Object.keys(employees).length === 0) {
            employeeListContainer.innerHTML = '<p class="empty-list-info">Brak pracowników. Dodaj pierwszego!</p>';
            return;
        }

        const sortedEmployees = Object.entries(employees)
            .map(([index, data]) => ({ index: parseInt(index, 10), firstName: data.firstName, lastName: data.lastName, displayName: data.displayName || data.name }))
            .sort((a, b) => a.index - b.index);

        sortedEmployees.forEach(({ index, firstName, lastName, displayName }) => {
            const nameToDisplay = (firstName && lastName) ? `${firstName} ${lastName}` : displayName;
            if (!nameToDisplay) return;

            const item = document.createElement('div');
            item.className = 'employee-list-item';
            item.dataset.employeeIndex = index;
            item.innerHTML = `<i class="fas fa-user"></i> <span>${nameToDisplay}</span>`;

            item.addEventListener('click', () => handleEmployeeSelect(index));
            employeeListContainer.appendChild(item);
        });
    };

    const handleEmployeeSelect = (index) => {
        selectedEmployeeIndex = index;
        const employee = EmployeeManager.getById(index);
        if (!employee) return;

        document.querySelectorAll('.employee-list-item').forEach(item => {
            item.classList.toggle('active', item.dataset.employeeIndex == index);
        });

        detailsPlaceholder.style.display = 'none';
        detailsEditForm.style.display = 'block';
        employeeFirstNameInput.value = employee.firstName || '';
        employeeLastNameInput.value = employee.lastName || '';
        employeeDisplayNameInput.value = employee.displayName || employee.name;
        employeeNumberInput.value = employee.employeeNumber || ''; // Nowe pole
        leaveEntitlementInput.value = employee.leaveEntitlement || 26;
        carriedOverLeaveInput.value = employee.carriedOverLeave || 0;
        document.getElementById('employeeRoleAdmin').checked = employee.role === 'admin';
        employeeIsHidden.checked = employee.isHidden || false;
        employeeUidInput.value = employee.uid || '';
    };

    const filterEmployees = () => {
        const searchTerm = employeeSearchInput.value.toLowerCase();
        document.querySelectorAll('.employee-list-item').forEach(item => {
            const name = item.querySelector('span').textContent.toLowerCase();
            item.style.display = name.includes(searchTerm) ? 'flex' : 'none';
        });
    };

    // --- LOGIKA INTERAKCJI Z FIREBASE ---
    const handleAddEmployee = async () => {
        // Zastąpione przez formularz, ale zostawiam logikę dodawania na razie
        const displayName = prompt("Wpisz nazwę wyświetlaną nowego pracownika:");
        if (!displayName || displayName.trim() === '') {
            window.showToast("Anulowano. Nazwa wyświetlana nie może być pusta.", 3000);
            return;
        }
        const entitlement = parseInt(prompt("Podaj wymiar urlopu (np. 26):", "26"), 10);
        if (isNaN(entitlement)) {
            window.showToast("Anulowano. Wymiar urlopu musi być liczbą.", 3000);
            return;
        }

        showLoading(true);
        try {
            const allEmployees = EmployeeManager.getAll();
            const highestIndex = Object.keys(allEmployees).reduce((max, index) => Math.max(max, parseInt(index, 10)), -1);
            const newIndex = highestIndex + 1;

            const newEmployee = {
                displayName: displayName.trim(),
                firstName: '',
                lastName: '',
                employeeNumber: '', // Domyślna wartość dla nowego pracownika
                leaveEntitlement: entitlement,
                carriedOverLeave: 0
            };

            await db.collection("schedules").doc("mainSchedule").update({
                [`employees.${newIndex}`]: newEmployee
            });

            await EmployeeManager.load();
            renderEmployeeList();
            window.showToast("Pracownik dodany pomyślnie!", 2000);
        } catch (error) {
            console.error("Błąd podczas dodawania pracownika:", error);
            window.showToast("Wystąpił błąd podczas dodawania pracownika. Spróbuj ponownie.", 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleSaveEmployee = async () => {
        if (selectedEmployeeIndex === null) {
            window.showToast("Nie wybrano pracownika.", 3000);
            return;
        }

        const oldEmployee = EmployeeManager.getById(selectedEmployeeIndex);
        const newFirstName = employeeFirstNameInput.value.trim();
        const newLastName = employeeLastNameInput.value.trim();
        const newDisplayName = employeeDisplayNameInput.value.trim();
        const newEmployeeNumber = employeeNumberInput.value.trim();
        const newEntitlement = parseInt(leaveEntitlementInput.value, 10);
        const newCarriedOver = parseInt(carriedOverLeaveInput.value, 10);
        const isAdmin = document.getElementById('employeeRoleAdmin').checked;
        const isHidden = employeeIsHidden.checked;
        const newUid = employeeUidInput.value.trim();

        if (newDisplayName === '') {
            window.showToast("Nazwa wyświetlana nie może być pusta.", 3000);
            return;
        }
        if (isNaN(newEntitlement) || isNaN(newCarriedOver)) {
            window.showToast("Wartości urlopu muszą być poprawnymi liczbami.", 3000);
            return;
        }

        const updatedData = {
            firstName: newFirstName,
            lastName: newLastName,
            displayName: newDisplayName,
            employeeNumber: newEmployeeNumber,
            leaveEntitlement: newEntitlement,
            carriedOverLeave: newCarriedOver,
            role: isAdmin ? 'admin' : 'user',
            isHidden: isHidden,
            uid: newUid
        };

        showLoading(true);
        try {
            // Użyj nowej, uproszczonej funkcji z EmployeeManager
            await EmployeeManager.updateEmployee(selectedEmployeeIndex, updatedData);

            // Logika migracji nazwy w urlopach (jeśli konieczna)
            const oldNameKey = oldEmployee.displayName || oldEmployee.name;
            if (oldNameKey !== newDisplayName) {
                // Ta logika powinna być idealnie częścią transakcji,
                // ale dla uproszczenia zostawiamy ją jako osobne wywołanie.
                // W przyszłości można to zintegrować w EmployeeManager.
                const leavesRef = db.collection("leaves").doc("mainLeaves");
                const leavesDoc = await leavesRef.get();
                if (leavesDoc.exists && leavesDoc.data()[oldNameKey]) {
                    const leavesData = leavesDoc.data();
                    const employeeLeaveData = leavesData[oldNameKey];
                    delete leavesData[oldNameKey];
                    leavesData[newDisplayName] = employeeLeaveData;
                    await leavesRef.set(leavesData);
                }
            }

            await EmployeeManager.load(); // Przeładuj dane, aby mieć pewność, że EmployeeManager ma aktualne dane

            // Zamiast przebudowywać całą listę, zaktualizuj tylko zmieniony element
            const listItem = employeeListContainer.querySelector(`.employee-list-item[data-employee-index="${selectedEmployeeIndex}"]`);
            if (listItem) {
                const nameToDisplay = (newFirstName && newLastName) ? `${newFirstName} ${newLastName}` : newDisplayName;
                listItem.querySelector('span').textContent = nameToDisplay;
            }
            window.showToast("Dane pracownika zaktualizowane.", 2000);
            // Nie ma potrzeby wywoływać handleEmployeeSelect, bo formularz już ma nowe dane

        } catch (error) {
            console.error("Błąd podczas zapisywania zmian pracownika:", error);
            window.showToast("Wystąpił błąd podczas zapisu. Spróbuj ponownie.", 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleDeleteEmployee = async () => {
        if (selectedEmployeeIndex === null) return;

        const employee = EmployeeManager.getById(selectedEmployeeIndex);
        const modal = document.getElementById('deleteConfirmationModal');
        const employeeNameSpan = document.getElementById('employeeNameToDelete');
        const confirmationInput = document.getElementById('deleteConfirmationInput');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');

        employeeNameSpan.textContent = employee.displayName || employee.name;
        modal.style.display = 'flex';

        const employeeName = employee.displayName || employee.name;

        const onConfirm = async () => {
            closeModal();
            showLoading(true);
            try {
                const FieldValue = firebase.firestore.FieldValue;
                await db.runTransaction(async (transaction) => {
                    const scheduleRef = db.collection("schedules").doc("mainSchedule");
                    const leavesRef = db.collection("leaves").doc("mainLeaves");
                    const scheduleDoc = await transaction.get(scheduleRef);
                    const leavesDoc = await transaction.get(leavesRef);

                    transaction.update(scheduleRef, { [`employees.${selectedEmployeeIndex}`]: FieldValue.delete() });
                    const scheduleData = scheduleDoc.data();
                    if (scheduleData && scheduleData.scheduleCells) {
                        Object.keys(scheduleData.scheduleCells).forEach(time => {
                            if (scheduleData.scheduleCells[time]?.[selectedEmployeeIndex]) {
                                transaction.update(scheduleRef, { [`scheduleCells.${time}.${selectedEmployeeIndex}`]: FieldValue.delete() });
                            }
                        });
                    }
                    if (leavesDoc.exists && leavesDoc.data()[employeeName]) {
                        transaction.update(leavesRef, { [employeeName]: FieldValue.delete() });
                    }
                });

                await EmployeeManager.load(); // Wymuś ponowne załadowanie danych
                renderEmployeeList();
                resetDetailsPanel();
                window.showToast("Pracownik usunięty pomyślnie.", 2000);
            } catch (error) {
                console.error("Błąd podczas usuwania pracownika:", error);
                window.showToast("Wystąpił błąd. Spróbuj ponownie.", 5000);
            } finally {
                showLoading(false);
            }
        };

        const onInput = () => {
            confirmBtn.disabled = confirmationInput.value.trim() !== employeeName;
        };

        const closeModal = () => {
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

    // --- INICJALIZACJA I NASŁUCHIWANIE ZDARZEŃ ---
    const init = async () => {
        // Query for elements only when the page is initialized
        loadingOverlay = document.getElementById('loadingOverlay');
        employeeListContainer = document.getElementById('employeeListContainer');
        employeeSearchInput = document.getElementById('employeeSearchInput');
        addEmployeeBtn = document.getElementById('addEmployeeBtn');
        detailsPlaceholder = document.getElementById('detailsPlaceholder');
        detailsEditForm = document.getElementById('detailsEditForm');
        employeeFirstNameInput = document.getElementById('employeeFirstNameInput');
        employeeLastNameInput = document.getElementById('employeeLastNameInput');
        employeeDisplayNameInput = document.getElementById('employeeDisplayNameInput');
        employeeNumberInput = document.getElementById('employeeNumberInput'); // Nowe pole
        leaveEntitlementInput = document.getElementById('leaveEntitlementInput');
        carriedOverLeaveInput = document.getElementById('carriedOverLeaveInput');
        saveEmployeeBtn = document.getElementById('saveEmployeeBtn');
        deleteEmployeeBtn = document.getElementById('deleteEmployeeBtn');
        employeeUidInput = document.getElementById('employeeUidInput');
        assignUidBtn = document.getElementById('assignUidBtn');
        clearUidBtn = document.getElementById('clearUidBtn');
        employeeIsHidden = document.getElementById('employeeIsHidden');
        // Nowe elementy dla kopii zapasowej
        createBackupBtn = document.getElementById('createBackupBtn');
        restoreBackupBtn = document.getElementById('restoreBackupBtn');
        lastBackupDateSpan = document.getElementById('lastBackupDate');

        resetDetailsPanel();
        showLoading(true);
        try {
            await EmployeeManager.load();
            renderEmployeeList();
            await displayLastBackupDate(); // Wyświetl datę kopii
        } catch (error) {
            console.error("Błąd inicjalizacji strony opcji:", error);
            window.showToast("Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.", 5000);
        } finally {
            showLoading(false);
        }

        // Attach event listeners
        employeeSearchInput.addEventListener('input', filterEmployees);
        addEmployeeBtn.addEventListener('click', handleAddEmployee);
        saveEmployeeBtn.addEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn.addEventListener('click', handleDeleteEmployee);
        assignUidBtn.addEventListener('click', handleAssignUid);
        clearUidBtn.addEventListener('click', handleClearUid);
        // Nowe listenery dla kopii zapasowej
        createBackupBtn.addEventListener('click', createBackup);
        restoreBackupBtn.addEventListener('click', handleRestoreBackup);
    };

    const destroy = () => {
        employeeSearchInput.removeEventListener('input', filterEmployees);
        addEmployeeBtn.removeEventListener('click', handleAddEmployee);
        saveEmployeeBtn.removeEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn.removeEventListener('click', handleDeleteEmployee);
        assignUidBtn.removeEventListener('click', handleAssignUid);
        clearUidBtn.removeEventListener('click', handleClearUid);
        // Usuń nowe listenery
        createBackupBtn.removeEventListener('click', createBackup);
        restoreBackupBtn.removeEventListener('click', handleRestoreBackup);
        console.log("Options module destroyed");
    };

    return {
        init,
        destroy
    };
})();

// Backward compatibility
window.Options = Options;
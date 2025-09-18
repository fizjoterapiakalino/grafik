const Options = (() => {
    // --- SELEKTORY ELEMENTÓW DOM ---
    let loadingOverlay, employeeListContainer, employeeSearchInput, addEmployeeBtn,
        detailsPlaceholder, detailsEditForm, employeeFirstNameInput, employeeLastNameInput,
        employeeDisplayNameInput, employeeNumberInput, leaveEntitlementInput,
        carriedOverLeaveInput, saveEmployeeBtn, deleteEmployeeBtn;

    // --- ZMIENNE STANU APLIKACJI ---
    let selectedEmployeeIndex = null;

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
        const newEmployeeNumber = employeeNumberInput.value.trim(); // Nowe pole
        const newEntitlement = parseInt(leaveEntitlementInput.value, 10);
        const newCarriedOver = parseInt(carriedOverLeaveInput.value, 10);

        if (newDisplayName === '') {
            window.showToast("Nazwa wyświetlana nie może być pusta.", 3000);
            return;
        }
        if (isNaN(newEntitlement) || isNaN(newCarriedOver)) {
            window.showToast("Wartości urlopu muszą być poprawnymi liczbami.", 3000);
            return;
        }

        const updatedEmployee = {
            firstName: newFirstName,
            lastName: newLastName,
            displayName: newDisplayName,
            employeeNumber: newEmployeeNumber, // Nowe pole
            leaveEntitlement: newEntitlement,
            carriedOverLeave: newCarriedOver
        };

        showLoading(true);
        try {
            await db.runTransaction(async (transaction) => {
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                const leavesRef = db.collection("leaves").doc("mainLeaves"); // Deklaracja leavesRef
                const leavesDoc = await transaction.get(leavesRef); // Odczyt przed zapisem
                
                transaction.update(scheduleRef, {
                    [`employees.${selectedEmployeeIndex}`]: updatedEmployee
                });

                // Jeśli nazwa się zmieniła, zaktualizuj klucze w urlopach
                // Logika migracji nazwy w urlopach
                const oldNameKey = oldEmployee.displayName || oldEmployee.name;
                if (oldNameKey !== newDisplayName) {
                    if (leavesDoc.exists && leavesDoc.data()[oldNameKey]) {
                        const leavesData = leavesDoc.data();
                        const employeeLeaveData = leavesData[oldNameKey];
                        delete leavesData[oldNameKey];
                        leavesData[newDisplayName] = employeeLeaveData;
                        transaction.set(leavesRef, leavesData);
                    }
                }
            });

            await EmployeeManager.load();
            renderEmployeeList();
            handleEmployeeSelect(selectedEmployeeIndex);
            window.showToast("Dane pracownika zaktualizowane.", 2000);

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

        resetDetailsPanel();
        showLoading(true);
        try {
            await EmployeeManager.load();
            renderEmployeeList();
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
    };

    const destroy = () => {
        employeeSearchInput.removeEventListener('input', filterEmployees);
        addEmployeeBtn.removeEventListener('click', handleAddEmployee);
        saveEmployeeBtn.removeEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn.removeEventListener('click', handleDeleteEmployee);
        console.log("Options module destroyed");
    };

    return {
        init,
        destroy
    };
})();

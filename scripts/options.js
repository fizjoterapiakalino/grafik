const Options = (() => {
    // --- SELEKTORY ELEMENTÓW DOM ---
    let loadingOverlay, employeeListContainer, employeeSearchInput, addEmployeeBtn,
        detailsPlaceholder, detailsEditForm, employeeNameInput, leaveEntitlementInput,
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
            .map(([index, data]) => ({ index: parseInt(index, 10), name: data.name }))
            .sort((a, b) => a.index - b.index);

        sortedEmployees.forEach(({ index, name }) => {
            if (!name) return;

            const item = document.createElement('div');
            item.className = 'employee-list-item';
            item.dataset.employeeIndex = index;
            item.innerHTML = `<i class="fas fa-user"></i> <span>${name}</span>`;

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
        employeeNameInput.value = employee.name;
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
        const name = prompt("Wpisz imię i nazwisko nowego pracownika:");
        if (!name || name.trim() === '') {
            window.showToast("Anulowano. Nazwa nie może być pusta.", 3000);
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
                name: name.trim(),
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
        const newName = employeeNameInput.value.trim();
        const newEntitlement = parseInt(leaveEntitlementInput.value, 10);
        const newCarriedOver = parseInt(carriedOverLeaveInput.value, 10);

        if (newName === '') {
            window.showToast("Nazwa pracownika nie może być pusta.", 3000);
            return;
        }
        if (isNaN(newEntitlement) || isNaN(newCarriedOver)) {
            window.showToast("Wartości urlopu muszą być poprawnymi liczbami.", 3000);
            return;
        }

        const updatedEmployee = {
            name: newName,
            leaveEntitlement: newEntitlement,
            carriedOverLeave: newCarriedOver
        };

        showLoading(true);
        try {
            await db.runTransaction(async (transaction) => {
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                
                transaction.update(scheduleRef, {
                    [`employees.${selectedEmployeeIndex}`]: updatedEmployee
                });

                // Jeśli nazwa się zmieniła, zaktualizuj klucze w urlopach
                if (oldEmployee.name !== newName) {
                    const leavesRef = db.collection("leaves").doc("mainLeaves");
                    const leavesDoc = await transaction.get(leavesRef);
                    if (leavesDoc.exists && leavesDoc.data()[oldEmployee.name]) {
                        const leavesData = leavesDoc.data();
                        const employeeLeaveData = leavesData[oldEmployee.name];
                        delete leavesData[oldEmployee.name];
                        leavesData[newName] = employeeLeaveData;
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
        if (selectedEmployeeIndex === null) {
            window.showToast("Nie wybrano pracownika.", 3000);
            return;
        }
        
        const employee = EmployeeManager.getById(selectedEmployeeIndex);
        const confirmation = confirm(`Czy na pewno chcesz usunąć pracownika "${employee.name}"?\n\nUWAGA: Ta operacja usunie również wszystkie powiązane z nim dane w grafiku i urlopach. Zmiany są nieodwracalne!`);

        if (!confirmation) return;

        showLoading(true);
        try {
            // Używamy firebase.firestore.FieldValue.delete() do usunięcia pola z obiektu
            const FieldValue = firebase.firestore.FieldValue;

            await db.runTransaction(async (transaction) => {
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                const leavesRef = db.collection("leaves").doc("mainLeaves");

                // --- FAZA ODCZYTU ---
                // Najpierw odczytujemy wszystkie potrzebne dokumenty.
                const scheduleDoc = await transaction.get(scheduleRef);
                const leavesDoc = await transaction.get(leavesRef);

                // --- FAZA ZAPISU ---
                // Teraz, gdy mamy dane, wykonujemy wszystkie operacje zapisu.

                // 1. Usuń pracownika z obiektu 'employees'
                transaction.update(scheduleRef, {
                    [`employees.${selectedEmployeeIndex}`]: FieldValue.delete()
                });

                // 2. Wyczyść dane tego pracownika z grafiku
                const scheduleData = scheduleDoc.data();
                if (scheduleData && scheduleData.scheduleCells) {
                    Object.keys(scheduleData.scheduleCells).forEach(time => {
                        if (scheduleData.scheduleCells[time]?.[selectedEmployeeIndex]) {
                            transaction.update(scheduleRef, {
                                [`scheduleCells.${time}.${selectedEmployeeIndex}`]: FieldValue.delete()
                            });
                        }
                    });
                }

                // 3. Usuń dane z urlopów
                if (leavesDoc.exists && leavesDoc.data()[employee.name]) {
                    transaction.update(leavesRef, {
                        [employee.name]: FieldValue.delete()
                    });
                }
            });

            await EmployeeManager.load();
            renderEmployeeList();
            resetDetailsPanel();
            window.showToast("Pracownik usunięty pomyślnie.", 2000);

        } catch (error) {
            console.error("Błąd podczas usuwania pracownika:", error);
            window.showToast("Wystąpił błąd podczas usuwania pracownika. Spróbuj ponownie.", 5000);
        } finally {
            showLoading(false);
        }
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
        employeeNameInput = document.getElementById('employeeNameInput');
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

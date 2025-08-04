document.addEventListener('DOMContentLoaded', () => {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const newEmployeeNameInput = document.getElementById('newEmployeeName');
    const addEmployeeBtn = document.getElementById('addEmployeeBtn');
    const employeeList = document.getElementById('employeeList');
    const employeeDetailsContainer = document.getElementById('employeeDetailsContainer');

    if (!firebase || !firebase.firestore) {
        console.error("Firebase lub Firestore nie jest załadowany!");
        showToast('Błąd krytyczny: Nie można połączyć się z bazą danych.', 'error');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        return;
    }
    const db = firebase.firestore();
    const scheduleRef = db.collection("schedules").doc("mainSchedule");

    let employees = [];
    let selectedEmployeeId = null;

    // Prosta funkcja do generowania unikalnego ID
    const generateUUID = () => `emp_${new Date().getTime()}_${Math.random().toString(36).substr(2, 9)}`;

    // --- RENDEROWANIE ---
    function renderEmployeeList() {
        employeeList.innerHTML = '';
        const sortedEmployees = [...employees].sort((a, b) => a.name.localeCompare(b.name));

        if (sortedEmployees.length === 0) {
            employeeDetailsContainer.innerHTML = '<p>Brak pracowników. Dodaj nowego, aby rozpocząć.</p>';
        }

        sortedEmployees.forEach(emp => {
            const listItem = document.createElement('li');
            listItem.dataset.id = emp.id;
            listItem.innerHTML = `<i class="fas fa-user"></i><span>${emp.name}</span>`;
            if (emp.id === selectedEmployeeId) {
                listItem.classList.add('active');
            }
            employeeList.appendChild(listItem);
        });
    }

    function renderEmployeeDetails() {
        const employee = employees.find(emp => emp.id === selectedEmployeeId);
        if (!employee) {
            employeeDetailsContainer.innerHTML = '<p>Wybierz pracownika z listy, aby zobaczyć szczegóły i opcje edycji.</p>';
            return;
        }

        employeeDetailsContainer.innerHTML = `
            <h3>Edytuj dane pracownika</h3>
            <div class="edit-employee-form">
                <input type="text" id="editEmployeeName" value="${employee.name}">
                <div class="form-actions">
                    <button id="saveEmployeeBtn" class="btn btn-primary" data-id="${employee.id}">Zapisz zmiany</button>
                    <button id="deleteEmployeeBtn" class="btn btn-danger" data-id="${employee.id}">Usuń pracownika</button>
                </div>
            </div>
        `;
    }

    function render() {
        renderEmployeeList();
        renderEmployeeDetails();
    }

    // --- LOGIKA FIREBASE ---
    async function addEmployee() {
        const employeeName = newEmployeeNameInput.value.trim();
        if (!employeeName) {
            showToast('Proszę wpisać imię i nazwisko pracownika.', 'error');
            return;
        }

        const newEmployee = {
            id: generateUUID(),
            name: employeeName
        };

        try {
            await scheduleRef.update({
                employees: firebase.firestore.FieldValue.arrayUnion(newEmployee)
            });
            newEmployeeNameInput.value = '';
            selectedEmployeeId = newEmployee.id; // Automatycznie wybierz nowego pracownika
            showToast('Pracownik dodany pomyślnie!', 'success');
        } catch (error) {
            console.error("Błąd podczas dodawania pracownika: ", error);
            showToast('Błąd serwera podczas dodawania pracownika.', 'error');
        }
    }

    async function editEmployee(id, newName) {
        const updatedName = newName.trim();
        if (!updatedName) {
            showToast('Imię i nazwisko nie może być puste.', 'error');
            return;
        }

        const employeeToUpdate = employees.find(emp => emp.id === id);
        if (!employeeToUpdate || updatedName === employeeToUpdate.name) return;

        const updatedEmployee = { ...employeeToUpdate, name: updatedName };

        try {
            // Użyj transakcji do bezpiecznej aktualizacji tablicy
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(scheduleRef);
                if (!doc.exists) throw "Dokument nie istnieje!";
                
                const currentEmployees = doc.data().employees || [];
                const newEmployees = currentEmployees.map(emp => emp.id === id ? updatedEmployee : emp);
                
                transaction.update(scheduleRef, { employees: newEmployees });
            });
            showToast('Dane pracownika zaktualizowane!', 'success');
        } catch (error) {
            console.error("Błąd podczas edytowania pracownika: ", error);
            showToast('Błąd serwera podczas aktualizacji danych.', 'error');
        }
    }

    async function deleteEmployee(id) {
        const employeeToDelete = employees.find(emp => emp.id === id);
        if (!employeeToDelete) return;

        // Użyj niestandardowego modala zamiast confirm()
        showConfirmDeleteModal(employeeToDelete, async () => {
            try {
                await scheduleRef.update({
                    employees: firebase.firestore.FieldValue.arrayRemove(employeeToDelete)
                });
                showToast('Pracownik usunięty!', 'success');
            } catch (error) {
                console.error("Błąd podczas usuwania pracownika: ", error);
                showToast('Błąd serwera podczas usuwania pracownika.', 'error');
            }
        });
    }

    // --- SŁUCHACZ CZASU RZECZYWISTEGO ---
    function setupRealtimeListener() {
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');

        scheduleRef.onSnapshot(doc => {
            if (doc.exists) {
                // Sprawdź, czy istnieje pole 'employees' i czy jest tablicą
                const data = doc.data();
                if (data && Array.isArray(data.employees)) {
                    employees = data.employees;
                } else {
                    // Jeśli pole 'employees' nie istnieje lub nie jest tablicą, zainicjuj je
                    // To również obsłuży migrację ze starej struktury `employeeHeaders`
                    console.warn("Pole 'employees' nie jest tablicą lub nie istnieje. Inicjalizacja.");
                    employees = [];
                    // Opcjonalnie: można dodać logikę migracji z `employeeHeaders`
                }

                // Utrzymaj zaznaczenie, jeśli to możliwe
                const selectedExists = employees.some(emp => emp.id === selectedEmployeeId);
                if (!selectedExists) {
                    selectedEmployeeId = employees.length > 0 ? [...employees].sort((a, b) => a.name.localeCompare(b.name))[0].id : null;
                }
                
                render();
            } else {
                console.error("Nie znaleziono dokumentu mainSchedule!");
                showToast('Błąd: Nie można wczytać danych harmonogramu.', 'error');
                employees = [];
                selectedEmployeeId = null;
                render();
            }

            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
                setTimeout(() => {
                    if (loadingOverlay.parentNode) loadingOverlay.parentNode.removeChild(loadingOverlay);
                }, 300);
            }
        }, error => {
            console.error("Błąd nasłuchiwania zmian: ", error);
            showToast('Błąd połączenia z bazą danych. Spróbuj odświeżyć stronę.', 'error');
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
        });
    }

    // --- EVENT LISTENERS ---
    if (addEmployeeBtn) {
        addEmployeeBtn.addEventListener('click', addEmployee);
    }

    employeeList.addEventListener('click', (event) => {
        const listItem = event.target.closest('li');
        if (listItem && listItem.dataset.id) {
            selectedEmployeeId = listItem.dataset.id;
            render();
        }
    });

    employeeDetailsContainer.addEventListener('click', (event) => {
        const target = event.target;
        const id = target.dataset.id;
        if (!id) return;

        if (target.id === 'saveEmployeeBtn') {
            const newNameInput = document.getElementById('editEmployeeName');
            editEmployee(id, newNameInput.value);
        } else if (target.id === 'deleteEmployeeBtn') {
            deleteEmployee(id);
        }
    });

    // --- LOGIKA MODALA ---
    const confirmDeleteModal = document.getElementById('confirmDeleteModal');
    const confirmDeleteText = document.getElementById('confirmDeleteText');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const closeModalBtn = confirmDeleteModal.querySelector('.close-button');

    let deleteCallback = null;

    function showConfirmDeleteModal(employee, callback) {
        confirmDeleteText.textContent = `Czy na pewno chcesz usunąć pracownika "${employee.name}"? Tej operacji nie można cofnąć.`;
        deleteCallback = callback;
        confirmDeleteModal.style.display = 'flex';
    }

    function hideConfirmDeleteModal() {
        confirmDeleteModal.style.display = 'none';
        deleteCallback = null;
    }

    confirmDeleteBtn.addEventListener('click', () => {
        if (deleteCallback) {
            deleteCallback();
        }
        hideConfirmDeleteModal();
    });

    cancelDeleteBtn.addEventListener('click', hideConfirmDeleteModal);
    closeModalBtn.addEventListener('click', hideConfirmDeleteModal);
    window.addEventListener('click', (event) => {
        if (event.target === confirmDeleteModal) {
            hideConfirmDeleteModal();
        }
    });


    // Inicjalizacja
    setupRealtimeListener();
});

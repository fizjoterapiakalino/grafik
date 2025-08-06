document.addEventListener('DOMContentLoaded', () => {
    // --- SELEKTORY ELEMENTÓW DOM ---
    const loadingOverlay = document.getElementById('loadingOverlay');
    const employeeListContainer = document.getElementById('employeeListContainer');
    const employeeSearchInput = document.getElementById('employeeSearchInput');
    const addEmployeeBtn = document.getElementById('addEmployeeBtn');
    
    const detailsPlaceholder = document.getElementById('detailsPlaceholder');
    const detailsEditForm = document.getElementById('detailsEditForm');
    const employeeNameInput = document.getElementById('employeeNameInput');
    const saveEmployeeBtn = document.getElementById('saveEmployeeBtn');
    const deleteEmployeeBtn = document.getElementById('deleteEmployeeBtn');

    // --- ZMIENNE STANU APLIKACJI ---
    let allEmployees = {}; // Przechowuje obiekt { index: name }
    let selectedEmployee = null; // Przechowuje { index, name } aktywnego pracownika

    // --- FUNKCJE POMOCNICZE ---
    const showLoading = (show) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    const resetDetailsPanel = () => {
        selectedEmployee = null;
        detailsPlaceholder.style.display = 'flex';
        detailsEditForm.style.display = 'none';
        
        // Usuń podświetlenie z listy
        const activeItem = document.querySelector('.employee-list-item.active');
        if (activeItem) {
            activeItem.classList.remove('active');
        }
    };

    // --- RENDEROWANIE I OBSŁUGA LISTY PRACOWNIKÓW ---
    const renderEmployeeList = () => {
        employeeListContainer.innerHTML = '';
        if (Object.keys(allEmployees).length === 0) {
            employeeListContainer.innerHTML = '<p class="empty-list-info">Brak pracowników. Dodaj pierwszego!</p>';
            return;
        }

        // Sortowanie pracowników po indeksie dla spójnej kolejności
        const sortedEmployees = Object.entries(allEmployees)
            .map(([index, name]) => ({ index: parseInt(index, 10), name }))
            .sort((a, b) => a.index - b.index);

        sortedEmployees.forEach(({ index, name }) => {
            if (!name) return; // Nie wyświetlaj "usuniętych" pracowników

            const item = document.createElement('div');
            item.className = 'employee-list-item';
            item.dataset.employeeIndex = index;
            item.innerHTML = `<i class="fas fa-user"></i> <span>${name}</span>`;

            item.addEventListener('click', () => handleEmployeeSelect({ index, name }));
            employeeListContainer.appendChild(item);
        });
    };

    const handleEmployeeSelect = ({ index, name }) => {
        selectedEmployee = { index, name };

        // Podświetl aktywny element na liście
        document.querySelectorAll('.employee-list-item').forEach(item => {
            item.classList.toggle('active', item.dataset.employeeIndex == index);
        });

        // Wyświetl panel edycji
        detailsPlaceholder.style.display = 'none';
        detailsEditForm.style.display = 'block';
        employeeNameInput.value = name;
    };
    
    const filterEmployees = () => {
        const searchTerm = employeeSearchInput.value.toLowerCase();
        document.querySelectorAll('.employee-list-item').forEach(item => {
            const name = item.querySelector('span').textContent.toLowerCase();
            item.style.display = name.includes(searchTerm) ? 'flex' : 'none';
        });
    };

    // --- LOGIKA INTERAKCJI Z FIREBASE ---
    const fetchEmployees = async () => {
        showLoading(true);
        try {
            const docRef = db.collection("schedules").doc("mainSchedule");
            const doc = await docRef.get();
            if (doc.exists && doc.data().employeeHeaders) {
                allEmployees = doc.data().employeeHeaders;
            } else {
                allEmployees = {};
            }
            renderEmployeeList();
        } catch (error) {
            console.error("Błąd podczas wczytywania pracowników:", error);
            window.showToast("Błąd wczytywania pracowników!", 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleAddEmployee = async () => {
        const name = prompt("Wpisz imię i nazwisko nowego pracownika:");
        if (!name || name.trim() === '') {
            window.showToast("Anulowano. Nazwa nie może być pusta.", 3000);
            return;
        }

        showLoading(true);
        try {
            // Znajdź najwyższy istniejący indeks, aby dodać nowego na końcu
            const highestIndex = Object.keys(allEmployees).reduce((max, index) => Math.max(max, parseInt(index, 10)), -1);
            const newIndex = highestIndex + 1;

            const updatedHeaders = { ...allEmployees, [newIndex]: name.trim() };

            await db.collection("schedules").doc("mainSchedule").update({
                employeeHeaders: updatedHeaders
            });

            allEmployees = updatedHeaders;
            renderEmployeeList();
            window.showToast("Pracownik dodany pomyślnie!", 2000);
        } catch (error) {
            console.error("Błąd podczas dodawania pracownika:", error);
            window.showToast("Wystąpił błąd przy dodawaniu.", 5000);
        } finally {
            showLoading(false);
        }
    };

    const handleSaveEmployee = async () => {
        if (!selectedEmployee) {
            window.showToast("Nie wybrano pracownika.", 3000);
            return;
        }

        const newName = employeeNameInput.value.trim();
        if (newName === '' || newName === selectedEmployee.name) {
            window.showToast("Nazwa jest pusta lub nie została zmieniona.", 3000);
            return;
        }

        showLoading(true);
        const oldName = selectedEmployee.name;
        const employeeIndex = selectedEmployee.index;

        try {
            // Transakcja, aby zapewnić spójność danych
            await db.runTransaction(async (transaction) => {
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                const leavesRef = db.collection("leaves").doc("mainLeaves");

                // --- FAZA ODCZYTU ---
                // Najpierw wykonujemy wszystkie operacje odczytu
                const leavesDoc = await transaction.get(leavesRef);
                
                // --- FAZA ZAPISU ---
                // Teraz wykonujemy wszystkie operacje zapisu
                
                // 1. Zaktualizuj nagłówek w grafiku
                transaction.update(scheduleRef, {
                    [`employeeHeaders.${employeeIndex}`]: newName
                });

                // 2. Zaktualizuj dane w urlopach (zmiana nazwy klucza)
                if (leavesDoc.exists && leavesDoc.data().leavesData?.[oldName]) {
                    const leavesData = leavesDoc.data().leavesData;
                    const employeeLeaveData = leavesData[oldName];
                    delete leavesData[oldName];
                    leavesData[newName] = employeeLeaveData;
                    transaction.update(leavesRef, { leavesData });
                }
            });

            // Zaktualizuj stan lokalny i UI
            allEmployees[employeeIndex] = newName;
            renderEmployeeList();
            handleEmployeeSelect({ index: employeeIndex, name: newName }); // Odśwież panel edycji
            window.showToast("Dane pracownika zaktualizowane.", 2000);

        } catch (error) {
            console.error("Błąd podczas zapisywania zmian:", error);
            window.showToast("Wystąpił błąd przy zapisie.", 5000);
        } finally {
            showLoading(false);
        }
    };
    
    const handleDeleteEmployee = async () => {
        if (!selectedEmployee) {
            window.showToast("Nie wybrano pracownika.", 3000);
            return;
        }

        const confirmation = confirm(`Czy na pewno chcesz usunąć pracownika "${selectedEmployee.name}"?\n\nUWAGA: Ta operacja usunie również wszystkie powiązane z nim dane w grafiku i urlopach. Zmiany są nieodwracalne!`);

        if (!confirmation) return;

        showLoading(true);
        const { index: employeeIndex, name: employeeName } = selectedEmployee;

        try {
            await db.runTransaction(async (transaction) => {
                const scheduleRef = db.collection("schedules").doc("mainSchedule");
                const leavesRef = db.collection("leaves").doc("mainLeaves");

                // --- FAZA ODCZYTU ---
                // Najpierw wykonujemy wszystkie operacje odczytu
                const scheduleDoc = await transaction.get(scheduleRef);
                const leavesDoc = await transaction.get(leavesRef);
                
                // --- FAZA ZAPISU ---
                // Teraz wykonujemy wszystkie operacje zapisu
                const scheduleData = scheduleDoc.data();

                // 1. Usuń pracownika z nagłówków (ustaw na null dla zachowania indeksów)
                scheduleData.employeeHeaders[employeeIndex] = null; 

                // 2. Wyczyść dane tego pracownika z grafiku
                if (scheduleData.scheduleCells) {
                    Object.keys(scheduleData.scheduleCells).forEach(time => {
                        if (scheduleData.scheduleCells[time]?.[employeeIndex]) {
                            delete scheduleData.scheduleCells[time][employeeIndex];
                        }
                    });
                }
                
                transaction.set(scheduleRef, scheduleData); // Użyj set, aby nadpisać całość

                // 3. Usuń dane z urlopów
                if (leavesDoc.exists && leavesDoc.data().leavesData?.[employeeName]) {
                    const leavesData = leavesDoc.data().leavesData;
                    delete leavesData[employeeName];
                    transaction.update(leavesRef, { leavesData });
                }
            });

            // Zaktualizuj stan lokalny i UI
            delete allEmployees[employeeIndex];
            renderEmployeeList();
            resetDetailsPanel();
            window.showToast("Pracownik usunięty pomyślnie.", 2000);

        } catch (error) {
            console.error("Błąd podczas usuwania pracownika:", error);
            window.showToast("Wystąpił błąd podczas usuwania.", 5000);
        } finally {
            showLoading(false);
        }
    };

    // --- INICJALIZACJA I NASŁUCHIWANIE ZDARZEŃ ---
    const initializePage = () => {
        resetDetailsPanel();
        fetchEmployees();

        // Event Listeners
        employeeSearchInput.addEventListener('input', filterEmployees);
        addEmployeeBtn.addEventListener('click', handleAddEmployee);
        saveEmployeeBtn.addEventListener('click', handleSaveEmployee);
        deleteEmployeeBtn.addEventListener('click', handleDeleteEmployee);
    };

    initializePage();
});

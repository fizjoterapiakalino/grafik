// scripts/employee-manager.js

const EmployeeManager = (() => {
    let _employees = {}; // Prywatna zmienna na dane pracowników

    // Prywatna funkcja do pobierania danych z Firestore
    const _fetchFromDB = async () => {
        try {
            const docRef = db.collection("schedules").doc("mainSchedule");
            const doc = await docRef.get();
            if (doc.exists && doc.data().employees) {
                _employees = doc.data().employees;
            } else {
                 // Logika na wypadek, gdyby struktura 'employees' nie istniała
                _employees = {};
                console.warn("Brak obiektu 'employees' w Firestore. Inicjalizacja pustego stanu.");
            }
        } catch (error) {
            console.error("Błąd krytyczny podczas pobierania danych pracowników z Firestore:", error);
            window.showToast("Wystąpił błąd podczas pobierania listy pracowników. Spróbuj odświeżyć stronę.", 5000);
            _employees = {}; // W razie błędu zwróć pusty obiekt, aby aplikacja mogła działać w ograniczonym zakresie
        }
    };

    let _isLoaded = false; // Flaga do śledzenia stanu załadowania

    // Publiczne API modułu
    return {
        // Inicjalizuje moduł, pobierając dane (tylko raz)
        load: async function() {
            if (_isLoaded) return; // Nie ładuj ponownie, jeśli dane już są
            await _fetchFromDB();
            _isLoaded = true;
        },
        // Zwraca wszystkich pracowników
        getAll: () => _employees,
        // Zwraca konkretnego pracownika po jego indeksie/kluczu
        getById: (id) => _employees[id] || null,
        // Zwraca tylko imię i nazwisko pracownika
        getNameById: (id) => _employees[id]?.displayName || _employees[id]?.name || `Pracownik ${id}`,
        getFullNameById: (id) => {
            const employee = _employees[id];
            if (!employee) return `Nieznany Pracownik ${id}`;
            const firstName = employee.firstName || '';
            const lastName = employee.lastName || '';
            const fullName = `${firstName} ${lastName}`.trim();
            return fullName === '' ? (employee.displayName || `Pracownik ${id}`) : fullName;
        },
        getLastNameById: (id) => {
            const employee = _employees[id];
            if (!employee) return `Nieznany ${id}`;
            return employee.lastName || '';
        },
        // Zwraca informacje urlopowe
        getLeaveInfoById: (id) => ({
            entitlement: _employees[id]?.leaveEntitlement || 0,
            carriedOver: _employees[id]?.carriedOverLeave || 0
        }),
        // Zwraca pracownika i jego indeks na podstawie UID
        getEmployeeByUid: (uid) => {
            if (!uid) return null;
            for (const id in _employees) {
                if (_employees[id].uid === uid) {
                    return { id, ..._employees[id] };
                }
            }
            return null;
        }
    };
})();

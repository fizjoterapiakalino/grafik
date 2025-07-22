document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableHead = mainScheduleTable.querySelector('thead tr');
    const tableBody = mainScheduleTable.querySelector('tbody');

    // --- Funkcje pomocnicze ---
    function toggleLoading(show) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    // --- Logika logowania ---
    firebase.auth().onAuthStateChanged(user => {
        // Przeładuj harmonogram, przekazując, czy użytkownik jest zalogowany
        loadSchedule(!!user);
    });

    // --- Główna funkcja renderująca tabelę ---
    function renderTable(scheduleData, isUserLoggedIn) {
        // 1. Czyszczenie starej tabeli
        tableHead.innerHTML = '<th>Godzina</th>'; // Reset nagłówka
        tableBody.innerHTML = '';

        // 2. Sprawdzenie, czy mamy jakiekolwiek dane do wyświetlenia
        const firstRow = scheduleData.length > 0 ? scheduleData[0] : null;
        if (!firstRow || !firstRow.slots) {
            const msg = isUserLoggedIn ? "Brak danych w bazie. Użyj pliku init-db.html, aby wygenerować siatkę." : "Brak danych do wyświetlenia.";
            tableHead.innerHTML += `<th>${msg}</th>`;
            return;
        }
        
        // 3. Dynamiczne tworzenie nagłówków z nazwami terapeutów
        const therapists = Object.keys(firstRow.slots).sort(); 
        therapists.forEach(therapist => {
            const th = document.createElement('th');
            th.textContent = therapist;
            tableHead.appendChild(th);
        });

        // 4. Renderowanie wierszy z danymi
        scheduleData.forEach(rowData => {
            // Upewnij się, że ten konkretny wiersz ma poprawną strukturę
            if (!rowData.slots) return;

            const row = document.createElement('tr');
            row.dataset.time = rowData.time;

            // Komórka z godziną
            const timeCell = document.createElement('td');
            timeCell.textContent = rowData.time;
            timeCell.classList.add('time-cell');
            row.appendChild(timeCell);

            // Komórki dla każdego terapeuty
            therapists.forEach(therapist => {
                const cell = document.createElement('td');
                const slotData = rowData.slots[therapist] || { text: '', type: 'normal' };
                
                cell.textContent = slotData.text;
                // Tutaj można będzie dodać logikę do stylowania (np. przerw)
                cell.className = `slot-cell type-${slotData.type}`;
                cell.dataset.therapist = therapist;

                // Edycja możliwa tylko dla zalogowanych użytkowników
                if (isUserLoggedIn) {
                    cell.contentEditable = true;
                    cell.addEventListener('blur', (e) => {
                        handleCellUpdate(rowData.time, therapist, e.target.textContent);
                    });
                }
                row.appendChild(cell);
            });
            tableBody.appendChild(row);
        });
    }

    // --- Komunikacja z Firestore ---
    function loadSchedule(isUserLoggedIn) {
        toggleLoading(true);
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            // Pobierz dane i odfiltruj te, które nie mają poprawnej struktury 'slots'
            const scheduleData = snapshot.docs
                .map(doc => doc.data())
                .filter(data => data && data.slots); 

            renderTable(scheduleData, isUserLoggedIn);
            toggleLoading(false);
        }, error => {
            console.error("Błąd ładowania harmonogramu: ", error);
            tableBody.innerHTML = `<tr><td colspan="99">Błąd: ${error.message}. Sprawdź reguły bazy danych i poprawność konfiguracji.</td></tr>`;
            toggleLoading(false);
        });
    }

    function handleCellUpdate(time, therapist, newText) {
        const docRef = db.collection('schedules').doc(time);
        
        // Używamy notacji z kropką, aby zaktualizować pole wewnątrz obiektu 'slots'
        const updateKey = `slots.${therapist}.text`;

        docRef.update({
            [updateKey]: newText
        }).catch(error => {
            console.error("Błąd aktualizacji komórki: ", error);
            // Można dodać informację dla użytkownika, że zapis się nie powiódł
        });
    }
});

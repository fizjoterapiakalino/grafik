document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableHead = mainScheduleTable.querySelector('thead tr');
    const tableBody = mainScheduleTable.querySelector('tbody');
    const loadingOverlay = document.getElementById('loadingOverlay');

    let therapists = []; // Globalna lista terapeutów

    function toggleLoading(show) {
        if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    firebase.auth().onAuthStateChanged(user => {
        loadSchedule(!!user); // Przekaż true jeśli user jest zalogowany, false wpp.
    });

    function renderTable(scheduleData, isUserLoggedIn) {
        // 1. Czyszczenie tabeli
        tableHead.innerHTML = '<th>Godzina</th>'; // Reset nagłówka
        tableBody.innerHTML = '';

        // 2. Wyciągnięcie i posortowanie terapeutów z pierwszego rekordu
        const firstRow = scheduleData.length > 0 ? scheduleData[0] : null;
        if (!firstRow) {
            tableHead.innerHTML += '<th>Brak danych w bazie. Uruchom init-db.html.</th>';
            return;
        }
        
        // Klucze obiektu 'slots' to nasi terapeuci
        therapists = Object.keys(firstRow.slots).sort(); 
        therapists.forEach(therapist => {
            const th = document.createElement('th');
            th.textContent = therapist;
            tableHead.appendChild(th);
        });

        // 3. Renderowanie wierszy z danymi
        scheduleData.forEach(rowData => {
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
                cell.className = `slot-cell type-${slotData.type}`; // np. type-przerwa
                cell.dataset.therapist = therapist;

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

    function loadSchedule(isUserLoggedIn) {
        toggleLoading(true);
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            const scheduleData = snapshot.docs.map(doc => doc.data());
            renderTable(scheduleData, isUserLoggedIn);
            toggleLoading(false);
        }, error => {
            console.error("Błąd ładowania harmonogramu: ", error);
            tableBody.innerHTML = `<tr><td colspan="99">Błąd: ${error.message}</td></tr>`;
            toggleLoading(false);
        });
    }

    function handleCellUpdate(time, therapist, newText) {
        const docRef = db.collection('schedules').doc(time);
        
        // Używamy notacji z kropką do aktualizacji zagnieżdżonego pola
        const updateKey = `slots.${therapist}.text`;

        docRef.update({
            [updateKey]: newText
        }).catch(error => {
            console.error("Błąd aktualizacji komórki: ", error);
            // Opcjonalnie: przywróć starą wartość lub pokaż błąd
        });
    }
});

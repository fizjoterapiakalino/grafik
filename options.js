document.addEventListener('DOMContentLoaded', () => {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const addEmployeeButton = document.getElementById('addEmployeeButton');
    const newEmployeeNameInput = document.getElementById('newEmployeeName');
    const employeeListDiv = document.getElementById('employeeList');
    
    // Na tej stronie nie ma asynchronicznego ładowania danych,
    // więc ukrywamy nakładkę od razu z małym opóźnieniem dla animacji.
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        setTimeout(() => {
            if (loadingOverlay.parentNode) loadingOverlay.parentNode.removeChild(loadingOverlay);
        }, 300);
    }

    // W przyszłości można wczytywać listę pracowników i ją tu wyświetlać
    // np. fetch(WEB_APP_URL + '?action=getEmployees').then(...)

    if (addEmployeeButton) {
        addEmployeeButton.addEventListener('click', () => {
            const employeeName = newEmployeeNameInput.value.trim();
            if (employeeName) {
                alert(`Logika dodawania pracownika: "${employeeName}". \nNależy zaimplementować wysłanie tych danych do Google Apps Script.`);
                // Przykładowa implementacja (wymaga obsługi po stronie serwera):
                /*
                fetch(WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'addEmployee', name: employeeName })
                })
                .then(response => response.json())
                .then(data => {
                    if(data.success) {
                        alert('Pracownik dodany!');
                        newEmployeeNameInput.value = '';
                        // Odśwież listę pracowników
                    } else {
                        alert('Błąd: ' + data.message);
                    }
                })
                .catch(error => console.error('Błąd podczas dodawania pracownika:', error));
                */
            } else {
                alert('Proszę wpisać imię i nazwisko pracownika.');
            }
        });
    }
});
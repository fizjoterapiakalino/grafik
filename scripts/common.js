// === STAŁE GLOBALNE ===
const months = [
    'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
    'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const MAX_UNDO_STATES = 20;

// Konfiguracja tabeli grafiku
const NUMBER_OF_EMPLOYEES = 13;
const START_HOUR = 7;
const END_HOUR = 17;
const DEFAULT_CELL_COLOR = '#e0e0e0';
const CONTENT_CELL_COLOR = '#ffffff';
const BREAK_TEXT = 'Przerwa';

// === FUNKCJE POMOCNICZE ===

/**
 * Zmienia pierwszą literę ciągu znaków na wielką.
 * @param {string} string - Ciąg znaków do modyfikacji.
 * @returns {string} - Zmodyfikowany ciąg znaków.
 */
const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Płynnie ukrywa i usuwa element nakładki ładowania.
 * @param {HTMLElement} loadingOverlay - Element nakładki do ukrycia.
 */
const hideLoadingOverlay = (loadingOverlay) => {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        setTimeout(() => {
            if (loadingOverlay.parentNode) {
                loadingOverlay.parentNode.removeChild(loadingOverlay);
            }
        }, 300); // Czas zgodny z przejściem CSS
    }
};

/**
 * Wyświetla komunikat typu "toast".
 * @param {string} message - Wiadomość do wyświetlenia.
 * @param {number} [duration=3000] - Czas wyświetlania w milisekundach.
 */
window.showToast = (message, duration = 3000) => {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        console.error('Toast container not found!');
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Pokaż toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    // Ukryj i usuń toast po określonym czasie
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        });
    }, duration);
};

// === ZARZĄDZANIE HISTORIĄ (UNDO) ===

class UndoManager {
    constructor(options) {
        this.maxStates = options.maxStates || 20;
        this.onUpdate = options.onUpdate; // Funkcja zwrotna do aktualizacji UI (np. przycisku)
        this.undoStack = [];
        this.redoStack = []; // Na przyszłość
    }

    /**
     * Zapisuje nowy stan w historii.
     * @param {object} state - Aktualny stan do zapisania.
     */
    pushState(state) {
        const currentStateJson = JSON.stringify(state);
        if (this.undoStack.length > 0 && JSON.stringify(this.undoStack[this.undoStack.length - 1]) === currentStateJson) {
            return; // Nie dodawaj, jeśli stan jest identyczny jak poprzedni
        }

        this.undoStack.push(state);
        if (this.undoStack.length > this.maxStates) {
            this.undoStack.shift(); // Usuń najstarszy stan, jeśli przekroczono limit
        }
        this.redoStack.length = 0; // Wyczyść stos redo przy nowej akcji
        this.update();
    }

    /**
     * Cofa ostatnią akcję.
     * @returns {object|null} Poprzedni stan lub null, jeśli nie ma czego cofać.
     */
    undo() {
        if (this.undoStack.length > 1) {
            const currentState = this.undoStack.pop();
            this.redoStack.push(currentState);
            const prevState = this.undoStack[this.undoStack.length - 1];
            this.update();
            return prevState;
        }
        return null;
    }

    /**
     * Sprawdza, czy można cofnąć akcję.
     * @returns {boolean}
     */
    canUndo() {
        return this.undoStack.length > 1;
    }

    /**
     * Resetuje historię.
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.update();
    }
    
    /**
     * Inicjalizuje menedżera pierwszym stanem.
     * @param {object} initialState - Początkowy stan aplikacji.
     */
    initialize(initialState) {
        this.clear();
        this.undoStack.push(initialState);
        this.update();
    }

    /**
     * Wywołuje funkcję zwrotną aktualizacji.
     */
    update() {
        if (this.onUpdate) {
            this.onUpdate(this);
        }
    }
}

// === WYSZUKIWANIE I PODŚWIETLANIE ===

/**
 * Przeszukuje i podświetla tekst w komórkach tabeli.
 * @param {string} searchTerm - Szukana fraza.
 * @param {string} tableSelector - Selektor CSS tabeli do przeszukania.
 * @param {string} cellSelector - Selektor CSS komórek do przeszukania w obrębie wiersza.
 */
function searchAndHighlight(searchTerm, tableSelector, cellSelector = 'td, th') {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    const regex = searchTerm ? new RegExp(searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi') : null;

    rows.forEach(row => {
        const cells = row.querySelectorAll(cellSelector);
        let rowMatches = false;

        cells.forEach(cell => {
            // Usuń istniejące podświetlenia
            cell.querySelectorAll('span.search-highlight').forEach(highlight => {
                const parent = highlight.parentNode;
                while (highlight.firstChild) {
                    parent.insertBefore(highlight.firstChild, highlight);
                }
                parent.removeChild(highlight);
                parent.normalize();
            });

            if (regex) {
                const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null, false);
                const textNodes = [];
                let currentNode;
                while (currentNode = walker.nextNode()) {
                    textNodes.push(currentNode);
                }

                textNodes.forEach(node => {
                    const text = node.nodeValue;
                    const newHtml = text.replace(regex, `<span class="search-highlight">$&</span>`);
                    if (newHtml !== text) {
                        const newFragment = document.createRange().createContextualFragment(newHtml);
                        node.parentNode.replaceChild(newFragment, node);
                        rowMatches = true;
                    }
                });
            }
        });

        if (searchTerm) {
            row.style.display = rowMatches ? '' : 'none';
        } else {
            row.style.display = '';
        }
    });
}

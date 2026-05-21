import {
    UndoManager,
    capitalizeFirstLetter,
    countWorkdays,
    getEasterDate,
    hideLoadingOverlay,
    isHoliday,
    searchAndHighlight,
    showToast,
} from '../scripts/common.js';

describe('common helpers', () => {
    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    test('capitalizes only the first character', () => {
        expect(capitalizeFirstLetter('kowalski')).toBe('Kowalski');
        expect(capitalizeFirstLetter('')).toBe('');
        expect(capitalizeFirstLetter('Nowak')).toBe('Nowak');
    });

    test('calculates Easter date in UTC', () => {
        expect(getEasterDate(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
        expect(getEasterDate(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
    });

    test('recognizes fixed and movable Polish holidays', () => {
        expect(isHoliday(new Date(Date.UTC(2026, 0, 1)))).toBe(true);
        expect(isHoliday(new Date(Date.UTC(2026, 5, 4)))).toBe(true); // Boze Cialo 2026
        expect(isHoliday(new Date(Date.UTC(2026, 4, 4)))).toBe(false);
    });

    test('counts workdays excluding weekends and holidays', () => {
        expect(countWorkdays('2026-01-01', '2026-01-07')).toBe(3);
    });

    test('searchAndHighlight toggles highlights without hiding rows', () => {
        document.body.innerHTML = `
            <table id="table">
                <tbody>
                    <tr><td class="cell">Kowalski</td></tr>
                    <tr><td class="cell search-highlight">Nowak</td></tr>
                </tbody>
            </table>
        `;

        searchAndHighlight('kow', '#table', '.cell');

        const cells = document.querySelectorAll('.cell');
        expect(cells[0].classList.contains('search-highlight')).toBe(true);
        expect(cells[1].classList.contains('search-highlight')).toBe(false);
        expect(document.querySelector('tr').style.display).toBe('');
    });

    test('showToast appends, shows and removes toast', () => {
        jest.useFakeTimers();
        document.body.innerHTML = '<div id="toast-container"></div>';

        showToast('Zapisano', 1000);

        const toast = document.querySelector('.toast');
        expect(toast.textContent).toBe('Zapisano');

        jest.advanceTimersByTime(100);
        expect(toast.classList.contains('show')).toBe(true);

        jest.advanceTimersByTime(1000);
        expect(toast.classList.contains('show')).toBe(false);

        jest.advanceTimersByTime(500);
        expect(document.querySelector('.toast')).toBeNull();
    });

    test('hideLoadingOverlay is safe for null and hides existing element', () => {
        const overlay = document.createElement('div');

        hideLoadingOverlay(overlay);
        hideLoadingOverlay(null);

        expect(overlay.style.display).toBe('none');
    });

    test('UndoManager stores immutable snapshots and respects maxStates', () => {
        const onUpdate = jest.fn();
        const undo = new UndoManager({ maxStates: 2, onUpdate });
        const state = { value: 1 };

        undo.initialize(state);
        state.value = 2;
        undo.pushState(state);
        state.value = 3;
        undo.pushState(state);

        expect(undo.canUndo()).toBe(true);
        expect(undo.undo()).toEqual({ value: 2 });
        expect(undo.undo()).toBeNull();
        expect(onUpdate).toHaveBeenCalled();
    });
});

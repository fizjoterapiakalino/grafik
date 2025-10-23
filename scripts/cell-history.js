const CellHistory = (() => {
    const MAX_HISTORY_ENTRIES = 3;

    /**
     * Manages the history of a cell state.
     * @param {object} cellState - The state object of the cell.
     * @param {string} oldContent - The old content to be added to the history.
     */
    const updateHistory = (cellState, oldContent) => {
        if (!oldContent || oldContent.trim() === '') {
            return;
        }

        if (!cellState.history) {
            cellState.history = [];
        }

        // Add to the beginning and prevent duplicates
        if (cellState.history[0] !== oldContent) {
            cellState.history.unshift(oldContent);
        }

        // Keep only the last N entries
        cellState.history = cellState.history.slice(0, MAX_HISTORY_ENTRIES);
    };

    return {
        updateHistory
    };
})();

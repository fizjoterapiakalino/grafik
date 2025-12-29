// scripts/utils.js
// Centralne funkcje pomocnicze używane w całej aplikacji

/**
 * Bezpiecznie kopiuje wartość, zwracając null jeśli wartość jest undefined.
 * Używane do zapobiegania zapisywania undefined do Firestore.
 * @param {*} val - Wartość do skopiowania
 * @returns {*} - Wartość lub null
 */
export const safeCopy = (val) => (val === undefined ? null : val);

/**
 * Bezpiecznie konwertuje wartość na boolean, zwracając false jeśli undefined.
 * @param {*} val - Wartość do konwersji
 * @returns {boolean} - Wartość jako boolean
 */
export const safeBool = (val) => (val === undefined ? false : !!val);

/**
 * Tworzy głęboką kopię obiektu lub tablicy.
 * @param {*} obj - Obiekt do skopiowania
 * @returns {*} - Głęboka kopia
 */
export const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * Lista kluczy zawartości komórki używanych do czyszczenia/kopiowania.
 */
export const CELL_CONTENT_KEYS = [
    'content',
    'content1',
    'content2',
    'isSplit',
    'isMassage',
    'isMassage1',
    'isMassage2',
    'isPnf',
    'isPnf1',
    'isPnf2',
    'isEveryOtherDay',
    'isEveryOtherDay1',
    'isEveryOtherDay2',
    'treatmentStartDate',
    'treatmentExtensionDays',
    'treatmentEndDate',
    'additionalInfo',
    'treatmentData1',
    'treatmentData2',
];

/**
 * Czyści wszystkie klucze zawartości z obiektu stanu komórki.
 * @param {Object} state - Obiekt stanu komórki
 */
export const clearCellContentKeys = (state) => {
    for (const key of CELL_CONTENT_KEYS) {
        state[key] = null;
    }
};

/**
 * Kopiuje dane treatment do obiektu docelowego.
 * @param {Object} source - Obiekt źródłowy z danymi treatment
 * @param {Object} target - Obiekt docelowy
 * @param {string} prefix - Opcjonalny suffix dla kluczy (np. '1' dla treatmentData1)
 */
export const copyTreatmentData = (source, target, suffix = '') => {
    const treatmentData = suffix ? source[`treatmentData${suffix}`] || {} : source;

    if (suffix) {
        target[`treatmentData${suffix}`] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
        };
    } else {
        target.treatmentStartDate = safeCopy(treatmentData.treatmentStartDate ?? treatmentData.startDate);
        target.treatmentExtensionDays = safeCopy(treatmentData.treatmentExtensionDays ?? treatmentData.extensionDays);
        target.treatmentEndDate = safeCopy(treatmentData.treatmentEndDate ?? treatmentData.endDate);
        target.additionalInfo = safeCopy(treatmentData.additionalInfo);
    }
};

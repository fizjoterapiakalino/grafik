// scripts/utils.ts
// Centralne funkcje pomocnicze używane w całej aplikacji

/**
 * Dane leczenia dla pojedynczej komórki lub części split
 */
export interface TreatmentData {
    startDate?: string | null;
    extensionDays?: number | null;
    endDate?: string | null;
    additionalInfo?: string | null;
}

/**
 * Stan komórki z danymi zawartości
 */
export interface CellState {
    content?: string | null;
    content1?: string | null;
    content2?: string | null;
    isSplit?: boolean | null;
    isMassage?: boolean | null;
    isMassage1?: boolean | null;
    isMassage2?: boolean | null;
    isPnf?: boolean | null;
    isPnf1?: boolean | null;
    isPnf2?: boolean | null;
    isEveryOtherDay?: boolean | null;
    isEveryOtherDay1?: boolean | null;
    isEveryOtherDay2?: boolean | null;
    treatmentStartDate?: string | null;
    treatmentExtensionDays?: number | null;
    treatmentEndDate?: string | null;
    additionalInfo?: string | null;
    treatmentData1?: TreatmentData | null;
    treatmentData2?: TreatmentData | null;
    [key: string]: unknown; // Allow dynamic access
}

/**
 * Bezpiecznie kopiuje wartość, zwracając null jeśli wartość jest undefined.
 * Używane do zapobiegania zapisywania undefined do Firestore.
 */
export const safeCopy = <T>(val: T | undefined): T | null =>
    (val === undefined ? null : val);

/**
 * Bezpiecznie konwertuje wartość na boolean, zwracając false jeśli undefined.
 */
export const safeBool = (val: unknown): boolean =>
    (val === undefined ? false : !!val);

/**
 * Tworzy głęboką kopię obiektu lub tablicy.
 */
export const deepClone = <T>(obj: T): T =>
    JSON.parse(JSON.stringify(obj));

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
] as const;

export type CellContentKey = typeof CELL_CONTENT_KEYS[number];

/**
 * Czyści wszystkie klucze zawartości z obiektu stanu komórki.
 */
export const clearCellContentKeys = (state: CellState): void => {
    for (const key of CELL_CONTENT_KEYS) {
        state[key] = null;
    }
};

/**
 * Źródło danych leczenia (może być obiekt z treatment lub treatmentData)
 */
interface TreatmentSource {
    treatmentStartDate?: string | null;
    treatmentExtensionDays?: number | null;
    treatmentEndDate?: string | null;
    startDate?: string | null;
    extensionDays?: number | null;
    endDate?: string | null;
    additionalInfo?: string | null;
    treatmentData1?: TreatmentData;
    treatmentData2?: TreatmentData;
}

/**
 * Kopiuje dane treatment do obiektu docelowego.
 * @param source - Obiekt źródłowy z danymi treatment
 * @param target - Obiekt docelowy
 * @param suffix - Opcjonalny suffix dla kluczy (np. '1' dla treatmentData1)
 */
export const copyTreatmentData = (
    source: TreatmentSource,
    target: CellState,
    suffix: string = ''
): void => {
    const treatmentDataKey = `treatmentData${suffix}` as keyof TreatmentSource;
    const treatmentData: TreatmentData = suffix
        ? (source[treatmentDataKey] as TreatmentData) || {}
        : source;

    if (suffix) {
        const targetKey = `treatmentData${suffix}` as keyof CellState;
        (target as Record<string, unknown>)[targetKey] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
        };
    } else {
        target.treatmentStartDate = safeCopy(
            (source as TreatmentSource).treatmentStartDate ?? treatmentData.startDate
        );
        target.treatmentExtensionDays = safeCopy(
            (source as TreatmentSource).treatmentExtensionDays ?? treatmentData.extensionDays
        );
        target.treatmentEndDate = safeCopy(
            (source as TreatmentSource).treatmentEndDate ?? treatmentData.endDate
        );
        target.additionalInfo = safeCopy(treatmentData.additionalInfo);
    }
};

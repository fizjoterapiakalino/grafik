// scripts/color-preferences.ts
// Moduł personalizacji kolorów - zapisuje preferencje w localStorage

/**
 * Domyślne kolory typów zabiegów
 */
const DEFAULT_COLORS = {
    massage: '#f472b6',      // Pink
    pnf: '#3b82f6',          // Blue
    everyOtherDay: '#a855f7', // Purple
    break: '#64748b'         // Slate
};

/**
 * Klucz localStorage do przechowywania preferencji
 */
const STORAGE_KEY = 'fizjoterapia_color_preferences';

/**
 * Interfejs preferencji kolorów
 */
interface ColorPreferences {
    massage: string;
    pnf: string;
    everyOtherDay: string;
    break: string;
}

/**
 * Interfejs publicznego API modułu
 */
interface ColorPreferencesAPI {
    init(): void;
    getColors(): ColorPreferences;
    setColor(key: keyof ColorPreferences, value: string): void;
    resetToDefaults(): void;
    applyColors(): void;
}

/**
 * Moduł personalizacji kolorów
 */
export const ColorPreferences: ColorPreferencesAPI = (() => {
    let currentColors: ColorPreferences = { ...DEFAULT_COLORS };

    /**
     * Wczytuje zapisane preferencje z localStorage
     */
    const loadFromStorage = (): ColorPreferences => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge z domyślnymi - na wypadek gdyby brakowało jakiegoś klucza
                return { ...DEFAULT_COLORS, ...parsed };
            }
        } catch (e) {
            console.warn('ColorPreferences: Błąd wczytywania z localStorage', e);
        }
        return { ...DEFAULT_COLORS };
    };

    /**
     * Zapisuje preferencje do localStorage
     */
    const saveToStorage = (): void => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentColors));
        } catch (e) {
            console.warn('ColorPreferences: Błąd zapisu do localStorage', e);
        }
    };

    /**
     * Aktualizuje zmienne CSS w dokumencie
     */
    const applyColors = (): void => {
        const root = document.documentElement;
        root.style.setProperty('--bg-massage', currentColors.massage);
        root.style.setProperty('--bg-pnf', currentColors.pnf);
        root.style.setProperty('--bg-every-other-day', currentColors.everyOtherDay);
        root.style.setProperty('--bg-break', currentColors.break);
    };

    /**
     * Inicjalizuje moduł - wczytuje preferencje i aplikuje kolory
     */
    const init = (): void => {
        currentColors = loadFromStorage();
        applyColors();
    };

    /**
     * Zwraca aktualne preferencje kolorów
     */
    const getColors = (): ColorPreferences => {
        return { ...currentColors };
    };

    /**
     * Ustawia pojedynczy kolor
     */
    const setColor = (key: keyof ColorPreferences, value: string): void => {
        if (key in currentColors) {
            currentColors[key] = value;
            saveToStorage();
            applyColors();
        }
    };

    /**
     * Przywraca domyślne kolory
     */
    const resetToDefaults = (): void => {
        currentColors = { ...DEFAULT_COLORS };
        saveToStorage();
        applyColors();
    };

    return {
        init,
        getColors,
        setColor,
        resetToDefaults,
        applyColors
    };
})();

// Eksport dla kompatybilności globalnej
declare global {
    interface Window {
        ColorPreferences: ColorPreferencesAPI;
    }
}

window.ColorPreferences = ColorPreferences;

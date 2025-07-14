const SPREADSHEET_ID = '1tD3FOapxLBlytGerMNZ5yp1qXIqvZW3vKiPGeB3vXDc'; 
const SHEET_NAME = 'DATA'; 
const DATA_KEY = 'grafikKalinowaData'; 
// Dodajemy klucz dla naszej pamięci podręcznej
const CACHE_KEY = 'grafikKalinowaCache';

/**
 * Funkcja obsługująca żądania GET. Zwraca dane grafiku.
 * ZOPTYMALIZOWANA WERSJA z użyciem CacheService.
 */
function doGet(e) {
  // Krok 1: Spróbuj pobrać dane z szybkiej pamięci podręcznej
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(CACHE_KEY);

  if (cachedData != null) {
    // Jeśli dane są w cache, zwróć je NATYCHMIAST! To jest nasz zysk na wydajności.
    return ContentService.createTextOutput(cachedData)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Krok 2: Jeśli danych nie ma w cache, wykonaj standardową procedurę
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  let scheduleData = '{}';

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === DATA_KEY) {
      scheduleData = values[i][1];
      break;
    }
  }
  
  // Krok 3: Zapisz pobrane dane w cache na przyszłość
  // Ustawiamy ważność cache na 1 godzinę (3600 sekund).
  cache.put(CACHE_KEY, scheduleData, 3600);

  // Zwróć dane
  return ContentService.createTextOutput(scheduleData)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Funkcja obsługująca żądania POST. Zapisuje dane grafiku.
 * ZOPTYMALIZOWANA WERSJA z unieważnianiem cache.
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const newScheduleData = e.postData.contents;

    let keyFound = false;
    let rowToUpdate = -1;

    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === DATA_KEY) {
        keyFound = true;
        rowToUpdate = i + 1;
        break;
      }
    }

    if (keyFound) {
      sheet.getRange(rowToUpdate, 2).setValue(newScheduleData);
    } else {
      sheet.appendRow([DATA_KEY, newScheduleData]);
    }

    // NAJWAŻNIEJSZY KROK: Po zapisaniu nowych danych, wyczyść stary cache!
    // Dzięki temu następne wywołanie doGet pobierze świeże dane.
    const cache = CacheService.getScriptCache();
    cache.remove(CACHE_KEY);

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Data saved and cache cleared.' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
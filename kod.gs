const SPREADSHEET_ID = '1tD3FOapxLBlytGerMNZ5yp1qXIqvZW3vKiPGeB3vXDc';
const SHEET_NAME = 'DATA';
const DATA_KEY = 'grafikKalinowaData';
const ALLOWED_ORIGIN = 'https://fizjoterapiakalino.github.io';

// Helper functions to manage CORS headers
function withSuccessHeader(textOutput) {
  return textOutput.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
}

function withErrorHeader(textOutput) {
  return textOutput.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
}

function doGet(e) {
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

  const textOutput = ContentService.createTextOutput(scheduleData)
    .setMimeType(ContentService.MimeType.JSON);
    
  return withSuccessHeader(textOutput);
}

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

    const successResponse = ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Data saved.' }))
      .setMimeType(ContentService.MimeType.JSON);
      
    return withSuccessHeader(successResponse);

  } catch (error) {
    const errorResponse = ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
      
    return withErrorHeader(errorResponse);
  }
}

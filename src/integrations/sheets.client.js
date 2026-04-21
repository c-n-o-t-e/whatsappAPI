const { google } = require("googleapis");
const config = require("../config");

function requireSheetId() {
    const id = config.getSheetId();
    if (!id) {
        throw new Error(
            "Missing SHEET_ID. Set SHEET_ID in .env (or environment) to your Google Spreadsheet ID.",
        );
    }
}

function getSpreadsheetId() {
    const id = config.getSheetId();
    if (!id) {
        throw new Error(
            "Missing SHEET_ID. Set SHEET_ID in .env (or environment) to your Google Spreadsheet ID.",
        );
    }
    return id;
}

async function createSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
}

async function listSpreadsheetSheetTitles(sheets) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId: getSpreadsheetId(),
        fields: "sheets.properties.title",
    });
    return (res.data.sheets || []).map((s) => s.properties.title);
}

/** A1 range sheet name quoting for titles with spaces/special chars. */
function quoteSheetNameForRange(title) {
    const safe = String(title).replace(/'/g, "''");
    return `'${safe}'`;
}

function findSheetTitleCaseInsensitive(titles, desiredTitle) {
    const lower = String(desiredTitle).toLowerCase();
    return titles.find((t) => String(t).toLowerCase() === lower) ?? null;
}

async function getSheetIdByTitle(sheets, desiredTitle) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId: getSpreadsheetId(),
        fields: "sheets.properties(sheetId,title)",
    });
    const lower = String(desiredTitle).toLowerCase();
    const match = (res.data.sheets || []).find(
        (s) => String(s?.properties?.title || "").toLowerCase() === lower,
    );
    return match?.properties?.sheetId ?? null;
}

module.exports = {
    requireSheetId,
    getSpreadsheetId,
    createSheetsClient,
    listSpreadsheetSheetTitles,
    quoteSheetNameForRange,
    findSheetTitleCaseInsensitive,
    getSheetIdByTitle,
};

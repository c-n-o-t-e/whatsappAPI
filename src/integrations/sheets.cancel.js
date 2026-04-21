const {
    requireSheetId,
    createSheetsClient,
    listSpreadsheetSheetTitles,
    quoteSheetNameForRange,
    findSheetTitleCaseInsensitive,
    getSpreadsheetId,
} = require("./sheets.client");
const { parseDateFromInvoiceId } = require("../utils/invoiceId");
const { formatMonthTabTitle } = require("../utils/dates");

async function findInvoiceRowInSheet(sheets, sheetTitle, invoiceId) {
    const q = quoteSheetNameForRange(sheetTitle);
    const col = await sheets.spreadsheets.values.get({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!J:J`,
    });
    const values = col.data.values || [];
    const rowIndex0 = values.findIndex(
        (row) => String(row?.[0] ?? "").trim() === String(invoiceId).trim(),
    );
    if (rowIndex0 === -1) return null;
    return rowIndex0 + 1;
}

/** Search all tabs for invoice id in column J (fallback for legacy Sheet1 rows). */
async function findInvoiceLocationAcrossSheets(sheets, invoiceId) {
    const titles = await listSpreadsheetSheetTitles(sheets);
    for (const sheetTitle of titles) {
        const rowNumber = await findInvoiceRowInSheet(
            sheets,
            sheetTitle,
            invoiceId,
        );
        if (rowNumber != null) {
            return { sheetTitle, rowNumber };
        }
    }
    return null;
}

async function setStayedByInvoiceId({ invoiceId, stayed }) {
    requireSheetId();

    const sheets = await createSheetsClient();

    const id = String(invoiceId).trim();
    let sheetTitle = null;
    let rowNumber = null;

    const fromId = parseDateFromInvoiceId(id);
    if (fromId) {
        const preferredTab = formatMonthTabTitle(fromId);
        const titles = await listSpreadsheetSheetTitles(sheets);
        const canonical = findSheetTitleCaseInsensitive(titles, preferredTab);
        if (canonical) {
            rowNumber = await findInvoiceRowInSheet(sheets, canonical, id);
            if (rowNumber != null) {
                sheetTitle = canonical;
            }
        }
    }

    if (sheetTitle == null) {
        const found = await findInvoiceLocationAcrossSheets(sheets, id);
        if (found == null) {
            const err = new Error("Invoice ID doesn't exist");
            err.statusCode = 404;
            throw err;
        }
        sheetTitle = found.sheetTitle;
        rowNumber = found.rowNumber;
    }

    const q = quoteSheetNameForRange(sheetTitle);
    await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!I${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[stayed]] },
    });

    return { updated: true, appended: false, rowNumber, sheetTitle };
}

module.exports = {
    findInvoiceRowInSheet,
    findInvoiceLocationAcrossSheets,
    setStayedByInvoiceId,
};

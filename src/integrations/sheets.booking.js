const {
    requireSheetId,
    createSheetsClient,
    listSpreadsheetSheetTitles,
    quoteSheetNameForRange,
    findSheetTitleCaseInsensitive,
    getSheetIdByTitle,
    getSpreadsheetId,
} = require("./sheets.client");
const {
    formatMonthTabTitle,
    deriveStayStartDate,
    getBookingDateForSheet,
} = require("../utils/dates");

/** One row of headers for columns B–J (matches append order). */
const BOOKING_HEADER_ROW = [
    "Name",
    "Phone",
    "Room Code",
    "Check-in",
    "Check-out",
    "Amount",
    "Booking Date",
    "Stayed",
    "Invoice ID",
];

function hexToSheetsRgb(hex) {
    const h = String(hex || "")
        .trim()
        .replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(h)) return { red: 0, green: 0, blue: 0 };
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return { red: r, green: g, blue: b };
}

async function applyMonthSheetBranding(sheets, sheetTitle) {
    const sheetId = await getSheetIdByTitle(sheets, sheetTitle);
    if (sheetId == null) return;

    const LOFTY_RED = hexToSheetsRgb("#C0181A");
    const CHARCOAL = hexToSheetsRgb("#121212");
    const OFF_WHITE = hexToSheetsRgb("#F7F7F7");
    const LIGHT_GRAY = hexToSheetsRgb("#F2F2F2");
    const MID_GRAY = hexToSheetsRgb("#BDBDBD");
    const CANCEL_BG = hexToSheetsRgb("#EFEFEF");
    const CANCEL_TEXT = hexToSheetsRgb("#7A7A7A");
    const BORDER = hexToSheetsRgb("#DDDDDD");
    const SUCCESS_BG = hexToSheetsRgb("#E8F5E9");
    const SUCCESS_TEXT = hexToSheetsRgb("#1B5E20");
    const FAIL_BG = hexToSheetsRgb("#FFEBEE");
    const FAIL_TEXT = hexToSheetsRgb("#B71C1C");

    const col = (n) => ({
        sheetId,
        dimension: "COLUMNS",
        startIndex: n,
        endIndex: n + 1,
    });

    const requests = [
        {
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: { frozenRowCount: 4, hideGridlines: true },
                },
                fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
            },
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 1,
                    endColumnIndex: 10,
                },
                mergeType: "MERGE_ALL",
            },
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: 2,
                    startColumnIndex: 1,
                    endColumnIndex: 10,
                },
                mergeType: "MERGE_ALL",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 2,
                    startColumnIndex: 1,
                    endColumnIndex: 11,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: CHARCOAL,
                        horizontalAlignment: "LEFT",
                        verticalAlignment: "MIDDLE",
                        textFormat: {
                            foregroundColor: OFF_WHITE,
                            bold: true,
                            fontSize: 14,
                        },
                    },
                },
                fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 2,
                    endRowIndex: 3,
                    startColumnIndex: 1,
                    endColumnIndex: 11,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: LOFTY_RED,
                    },
                },
                fields: "userEnteredFormat.backgroundColor",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 3,
                    endRowIndex: 4,
                    startColumnIndex: 1,
                    endColumnIndex: 10,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: CHARCOAL,
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE",
                        textFormat: {
                            foregroundColor: OFF_WHITE,
                            bold: true,
                            fontSize: 11,
                        },
                    },
                },
                fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
            },
        },
        {
            updateDimensionProperties: {
                range: col(1),
                properties: { pixelSize: 180 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(2),
                properties: { pixelSize: 150 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(3),
                properties: { pixelSize: 110 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(4),
                properties: { pixelSize: 130 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(5),
                properties: { pixelSize: 130 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(6),
                properties: { pixelSize: 140 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(7),
                properties: { pixelSize: 170 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(8),
                properties: { pixelSize: 90 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(9),
                properties: { pixelSize: 260 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: col(10),
                properties: { pixelSize: 260 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: 0,
                    endIndex: 2,
                },
                properties: { pixelSize: 38 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: 2,
                    endIndex: 3,
                },
                properties: { pixelSize: 8 },
                fields: "pixelSize",
            },
        },
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: 3,
                    endIndex: 4,
                },
                properties: { pixelSize: 32 },
                fields: "pixelSize",
            },
        },
        {
            addBanding: {
                bandedRange: {
                    range: {
                        sheetId,
                        startRowIndex: 4,
                        endRowIndex: 2000,
                        startColumnIndex: 1,
                        endColumnIndex: 10,
                    },
                    rowProperties: {
                        firstBandColor: { ...OFF_WHITE },
                        secondBandColor: { ...LIGHT_GRAY },
                    },
                },
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 2000,
                    startColumnIndex: 4,
                    endColumnIndex: 6,
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: { type: "DATE", pattern: "dd-mmm-yyyy" },
                    },
                },
                fields: "userEnteredFormat.numberFormat",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 2000,
                    startColumnIndex: 6,
                    endColumnIndex: 7,
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: { type: "NUMBER", pattern: "₦#,##0" },
                    },
                },
                fields: "userEnteredFormat.numberFormat",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 2000,
                    startColumnIndex: 7,
                    endColumnIndex: 8,
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: {
                            type: "DATE_TIME",
                            pattern: "dd-mmm-yyyy hh:mm",
                        },
                    },
                },
                fields: "userEnteredFormat.numberFormat",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 2000,
                    startColumnIndex: 8,
                    endColumnIndex: 9,
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: "CENTER",
                    },
                },
                fields: "userEnteredFormat.horizontalAlignment",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 10,
                    endColumnIndex: 11,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: LOFTY_RED,
                        textFormat: {
                            foregroundColor: OFF_WHITE,
                            bold: true,
                            fontSize: 11,
                        },
                    },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: 2,
                    startColumnIndex: 10,
                    endColumnIndex: 11,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: CHARCOAL,
                        numberFormat: { type: "NUMBER", pattern: "₦#,##0" },
                        horizontalAlignment: "LEFT",
                        textFormat: {
                            foregroundColor: OFF_WHITE,
                            bold: true,
                            fontSize: 14,
                        },
                    },
                },
                fields: "userEnteredFormat(backgroundColor,numberFormat,horizontalAlignment,textFormat)",
            },
        },
        {
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: 3,
                    endRowIndex: 2000,
                    startColumnIndex: 1,
                    endColumnIndex: 10,
                },
                innerHorizontal: {
                    style: "SOLID",
                    width: 1,
                    color: BORDER,
                },
                innerVertical: {
                    style: "SOLID",
                    width: 1,
                    color: BORDER,
                },
                top: { style: "SOLID", width: 1, color: BORDER },
                bottom: { style: "SOLID", width: 1, color: BORDER },
                left: { style: "SOLID", width: 1, color: BORDER },
                right: { style: "SOLID", width: 1, color: BORDER },
            },
        },
        {
            setBasicFilter: {
                filter: {
                    range: {
                        sheetId,
                        startRowIndex: 3,
                        endRowIndex: 2000,
                        startColumnIndex: 1,
                        endColumnIndex: 10,
                    },
                },
            },
        },
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [
                        {
                            sheetId,
                            startRowIndex: 4,
                            endRowIndex: 2000,
                            startColumnIndex: 1,
                            endColumnIndex: 10,
                        },
                    ],
                    booleanRule: {
                        condition: {
                            type: "CUSTOM_FORMULA",
                            values: [{ userEnteredValue: "=$I5=FALSE" }],
                        },
                        format: {
                            backgroundColor: CANCEL_BG,
                            textFormat: {
                                foregroundColor: CANCEL_TEXT,
                                strikethrough: true,
                            },
                        },
                    },
                },
                index: 0,
            },
        },
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [
                        {
                            sheetId,
                            startRowIndex: 4,
                            endRowIndex: 2000,
                            startColumnIndex: 8,
                            endColumnIndex: 9,
                        },
                    ],
                    booleanRule: {
                        condition: {
                            type: "CUSTOM_FORMULA",
                            values: [{ userEnteredValue: "=$I5=TRUE" }],
                        },
                        format: {
                            backgroundColor: SUCCESS_BG,
                            textFormat: {
                                foregroundColor: SUCCESS_TEXT,
                                bold: true,
                            },
                        },
                    },
                },
                index: 0,
            },
        },
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [
                        {
                            sheetId,
                            startRowIndex: 4,
                            endRowIndex: 2000,
                            startColumnIndex: 8,
                            endColumnIndex: 9,
                        },
                    ],
                    booleanRule: {
                        condition: {
                            type: "CUSTOM_FORMULA",
                            values: [{ userEnteredValue: "=$I5=FALSE" }],
                        },
                        format: {
                            backgroundColor: FAIL_BG,
                            textFormat: {
                                foregroundColor: FAIL_TEXT,
                                bold: true,
                            },
                        },
                    },
                },
                index: 0,
            },
        },
    ];

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: { requests },
    });
}

async function ensureMonthSheet(sheets, date) {
    const title = formatMonthTabTitle(date);
    const titles = await listSpreadsheetSheetTitles(sheets);
    const already = findSheetTitleCaseInsensitive(titles, title);
    if (already) {
        return already;
    }

    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: getSpreadsheetId(),
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: {
                                title,
                                gridProperties: {
                                    rowCount: 2000,
                                    columnCount: 26,
                                },
                            },
                        },
                    },
                ],
            },
        });
    } catch (e) {
        const msg = String(e?.message || e);
        const raceExisting = findSheetTitleCaseInsensitive(
            await listSpreadsheetSheetTitles(sheets),
            title,
        );
        if (raceExisting) {
            return raceExisting;
        }
        if (!/already exists|duplicate/i.test(msg)) {
            throw e;
        }
        const afterDup = findSheetTitleCaseInsensitive(
            await listSpreadsheetSheetTitles(sheets),
            title,
        );
        if (afterDup) {
            return afterDup;
        }
        throw e;
    }

    const q = quoteSheetNameForRange(title);
    await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!B1:B2`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [["LOFTY XPHERE HOMES"], [`${title} — Bookings`]],
        },
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!B4:J4`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [BOOKING_HEADER_ROW] },
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!K1:K3`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [
                ["Monthly total (Stayed=TRUE)"],
                ["=SUMIFS(G:G,I:I,TRUE)"],
                [""],
            ],
        },
    });

    await applyMonthSheetBranding(sheets, title);

    return title;
}

async function appendToSheet(data) {
    requireSheetId();

    const sheets = await createSheetsClient();

    const bookingDate =
        data.bookingDate instanceof Date ? data.bookingDate : null;
    const resolvedBookingDate =
        bookingDate && !Number.isNaN(bookingDate.getTime())
            ? bookingDate
            : getBookingDateForSheet();

    const stayStart = deriveStayStartDate(data.checkIn, resolvedBookingDate);
    const sheetMonthDate = stayStart ?? resolvedBookingDate;

    const monthTitle = await ensureMonthSheet(sheets, sheetMonthDate);
    const q = quoteSheetNameForRange(monthTitle);

    await sheets.spreadsheets.values.append({
        spreadsheetId: getSpreadsheetId(),
        range: `${q}!B5:J`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [
                [
                    data.name,
                    data.phone,
                    data.apartment,
                    data.checkIn,
                    data.checkOut,
                    data.amount,
                    resolvedBookingDate.toLocaleString(),
                    data.stayed,
                    data.invoiceId,
                ],
            ],
        },
    });
}

module.exports = {
    BOOKING_HEADER_ROW,
    appendToSheet,
    ensureMonthSheet,
    applyMonthSheetBranding,
};

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { google } = require("googleapis");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(bodyParser.json());

/* =========================
   GOOGLE SHEETS SETUP
========================= */
const SHEET_ID = process.env.SHEET_ID;

/**
 * Test-only: shift which calendar month gets new tabs + invoice id date.
 * Set ONE of:
 *   MOCK_BOOKING_MONTH_OFFSET=1   → pretend "today" is next month (tab + LXH date)
 *   MOCK_BOOKING_DATE=2026-06-15 → fixed pretend date (YYYY-MM-DD)
 * Remove both for production. MOCK_BOOKING_DATE wins if both are set.
 */
function addMonths(date, months) {
    const d = new Date(date.getTime());
    const expectedDay = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() !== expectedDay) {
        d.setDate(0);
    }
    return d;
}

function parseMockBookingDateFromEnv() {
    const raw = process.env.MOCK_BOOKING_DATE;
    if (!raw || !String(raw).trim()) {
        return null;
    }
    const s = String(raw).trim();
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
        const y = Number(ymd[1]);
        const mo = Number(ymd[2]);
        const d = Number(ymd[3]);
        const dt = new Date(y, mo - 1, d, 12, 0, 0);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "Now" for month tab + booking row timestamp + invoice id prefix. Respects mock env in dev. */
function getBookingDateForSheet() {
    const fixed = parseMockBookingDateFromEnv();
    if (fixed) {
        return fixed;
    }
    const off = process.env.MOCK_BOOKING_MONTH_OFFSET;
    if (off == null || String(off).trim() === "") {
        return new Date();
    }
    const n = parseInt(String(off), 10);
    if (Number.isNaN(n) || n === 0) {
        return new Date();
    }
    return addMonths(new Date(), n);
}

function isMockBookingDateActive() {
    return (
        Boolean(process.env.MOCK_BOOKING_DATE?.trim()) ||
        (process.env.MOCK_BOOKING_MONTH_OFFSET != null &&
            String(process.env.MOCK_BOOKING_MONTH_OFFSET).trim() !== "" &&
            parseInt(process.env.MOCK_BOOKING_MONTH_OFFSET, 10) !== 0)
    );
}

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

function requireSheetId() {
    if (!SHEET_ID || typeof SHEET_ID !== "string" || !SHEET_ID.trim()) {
        throw new Error(
            "Missing SHEET_ID. Set SHEET_ID in .env (or environment) to your Google Spreadsheet ID.",
        );
    }
}

function parseInvoiceIdFromText(text) {
    const t = String(text ?? "").trim();
    if (!t) return null;

    const labeled = t.match(
        /invoice\s*(?:id|number)?\s*[:#-]?\s*(LXH-[A-Z0-9]+(?:-[A-Z0-9]+)+)/i,
    );
    if (labeled?.[1]) return labeled[1];

    const embedded = t.match(/\b(LXH-[A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i);
    return embedded?.[1] ?? null;
}

/** Tab title like "April 2026" from a Date (booking / invoice month). */
function formatMonthTabTitle(date) {
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
    }).format(date);
}

/** A1 range sheet name quoting for titles with spaces/special chars. */
function quoteSheetNameForRange(title) {
    const safe = String(title).replace(/'/g, "''");
    return `'${safe}'`;
}

/** YYYYMMDD after LXH- in invoice ids → Date (local). */
function parseDateFromInvoiceId(invoiceId) {
    const m = String(invoiceId).match(/^LXH-(\d{4})(\d{2})(\d{2})-/i);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

async function listSpreadsheetSheetTitles(sheets) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: "sheets.properties.title",
    });
    return (res.data.sheets || []).map((s) => s.properties.title);
}

function findSheetTitleCaseInsensitive(titles, desiredTitle) {
    const lower = String(desiredTitle).toLowerCase();
    return titles.find((t) => String(t).toLowerCase() === lower) ?? null;
}

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

async function getSheetIdByTitle(sheets, desiredTitle) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: "sheets.properties(sheetId,title)",
    });
    const lower = String(desiredTitle).toLowerCase();
    const match = (res.data.sheets || []).find(
        (s) => String(s?.properties?.title || "").toLowerCase() === lower,
    );
    return match?.properties?.sheetId ?? null;
}

async function applyMonthSheetBranding(sheets, sheetTitle) {
    const sheetId = await getSheetIdByTitle(sheets, sheetTitle);
    if (sheetId == null) return;

    // Lofty Xphere Homes brand palette (from logo): red + charcoal + neutrals.
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
        // Freeze title + KPI + header.
        {
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: { frozenRowCount: 4, hideGridlines: true },
                },
                fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
            },
        },

        // Title band (B1:J1) and subtitle (B2:J2) – separate merges so both lines show.
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1, // row 1
                    startColumnIndex: 1, // B
                    endColumnIndex: 10, // J
                },
                mergeType: "MERGE_ALL",
            },
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: 2, // row 2
                    startColumnIndex: 1, // B
                    endColumnIndex: 10, // J
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
                    endColumnIndex: 11, // include KPI column K for full-width top bar feel
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
                fields:
                    "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
            },
        },

        // Brand divider row (B3:K3) – Lofty red accent.
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 2, // row 3
                    endRowIndex: 3,
                    startColumnIndex: 1, // B
                    endColumnIndex: 11, // K
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: LOFTY_RED,
                    },
                },
                fields: "userEnteredFormat.backgroundColor",
            },
        },

        // Header styling for booking table (B4:J4) – high contrast, always readable.
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 3,
                    endRowIndex: 4,
                    startColumnIndex: 1, // B
                    endColumnIndex: 10, // J (exclusive)
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
                fields:
                    "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
            },
        },

        // Column sizing (B–J) + summary column K.
        { updateDimensionProperties: { range: col(1), properties: { pixelSize: 180 }, fields: "pixelSize" } }, // B Name
        { updateDimensionProperties: { range: col(2), properties: { pixelSize: 150 }, fields: "pixelSize" } }, // C Phone
        { updateDimensionProperties: { range: col(3), properties: { pixelSize: 110 }, fields: "pixelSize" } }, // D Room
        { updateDimensionProperties: { range: col(4), properties: { pixelSize: 130 }, fields: "pixelSize" } }, // E Check-in
        { updateDimensionProperties: { range: col(5), properties: { pixelSize: 130 }, fields: "pixelSize" } }, // F Check-out
        { updateDimensionProperties: { range: col(6), properties: { pixelSize: 140 }, fields: "pixelSize" } }, // G Amount
        { updateDimensionProperties: { range: col(7), properties: { pixelSize: 170 }, fields: "pixelSize" } }, // H Booking Date
        { updateDimensionProperties: { range: col(8), properties: { pixelSize: 90 }, fields: "pixelSize" } }, // I Stayed
        { updateDimensionProperties: { range: col(9), properties: { pixelSize: 260 }, fields: "pixelSize" } }, // J Invoice
        { updateDimensionProperties: { range: col(10), properties: { pixelSize: 260 }, fields: "pixelSize" } }, // K KPI

        // Row heights for title/subtitle/divider/header.
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
                    endIndex: 3, // divider row
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
                    endIndex: 4, // header row
                },
                properties: { pixelSize: 32 },
                fields: "pixelSize",
            },
        },

        // Table banding for B:J (DATA rows only; exclude header to keep it crisp).
        {
            addBanding: {
                bandedRange: {
                    range: {
                        sheetId,
                        startRowIndex: 4, // start at row 5
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

        // Data formats: dates + currency + boolean alignment.
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 2000,
                    startColumnIndex: 4, // E
                    endColumnIndex: 6, // F (exclusive)
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
                    startColumnIndex: 6, // G
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
                    startColumnIndex: 7, // H
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
                    startColumnIndex: 8, // I
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

        // KPI card styling (K1:K2) – Lofty red header + charcoal value.
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1, // K1
                    startColumnIndex: 10, // K
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
                    endRowIndex: 2, // K2
                    startColumnIndex: 10, // K2
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
                fields:
                    "userEnteredFormat(backgroundColor,numberFormat,horizontalAlignment,textFormat)",
            },
        },

        // Borders around the table (B4:J2000).
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

        // Create a filter on the header row (B4:J4).
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

        // Conditional formatting: if Stayed is FALSE, grey + strikethrough the row (B:J).
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
                            // Data starts at row 5; use row-relative reference.
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

        // Conditional formatting: Stayed TRUE (only on column I) – green "pill" feel.
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [
                        {
                            sheetId,
                            startRowIndex: 4,
                            endRowIndex: 2000,
                            startColumnIndex: 8, // I only
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
        // Stayed FALSE (column I) – red "pill" feel (in addition to row strike/grey).
        {
            addConditionalFormatRule: {
                rule: {
                    ranges: [
                        {
                            sheetId,
                            startRowIndex: 4,
                            endRowIndex: 2000,
                            startColumnIndex: 8, // I only
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
        spreadsheetId: SHEET_ID,
        requestBody: { requests },
    });
}

/**
 * Ensures a tab exists for the calendar month of `date`. New tabs get a header row on B1:J1.
 * Returns the sheet title as stored in the spreadsheet.
 */
async function ensureMonthSheet(sheets, date) {
    const title = formatMonthTabTitle(date);
    const titles = await listSpreadsheetSheetTitles(sheets);
    const already = findSheetTitleCaseInsensitive(titles, title);
    if (already) {
        return already;
    }

    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
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
        spreadsheetId: SHEET_ID,
        range: `${q}!B1:B2`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [
                ["LOFTY XPHERE HOMES"],
                [`${title} — Bookings`],
            ],
        },
    });

    // Column headers live on row 4 (B4:J4).
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${q}!B4:J4`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [BOOKING_HEADER_ROW] },
    });

    // Monthly summary (exclude cancellations: only Stayed=TRUE).
    // Amount column = G, Stayed column = I.
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        // Put it outside the booking table (B–J) to avoid append/table-range shifting.
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

    // Apply "Lofty" branded styling to the new tab.
    await applyMonthSheetBranding(sheets, title);

    return title;
}

async function findInvoiceRowInSheet(sheets, sheetTitle, invoiceId) {
    const q = quoteSheetNameForRange(sheetTitle);
    const col = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
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

async function appendToSheet(data) {
    requireSheetId();

    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const bookingDate = data.bookingDate instanceof Date ? data.bookingDate : null;
    const resolvedBookingDate =
        bookingDate && !Number.isNaN(bookingDate.getTime())
            ? bookingDate
            : getBookingDateForSheet();

    // Pick the destination tab by stay month (check-in), falling back to booking month.
    const stayStart = deriveStayStartDate(data.checkIn, resolvedBookingDate);
    const sheetMonthDate = stayStart ?? resolvedBookingDate;

    const monthTitle = await ensureMonthSheet(sheets, sheetMonthDate);
    const q = quoteSheetNameForRange(monthTitle);

    // Sheet columns B–J: Name, Phone, Room, Check-in, Check-out, Amount, Booking date, Stayed, Invoice ID
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        // Data starts from row 5 (row 4 is header).
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

async function setStayedByInvoiceId({ invoiceId, stayed }) {
    requireSheetId();

    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

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
        spreadsheetId: SHEET_ID,
        range: `${q}!I${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[stayed]] },
    });

    return { updated: true, appended: false, rowNumber, sheetTitle };
}

/* =========================
   INVOICE GENERATOR
========================= */

/** Escape `$` so String#replaceAll replacement strings stay literal. */
function forReplace(value) {
    return String(value ?? "").replace(/\$/g, "$$");
}

function formatDateDisplay(date) {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }).format(date);
    } catch {
        return date.toLocaleDateString();
    }
}

function parseDateSafely(value) {
    const d = new Date(String(value ?? "").trim());
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse stay dates; yearless strings (e.g. "Aug 10") use the current year so nights match the invoice. */
function parseStayDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/\b(19|20)\d{2}\b/.test(raw)) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const y = new Date().getFullYear();
    const d = new Date(`${raw} ${y}`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derive the stay start date (check-in) for deciding which month tab to write into.
 *
 * If check-in is yearless (e.g. "Aug 10"), we assume the booking year, and if that
 * would land "in the past" relative to the booking date, we roll it into next year.
 */
function deriveStayStartDate(checkInRaw, bookingDate) {
    const raw = String(checkInRaw ?? "").trim();
    if (!raw) return null;

    // If it already includes a year, trust normal parsing.
    if (/\b(19|20)\d{2}\b/.test(raw)) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const ref =
        bookingDate instanceof Date && !Number.isNaN(bookingDate.getTime())
            ? bookingDate
            : new Date();

    // Try parsing as "Mon DD" (and other Date() compatible formats) with booking year.
    const assumed = new Date(`${raw} ${ref.getFullYear()}`);
    if (Number.isNaN(assumed.getTime())) return null;

    // If assumed check-in is meaningfully before booking date, assume next year.
    // (Handles: booking in Nov for "Jan 10" stay.)
    const oneWeekMs = 7 * 86400000;
    if (assumed.getTime() < ref.getTime() - oneWeekMs) {
        assumed.setFullYear(assumed.getFullYear() + 1);
    }

    return assumed;
}

/** Whole nights between check-in and check-out (nights = calendar days between dates). */
function formatNightsLabel(checkIn, checkOut) {
    const start = parseStayDate(checkIn);
    const end = parseStayDate(checkOut);
    if (!start || !end) return "—";
    const nights = Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 86400000),
    );
    if (nights === 1) return "1 night";
    return `${nights} nights`;
}

function makeInvoiceNumber(data, referenceDate = new Date()) {
    const now =
        referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
            ? referenceDate
            : new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const last4 = String(data?.phone ?? "")
        .replace(/\D/g, "")
        .slice(-4);
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `LXH-${y}${m}${d}-${last4 || "GUEST"}-${rand}`;
}

async function generateInvoice(data) {
    const browser = await puppeteer.launch({ channel: "chrome" });
    const page = await browser.newPage();

    let html = fs.readFileSync(path.join(__dirname, "invoice.html"), "utf8");

    const logoPath = path.join(__dirname, "images", "logo.png");
    const logoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
    html = html.replaceAll("{{LOGO_SRC}}", logoDataUri);

    const amountDisplay =
        typeof data.amount === "number"
            ? data.amount.toLocaleString("en-NG")
            : forReplace(data.amount);

    const now = new Date();
    const issueDate = formatDateDisplay(now);

    const businessName = process.env.BUSINESS_NAME || "Lofty Xphere Homes";
    const businessPhone =
        process.env.BUSINESS_PHONE ||
        process.env.WHATSAPP_PHONE ||
        "08161122328";
    const businessEmail =
        process.env.BUSINESS_EMAIL || "hello@loftyxpherehomes.com";

    html = html
        .replaceAll("{{name}}", forReplace(data.name))
        .replaceAll("{{phone}}", forReplace(data.phone))
        .replaceAll("{{apartment}}", forReplace(data.apartment))
        .replaceAll("{{checkIn}}", forReplace(data.checkIn))
        .replaceAll("{{checkOut}}", forReplace(data.checkOut))
        .replaceAll("{{amount}}", amountDisplay)
        .replaceAll("{{status}}", "Paid")
        .replaceAll(
            "{{invoiceNumber}}",
            forReplace(data.invoiceId ?? makeInvoiceNumber(data)),
        )
        .replaceAll("{{issueDate}}", forReplace(issueDate))
        .replaceAll("{{businessName}}", forReplace(businessName))
        .replaceAll("{{businessPhone}}", forReplace(businessPhone))
        .replaceAll("{{businessEmail}}", forReplace(businessEmail))
        .replaceAll(
            "{{nightsLabel}}",
            forReplace(formatNightsLabel(data.checkIn, data.checkOut)),
        );

    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    const invoicesDir = path.join(__dirname, "invoices");
    fs.mkdirSync(invoicesDir, { recursive: true });
    const filePath = path.join(invoicesDir, `invoice_${Date.now()}.pdf`);

    await page.pdf({
        path: filePath,
        format: "A4",
    });

    await browser.close();

    return filePath;
}

/* =========================
   BOOKING HANDLER
========================= */
async function handleBooking(message) {
    console.log("🔥 Processing booking...");

    const bookingDate = getBookingDateForSheet();
    if (isMockBookingDateActive()) {
        const stayStart = deriveStayStartDate(message.checkIn, bookingDate);
        const targetMonth = formatMonthTabTitle(stayStart ?? bookingDate);
        console.warn(
            "[MOCK] Using shifted booking date for invoice id + booking timestamp:",
            bookingDate.toISOString(),
            `(destination month tab: ${targetMonth})`,
        );
    }

    // Mock data (later replace with parser)
    const base = {
        name: message.name,
        phone: message.phoneNumber,
        apartment: message.apartment,
        checkIn: message.checkIn,
        checkOut: message.checkOut,
        amount: message.amount,
    };
    const invoiceId = makeInvoiceNumber(base, bookingDate);
    const data = {
        ...base,
        bookingDate,
        stayed: true,
        invoiceId,
    };

    // 1. Generate Invoice
    const invoicePath = await generateInvoice(data);
    console.log("Invoice created:", invoicePath);

    // 2. Save to Google Sheets
    await appendToSheet(data);
    console.log("Saved to Google Sheets ✅");

    // 3. (Later) send back via WhatsApp API
}

/* =========================
   WEBHOOK ENDPOINT
========================= */
app.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message) {
            const text = message.text?.body;

            console.log("Incoming:", text);

            // Trigger phrase
            if (
                text?.toLowerCase().includes("your invoice will be generated")
            ) {
                await handleBooking(message);
            } else if (text?.toLowerCase().includes("booking cancelled")) {
                const invoiceId = parseInvoiceIdFromText(text);
                if (!invoiceId) {
                    throw new Error(
                        "Booking cancelled message missing invoiceId. Include something like 'Invoice ID: LXH-20260414-1234-ABCD'.",
                    );
                }
                await setStayedByInvoiceId({ invoiceId, stayed: false });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        const status = err.statusCode || 500;
        const message =
            status === 404 && err.message
                ? err.message
                : "Internal server error";
        if (status === 404) {
            return res.status(404).json({ error: message });
        }
        res.sendStatus(500);
    }
});

/* =========================
   TEST ROUTE (OPTIONAL)
========================= */
app.get("/", (req, res) => {
    res.send("Server running 🚀");
});

app.listen(3000, () => console.log("Server running on port 3000"));

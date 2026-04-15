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
        range: `${q}!B1:J1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [BOOKING_HEADER_ROW] },
    });

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

    const bookingDate = getBookingDateForSheet();
    const monthTitle = await ensureMonthSheet(sheets, bookingDate);
    const q = quoteSheetNameForRange(monthTitle);

    // Sheet columns B–J: Name, Phone, Room, Check-in, Check-out, Amount, Booking date, Stayed, Invoice ID
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${q}!B:J`,
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
                    bookingDate.toLocaleString(),
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
        console.warn(
            "[MOCK] Using shifted booking date for tab + invoice id:",
            bookingDate.toISOString(),
            `(month tab: ${formatMonthTabTitle(bookingDate)})`,
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

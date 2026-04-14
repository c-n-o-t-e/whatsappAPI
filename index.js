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
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";

function requireSheetId() {
    if (!SHEET_ID || typeof SHEET_ID !== "string" || !SHEET_ID.trim()) {
        throw new Error(
            "Missing SHEET_ID. Set SHEET_ID in .env (or environment) to your Google Spreadsheet ID."
        );
    }
}

function parseInvoiceIdFromText(text) {
    const t = String(text ?? "").trim();
    if (!t) return null;

    const labeled = t.match(
        /invoice\s*(?:id|number)?\s*[:#-]?\s*(LXH-[A-Z0-9]+(?:-[A-Z0-9]+)+)/i
    );
    if (labeled?.[1]) return labeled[1];

    const embedded = t.match(/\b(LXH-[A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i);
    return embedded?.[1] ?? null;
}

async function appendToSheet(data) {
    requireSheetId();

    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:I`,
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
                    new Date().toLocaleString(),
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

    // invoiceId column is I (9th). Read it and find row index.
    const col = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!I:I`,
    });

    const values = col.data.values || [];
    const rowIndex0 = values.findIndex(
        (row) => String(row?.[0] ?? "").trim() === String(invoiceId).trim()
    );

    // If not found, append a minimal "cancellation" row so you still capture it.
    if (rowIndex0 === -1) {
        await appendToSheet({
            name: "",
            phone: "",
            apartment: "",
            checkIn: "",
            checkOut: "",
            amount: "",
            stayed,
            invoiceId,
        });
        return { updated: false, appended: true };
    }

    // Sheets rows are 1-indexed. Update H (stayed) in the matched row.
    const rowNumber = rowIndex0 + 1;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!H${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[stayed]] },
    });

    return { updated: true, appended: false, rowNumber };
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

function makeInvoiceNumber(data) {
    const now = new Date();
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

    let html = fs.readFileSync("./invoice.html", "utf8");

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
            forReplace(data.invoiceId ?? makeInvoiceNumber(data))
        )
        .replaceAll("{{issueDate}}", forReplace(issueDate))
        .replaceAll("{{businessName}}", forReplace(businessName))
        .replaceAll("{{businessPhone}}", forReplace(businessPhone))
        .replaceAll("{{businessEmail}}", forReplace(businessEmail));

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

    // Mock data (later replace with parser)
    const base = {
        name: message.name,
        phone: message.phoneNumber,
        apartment: message.apartment,
        checkIn: message.checkIn,
        checkOut: message.checkOut,
        amount: message.amount,
    };
    const invoiceId = makeInvoiceNumber(base);
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
                        "Booking cancelled message missing invoiceId. Include something like 'Invoice ID: LXH-20260414-1234-ABCD'."
                    );
                }
                await setStayedByInvoiceId({ invoiceId, stayed: false });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error(err);
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

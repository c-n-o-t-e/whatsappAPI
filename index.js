const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

/* =========================
   GOOGLE SHEETS SETUP
========================= */
const SHEET_ID = "YOUR_SHEET_ID";

async function appendToSheet(data) {
    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Sheet1!A:G",
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
                ],
            ],
        },
    });
}

/* =========================
   INVOICE GENERATOR
========================= */

async function generateInvoice(data) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    let html = fs.readFileSync("./invoice.html", "utf8");

    html = html
        .replace("{{name}}", data.name)
        .replace("{{phone}}", data.phone)
        .replace("{{apartment}}", data.apartment)
        .replace("{{checkIn}}", data.checkIn)
        .replace("{{checkOut}}", data.checkOut)
        .replace("{{amount}}", data.amount);

    await page.setContent(html);

    const filePath = `./invoices/invoice_${Date.now()}.pdf`;

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
    const data = {
        name: "John Doe",
        phone: message.from,
        apartment: "Lekki 2BR",
        checkIn: "Aug 10",
        checkOut: "Aug 12",
        amount: 250000,
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

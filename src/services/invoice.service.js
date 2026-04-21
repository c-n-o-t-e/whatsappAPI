const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const config = require("../config");
const { formatNightsLabel } = require("../utils/dates");
const { makeInvoiceNumber, randomInvoiceCode } = require("../utils/invoiceId");

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

async function generateInvoice(data) {
    const browser = await puppeteer.launch({ channel: "chrome" });
    const page = await browser.newPage();

    let html = fs.readFileSync(
        path.join(config.PROJECT_ROOT, "invoice.html"),
        "utf8",
    );

    const logoPath = path.join(config.PROJECT_ROOT, "images", "logo.png");
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

    const invoicesDir = path.join(config.PROJECT_ROOT, "invoices");
    fs.mkdirSync(invoicesDir, { recursive: true });

    const safeId = String(data?.invoiceId || "")
        .trim()
        .replace(/[^A-Za-z0-9-]/g, "");
    const baseName = safeId ? `inv_${safeId}` : `inv_${randomInvoiceCode(10)}`;
    let filePath = path.join(invoicesDir, `${baseName}.pdf`);
    for (let i = 2; fs.existsSync(filePath); i++) {
        filePath = path.join(invoicesDir, `${baseName}-${i}.pdf`);
    }

    await page.pdf({
        path: filePath,
        format: "A4",
    });

    await browser.close();

    return filePath;
}

module.exports = {
    generateInvoice,
};

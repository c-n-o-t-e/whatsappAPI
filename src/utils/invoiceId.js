const crypto = require("crypto");

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

/** Date portion in invoice ids → Date (local). Format: LXH-YYMMDD-XXXXXX */
function parseDateFromInvoiceId(invoiceId) {
    const s = String(invoiceId || "").trim();
    const compact = s.match(/^LXH-(\d{2})(\d{2})(\d{2})-/i);
    if (!compact) return null;
    const y = 2000 + Number(compact[1]);
    const mo = Number(compact[2]);
    const d = Number(compact[3]);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function randomInvoiceCode(length = 6) {
    const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function makeInvoiceNumber(data, referenceDate = new Date()) {
    const now =
        referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
            ? referenceDate
            : new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const code = randomInvoiceCode(6);
    return `LXH-${yy}${mm}${dd}-${code}`;
}

/** Accept pasted invoice id or free text containing an LXH-… id (same rules as WhatsApp cancel). */
function resolveInvoiceIdFromFormInput(raw) {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    return (
        parseInvoiceIdFromText(t) ||
        parseInvoiceIdFromText(`Invoice ID: ${t}`)
    );
}

module.exports = {
    parseInvoiceIdFromText,
    parseDateFromInvoiceId,
    randomInvoiceCode,
    makeInvoiceNumber,
    resolveInvoiceIdFromFormInput,
};

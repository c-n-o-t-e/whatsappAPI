const path = require("path");
const { appendToSheet } = require("../integrations/sheets.booking");
const { generateInvoice } = require("./invoice.service");
const {
    getBookingDateForSheet,
    isMockBookingDateActive,
    deriveStayStartDate,
    formatMonthTabTitle,
} = require("../utils/dates");
const { makeInvoiceNumber } = require("../utils/invoiceId");

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

    const base = {
        name: message.name,
        phone: message.phoneNumber ?? message.phone,
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

    const invoicePath = await generateInvoice(data);
    console.log("Invoice created:", invoicePath);

    await appendToSheet(data);
    console.log("Saved to Google Sheets ✅");

    const invoiceUrlPath = `/invoices/${path.basename(invoicePath)}`;
    return { invoicePath: invoiceUrlPath };
}

module.exports = {
    handleBooking,
};

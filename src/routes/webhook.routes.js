const express = require("express");
const { handleBooking } = require("../services/booking.service");
const { setStayedByInvoiceId } = require("../integrations/sheets.cancel");
const { parseInvoiceIdFromText } = require("../utils/invoiceId");

const router = express.Router();

router.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message) {
            const text = message.text?.body;

            console.log("Incoming:", text);

            if (
                text?.toLowerCase().includes("your invoice will be generated")
            ) {
                await handleBooking(message);
            } else if (text?.toLowerCase().includes("booking cancelled")) {
                const invoiceId = parseInvoiceIdFromText(text);
                if (!invoiceId) {
                    throw new Error(
                        "Booking cancelled message missing invoiceId. Include something like 'Invoice ID: LXH-260414-7K3P9D'.",
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

module.exports = router;

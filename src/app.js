const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const config = require("./config");
const webhookRoutes = require("./routes/webhook.routes");
const bookingRoutes = require("./routes/booking.routes");

function createApp() {
    const app = express();

    app.use(express.json());
    app.use(bodyParser.json());
    app.use(express.urlencoded({ extended: true }));

    app.use(
        "/invoices",
        express.static(path.join(config.PROJECT_ROOT, "invoices")),
    );

    app.use(webhookRoutes);
    app.use(bookingRoutes);

    return app;
}

module.exports = { createApp };

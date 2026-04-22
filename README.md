# WhatsApp API (booking + invoices + Google Sheets)

Express server that:

- Accepts a **WhatsApp Cloud API**-style webhook and triggers booking or cancellation flows from message text.
- Serves a small **HTML UI** to create bookings and cancel by invoice ID.
- Generates **invoice PDFs** with Puppeteer (Chrome) from `invoice.html`, stores them under `invoices/`, and serves them at `/invoices/<filename>`.
- Appends bookings to **Google Sheets** (monthly tabs, branded layout) and updates the **Stayed** column on cancellation.

## Requirements

- **Node.js** (CommonJS; see `package.json` for dependencies).
- **Google Chrome** installed locally (Puppeteer uses `puppeteer-core` with `channel: "chrome"`).
- A **Google Cloud** service account with access to the target spreadsheet, and **`credentials.json`** in the project directory (path is resolved relative to the process **current working directory**).

## Setup

```bash
npm install
```

Create a `.env` file in the project root (loaded from `process.cwd()`). Minimum for Sheets:

| Variable | Description |
|----------|-------------|
| `SHEET_ID` | Google Spreadsheet ID (required when appending/updating the sheet). |

Optional branding (invoice PDF):

| Variable | Default |
|----------|---------|
| `BUSINESS_NAME` | Lofty Xphere Homes |
| `BUSINESS_PHONE` | `WHATSAPP_PHONE` or `08161122328` |
| `WHATSAPP_PHONE` | (fallback for phone line above) |
| `BUSINESS_EMAIL` | hello@loftyxpherehomes.com |

Optional **dev-only** date shifting (tab selection + invoice ID date prefix):

| Variable | Description |
|----------|-------------|
| `MOCK_BOOKING_DATE` | Fixed date `YYYY-MM-DD` (wins if both mock vars are set). |
| `MOCK_BOOKING_MONTH_OFFSET` | Integer month offset from “today” (e.g. `1` = next month). |

Place **`credentials.json`** (service account key) so it resolves as `./credentials.json` when you start the server from the project root.

## Run

```bash
npm start
```

Or:

```bash
node src/server.js
node index.js
```

Default listen: **port 3000**.

## HTTP routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhook` | Meta/WhatsApp-style JSON body; see behavior below. |
| `GET` | `/` | Create-booking form. |
| `POST` | `/create-booking` | Form post → PDF + Sheets row. |
| `GET` | `/cancel-booking` | Cancel form. |
| `POST` | `/cancel-booking` | Set **Stayed** to `FALSE` for the invoice ID. |
| static | `/invoices/*` | Generated PDFs. |

### Webhook behavior (summary)

- If a message body contains **“your invoice will be generated”** (case-insensitive), the app runs the booking pipeline (invoice + append row).
- If the body contains **“booking cancelled”**, it parses an invoice id from the text (e.g. `LXH-YYMMDD-XXXXXX`) and sets **Stayed** to `FALSE`.
- Success: `200`. Missing invoice on cancel: `404` with JSON `{ "error": "..." }`. Other errors: `500`.

## Project layout

```text
src/
  server.js          # listen
  app.js             # Express app (middleware, static, routes)
  config.js          # dotenv, PROJECT_ROOT, SHEET_ID helper
  routes/            # webhook + booking pages
  services/          # handleBooking, PDF generation
  integrations/      # Google Sheets client + booking/cancel ops
  utils/             # dates, html escape, invoice id helpers
invoice.html         # PDF template (project root)
images/              # e.g. logo for invoice
invoices/            # generated PDFs (gitignored if you choose)
```

## Invoice IDs and files

- Invoice id format: **`LXH-YYMMDD-XXXXXX`** (Crockford-style suffix).
- PDF filename prefix: **`inv_<invoiceId>.pdf`** (with numeric suffix if the file already exists).

## Security notes

- **`/webhook`**, **`/`**, **`/create-booking`**, and **`/cancel-booking`** are not authenticated in code. Protect them (network, reverse proxy, signature verification for WhatsApp, or app-level auth) if exposed publicly.
- Do not commit **`credentials.json`** or secrets in `.env`.
- Validate and verify WhatsApp webhook signatures in production.

## License

ISC (see `package.json`).

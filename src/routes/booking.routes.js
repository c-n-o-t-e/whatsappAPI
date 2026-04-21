const express = require("express");
const { handleBooking } = require("../services/booking.service");
const { setStayedByInvoiceId } = require("../integrations/sheets.cancel");
const { escapeHtml } = require("../utils/html");
const { resolveInvoiceIdFromFormInput } = require("../utils/invoiceId");

const router = express.Router();

router.get("/", (req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Create Booking</title>
    <style>
      :root{
        --ink:#1F1F1F;
        --muted:#5C5856;
        --paper:#F6F5F3;
        --card:#FFFFFF;
        --border:#D8D4CF;
        --accent:#8B2D35;
        --shadow:0 10px 30px rgba(0,0,0,.08);
        --radius:14px;
      }
      *{box-sizing:border-box}
      body{
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color:var(--ink);
        background: radial-gradient(1200px 700px at 20% -10%, rgba(139,45,53,.12), transparent 60%),
                    radial-gradient(900px 600px at 90% 0%, rgba(31,31,31,.08), transparent 55%),
                    var(--paper);
      }
      .wrap{max-width:760px;margin:32px auto;padding:0 16px}
      .header{
        display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;
        margin-bottom:14px
      }
      h1{font-size:22px;line-height:1.2;margin:0}
      .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
      .badge{
        border:1px solid var(--border);
        background:rgba(255,255,255,.7);
        backdrop-filter:saturate(180%) blur(8px);
        padding:10px 12px;border-radius:999px;font-size:12px;color:var(--muted)
      }
      .card{
        background:var(--card);
        border:1px solid var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow);
        overflow:hidden
      }
      .bar{height:6px;background:linear-gradient(90deg,var(--accent), #5b1c22)}
      form{padding:18px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media (max-width: 640px){.grid{grid-template-columns:1fr}}
      label{display:block;font-size:12px;color:var(--muted);margin:2px 0 6px}
      input{
        width:100%;
        padding:12px 12px;
        border:1px solid var(--border);
        border-radius:12px;
        font-size:14px;
        outline:none;
        background:#fff;
      }
      input:focus{border-color:rgba(139,45,53,.55);box-shadow:0 0 0 4px rgba(139,45,53,.12)}
      .full{grid-column:1/-1}
      .actions{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
      button{
        appearance:none;border:0;
        padding:12px 14px;
        border-radius:12px;
        background:var(--accent);
        color:#fff;
        font-weight:600;
        font-size:14px;
        cursor:pointer;
      }
      button:hover{filter:brightness(.98)}
      button[disabled]{opacity:.78;cursor:not-allowed}
      .btnInner{display:inline-flex;align-items:center;gap:10px}
      .spinner{
        width:16px;height:16px;border-radius:999px;
        border:2px solid rgba(255,255,255,.45);
        border-top-color: rgba(255,255,255,1);
        animation: spin .8s linear infinite;
        display:none;
      }
      button.isLoading .spinner{display:inline-block}
      button.isLoading .label{opacity:.95}
      @keyframes spin{to{transform:rotate(360deg)}}
      .hint{font-size:12px;color:var(--muted);margin:0}
      .req{color:var(--accent);font-weight:700}
      .nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .nav a{
        font-size:13px;font-weight:600;text-decoration:none;color:var(--accent);
        padding:8px 12px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.85)
      }
      .nav a:hover{background:var(--paper)}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        <div>
          <h1>Create booking</h1>
          <p class="sub">Generates an invoice PDF and logs the booking to Google Sheets.</p>
          <nav class="nav" aria-label="Booking tools">
            <a href="/" aria-current="page">New booking</a>
            <a href="/cancel-booking">Cancel booking</a>
          </nav>
        </div>
        <div class="badge">Lofty Xphere Homes</div>
      </div>

      <div class="card">
        <div class="bar"></div>
        <form method="POST" action="/create-booking">
          <div class="grid">
            <div>
              <label for="name">Name <span class="req">*</span></label>
              <input id="name" name="name" autocomplete="name" required />
            </div>
            <div>
              <label for="phone">Phone <span class="req">*</span></label>
              <input id="phone" name="phone" autocomplete="tel" inputmode="tel" required />
            </div>
            <div>
              <label for="apartment">Room Code / Apartment <span class="req">*</span></label>
              <input id="apartment" name="apartment" required />
            </div>
            <div>
              <label for="amount">Amount (₦) <span class="req">*</span></label>
              <input id="amount" name="amount" inputmode="numeric" placeholder="e.g. 950000" required />
            </div>
            <div>
              <label for="checkIn">Check-in <span class="req">*</span></label>
              <input id="checkIn" name="checkIn" type="date" required />
            </div>
            <div>
              <label for="checkOut">Check-out <span class="req">*</span></label>
              <input id="checkOut" name="checkOut" type="date" required />
            </div>
            <div class="full">
              <p class="hint">Tip: date pickers will submit as YYYY-MM-DD (works with Google Sheets + invoice generation).</p>
            </div>
          </div>
          <div class="actions">
            <button type="submit" data-default-label="Create Booking" data-loading-label="Processing…">
              <span class="btnInner">
                <span class="spinner" aria-hidden="true"></span>
                <span class="label">Create Booking</span>
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
    <script>
      (function () {
        var form = document.querySelector('form[action="/create-booking"]');
        if (!form) return;
        var btn = form.querySelector('button[type="submit"]');
        if (!btn) return;

        form.addEventListener('submit', function () {
          if (btn.disabled) return;
          btn.disabled = true;
          btn.classList.add('isLoading');
          var labelEl = btn.querySelector('.label');
          var loading = btn.getAttribute('data-loading-label') || 'Processing…';
          if (labelEl) labelEl.textContent = loading;
          btn.setAttribute('aria-busy', 'true');
        });
      })();
    </script>
  </body>
</html>`);
});

router.post("/create-booking", async (req, res) => {
    try {
        const raw = req.body || {};
        const name = String(raw.name ?? "").trim();
        const phone = String(raw.phone ?? "").trim();
        const apartment = String(raw.apartment ?? "").trim();
        const checkIn = String(raw.checkIn ?? "").trim();
        const checkOut = String(raw.checkOut ?? "").trim();
        const amountRaw = String(raw.amount ?? "").trim();

        const missing = [];
        if (!name) missing.push("name");
        if (!phone) missing.push("phone");
        if (!apartment) missing.push("apartment");
        if (!checkIn) missing.push("checkIn");
        if (!checkOut) missing.push("checkOut");
        if (!amountRaw) missing.push("amount");

        if (missing.length) {
            return res.status(400).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Missing fields</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Missing required fields</h2>
  <p>Please fill: <strong>${escapeHtml(missing.join(", "))}</strong></p>
  <p><a href="/" style="color:#8B2D35">Go back</a></p>
</body></html>`);
        }

        const amountNumber = Number(String(amountRaw).replace(/,/g, ""));
        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            return res.status(400).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Invalid amount</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Invalid amount</h2>
  <p>Amount must be a positive number.</p>
  <p><a href="/" style="color:#8B2D35">Go back</a></p>
</body></html>`);
        }

        const result = await handleBooking({
            name,
            phone,
            apartment,
            checkIn,
            checkOut,
            amount: amountNumber,
        });

        const invoicePath = result?.invoicePath;
        if (!invoicePath) {
            throw new Error(
                "Invoice was generated but no invoicePath was returned.",
            );
        }

        res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Booking Created</title>
    <style>
      :root{--ink:#1F1F1F;--muted:#5C5856;--paper:#F6F5F3;--card:#fff;--border:#D8D4CF;--accent:#8B2D35;--shadow:0 10px 30px rgba(0,0,0,.08);--radius:14px;}
      *{box-sizing:border-box}
      body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--paper);color:var(--ink)}
      .wrap{max-width:760px;margin:32px auto;padding:0 16px}
      .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
      .bar{height:6px;background:linear-gradient(90deg,var(--accent), #5b1c22)}
      .content{padding:18px}
      h2{margin:0 0 8px;font-size:20px}
      p{margin:0 0 14px;color:var(--muted)}
      a.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 14px;border-radius:12px;font-weight:600}
      a.link{color:var(--accent)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="bar"></div>
        <div class="content">
          <h2>Booking Created ✅</h2>
          <p>Your invoice is ready.</p>
          <div class="row">
            <a class="btn" href="${invoicePath}" download>Download Invoice</a>
            <a class="link" href="/">Create another booking</a>
            <a class="link" href="/cancel-booking">Cancel a booking</a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`);
    } catch (err) {
        console.error(err);
        res.status(500).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Error</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Something went wrong</h2>
  <p>${escapeHtml(err?.message || "Internal server error")}</p>
  <p><a href="/" style="color:#8B2D35">Go back</a></p>
</body></html>`);
    }
});

router.get("/cancel-booking", (req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Cancel Booking</title>
    <style>
      :root{
        --ink:#1F1F1F;
        --muted:#5C5856;
        --paper:#F6F5F3;
        --card:#FFFFFF;
        --border:#D8D4CF;
        --accent:#8B2D35;
        --shadow:0 10px 30px rgba(0,0,0,.08);
        --radius:14px;
      }
      *{box-sizing:border-box}
      body{
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        color:var(--ink);
        background: radial-gradient(1200px 700px at 20% -10%, rgba(139,45,53,.12), transparent 60%),
                    radial-gradient(900px 600px at 90% 0%, rgba(31,31,31,.08), transparent 55%),
                    var(--paper);
      }
      .wrap{max-width:760px;margin:32px auto;padding:0 16px}
      .header{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
      h1{font-size:22px;line-height:1.2;margin:0}
      .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
      .badge{
        border:1px solid var(--border);
        background:rgba(255,255,255,.7);
        backdrop-filter:saturate(180%) blur(8px);
        padding:10px 12px;border-radius:999px;font-size:12px;color:var(--muted)
      }
      .nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .nav a{
        font-size:13px;font-weight:600;text-decoration:none;color:var(--accent);
        padding:8px 12px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.85)
      }
      .nav a:hover{background:var(--paper)}
      .card{
        background:var(--card);
        border:1px solid var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow);
        overflow:hidden
      }
      .bar{height:6px;background:linear-gradient(90deg,var(--accent), #5b1c22)}
      form{padding:18px}
      label{display:block;font-size:12px;color:var(--muted);margin:2px 0 6px}
      input{
        width:100%;
        max-width:100%;
        padding:12px 12px;
        border:1px solid var(--border);
        border-radius:12px;
        font-size:14px;
        outline:none;
        background:#fff;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      input:focus{border-color:rgba(139,45,53,.55);box-shadow:0 0 0 4px rgba(139,45,53,.12)}
      .actions{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
      button{
        appearance:none;border:0;
        padding:12px 14px;
        border-radius:12px;
        background:var(--accent);
        color:#fff;
        font-weight:600;
        font-size:14px;
        cursor:pointer;
      }
      button:hover{filter:brightness(.98)}
      button[disabled]{opacity:.78;cursor:not-allowed}
      .btnInner{display:inline-flex;align-items:center;gap:10px}
      .spinner{
        width:16px;height:16px;border-radius:999px;
        border:2px solid rgba(255,255,255,.45);
        border-top-color: rgba(255,255,255,1);
        animation: spin .8s linear infinite;
        display:none;
      }
      button.isLoading .spinner{display:inline-block}
      button.isLoading .label{opacity:.95}
      @keyframes spin{to{transform:rotate(360deg)}}
      .hint{font-size:12px;color:var(--muted);margin:12px 0 0;line-height:1.45}
      .req{color:var(--accent);font-weight:700}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        <div>
          <h1>Cancel booking</h1>
          <p class="sub">Sets <strong>Stayed</strong> to FALSE in Google Sheets for this invoice (same as WhatsApp “booking cancelled”).</p>
          <nav class="nav" aria-label="Booking tools">
            <a href="/">New booking</a>
            <a href="/cancel-booking" aria-current="page">Cancel booking</a>
          </nav>
        </div>
        <div class="badge">Lofty Xphere Homes</div>
      </div>
      <div class="card">
        <div class="bar"></div>
        <form method="POST" action="/cancel-booking">
          <label for="invoiceId">Invoice ID <span class="req">*</span></label>
          <input id="invoiceId" name="invoiceId" placeholder="LXH-260414-7K3P9D" autocomplete="off" required />
          <p class="hint">Paste the full invoice id from the sheet or invoice PDF. You can also paste a sentence that contains the id.</p>
          <div class="actions">
            <button type="submit" data-default-label="Cancel booking" data-loading-label="Cancelling…">
              <span class="btnInner">
                <span class="spinner" aria-hidden="true"></span>
                <span class="label">Cancel booking</span>
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
    <script>
      (function () {
        var form = document.querySelector('form[action="/cancel-booking"]');
        if (!form) return;
        var btn = form.querySelector('button[type="submit"]');
        if (!btn) return;

        form.addEventListener('submit', function () {
          if (btn.disabled) return;
          btn.disabled = true;
          btn.classList.add('isLoading');
          var labelEl = btn.querySelector('.label');
          var loading = btn.getAttribute('data-loading-label') || 'Processing…';
          if (labelEl) labelEl.textContent = loading;
          btn.setAttribute('aria-busy', 'true');
        });
      })();
    </script>
  </body>
</html>`);
});

router.post("/cancel-booking", async (req, res) => {
    try {
        const raw = req.body || {};
        const invoiceInput = String(raw.invoiceId ?? "").trim();
        const invoiceId = resolveInvoiceIdFromFormInput(invoiceInput);

        if (!invoiceId) {
            return res.status(400).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Invalid invoice</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Could not read invoice ID</h2>
  <p>Enter a valid id like <code>LXH-YYMMDD-XXXXXX</code> (or paste text that includes it).</p>
  <p><a href="/cancel-booking" style="color:#8B2D35">Go back</a></p>
</body></html>`);
        }

        const result = await setStayedByInvoiceId({
            invoiceId,
            stayed: false,
        });

        res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Booking Cancelled</title>
    <style>
      :root{--ink:#1F1F1F;--muted:#5C5856;--paper:#F6F5F3;--card:#fff;--border:#D8D4CF;--accent:#8B2D35;--shadow:0 10px 30px rgba(0,0,0,.08);--radius:14px;}
      *{box-sizing:border-box}
      body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--paper);color:var(--ink)}
      .wrap{max-width:760px;margin:32px auto;padding:0 16px}
      .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
      .bar{height:6px;background:linear-gradient(90deg,var(--accent), #5b1c22)}
      .content{padding:18px}
      h2{margin:0 0 8px;font-size:20px}
      p{margin:0 0 10px;color:var(--muted);font-size:14px}
      code{background:#f0eeeb;padding:2px 6px;border-radius:6px;font-size:13px}
      a.link{color:var(--accent);font-weight:600}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="bar"></div>
        <div class="content">
          <h2>Booking cancelled ✅</h2>
          <p>Invoice <code>${escapeHtml(invoiceId)}</code> — Stayed set to <strong>FALSE</strong> on sheet <strong>${escapeHtml(result.sheetTitle)}</strong> (row ${escapeHtml(String(result.rowNumber))}).</p>
          <p><a class="link" href="/cancel-booking">Cancel another</a> · <a class="link" href="/">New booking</a></p>
        </div>
      </div>
    </div>
  </body>
</html>`);
    } catch (err) {
        console.error(err);
        const status = err.statusCode || 500;
        if (status === 404) {
            return res.status(404).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Not found</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Invoice not found</h2>
  <p>${escapeHtml(err?.message || "Invoice ID doesn't exist")}</p>
  <p><a href="/cancel-booking" style="color:#8B2D35">Go back</a></p>
</body></html>`);
        }
        res.status(500).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Error</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#F6F5F3;color:#1F1F1F">
  <h2>Something went wrong</h2>
  <p>${escapeHtml(err?.message || "Internal server error")}</p>
  <p><a href="/cancel-booking" style="color:#8B2D35">Go back</a></p>
</body></html>`);
    }
});

module.exports = router;

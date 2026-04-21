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

/** Tab title like "April 2026" from a Date (booking / invoice month). */
function formatMonthTabTitle(date) {
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
    }).format(date);
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

/**
 * Derive the stay start date (check-in) for deciding which month tab to write into.
 *
 * If check-in is yearless (e.g. "Aug 10"), we assume the booking year, and if that
 * would land "in the past" relative to the booking date, we roll it into next year.
 */
function deriveStayStartDate(checkInRaw, bookingDate) {
    const raw = String(checkInRaw ?? "").trim();
    if (!raw) return null;

    if (/\b(19|20)\d{2}\b/.test(raw)) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const ref =
        bookingDate instanceof Date && !Number.isNaN(bookingDate.getTime())
            ? bookingDate
            : new Date();

    const assumed = new Date(`${raw} ${ref.getFullYear()}`);
    if (Number.isNaN(assumed.getTime())) return null;

    const oneWeekMs = 7 * 86400000;
    if (assumed.getTime() < ref.getTime() - oneWeekMs) {
        assumed.setFullYear(assumed.getFullYear() + 1);
    }

    return assumed;
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

module.exports = {
    addMonths,
    parseMockBookingDateFromEnv,
    getBookingDateForSheet,
    isMockBookingDateActive,
    formatMonthTabTitle,
    parseStayDate,
    deriveStayStartDate,
    formatNightsLabel,
};

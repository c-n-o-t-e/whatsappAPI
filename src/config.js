/**
 * Central configuration and environment access.
 * dotenv loads once from process.cwd() (same as legacy index.js).
 */
require("dotenv").config();

const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");

/**
 * @returns {string|undefined}
 */
function getSheetId() {
    const id = process.env.SHEET_ID;
    if (id == null || typeof id !== "string" || !id.trim()) {
        return undefined;
    }
    return id.trim();
}

module.exports = {
    PROJECT_ROOT,
    getSheetId,
};

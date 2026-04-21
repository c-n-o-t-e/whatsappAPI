function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => {
        switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return c;
        }
    });
}

module.exports = { escapeHtml };

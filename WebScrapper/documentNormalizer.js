const path = require('path');

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const createDocumentId = (document) => {
    const source = `${document.date || ''}|${document.type || ''}|${document.title || ''}|${document.url || ''}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = (Math.imul(31, hash) + source.charCodeAt(i)) | 0;
    }
    return `pdf-${Math.abs(hash).toString(36)}`;
};

const normalizeUrl = (url, baseUrl) => {
    try {
        return new URL(url, baseUrl).href;
    } catch (_err) {
        return '';
    }
};

const normalizeDocuments = (documents, options = {}) => {
    const { scrapedAt = new Date().toISOString(), sourceUrl = '' } = options;
    const seen = new Set();
    const normalized = [];

    for (const rawDocument of Array.isArray(documents) ? documents : []) {
        const url = normalizeUrl(rawDocument && rawDocument.url, sourceUrl);
        if (!url) continue;

        const document = {
            date: normalizeText(rawDocument.date),
            type: normalizeText(rawDocument.type),
            title: normalizeText(rawDocument.title) || path.basename(url.split('?')[0]) || 'Dokument PDF',
            url,
            sourceUrl,
            scrapedAt,
        };

        const dedupeKey = document.url.toLowerCase();
        if (seen.has(dedupeKey)) continue;

        document.id = createDocumentId(document);
        seen.add(dedupeKey);
        normalized.push(document);
    }

    return normalized.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
};

module.exports = {
    createDocumentId,
    normalizeDocuments,
    normalizeText,
    normalizeUrl,
};

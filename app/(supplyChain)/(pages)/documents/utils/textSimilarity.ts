// Utility for calculating text similarity between OCR extracted document contents

/**
 * Clean and normalize text for comparison
 */
export function normalizeText(text: string | null | undefined): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generate n-grams (shingles) from a string
 */
function getNGrams(str: string, n: number = 3): Set<string> {
    const ngrams = new Set<string>();
    if (str.length < n) {
        if (str.length > 0) ngrams.add(str);
        return ngrams;
    }
    for (let i = 0; i <= str.length - n; i++) {
        ngrams.add(str.slice(i, i + n));
    }
    return ngrams;
}

/**
 * Calculate character-level n-gram Dice similarity coefficient (0.0 to 1.0)
 */
export function calculateDiceSimilarity(str1: string, str2: string, n: number = 3): number {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1.0;

    const ngrams1 = getNGrams(s1, n);
    const ngrams2 = getNGrams(s2, n);

    let intersection = 0;
    for (const gram of ngrams1) {
        if (ngrams2.has(gram)) {
            intersection++;
        }
    }

    const total = ngrams1.size + ngrams2.size;
    if (total === 0) return 0;
    return (2 * intersection) / total;
}

/**
 * Calculate token (word) Jaccard similarity (0.0 to 1.0)
 */
export function calculateTokenJaccard(str1: string, str2: string): number {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1.0;

    const words1 = new Set(s1.split(' ').filter(w => w.length > 1));
    const words2 = new Set(s2.split(' ').filter(w => w.length > 1));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const w of words1) {
        if (words2.has(w)) {
            intersection++;
        }
    }

    const union = new Set([...words1, ...words2]).size;
    if (union === 0) return 0;
    return intersection / union;
}

/**
 * Combined OCR text similarity score (0.0 to 1.0)
 */
export function calculateOcrTextSimilarity(text1: string | null | undefined, text2: string | null | undefined): number {
    if (!text1 || !text2) return 0;
    const s1 = normalizeText(text1);
    const s2 = normalizeText(text2);

    // If text is too short, avoid false positives
    if (s1.length < 15 || s2.length < 15) return 0;

    // Exact normalized match
    if (s1 === s2) return 1.0;

    // Substring containment with high length ratio
    if (s1.includes(s2) || s2.includes(s1)) {
        const ratio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
        if (ratio >= 0.70) {
            return Math.max(0.85, ratio);
        }
    }

    const tokenScore = calculateTokenJaccard(s1, s2);
    const diceScore = calculateDiceSimilarity(s1, s2, 3);

    // Weighted combination: 50% token overlap + 50% character n-gram Dice
    return (tokenScore * 0.5) + (diceScore * 0.5);
}

export interface DocumentSimilarityMatch {
    isSimilar: boolean;
    similarity: number; // 0 to 100
    matchedDoc: {
        id: string;
        title?: string;
        file_name?: string;
        supplier?: string;
        po_number?: string;
    };
    matchReason: string;
}

export interface DocumentInspectionData {
    text?: string | null;
    description?: string | null;
    summary?: string | null;
    po_number?: string | null;
    vendor_name?: string | null;
    file_name?: string | null;
    file_size?: number | null;
}

/**
 * Check if the newly extracted document data is similar or identical to any existing document in the system
 */
export function findSimilarExtractedDocument(
    newDataOrText: string | DocumentInspectionData | null | undefined,
    existingDocs: any[],
    excludeDocId?: string | null,
    similarityThreshold = 0.70 // 70% similarity threshold
): DocumentSimilarityMatch | null {
    if (!newDataOrText) return null;

    let newText = '';
    let newDesc = '';
    let newSummary = '';
    let newPo = '';
    let newFileName = '';
    let newFileSize: number | null = null;

    if (typeof newDataOrText === 'string') {
        newText = newDataOrText;
    } else {
        newText = newDataOrText.text || '';
        newDesc = newDataOrText.description || '';
        newSummary = newDataOrText.summary || '';
        newPo = newDataOrText.po_number || '';
        newFileName = newDataOrText.file_name || '';
        newFileSize = typeof newDataOrText.file_size === 'number' ? newDataOrText.file_size : null;
    }

    const newCombined = [newText, newDesc, newSummary].filter(Boolean).join(' ');
    if (newCombined.trim().length < 10 && !newFileName) {
        return null;
    }

    let highestMatch: DocumentSimilarityMatch | null = null;

    for (const doc of existingDocs) {
        if (excludeDocId && doc.id === excludeDocId) continue;

        const docExt = doc.extracted || {};
        const docText = docExt.text || '';
        const docDesc = docExt.description || '';
        const docSummary = docExt.summary || '';
        const docPo = doc.po_number || docExt.po_number || '';
        const docFileName = doc.file_name || '';
        const docFileSize = typeof doc.file_size === 'number' ? doc.file_size : null;

        // 1. Exact file match check
        if (newFileName && docFileName && newFileSize && docFileSize) {
            if (newFileName.toLowerCase().trim() === docFileName.toLowerCase().trim() && newFileSize === docFileSize) {
                return {
                    isSimilar: true,
                    similarity: 100,
                    matchedDoc: {
                        id: doc.id,
                        title: doc.title,
                        file_name: doc.file_name,
                        supplier: doc.supplier || docExt.vendor_name,
                        po_number: docPo,
                    },
                    matchReason: `Exact file match: "${doc.file_name}" (${doc.file_size} bytes) already exists in system.`,
                };
            }
        }

        // 2. Score individual dimensions
        let maxSim = 0;
        let matchField = '';

        // Compare text vs text
        if (newText.length >= 15 && docText.length >= 15) {
            const score = calculateOcrTextSimilarity(newText, docText);
            if (score > maxSim) {
                maxSim = score;
                matchField = 'Extracted OCR text';
            }
        }

        // Compare description vs description
        if (newDesc.length >= 15 && docDesc.length >= 15) {
            const score = calculateOcrTextSimilarity(newDesc, docDesc);
            if (score > maxSim) {
                maxSim = score;
                matchField = 'Photo visual description';
            }
        }

        // Compare summary vs summary
        if (newSummary.length >= 15 && docSummary.length >= 15) {
            const score = calculateOcrTextSimilarity(newSummary, docSummary);
            if (score > maxSim) {
                maxSim = score;
                matchField = 'Document summary';
            }
        }

        // Cross-compare text vs description or vice versa
        if (newText.length >= 15 && docDesc.length >= 15) {
            const score = calculateOcrTextSimilarity(newText, docDesc);
            if (score > maxSim) {
                maxSim = score;
                matchField = 'Content match';
            }
        }
        if (newDesc.length >= 15 && docText.length >= 15) {
            const score = calculateOcrTextSimilarity(newDesc, docText);
            if (score > maxSim) {
                maxSim = score;
                matchField = 'Content match';
            }
        }

        // Combined text comparison
        const docCombined = [docText, docDesc, docSummary].filter(Boolean).join(' ');
        if (newCombined.length >= 20 && docCombined.length >= 20) {
            const combinedScore = calculateOcrTextSimilarity(newCombined, docCombined);
            if (combinedScore > maxSim) {
                maxSim = combinedScore;
                matchField = 'Combined content';
            }
        }

        // 3. PO / Tracking number boost: If tracking numbers match and content has moderate similarity
        if (newPo && docPo && newPo.toLowerCase().trim() === docPo.toLowerCase().trim()) {
            if (maxSim >= 0.50 || (newFileName && docFileName && newFileName.toLowerCase() === docFileName.toLowerCase())) {
                maxSim = Math.max(maxSim, 0.95);
                matchField = `Reference number (${newPo}) & content match`;
            }
        }

        if (maxSim >= similarityThreshold) {
            const similarityPercent = Math.round(maxSim * 100);
            if (!highestMatch || similarityPercent > highestMatch.similarity) {
                highestMatch = {
                    isSimilar: true,
                    similarity: similarityPercent,
                    matchedDoc: {
                        id: doc.id,
                        title: doc.title,
                        file_name: doc.file_name,
                        supplier: doc.supplier || docExt.vendor_name,
                        po_number: docPo,
                    },
                    matchReason: `${matchField} is ${similarityPercent}% similar to existing document "${doc.title || doc.file_name}"`,
                };
            }
        }
    }

    return highestMatch;
}


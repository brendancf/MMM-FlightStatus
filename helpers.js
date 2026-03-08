/**
 * Flight detection and normalization helpers.
 * Detects flight numbers (IATA airline + number) and optional airport codes.
 */

// IATA flight number: 2-letter airline code + 2-4 digits (e.g. WN 1234, AA1234)
const FLIGHT_NUMBER_REGEX = /\b([A-Z]{2})\s*[-]?\s*(\d{2,4})\b/gi;

// Common US and intl airport codes (subset) to reduce false positives on random 3-letter words
const AIRPORT_CODES = new Set([
	"ABQ", "ATL", "AUS", "BWI", "BOS", "CLT", "ORD", "MDW", "CVG", "CLE", "CMH", "DFW", "DAL", "DEN", "DTW", "FLL", "RSW", "BDL", "HNL", "IAH", "HOU", "IND", "MCI", "LAS", "LAX", "SNA", "ONT", "BUR", "MEM", "MIA", "MSP", "BNA", "MSY", "JFK", "LGA", "EWR", "MCO", "SFB", "PHL", "PHX", "PIT", "PDX", "RDU", "SMF", "SLC", "SAN", "SFO", "SJC", "OAK", "SEA", "STL", "TPA", "DCA", "IAD", "MKE", "ANC", "FAI", "JNU", "SIT", "YYC", "YVR", "YEG", "YYZ", "YUL", "LHR", "CDG", "FRA", "AMS", "DXB", "NRT", "HND", "ICN", "SYD", "AKL", "MEX", "CUN", "GDL", "MTY", "TIJ"
]);

/**
 * Extract all flight numbers (IATA format) from text.
 * @param {string} text - Title, description, or location
 * @returns {string[]} Unique flight IATA codes (e.g. ['WN1234'])
 */
function extractFlightNumbers(text) {
	if (!text || typeof text !== "string") return [];
	const seen = new Set();
	const result = [];
	let m;
	const re = new RegExp(FLIGHT_NUMBER_REGEX.source, "gi");
	while ((m = re.exec(text)) !== null) {
		const iata = (m[1] || "").toUpperCase() + (m[2] || "");
		if (!seen.has(iata)) {
			seen.add(iata);
			result.push(iata);
		}
	}
	return result;
}

/**
 * Extract 3-letter IATA airport codes from text (only from known set).
 * @param {string} text
 * @returns {string[]}
 */
function extractAirportCodes(text) {
	if (!text || typeof text !== "string") return [];
	const upper = text.toUpperCase();
	const found = [];
	for (const code of AIRPORT_CODES) {
		const re = new RegExp("\\b" + code + "\\b");
		if (re.test(upper)) found.push(code);
	}
	return [...new Set(found)];
}

/**
 * Check if event looks like a flight (has "flight" keyword or multiple airport codes).
 */
function looksLikeFlight(summary, description, location) {
	const combined = [summary, description, location].filter(Boolean).join(" ").toLowerCase();
	if (/\bflight\b/i.test(combined)) return true;
	const codes = extractAirportCodes(combined);
	return codes.length >= 2;
}

/**
 * Detect flights from a calendar event. Returns array of { flightIata, date, label }.
 * Only includes events that have at least one extractable flight number.
 */
function detectFlightsFromEvent(event, calendarName) {
	const summary = event.summary || "";
	const description = event.description || "";
	const location = event.location || "";
	const text = [summary, description, location].join(" ");
	const flightNumbers = extractFlightNumbers(text);
	if (flightNumbers.length === 0) return [];
	if (!looksLikeFlight(summary, description, location)) return [];

	const start = event.start;
	let eventDate;
	if (start.dateTime) {
		eventDate = new Date(start.dateTime);
	} else if (start.date) {
		eventDate = new Date(start.date + "T12:00:00");
	} else {
		return [];
	}
	const dateStr = eventDate.toISOString().slice(0, 10);
	const label = summary.trim() || `Flight ${flightNumbers[0]}`;

	return flightNumbers.map((flightIata) => ({
		flightIata,
		date: dateStr,
		label,
		calendarName
	}));
}

module.exports = {
	extractFlightNumbers,
	extractAirportCodes,
	looksLikeFlight,
	detectFlightsFromEvent,
	AIRPORT_CODES
};

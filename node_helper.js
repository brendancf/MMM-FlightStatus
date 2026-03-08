/* global NodeHelper */
const NodeHelper = require("node_helper");
const path = require("path");
const fs = require("fs");
const Log = require("logger");
const { detectFlightsFromEvent } = require("./helpers");

const CREDENTIALS_FILE = "credentials.json";
const TOKEN_FILE = "token.json";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

module.exports = NodeHelper.create({
	start() {
		Log.log(`Starting node helper: ${this.name}`);
		this.rootPath = path.join(this.path, "..", "..");
		this.config = null;
		this.calendarIds = [];
		this.calendarNames = {};
		this.calendarService = null;
		this.flightStatusCache = {};
		this.apiKey = null;
		this.fetchTimer = null;
		this.isActive = true;
		this.lastFlightsPayload = null; // so we can re-send when a client connects

		this.loadConfigAndStart();
	},

	stop() {
		this.isActive = false;
		if (this.fetchTimer) clearTimeout(this.fetchTimer);
	},

	loadConfigAndStart() {
		try {
			const configPath = path.join(this.rootPath, "config", "config.js");
			const mmConfig = require(configPath);
			const modules = mmConfig.modules || mmConfig;
			const modList = Array.isArray(modules) ? modules : modules.modules || [];
			const ourMod = modList.find((m) => m.module === "MMM-FlightStatus");
			this.config = (ourMod && ourMod.config) || {};
			this.calendarIds = this.resolveCalendarIds(modList);
			if (this.calendarIds.length === 0) {
				Log.warn(`${this.name}: No calendar IDs configured. Set useCalendarsFrom or calendarIds.`);
			}
		} catch (err) {
			Log.error(`${this.name}: Failed to load config:`, err.message);
			this.sendSocketNotification("FLIGHT_STATUS_ERROR", { error_type: "config_load_failed" });
			return;
		}

		try {
			const keysPath = path.join(this.rootPath, "config", "keys.js");
			const keys = require(keysPath);
			this.apiKey = keys.AVIATIONSTACK_KEY || this.config.flightStatusApiKey || "";
			if (!this.apiKey) {
				Log.warn(`${this.name}: No AviationStack API key. Copy config/keys.sample.js to config/keys.js and add AVIATIONSTACK_KEY.`);
			}
		} catch (err) {
			this.apiKey = this.config.flightStatusApiKey || "";
		}

		this.authenticateGoogle();
	},

	resolveCalendarIds(modList) {
		if (this.config.calendarIds && this.config.calendarIds.length > 0) {
			return this.config.calendarIds;
		}
		const useFrom = this.config.useCalendarsFrom || "MMM-GoogleCalendar";
		const mod = modList.find((m) => m.module === useFrom);
		if (!mod || !mod.config || !mod.config.calendars) return [];
		const calendars = mod.config.calendars;
		const ids = [];
		calendars.forEach((cal) => {
			const id = cal.calendarID || cal.url;
			if (id) {
				ids.push(id);
				this.calendarNames[id] = cal.name || id;
			}
		});
		return ids;
	},

	authenticateGoogle() {
		const authModule = this.config.googleCalendarAuthPath || "MMM-GoogleCalendar";
		const authDir = path.join(this.rootPath, "modules", authModule);
		const credPath = path.join(authDir, CREDENTIALS_FILE);
		const tokenPath = path.join(authDir, TOKEN_FILE);

		if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) {
			Log.error(`${this.name}: Google auth files not found in ${authDir}. Use MMM-GoogleCalendar auth.`);
			this.sendSocketNotification("FLIGHT_STATUS_ERROR", { error_type: "auth_not_found" });
			return;
		}

		let credentials;
		let token;
		try {
			credentials = JSON.parse(fs.readFileSync(credPath, "utf8"));
			token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
		} catch (err) {
			Log.error(`${this.name}: Failed to read credentials/token:`, err.message);
			this.sendSocketNotification("FLIGHT_STATUS_ERROR", { error_type: "auth_read_failed" });
			return;
		}

		if (!credentials.installed) {
			Log.error(`${this.name}: credentials.json must use "Desktop app" type (installed).`);
			this.sendSocketNotification("FLIGHT_STATUS_ERROR", { error_type: "auth_invalid" });
			return;
		}

		const { client_id, client_secret, redirect_uris } = credentials.installed;
		const redirect_uri = redirect_uris && redirect_uris[0] ? redirect_uris[0] : "http://localhost:8080";

		let google;
		try {
			google = require("googleapis").google;
		} catch (err) {
			Log.error(`${this.name}: googleapis not installed. Run: cd modules/MMM-FlightStatus && npm install`);
			this.sendSocketNotification("FLIGHT_STATUS_ERROR", { error_type: "deps_missing" });
			return;
		}

		const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
		oauth2Client.setCredentials(token);
		this.calendarService = google.calendar({ version: "v3", auth: oauth2Client });
		Log.info(`${this.name}: Google Calendar auth OK.`);
		this.scheduleFetch();
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "FLIGHT_STATUS_INIT") {
			Log.info(`${this.name}: Client connected.`);
			// Re-send cached data if we already have it
			if (this.lastFlightsPayload) {
				this.sendSocketNotification("FLIGHT_STATUS", this.lastFlightsPayload);
			}
		}
	},

	getTodayRange() {
		const now = new Date();
		// Use server local date for "today" (timezone option could be added later with moment-timezone)
		const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
		let timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000 - 1);
		if (this.config.includeTomorrow) {
			timeMax = new Date(timeMax.getTime() + 24 * 60 * 60 * 1000);
		}
		return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
	},

	scheduleFetch() {
		if (!this.isActive) return;
		const intervalMs = (this.config.calendarFetchIntervalMinutes || 15) * 60 * 1000;
		this.fetchTimer = setTimeout(() => {
			this.fetchCalendarsAndFlights();
			this.scheduleFetch();
		}, intervalMs);
		setTimeout(() => this.fetchCalendarsAndFlights(), 2000);
	},

	fetchCalendarsAndFlights() {
		if (!this.calendarService || this.calendarIds.length === 0) {
			this.lastFlightsPayload = { flights: [] };
			this.sendSocketNotification("FLIGHT_STATUS", this.lastFlightsPayload);
			return;
		}

		const { timeMin, timeMax } = this.getTodayRange();
		const allEvents = [];
		let pending = this.calendarIds.length;

		this.calendarIds.forEach((calendarId) => {
			this.calendarService.events.list(
				{
					calendarId,
					timeMin,
					timeMax,
					singleEvents: true,
					orderBy: "startTime",
					maxResults: 100
				},
				(err, res) => {
					if (err) {
						Log.warn(`${this.name}: Calendar ${calendarId} error:`, err.message);
					} else if (res && res.data && res.data.items) {
						const name = this.calendarNames[calendarId] || calendarId;
						res.data.items.forEach((ev) => allEvents.push({ ...ev, _calendarName: name }));
					}
					pending--;
					if (pending === 0) this.processEventsAndSendFlights(allEvents);
				}
			);
		});
	},

	processEventsAndSendFlights(events) {
		const seen = new Set();
		const flightsFromCalendar = [];
		events.forEach((ev) => {
			const detected = detectFlightsFromEvent(ev, ev._calendarName);
			detected.forEach((f) => {
				const key = `${f.flightIata}|${f.date}`;
				if (!seen.has(key)) {
					seen.add(key);
					flightsFromCalendar.push(f);
				}
			});
		});

		if (flightsFromCalendar.length === 0) {
			this.lastFlightsPayload = { flights: [] };
			this.sendSocketNotification("FLIGHT_STATUS", this.lastFlightsPayload);
			return;
		}

		if (!this.apiKey) {
			Log.warn(`${this.name}: No API key — sending flights without status`);
			this.lastFlightsPayload = {
				flights: flightsFromCalendar.map((f) => ({
					...f,
					status: "unknown",
					departure: {},
					arrival: {}
				}))
			};
			this.sendSocketNotification("FLIGHT_STATUS", this.lastFlightsPayload);
			return;
		}

		let pending = flightsFromCalendar.length;
		const results = new Array(flightsFromCalendar.length);
		flightsFromCalendar.forEach((f, idx) => {
			this.fetchFlightStatus(f, (flightWithStatus) => {
				results[idx] = flightWithStatus;
				pending--;
				if (pending === 0) {
					this.lastFlightsPayload = { flights: results };
					Log.info(`${this.name}: Sending ${results.length} flight(s) to display`);
					this.sendSocketNotification("FLIGHT_STATUS", this.lastFlightsPayload);
				}
			});
		});
	},

	fetchFlightStatus(flight, callback) {
		const cacheKey = `${flight.flightIata}|${flight.date}`;
		const cached = this.flightStatusCache[cacheKey];
		if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
			callback(cached.data);
			return;
		}

		// AviationStack free tier only supports HTTP
		const url = `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(this.apiKey)}&flight_iata=${encodeURIComponent(flight.flightIata)}&flight_date=${encodeURIComponent(flight.date)}`;
		const http = require("http");
		http.get(url, (res) => {
			let body = "";
			res.on("data", (chunk) => (body += chunk));
			res.on("end", () => {
				let status = "unknown";
				let departure = {};
				let arrival = {};
				try {
					const json = JSON.parse(body);
					if (json.error) {
						Log.warn(`${this.name}: AviationStack API error for ${flight.flightIata}:`, JSON.stringify(json.error));
					}
					const data = json.data;
					if (data && data[0]) {
						const f = data[0];
						status = f.flight_status || "unknown";
						departure = f.departure || {};
						arrival = f.arrival || {};
						Log.info(`${this.name}: ${flight.flightIata} status=${status}`);
					} else {
						Log.info(`${this.name}: ${flight.flightIata} — no data returned from API (pagination: ${JSON.stringify(json.pagination || {})})`);
					}
				} catch (e) {
					Log.warn(`${this.name}: AviationStack parse error for ${flight.flightIata}:`, e.message);
					Log.debug(`${this.name}: Response body: ${body.substring(0, 500)}`);
				}
				const result = {
					...flight,
					status,
					departure,
					arrival
				};
				this.flightStatusCache[cacheKey] = { data: result, ts: Date.now() };
				callback(result);
			});
		}).on("error", (err) => {
			Log.warn(`${this.name}: AviationStack request error:`, err.message);
			callback({
				...flight,
				status: "unknown",
				departure: {},
				arrival: {}
			});
		});
	}
});

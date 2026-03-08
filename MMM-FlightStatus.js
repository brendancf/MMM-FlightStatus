/* MagicMirror² Module: MMM-FlightStatus
 * Shows flight status for flights detected from Google Calendar events.
 */
Module.register("MMM-FlightStatus", {
	defaults: {
		header: "Flight status",
		timeFormat: 12,
		animationSpeed: 300
	},

	start() {
		Log.info(`Starting module: ${this.name}`);
		this.flights = [];
		this.error = null;
		// Establish socket connection so we can receive notifications from node_helper
		this.sendSocketNotification("FLIGHT_STATUS_INIT", this.config);
	},

	socketNotificationReceived(notification, payload) {
		Log.info(`${this.name}: Received ${notification} with ${JSON.stringify(payload).substring(0, 200)}`);
		if (notification === "FLIGHT_STATUS") {
			this.error = null;
			this.flights = payload.flights || [];
			Log.info(`${this.name}: ${this.flights.length} flight(s) to render`);
			this.updateDom(this.config.animationSpeed);
		} else if (notification === "FLIGHT_STATUS_ERROR") {
			this.error = payload.error_type || "unknown";
			this.flights = [];
			this.updateDom(this.config.animationSpeed);
		}
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-flightstatus";

		if (this.error) {
			wrapper.innerHTML = `<div class="flight-status-error">Flight status unavailable</div>`;
			return wrapper;
		}

		if (!this.flights || this.flights.length === 0) {
			wrapper.innerHTML = "";
			return wrapper;
		}

		const header = document.createElement("div");
		header.className = "flight-status-header";
		header.textContent = this.config.header;
		wrapper.appendChild(header);

		const list = document.createElement("div");
		list.className = "flight-status-list";
		this.flights.forEach((f) => {
			const row = this.buildFlightRow(f);
			list.appendChild(row);
		});
		wrapper.appendChild(list);
		return wrapper;
	},

	buildFlightRow(flight) {
		const row = document.createElement("div");
		row.className = "flight-status-row";

		const statusLabel = this.statusLabel(flight.status);
		const dep = flight.departure || {};
		const arr = flight.arrival || {};
		const depTz = dep.timezone || null;
		const arrTz = arr.timezone || null;
		const depTzLabel = this.tzAbbrev(depTz);
		const arrTzLabel = this.tzAbbrev(arrTz);
		const depSched = dep.scheduled ? this.formatTime(dep.scheduled, depTz) : "—";
		const depEst = dep.estimated ? this.formatTime(dep.estimated, depTz) : null;
		const depActual = dep.actual ? this.formatTime(dep.actual, depTz) : null;
		const arrSched = arr.scheduled ? this.formatTime(arr.scheduled, arrTz) : "—";
		const arrEst = arr.estimated ? this.formatTime(arr.estimated, arrTz) : null;
		const arrActual = arr.actual ? this.formatTime(arr.actual, arrTz) : null;
		// Show actual > estimated > scheduled
		const depDisplay = depActual || depEst || depSched;
		const arrDisplay = arrActual || arrEst || arrSched;
		const depChanged = depDisplay !== depSched;
		const arrChanged = arrDisplay !== arrSched;
		const depGate = dep.gate || "";
		const arrGate = arr.gate || "";
		const depDelay = dep.delay ? parseInt(dep.delay, 10) : null;
		const arrDelay = arr.delay ? parseInt(arr.delay, 10) : null;

		// Build route line: airport codes from API (preferred) or calendar, plus airline and flight #
		const depCode = flight.depIata || (flight.airports && flight.airports[0]) || "";
		const arrCode = flight.arrIata || (flight.airports && flight.airports[1]) || "";
		const route = depCode && arrCode ? `${depCode} → ${arrCode}` : depCode || arrCode || "";
		const airlineStr = flight.airline || "";
		const flightLine = [airlineStr, flight.flightIata].filter(Boolean).join(" ");

		let html = `<div class="flight-label">${route ? `${this.escapeHtml(route)} · ` : ""}${this.escapeHtml(flightLine)}</div>`;
		html += `<div class="flight-meta"><span class="flight-status flight-status-${this.statusClass(flight.status)}">${statusLabel}</span></div>`;
		html += `<div class="flight-times">`;
		html += `<div class="flight-dep">Dep ${depChanged ? `<span class="flight-time-old">${depSched}</span> ${depDisplay}` : depSched}${depTzLabel ? ` ${depTzLabel}` : ""}${depGate ? ` Gate ${depGate}` : ""}${depDelay ? ` <span class="flight-delay">+${depDelay}m</span>` : ""}</div>`;
		html += `<div class="flight-arr">Arr ${arrChanged ? `<span class="flight-time-old">${arrSched}</span> ${arrDisplay}` : arrSched}${arrTzLabel ? ` ${arrTzLabel}` : ""}${arrGate ? ` Gate ${arrGate}` : ""}${arrDelay ? ` <span class="flight-delay">+${arrDelay}m</span>` : ""}</div>`;
		html += `</div>`;

		row.innerHTML = html;
		return row;
	},

	statusLabel(status) {
		if (!status || status === "unknown") return "—";
		// Capitalize first letter of each word (FlightAware returns e.g. "scheduled", "delayed")
		return status.replace(/\b\w/g, (c) => c.toUpperCase());
	},

	statusClass(status) {
		if (!status) return "";
		const s = status.toLowerCase();
		if (s.includes("delay")) return "delayed";
		if (s.includes("cancel")) return "cancelled";
		if (s.includes("divert")) return "diverted";
		if (s.includes("en route") || s.includes("in air")) return "active";
		if (s.includes("arrived") || s.includes("landed")) return "landed";
		if (s.includes("scheduled")) return "scheduled";
		return s;
	},

	tzAbbrev(timezone) {
		if (!timezone) return "";
		try {
			// Use Intl to get the short timezone name (e.g. "EDT", "PDT")
			const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" });
			const parts = fmt.formatToParts(new Date());
			const tzPart = parts.find((p) => p.type === "timeZoneName");
			return tzPart ? tzPart.value : "";
		} catch (e) {
			return "";
		}
	},

	formatTime(isoStr, timezone) {
		if (!isoStr) return "—";
		const date = new Date(isoStr);
		if (isNaN(date.getTime())) return isoStr;
		const use24 = this.config.timeFormat === 24;
		const opts = {
			hour: "numeric",
			minute: "2-digit",
			hour12: !use24
		};
		if (timezone) {
			opts.timeZone = timezone;
		}
		return date.toLocaleTimeString("en-US", opts);
	},

	escapeHtml(text) {
		if (!text) return "";
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	},

	getStyles() {
		return ["MMM-FlightStatus.css"];
	}
});

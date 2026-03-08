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
		const depSched = dep.scheduled ? this.formatTime(dep.scheduled) : "—";
		const depActual = dep.actual ? this.formatTime(dep.actual) : null;
		const arrSched = arr.scheduled ? this.formatTime(arr.scheduled) : "—";
		const arrActual = arr.actual ? this.formatTime(arr.actual) : null;
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
		html += `<div class="flight-meta"><span class="flight-status flight-status-${flight.status}">${statusLabel}</span></div>`;
		html += `<div class="flight-times">`;
		html += `<span class="flight-dep">Dep ${depSched}${depActual && depActual !== depSched ? ` <small>(${depActual})</small>` : ""}${depGate ? ` Gate ${depGate}` : ""}${depDelay ? ` <span class="flight-delay">+${depDelay}m</span>` : ""}</span>`;
		html += ` · `;
		html += `<span class="flight-arr">Arr ${arrSched}${arrActual && arrActual !== arrSched ? ` <small>(${arrActual})</small>` : ""}${arrGate ? ` Gate ${arrGate}` : ""}${arrDelay ? ` <span class="flight-delay">+${arrDelay}m</span>` : ""}</span>`;
		html += `</div>`;

		row.innerHTML = html;
		return row;
	},

	statusLabel(status) {
		const labels = {
			scheduled: "Scheduled",
			active: "In flight",
			landed: "Landed",
			cancelled: "Cancelled",
			incident: "Incident",
			diverted: "Diverted",
			unknown: "—"
		};
		return labels[status] || status || "—";
	},

	formatTime(isoStr) {
		if (!isoStr) return "—";
		const date = new Date(isoStr);
		if (isNaN(date.getTime())) return isoStr;
		const use24 = this.config.timeFormat === 24;
		if (use24) {
			const h = date.getHours();
			const m = date.getMinutes();
			return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
		}
		let h = date.getHours();
		const ampm = h >= 12 ? "PM" : "AM";
		h = h % 12 || 12;
		const m = date.getMinutes();
		return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
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

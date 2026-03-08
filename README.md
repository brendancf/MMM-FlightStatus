# MMM-FlightStatus

Shows flight status on your Magic Mirror for flights detected automatically from Google Calendar events. No manual flight list—add calendar events with flight numbers (e.g. "Flight WN 1234" or "BWI to SEA") and the module shows live status (scheduled → departed → landed) and times.

## Features

- **Calendar-driven**: Uses the same Google Calendar auth and calendars as MMM-GoogleCalendar.
- **Flight detection**: Detects events that look like flights (flight number like `WN 1234`, or "flight" + airport codes).
- **Live status**: Fetches status from AviationStack (scheduled, active, landed, delays, gates).

## Setup

### 1. Dependencies

```bash
cd modules/MMM-FlightStatus
npm install
```

### 2. Google Calendar auth

Use your existing MMM-GoogleCalendar auth. Ensure `modules/MMM-GoogleCalendar/credentials.json` and `modules/MMM-GoogleCalendar/token.json` exist (run MMM-GoogleCalendar’s auth flow if needed).

### 3. AviationStack API key

Copy the keys sample and add your key (get a free key at [aviationstack.com](https://aviationstack.com)):

```bash
cp config/keys.sample.js config/keys.js
# Edit config/keys.js and set AVIATIONSTACK_KEY
```

`config/keys.js` is gitignored; the key is never sent to the frontend.

### 4. Config

Add the module to `config/config.js`. It will use the same calendars as MMM-GoogleCalendar by default:

```javascript
{
  module: "MMM-FlightStatus",
  position: "bottom_left",
  config: {
    useCalendarsFrom: "MMM-GoogleCalendar",
    calendarFetchIntervalMinutes: 15,
    flightStatusRefreshMinutes: 20,
    includeTomorrow: false,
    header: "Flight status",
    timeFormat: 12
  }
}
```

**Config options**

| Option | Default | Description |
|--------|--------|-------------|
| `useCalendarsFrom` | `"MMM-GoogleCalendar"` | Module name to take calendar IDs from. |
| `calendarIds` | — | Override: array of calendar IDs (e.g. `["you@gmail.com"]`). |
| `googleCalendarAuthPath` | `"MMM-GoogleCalendar"` | Module folder that contains `credentials.json` and `token.json`. |
| `calendarFetchIntervalMinutes` | 15 | Minutes between calendar fetches. |
| `flightStatusRefreshMinutes` | 20 | Minutes between AviationStack refreshes (per flight). |
| `includeTomorrow` | false | Include tomorrow’s events. |
| `timezone` | server | Not used for range; "today" is server local. |
| `header` | "Flight status" | Section header. |
| `timeFormat` | 12 | 12 or 24 for times. |

## Calendar events

For an event to be treated as a flight and show status:

- **Must** contain a flight number: two-letter airline code + digits, e.g. `WN 1234`, `AA1234`, `UA 567`.
- **And** either:
  - the word "flight" in title/description, or
  - two known airport codes (e.g. BWI, SEA) in title/description/location.

Examples that will be detected:

- "Flight WN 1234 – Ellie BWI to SEA"
- "AA 100" in title and "JFK to LAX" in location
- "Trip home – WN 567" with "flight" in description

## Visibility

The module only shows content when there is at least one detected flight for today (and optionally tomorrow). When there are no flights, it renders nothing.

## License

MIT

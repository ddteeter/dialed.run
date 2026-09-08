/**
 * Shaped from Visual Crossing's documented Timeline API response (metric,
 * `include=hours`) — recorded from their published docs, not a live call:
 * no API key exists yet (docs/designs/103-weather.md). Re-record against a
 * live response once the secret lands.
 */
export const visualCrossingObservationFixture = {
  queryCost: 24,
  latitude: 44.98,
  longitude: -93.27,
  resolvedAddress: "Minneapolis, MN, United States",
  address: "44.98,-93.27",
  timezone: "America/Chicago",
  days: [
    {
      datetime: "2026-01-15",
      hours: [
        {
          datetime: "06:00:00",
          datetimeEpoch: 1_768_482_000,
          temp: -5.6,
          feelslike: -11.2,
          humidity: 81.4,
          windspeed: 12.6,
          precip: 0,
          conditions: "Clear",
        },
        {
          datetime: "07:00:00",
          datetimeEpoch: 1_768_485_600,
          temp: -4.8,
          feelslike: -9.7,
          humidity: 80.1,
          windspeed: 14.2,
          precip: 0.2,
          conditions: "Overcast",
        },
        {
          // No `precip` key at all — Visual Crossing omits it as often as
          // it sends an explicit null; the adapter must default either way.
          datetime: "08:00:00",
          datetimeEpoch: 1_768_489_200,
          temp: -3.9,
          feelslike: -8.5,
          humidity: 78.6,
          windspeed: 15.8,
          conditions: "Snow, Overcast",
        },
      ],
    },
  ],
};

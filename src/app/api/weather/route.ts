import { NextResponse } from "next/server";

/**
 * Map a day's rainfall to an IMD-style colour warning.
 *
 * The previous thresholds fired "Red Alert (Extreme Rain/Storm)" at 50mm/day,
 * or on any WMO code >= 80 — and code 80 is merely *slight* rain showers. A
 * routine 20mm monsoon day in Kerala therefore rendered as an extreme-rain red
 * alert, which is exactly the kind of constant false alarm that trains people
 * to ignore the real one.
 *
 * Bands follow IMD's 24-hour rainfall categories:
 *   heavy 64.5–115.5mm · very heavy 115.6–204.4mm · extremely heavy >204.4mm
 */
function deriveAlert(
  weatherCode: number,
  dailyPrecip: number
): { level: "green" | "yellow" | "orange" | "red"; label: string } {
  if (dailyPrecip > 204.4) {
    return { level: "red", label: "Red Alert (Extremely Heavy Rain)" };
  }
  if (dailyPrecip > 115.5) {
    return { level: "orange", label: "Orange Alert (Very Heavy Rain)" };
  }
  if (dailyPrecip > 64.4) {
    return { level: "yellow", label: "Yellow Alert (Heavy Rain)" };
  }

  // Storm codes escalate even when the daily total stays modest.
  // 95–99 thunderstorm, 99 with heavy hail; 82 violent rain showers.
  if (weatherCode === 99) {
    return { level: "orange", label: "Orange Alert (Severe Thunderstorm)" };
  }
  if (weatherCode >= 95 || weatherCode === 82) {
    return { level: "yellow", label: "Yellow Alert (Thunderstorm/Squall)" };
  }

  return { level: "green", label: "No Warning (Light to Moderate Rain)" };
}

/**
 * Open-Meteo hourly timestamps look like "2026-08-02T20:00" and are already in
 * the requested timezone (Asia/Kolkata). Formatting them through `new Date()`
 * would re-interpret them in the *server's* timezone, so the hour label is
 * derived from the string directly instead.
 */
function formatHourLabel(isoLocal: string): string {
  const hour = Number(isoLocal.slice(11, 13));
  if (!Number.isFinite(hour)) return isoLocal;
  const suffix = hour < 12 ? "am" : "pm";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${suffix}`;
}

/** Daily timestamps are date-only ("2026-08-03") → UTC midnight when parsed. */
function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Clamp a possibly-null Open-Meteo reading to a finite number. */
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Validate coordinates before forwarding them to the upstream provider.
  const latParam = Number(searchParams.get("latitude"));
  const lngParam = Number(searchParams.get("longitude"));
  const lat = Number.isFinite(latParam) && Math.abs(latParam) <= 90 ? latParam : 9.9312; // Kochi
  const lng = Number.isFinite(lngParam) && Math.abs(lngParam) <= 180 ? lngParam : 76.2673;

  try {
    // 1. Fetch live Open-Meteo forecast (precipitation, rain, temp, weather_code)
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,rain,temperature_2m&daily=weather_code,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=6`;
    // This route reads query params, so it is always dynamic and the route-level
    // `revalidate` export would be ignored — cache at the fetch instead.
    const weatherRes = await fetch(openMeteoUrl, { next: { revalidate: 900 } });
    if (!weatherRes.ok) throw new Error("Failed to fetch weather data from provider");
    const weatherData = await weatherRes.json();

    const hourlyTimes = weatherData?.hourly?.time as string[] | undefined;
    const dailyTimes = weatherData?.daily?.time as string[] | undefined;
    if (!Array.isArray(hourlyTimes) || !Array.isArray(dailyTimes)) {
      throw new Error("Weather provider returned an unexpected response");
    }

    // Find current local hour index (Asia/Kolkata timezone)
    const localTimeString = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date())
      .replace(" ", "T");

    const closestHourStr = localTimeString.slice(0, 14) + "00"; // Round to start of hour
    let currentHourIndex = hourlyTimes.indexOf(closestHourStr);
    if (currentHourIndex === -1) currentHourIndex = 0;

    const currentRain = num(weatherData.hourly.rain?.[currentHourIndex]);
    const currentTemp = num(weatherData.hourly.temperature_2m?.[currentHourIndex], 28);

    // Next 24 hours precipitation sparkline data
    const next24hPrecipitation = [];
    const hourlyPrecip = weatherData.hourly.precipitation ?? [];
    for (let i = currentHourIndex; i < currentHourIndex + 24 && i < hourlyTimes.length; i++) {
      next24hPrecipitation.push({
        time: formatHourLabel(hourlyTimes[i]),
        rain: num(hourlyPrecip[i]),
      });
    }

    // 5-day daily outlook
    const dailyOutlook = [];
    const dailyCodes = (weatherData.daily.weather_code ?? []) as number[];
    const dailyPrecipSum = (weatherData.daily.precipitation_sum ?? []) as number[];

    // Extract next 5 days
    for (let i = 1; i <= 5 && i < dailyTimes.length; i++) {
      const rainSum = num(dailyPrecipSum[i]);
      const derived = deriveAlert(num(dailyCodes[i]), rainSum);
      dailyOutlook.push({
        day: formatDayLabel(dailyTimes[i]),
        rainSum,
        alert: derived.level,
        label: derived.label,
      });
    }

    // 2. Derive Alert level (attempting public warning derivation)
    // IMD CORS block and unreliable public endpoints fallback to Open-Meteo derived codes.
    // Daily WMO code and rain sums are mapped to alert severity levels.
    const currentAlert = deriveAlert(num(dailyCodes[0]), num(dailyPrecipSum[0]));

    return NextResponse.json({
      success: true,
      current: {
        rain: currentRain,
        temperature: currentTemp,
        alertLevel: currentAlert.level,
        alertLabel: currentAlert.label,
      },
      sparkline: next24hPrecipitation,
      forecast: dailyOutlook,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch weather forecast";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

export const revalidate = 900; // 15-minute revalidation cache

// Derive alert levels based on standard WMO weather codes
function deriveAlert(weatherCode: number, dailyMaxPrecip: number): { level: "green" | "yellow" | "orange" | "red"; label: string } {
  if (weatherCode >= 80 || weatherCode >= 95 || dailyMaxPrecip > 50) {
    return { level: "red", label: "Red Alert (Extreme Rain/Storm)" };
  } else if (weatherCode >= 60 || dailyMaxPrecip > 20) {
    return { level: "orange", label: "Orange Alert (Heavy Rain Warning)" };
  } else if (weatherCode >= 50 || dailyMaxPrecip > 5) {
    return { level: "yellow", label: "Yellow Alert (Moderate Rain Warning)" };
  }
  return { level: "green", label: "No Alert (Clear/Light Rain)" };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("latitude") || "9.9312"; // Fallback to Kochi
  const lng = searchParams.get("longitude") || "76.2673";

  try {
    // 1. Fetch live Open-Meteo forecast (precipitation, rain, temp, weather_code)
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,rain,temperature_2m&daily=weather_code,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=6`;
    const weatherRes = await fetch(openMeteoUrl);
    if (!weatherRes.ok) throw new Error("Failed to fetch weather data from provider");
    const weatherData = await weatherRes.json();

    // Find current local hour index (Asia/Kolkata timezone)
    const localTimeString = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()).replace(" ", "T");

    const closestHourStr = localTimeString.slice(0, 14) + "00"; // Round to start of hour
    let currentHourIndex = weatherData.hourly.time.indexOf(closestHourStr);
    if (currentHourIndex === -1) currentHourIndex = 0;

    const currentRain = weatherData.hourly.rain?.[currentHourIndex] ?? 0;
    const currentTemp = weatherData.hourly.temperature_2m?.[currentHourIndex] ?? 28;

    // Next 24 hours precipitation sparkline data
    const next24hPrecipitation = [];
    for (let i = currentHourIndex; i < currentHourIndex + 24 && i < weatherData.hourly.time.length; i++) {
      const timeVal = new Date(weatherData.hourly.time[i]);
      next24hPrecipitation.push({
        time: timeVal.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true }),
        rain: weatherData.hourly.precipitation[i] ?? 0,
      });
    }

    // 5-day daily outlook
    const dailyOutlook = [];
    const dailyTimes = weatherData.daily.time as string[];
    const dailyCodes = weatherData.daily.weather_code as number[];
    const dailyPrecipSum = weatherData.daily.precipitation_sum as number[];

    // Extract next 5 days
    for (let i = 1; i <= 5 && i < dailyTimes.length; i++) {
      const d = new Date(dailyTimes[i]);
      const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
      const derived = deriveAlert(dailyCodes[i] ?? 0, dailyPrecipSum[i] ?? 0);
      dailyOutlook.push({
        day: dayLabel,
        rainSum: dailyPrecipSum[i] ?? 0,
        alert: derived.level,
        label: derived.label,
      });
    }

    // 2. Derive Alert level (attempting public warning derivation)
    // IMD CORS block and unreliable public endpoints fallback to Open-Meteo derived codes.
    // Daily WMO code and rain sums are mapped to alert severity levels.
    const todayWeatherCode = weatherData.daily.weather_code?.[0] ?? 0;
    const todayPrecipSum = weatherData.daily.precipitation_sum?.[0] ?? 0;
    const currentAlert = deriveAlert(todayWeatherCode, todayPrecipSum);

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
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

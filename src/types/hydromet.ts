/** A normalized official alert from the SACHET CAP feed (IMD / SDMA / CWC). */
export interface OfficialAlert {
  id: string;
  severity: "red" | "orange" | "yellow";
  event: string;
  message: string;
  areaDescription: string;
  /** Issuing agency as reported by SACHET, e.g. "Kerala SDMA", "IMD". */
  source: string;
  /** Kerala districts matched in the alert area text. */
  districts: string[];
  /** River names matched in the alert text (for gauge overlays). */
  rivers: string[];
  start: string | null;
  end: string | null;
}

export interface AlertsResponse {
  success: boolean;
  alerts: OfficialAlert[];
}

export interface RiverStation {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  dangerLevel: number;
  discharge: number;
  trend: "rising" | "falling" | "steady";
  status: "normal" | "warning" | "danger";
  /** False when the upstream gauge could not be read — readings are not real. */
  available: boolean;
  /** Present when an official flood alert covers this river/station. */
  officialAlert?: { source: string; severity: string; message: string } | null;
  updatedAt: string;
}

export interface RiverResponse {
  success: boolean;
  stations: RiverStation[];
}

export interface DamStation {
  id: string;
  name: string;
  river: string;
  /** Null for dams known only from the official bulletin (listed, not mapped). */
  lat: number | null;
  lng: number | null;
  district: string;
  frl: number;
  unit: string;
  dangerLevel: number;
  currentLevel: number;
  capacityPct: number;
  status: "normal" | "alert" | "spill";
  alertColor: "green" | "blue" | "orange" | "red";
  /** Compact state label rendered in the status chip. */
  shutterStatus: string;
  /** Full remarks line from the official bulletin (shutter positions etc.). */
  remarks?: string;
  trend: "rising" | "falling" | "steady";
  catchmentRain24h: number;
  /** "KSDMA" = today's official gauge bulletin; "estimated" = rainfall model. */
  source: "KSDMA" | "estimated";
  /** Bulletin timestamp, e.g. "02/08/2026 08.30 PM" — only on official rows. */
  officialDate?: string | null;
  /** False when neither the bulletin nor catchment weather could be read. */
  available: boolean;
  updatedAt: string;
}

export interface DamResponse {
  success: boolean;
  /** Count of dams carrying today's official KSDMA gauge reading. */
  officialCount: number;
  /** Timestamp printed on today's bulletin, e.g. "02/08/2026 08.30 PM". */
  officialDate: string | null;
  /** True when at least one dam is still rainfall-modelled. */
  estimated: boolean;
  dams: DamStation[];
}

export interface SparklineItem {
  time: string;
  rain: number;
}

export interface ForecastItem {
  day: string;
  rainSum: number;
  alert: string;
  label: string;
}

export interface WeatherResponse {
  success: boolean;
  current: {
    rain: number;
    temperature: number;
    alertLevel: "green" | "yellow" | "orange" | "red";
    alertLabel: string;
  };
  sparkline: SparklineItem[];
  forecast: ForecastItem[];
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  pubDate: string;
}

export interface NewsResponse {
  success: boolean;
  news: NewsItem[];
}

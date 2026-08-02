# Kerala Flood Emergency Dashboard

A high-performance, responsive, and real-time dashboard built using **Next.js 14 (App Router)**, **Tailwind CSS**, and **Supabase**. It provides real-time geospatial alerts and SOS rescue coordination to assist in disaster response operations.

---

## Key Features
- **Interactive Leaflet Map**: Centered on Kerala showing real-time color-coded flood report pins and pulsing SOS beacons.
- **Incident Reporting Modal**: Supports automatic browser GPS coordinates capture and mobile photo uploads.
- **Client-Side Image Compression**: Shrinks dynamic image uploads to under `500KB` using `browser-image-compression`.
- **Live Weather Widget**: Displays district-wise warnings, current rainfall intensity (mm/h), and 3-day precipitation forecasts from Open-Meteo.
- **Govt Alerts Ticker**: Features critical agency feeds and quick emergency phone actions (`1077`, `112`).
- **Anti-Spam & Rate Limiting**: Built-in 30-second submission cooldown timers and honey-pot fields.
- **Dynamic Search Filters**: Filter coordinates and lists by district or timeframe (24h, 3 days, 1 week) on the client side.
- **Map Maximize Toggle**: Collapse/restore reporting panels instantly.

---

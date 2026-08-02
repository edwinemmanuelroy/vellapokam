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

## 🛠️ Step-by-Step Supabase Setup

### 1. Database Schema Migration
1. Go to your **Supabase Dashboard** and navigate to the **SQL Editor**.
2. Click **New query**, paste the entire contents of `supabase/migrations/00001_create_tables.sql`, and click **Run**.
   - This creates the `flood_reports` and `sos_requests` tables.
   - Configures optimized geospatial and chronological indexes.
   - Restricts updates to authenticated roles while allowing public reads and inserts.

### 2. Storage Setup ('flood-photos')
1. In the Supabase Sidebar, go to **Storage**.
2. Click **New bucket** and set the bucket name to **`flood-photos`**.
3. Toggle the **Public bucket** switch to **Enabled** (this is required so public users can access photos).
4. Run the storage policies at the bottom of the SQL script, or click **Policies** under your bucket settings:
   - **Upload Policy**: Allow public (`anon`) users to perform `INSERT` operations.
   - **Read Policy**: Allow public (`anon`) users to perform `SELECT` operations.

### 3. Real-time Subscription (Optional)
To stream new submissions to the map instantly without manual polling:
- Go to **Database** → **Publications** → **supabase_realtime** (or check publication tables).
- Toggle publications on for `flood_reports` and `sos_requests`.

---

## 🚀 Deploying to Vercel

1. **Commit and Push**: Push your project to your GitHub/GitLab repository.
2. **Vercel Project Setup**:
   - Go to [Vercel](https://vercel.com/new) and import your project repository.
   - Leave the Framework Preset as **Next.js**.
   - Ensure the Build Command is `npm run build` and Output Directory is `.next`.
3. **Environment Variables**: Add the following Environment Variables in the project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`: (Your Supabase Project API URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (Your Supabase Project Anon Public API key)
4. **Deploy**: Click **Deploy**. Vercel will build and launch your application globally.

---

## 💻 Local Development Setup

To test the application locally:

```bash
# 1. Clone & Enter Directory
cd kerala-flood-dashboard

# 2. Copy and configure Environment Variables
cp .env.local.example .env.local
# Open .env.local and add your Supabase credentials

# 3. Install dependencies
npm install

# 4. Start Local Next.js dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the live dashboard interface.

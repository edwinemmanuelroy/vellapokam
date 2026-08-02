import { NextResponse } from "next/server";

export const revalidate = 900; // 15-minute revalidation cache

interface NewsItem {
  title: string;
  source: string;
  link: string;
  pubDate: string;
}

/** Strip a CDATA wrapper and decode the entities RSS actually uses. */
function decodeXml(raw: string): string {
  return raw
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") // must be last so "&amp;lt;" does not become "<"
    .trim();
}

/**
 * Only http(s) links are rendered into an anchor `href`. Without this a feed
 * item could inject a `javascript:` URI into the dashboard.
 */
function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const rssUrl =
      "https://news.google.com/rss/search?q=Kerala+floods+OR+Kerala+rain+OR+KSDMA&hl=en-IN&gl=IN&ceid=IN:en";
    const res = await fetch(rssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      next: { revalidate: 900 },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch RSS news feed");
    }

    const xmlText = await res.text();

    // Simple XML parser using RegExp to avoid bulky XML parsing dependencies
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items: NewsItem[] = [];
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null && items.length < 15) {
      const itemContent = match[1];

      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);

      const link = linkMatch ? safeLink(decodeXml(linkMatch[1])) : null;
      if (!link) continue; // an item with no usable link is not actionable

      const fullTitle = titleMatch ? decodeXml(titleMatch[1]) : "Emergency Update";
      const source = sourceMatch ? decodeXml(sourceMatch[1]) : "Media Alert";

      const rawDate = pubDateMatch ? decodeXml(pubDateMatch[1]) : "";
      const parsedDate = new Date(rawDate);
      const pubDate = Number.isNaN(parsedDate.getTime())
        ? new Date().toUTCString()
        : parsedDate.toUTCString();

      // Google News appends " - <Source>" to the headline; drop the duplicate.
      let displayTitle = fullTitle;
      if (fullTitle.includes(" - ")) {
        const parts = fullTitle.split(" - ");
        const possibleSource = parts[parts.length - 1];
        if (possibleSource.toLowerCase() === source.toLowerCase()) {
          parts.pop();
          displayTitle = parts.join(" - ");
        }
      }

      items.push({
        title: displayTitle.trim(),
        source: source.trim(),
        link,
        pubDate,
      });
    }

    // An empty feed is reported as an empty feed. Seeding invented headlines
    // here would put fabricated flood bulletins in front of users.
    return NextResponse.json({ success: true, news: items });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load live news feed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

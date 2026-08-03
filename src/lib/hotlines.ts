/**
 * Kerala emergency hotlines.
 *
 * Every number here is verified against official sources — KSDMA's own
 * communication and ERSS pages (sdma.kerala.gov.in) for 112/1077/1079 and the
 * KSDMA office line, and the national three/four-digit emergency numbers.
 *
 * Rules for editing this file:
 *  - Never add a number you have not verified against a government source.
 *    A wrong emergency number is worse than a missing one.
 *  - Per-district control room numbers deliberately live behind the KSDMA
 *    directory link rather than being transcribed here; they change, and a
 *    stale copy would be dialled in an emergency.
 */

export interface Hotline {
  number: string;
  /** Digits actually dialled — strips spaces/dashes for the tel: href. */
  dial: string;
  label: string;
  description: string;
}

export interface HotlineGroup {
  title: string;
  note?: string;
  /** Emergency groups get the large, high-contrast treatment. */
  emphasis: boolean;
  hotlines: Hotline[];
}

export const HOTLINE_GROUPS: HotlineGroup[] = [
  {
    title: "Call first",
    note: "If you are in danger right now, start here.",
    emphasis: true,
    hotlines: [
      {
        number: "112",
        dial: "112",
        label: "Emergency — police, fire, ambulance",
        description:
          "India's single emergency number (ERSS). Use it for any life-threatening situation; it reaches police, fire and ambulance.",
      },
      {
        number: "1077",
        dial: "1077",
        label: "District disaster control room",
        description:
          "Toll-free. Routes to your own district's Emergency Operations Centre — the people coordinating local flood rescue.",
      },
      {
        number: "1079",
        dial: "1079",
        label: "State disaster control room",
        description:
          "Toll-free. Kerala's State Emergency Operations Centre, for when the district line cannot be reached.",
      },
    ],
  },
  {
    title: "Specific services",
    emphasis: false,
    hotlines: [
      {
        number: "101",
        dial: "101",
        label: "Fire & Rescue",
        description: "Direct line to Fire and Rescue Services.",
      },
      {
        number: "108",
        dial: "108",
        label: "Ambulance",
        description: "Emergency medical transport.",
      },
      {
        number: "1098",
        dial: "1098",
        label: "Childline",
        description: "For a child who is missing, separated from family, or at risk.",
      },
      {
        number: "181",
        dial: "181",
        label: "Women's helpline",
        description: "Round-the-clock support for women in distress.",
      },
    ],
  },
  {
    title: "Non-emergency",
    note: "For information and coordination — not for a rescue request.",
    emphasis: false,
    hotlines: [
      {
        number: "0471 2778855",
        dial: "04712778855",
        label: "KSDMA office",
        description:
          "Kerala State Disaster Management Authority, Thiruvananthapuram. Office line, not a control room.",
      },
    ],
  },
];

/** Official directory, for per-district and taluk-level numbers. */
export const KSDMA_DIRECTORY_URL = "https://sdma.kerala.gov.in/communication/";

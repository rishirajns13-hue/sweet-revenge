# Redesign: cartoon feed (14 Nov 2026)

Status: **approved by the user** (they picked the parts from rendered mockups A/B/C, then said to build without further questions).

## What the user chose (from mockups, scratchpad mock/A–D)
- **A, cartoon everything:** cream cards, thick ink outlines (3 px #2b2140), offset shadows (6px 7px 0), slight tilts, Lilita One titles. The nav rail / bottom bar and the top-bar chips match.
- **B, feed + sidebar:** a centred feed (max about 700 px) with a 300 px sidebar on laptops, on a **calmer, lighter background** (the theme gradient under a 55% white veil).
- **C, big poster + game shelf:** a poster on top, then "Pick your battle", a swipeable row of the full game cards with their art.
- **Not chosen:** B's stories row.
- **Kept from before (the user liked them):** the Home chat preview shows the real last messages, plus the quick reply. Sounds, the chat inbox and photos are untouched.
- **The conversation itself** stays clean and Instagram-like (the user wants the chat to have Instagram's aesthetics). Only the app chrome around it is cartoon.

## Home
- **Feed:**
  - **The poster** shows their critter (big, tilted) and a headline: "Kunju is typing…" / "Kunju sent you N messages" / "Say hi to Kunju". Below that:
    - "● Active now / last message time";
    - the last 3 messages as outlined bubbles, plus typing dots;
    - the quick reply;
    - two buttons: "💬 Open chat" (to the inbox) and the up-next game: resume > revenge (< 24 h) > favourite > Ludo.
  - **"Pick your battle"** is a shelf of the real game cards, swipeable.
- **Sidebar on laptops** (stacked under the feed on phones):
  - you: critter, name, level, trophy count;
  - the grudge: score and a Challenge button;
  - level: cone, XP bar, the 4 latest trophies, "All trophies".

## Whole app
- The nav, the top bar and the Games / Trophies / Rivals / You cards use the cartoon language (most already do).
- The calmer background applies app-wide on index.html.
- The login and loading screens are unchanged.

## Must keep working
Every existing check: shoot, inbox, fixes, photos, tools, vanish, title, contrast in the chat, reduced motion, and the unit tests.

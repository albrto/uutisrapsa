#!/usr/bin/env python3
"""
Kerää vanhojen Uutisraportti-jaksojen (2016-2018) audio-URL:t Suplasta
käyttäen Playwrightia.

Käyttö:
  source /Users/antero/.venvs/uutisrapsa/bin/activate
  python3 keraa_supla_audio_urlit.py
"""

import json
import re
import time
import os
import sys

from playwright.sync_api import sync_playwright

OUTPUT_FILE = "supla_audio_urlit.json"
CUTOFF_DATE = "2018-01-24"
SERIES_PAGE = "https://www.supla.fi/podcast/uutisraportti-podcast?s=601122%7E0-1"


def log(msg):
    print(msg, flush=True)


def handle_consent(page):
    """Handle the iframe-based cookie consent dialog."""
    try:
        consent_frame = page.frame_locator('iframe[id^="sp_message_iframe"]')
        accept_btn = consent_frame.locator(
            'button[title="OK"], button:has-text("OK"), button:has-text("Hyväksy")'
        ).first
        accept_btn.click(timeout=5000)
        log("  ✅ Evästesuostumus hyväksytty")
        time.sleep(2)
    except:
        try:
            page.evaluate("""
                document.querySelectorAll('[id^="sp_message_container"]')
                    .forEach(el => el.remove());
            """)
        except:
            pass


def scrape_episodes_from_page(page):
    """Parsii jaksotiedot Suplan sivulta."""
    episodes = []
    seen_ids = set()

    log("Ladataan Suplan jaksosivua...")
    page.goto(SERIES_PAGE, wait_until="domcontentloaded", timeout=30000)
    time.sleep(8)  # Wait for JS to render
    handle_consent(page)
    time.sleep(3)

    page_num = 1
    while page_num <= 10:
        log(f"\n📄 Sivu {page_num}:")
        
        # Wait for episode items to appear
        try:
            page.wait_for_selector('[data-source="podcast_episode"]', timeout=15000)
        except:
            log("  Ei jaksoja löytynyt!")
            break

        items = page.locator('[data-source="podcast_episode"]').all()
        if not items:
            break

        found_past_cutoff = False
        new_count = 0

        for item in items:
            try:
                ep_id = item.get_attribute("data-id")
                if not ep_id or ep_id in seen_ids:
                    continue
                seen_ids.add(ep_id)

                title = "?"
                try:
                    title = item.locator("h2").first.text_content(timeout=3000).strip()
                except:
                    pass

                info_text = ""
                try:
                    info_text = item.locator('[class*="info"]').first.text_content(timeout=3000).strip()
                except:
                    pass

                date_match = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', info_text)
                if date_match:
                    day, month, year = date_match.groups()
                    date_iso = f"{year}-{int(month):02d}-{int(day):02d}"
                    date_str = f"{day}.{month}.{year}"
                else:
                    date_iso = "9999-99-99"
                    date_str = "?"

                if date_iso >= CUTOFF_DATE:
                    found_past_cutoff = True
                    continue

                episodes.append({
                    "id": ep_id,
                    "title": title,
                    "date_str": date_str,
                    "date_iso": date_iso,
                    "supla_url": f"https://www.supla.fi/episode/{ep_id}"
                })
                new_count += 1
                log(f"  ✅ {title} ({date_str})")

            except Exception as e:
                log(f"  ⚠️ Virhe: {e}")

        if found_past_cutoff:
            log("  Saavuttu cutoff-päivään.")
            break

        # Next page
        try:
            btns = page.locator('button:has-text("Seuraava"), button:has-text("Näytä lisää")').all()
            clicked = False
            for btn in btns:
                if btn.is_visible(timeout=2000):
                    btn.click()
                    time.sleep(5)
                    clicked = True
                    break
            if not clicked:
                log("  Ei seuraavaa sivua.")
                break
        except:
            break

        page_num += 1

    return episodes


def capture_audio_url(page, episode):
    """Navigate to episode, play it, capture audio URL from network."""
    audio_url = None

    def on_response(response):
        nonlocal audio_url
        if 'appdata.richie.fi' in response.url and '.mp3' in response.url:
            audio_url = response.url

    page.on("response", on_response)

    try:
        page.goto(episode["supla_url"], wait_until="domcontentloaded", timeout=30000)
        time.sleep(5)
        handle_consent(page)

        # Click play
        play_btn = page.locator('button[aria-label="Toista"], button:has-text("Toista")').first
        play_btn.click(timeout=10000)
        log(f"    ▶️ Play painettu, odotetaan audiota...")

        for sec in range(120):
            if audio_url:
                break
            time.sleep(1)
            if sec > 0 and sec % 30 == 0:
                log(f"    ...odotetaan ({sec}s)")

        # Stop
        try:
            page.locator('button[aria-label="Pysäytä"]').first.click(timeout=3000)
        except:
            pass

    except Exception as e:
        log(f"    ⚠️ {e}")
    finally:
        page.remove_listener("response", on_response)

    return audio_url.split("?")[0] if audio_url else None


def main():
    log("=" * 60)
    log("Supla Audio URL -kerääjä — Uutisraportti 2016-2018")
    log("=" * 60)

    # Resume from existing
    existing = []
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            try:
                existing = json.load(f)
                log(f"\nJatketaan: {len(existing)} jaksoa jo kerätty.")
            except:
                existing = []

    done_ids = {e["id"] for e in existing if e.get("audio_url")}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        )
        page = ctx.new_page()

        # Step 1: Episode list
        log("\n📋 VAIHE 1: Jaksolista\n")
        episodes = scrape_episodes_from_page(page)

        # Deduplicate by date + normalized title
        unique = []
        seen = set()
        for ep in episodes:
            norm = re.sub(r'^[\d\s.:"\'"]+', '', ep["title"]).lower().strip()[:40]
            key = f"{ep['date_iso']}_{norm}"
            if key not in seen:
                seen.add(key)
                unique.append(ep)
            else:
                log(f"  🔄 Duplikaatti: {ep['title']}")
        episodes = unique

        log(f"\n📊 {len(episodes)} uniikkia jaksoa.")

        # Step 2: Audio URLs
        to_do = [e for e in episodes if e["id"] not in done_ids]
        log(f"\n🔊 VAIHE 2: Audio-URL:t ({len(to_do)} jäljellä)\n")

        results = list(existing)

        for i, ep in enumerate(to_do):
            log(f"[{i+1}/{len(to_do)}] {ep['title']} ({ep['date_str']})")
            url = capture_audio_url(page, ep)
            ep["audio_url"] = url
            results.append(ep)

            if url:
                log(f"    ✅ {url}")
            else:
                log(f"    ❌ Ei löytynyt")

            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)

            time.sleep(2)

        browser.close()

    found = sum(1 for r in results if r.get("audio_url"))
    log(f"\n{'=' * 60}")
    log(f"✅ Valmis! Tulos: {OUTPUT_FILE}")
    log(f"   Audio löytyi: {found}/{len(results)}")
    log(f"{'=' * 60}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Process episodes in supla_audio_urlit.json that are missing audio URLs.
Resumes from where we left off.
"""
import json
import time
import sys
from playwright.sync_api import sync_playwright

import os
# Polut ankkuroidaan tiedoston omaan sijaintiin, jotta kansion voi nimetä/siirtää vapaasti
PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(PIPELINE_KANSIO, "supla_audio_urlit.json")

with open(OUTPUT, "r") as f:
    data = json.load(f)

todo = [(i, ep) for i, ep in enumerate(data) if not ep.get("audio_url")]
print(f"Total: {len(data)}, need audio: {len(todo)}", flush=True)

if not todo:
    print("Nothing to do!", flush=True)
    sys.exit(0)


class AudioCapture:
    def __init__(self):
        self.url = None
    
    def handler(self, response):
        if 'appdata.richie.fi' in response.url and '.mp3' in response.url:
            self.url = response.url


def handle_consent(page):
    try:
        cf = page.frame_locator('iframe[id^="sp_message_iframe"]')
        cf.locator('button[title="OK"], button:has-text("OK")').first.click(timeout=5000)
        time.sleep(2)
    except:
        try:
            page.evaluate('document.querySelectorAll("[id^=sp_message_container]").forEach(e=>e.remove())')
        except:
            pass


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    )
    page = ctx.new_page()

    for idx, (data_idx, ep) in enumerate(todo):
        print(f"\n[{idx+1}/{len(todo)}] {ep['title']} ({ep['date_str']})", flush=True)

        capture = AudioCapture()
        page.on("response", capture.handler)

        try:
            page.goto(ep["supla_url"], wait_until="domcontentloaded", timeout=30000)
            time.sleep(5)
            handle_consent(page)

            play_btn = page.locator('button[aria-label="Toista"], button:has-text("Toista")').first
            play_btn.click(timeout=10000)
            print(f"    ▶️ Play clicked", flush=True)

            for sec in range(120):
                if capture.url:
                    break
                time.sleep(1)
                if sec > 0 and sec % 30 == 0:
                    print(f"    ...waiting ({sec}s)", flush=True)

            try:
                page.locator('button[aria-label="Pysäytä"]').first.click(timeout=3000)
            except:
                pass

        except Exception as e:
            print(f"    ⚠️ {e}", flush=True)
        finally:
            page.remove_listener("response", capture.handler)

        if capture.url:
            clean = capture.url.split("?")[0]
            data[data_idx]["audio_url"] = clean
            print(f"    ✅ {clean}", flush=True)
        else:
            print(f"    ❌ Not found", flush=True)

        with open(OUTPUT, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        time.sleep(2)

    browser.close()

found = sum(1 for e in data if e.get("audio_url"))
print(f"\n{'='*60}", flush=True)
print(f"✅ Done! Audio: {found}/{len(data)}", flush=True)
print(f"{'='*60}", flush=True)

import http.server
import json
import socketserver
import os
import subprocess

PORT = 5001
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class EventHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/tallenna':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                corrections = json.loads(post_data)
                
                # Tallenna korjaukset.json
                # Huom: Tallennetaan iCloud-kansioon, jotta paivita_korjaukset.sh löytää sen
                icloud_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                icloud_path = os.path.join(icloud_dir, "korjaukset.json")
                with open(icloud_path, 'w', encoding='utf-8') as f:
                    json.dump(corrections, f, ensure_ascii=False, indent=2)
                
                print(f"✅ Korjaukset tallennettu polkuun: {icloud_path}")
                
                # Aja julkaisuskripti
                deploy_script = os.path.join(icloud_dir, "paivita_korjaukset.sh")
                print(f"🚀 Ajetaan julkaisuskripti: {deploy_script}")
                
                # Käytetään subprocessia ajamaan skripti
                result = subprocess.run([deploy_script], capture_output=True, text=True)
                
                if result.returncode == 0:
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {"status": "success", "message": "Korjaukset sovellettu ja julkaistu!", "output": result.stdout}
                    self.wfile.write(json.dumps(response).encode())
                else:
                    print(f"❌ Virhe skriptin ajossa (exit code {result.returncode})")
                    print(f"STDOUT: {result.stdout}")
                    print(f"STDERR: {result.stderr}")
                    self.send_response(500)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {"status": "error", "message": "Virhe skriptin ajossa", "error": result.stderr}
                    self.wfile.write(json.dumps(response).encode())
            except Exception as e:
                print(f"❌ Virhe tallennuksessa: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path == '/ohita':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                item_to_ignore = json.loads(post_data)
                icloud_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                ohitukset_path = os.path.join(icloud_dir, "ohitukset.json")
                
                ohitukset = []
                if os.path.exists(ohitukset_path):
                    with open(ohitukset_path, 'r', encoding='utf-8') as f:
                        ohitukset = json.load(f)
                
                # Tarkista onko jo listalla
                if not any(o.get('jakso_id') == item_to_ignore.get('jakso_id') and o.get('r_idx') == item_to_ignore.get('r_idx') for o in ohitukset):
                    ohitukset.append(item_to_ignore)
                
                with open(ohitukset_path, 'w', encoding='utf-8') as f:
                    json.dump(ohitukset, f, ensure_ascii=False, indent=2)
                
                print(f"✅ Lisätty pysyvä ohitus: {item_to_ignore}")
                
                # Päivitetään validaattorin data jotta se häviää heti
                # (repon venv-python, koska validoi tarvitsee feedparserin)
                validoi_script = os.path.join(icloud_dir, "validoi_suosittelijat.py")
                venv_python = os.path.join(icloud_dir, "venv", "bin", "python3")
                subprocess.run([venv_python, validoi_script])

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Lisätty pysyviin ohituksiin"}).encode())
            except Exception as e:
                print(f"❌ Virhe ohituksen tallennuksessa: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

class SafeTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with SafeTCPServer(("127.0.0.1", PORT), EventHandler) as httpd:
    print(f"📡 Valdaattori-palvelin käynnissä portissa {PORT}")
    print(f"🔗 Avaa osoite: http://127.0.0.1:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Palvelin suljetaan...")
        httpd.server_close()

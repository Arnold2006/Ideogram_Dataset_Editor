"""
Fallback browser launcher when Electron is not available (python_embeded only).
Serves dist/ on http://127.0.0.1:0 and opens default browser.
Dataset/model/AI features require Electron IPC and will show a message;
this mode is preview-only for the portable without Node/Electron.
"""
import http.server, socketserver, threading, webbrowser, pathlib, sys, os
ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PORT = 0
if "--browser" in sys.argv:
  if not DIST.exists():
    print(f"dist/ not found at {DIST} — run: npm run dist")
    sys.exit(1)
  os.chdir(DIST)
  handler = http.server.SimpleHTTPRequestHandler
  with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    print(f"Serving {DIST} at {url} — opening browser (preview, no IPC)...")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
else:
  print("Usage: launch.py --browser")

"""Start the VITAL server:  python app.py"""
import socket

import config
from vital import create_app

app = create_app()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    ip = lan_ip()
    print("\n  VITAL server is running")
    print(f"  On this laptop:         http://localhost:{config.PORT}")
    print(f"  From a phone / ESP32:   http://{ip}:{config.PORT}")
    print(f"  Put this in the firmware as SERVER_URL:  http://{ip}:{config.PORT}\n")
    app.run(host="0.0.0.0", port=config.PORT, debug=False, threaded=True)

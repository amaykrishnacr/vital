# =====================================================================
#  VITAL settings - this is the only file you normally need to edit.
# =====================================================================

# Port the website runs on. Open http://localhost:5000 on this laptop,
# or http://<laptop-ip>:5000 from a phone on the same Wi-Fi.
PORT = 5000

# Shared secret between the ESP32 (or the simulator) and this server.
# The same text must be in the firmware and in the simulator settings.
DEVICE_KEY = "vital-device-key"

# Telegram bot token from @BotFather (see README, "Emergency alerts").
# Leave empty to run without Telegram; alerts still show on the website.
TELEGRAM_BOT_TOKEN = ""

# Used to sign login cookies. Change it to any long random text.
SECRET_KEY = "change-me-to-any-long-random-text"

# Shown on the City view page.
CITY_NAME = "Vellore"

# A finger on the MLX90614 reads cooler than body temperature.
# Body temperature = skin reading + offset. Each user can be calibrated
# from the admin "Users" page; this is the starting value.
DEFAULT_TEMP_OFFSET = 2.4

# How long to wait before sending the same kind of alert again (minutes).
ALERT_COOLDOWN_MIN = 5

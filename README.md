# VITAL

**IoT-Enabled Smart Health Monitoring and Emergency Alert System with AI-Based Anomaly Prediction for Smart City Integration**

VITAL (Vitals Intelligence, Tracking & Anomaly Learning) reads heart rate, blood oxygen (SpO₂) and temperature from an ESP32 device. It then:

- shows the readings live on a website
- learns what is normal for each person
- predicts worrying trends early
- sends emergency alerts on Telegram
- publishes anonymised, ward-level summaries for a smart city platform

This repository contains the server, the website, the machine learning, a **fake ESP32** for testing without hardware, and the **ESP32 firmware** in `firmware/`. The presentation is in `docs/`.

---

## What's inside

```
vital/
├── setup.bat              ← run once: installs everything and creates demo data
├── start_server.bat       ← starts the website (keep the window open)
├── start_simulator.bat    ← starts the fake ESP32
├── server/
│   ├── config.py          ← the ONLY file you normally edit (Telegram token, keys)
│   ├── app.py             ← starts the server
│   ├── seed_demo.py       ← creates 7 days of demo history + trains the models
│   ├── vital/
│   │   ├── api.py         ← JSON API (device, website, admin)
│   │   ├── live.py        ← processes every reading (quality → ML → prediction → alerts)
│   │   ├── alerts.py      ← alert rules + Telegram
│   │   ├── city.py        ← smart city ward summaries (MQTT messages)
│   │   ├── db.py          ← SQLite database
│   │   └── ml/
│   │       ├── anomaly.py ← Isolation Forest, one model per user
│   │       ├── predict.py ← trend prediction (linear regression, 15 min ahead)
│   │       ├── state.py   ← health-state classifier (decision tree)
│   │       ├── quality.py ← signal-quality model (logistic regression)
│   │       └── insights.py← plain-English cards for Simple mode
│   ├── templates/         ← web pages (HTML)
│   └── static/            ← CSS, JavaScript, Chart.js (works offline)
├── simulator/
│   └── fake_esp32.py      ← pretends to be the device, with demo scenarios
├── firmware/
│   ├── sensor_test/       ← upload first: checks the wiring
│   └── vital_firmware/    ← the real device code (edit config.h)
└── docs/                  ← presentation and screenshots
```

---

## Setup on Windows (once)

You need **Python 3.10 or newer**. In Command Prompt, `python --version` should print a version number. If it doesn't, install Python from python.org and tick **"Add python.exe to PATH"** during installation.

1. **Download the project.**
   - On GitHub, click **Code → Download ZIP** and unzip it somewhere simple, like `Documents\vital`.
   - Or, if you have Git, run `git clone https://github.com/amaykrishnacr/vital`.
2. Double-click **`setup.bat`**. It:
   - creates a private Python environment in `server\.venv`
   - installs Flask, NumPy, scikit-learn and Requests
   - creates 7 days of demo history and trains each person's ML model (about 30 seconds)

## Running it

1. Double-click **`start_server.bat`**. A black window opens and your browser opens http://localhost:5000.
   - Keep the window open; closing it stops VITAL.
   - The window also shows the address phones (and later the ESP32) can use, like `http://192.168.x.x:5000`.
   - The first time, Windows Firewall may ask about Python. Click **Allow** so phones and the ESP32 can connect.
2. Double-click **`start_simulator.bat`**. It sends readings once per second, just like the real device will.
3. Log in:

| Account | Username | Password | What it sees |
|---|---|---|---|
| Admin (supervisor) | `admin` | `admin123` | Monitoring station, alerts, users, City view |
| Team members | `member1` … `member4` | `vital123` | Their own live page and history |

> Change the passwords on the **Users** page before showing it to anyone.

4. As a member, press **Start measurement**. The pulse wave, numbers and "What VITAL noticed" cards start updating. Use the **Simple / Detailed** switch at the top.

Only one person can measure at a time, because there is one device. Press **Stop** before someone else starts.

---

## Demo walkthrough (for the showcase)

The admin **Station** page has a **Demo · simulator scenario** menu. Choosing a scenario changes what the fake ESP32 sends, so you can show every feature live:

| Scenario | What happens | Shows off |
|---|---|---|
| Normal resting | Calm readings | Simple mode insights, personal baseline |
| After exercise | Heart rate ~110 | State changes to *Elevated*; status "Keep an eye" |
| Developing fever | Temperature climbs ~0.12 °C/min | **Trend prediction**: early warning minutes before 38 °C, then a critical alert at 38.5 °C |
| Oxygen dropping | SpO₂ falls below 90 % | **Critical alert** within about a minute: red tile, OLED "ALERT", Telegram message |
| High heart rate at rest | ~134 bpm | Heart-rate alert |
| Moving finger (bad signal) | Noisy waveform | **Signal-quality model** rejects bad readings |
| No finger on sensor | Nothing to measure | "Place your finger on the sensor" |

A good order for the demo:

1. Log in as a member in one browser window and as admin in another (or on a phone).
2. Start with *Normal*, flip Simple ↔ Detailed, and open History.
3. Switch to *Oxygen dropping* and watch the member's page turn red, the admin tile flash and the Telegram message arrive.
4. Switch to *Developing fever*. After about 2 minutes, an **early warning** appears with an estimated time.
5. Finish on **City view**.

Pick **Normal** again to reset. Acknowledge alerts on the **Alerts** page.

---

## Emergency alerts on Telegram

1. In Telegram, search for **@BotFather**, send `/newbot`, and follow the steps. It gives you a **token** like `123456789:AAH...`.
2. Open `server\config.py` in Notepad, paste the token in the quotes after `TELEGRAM_BOT_TOKEN =`, and save. Restart the server.
3. The emergency contact (a teammate, for the demo) opens your bot in Telegram and presses **Start**.
4. On the **Users** page, click **Edit** on a member, then **Find chat ID**, and click that contact's name. Click **Save**, then **Send test alert**.

Alert rules (`server/vital/alerts.py`):

- SpO₂ below 90 % for 10 s
- heart rate above 120 or below 45 bpm for 10 s
- temperature 38.5 °C or higher
- an anomaly score of 0.7 or more for three windows in a row
- an early warning from trend prediction

The same kind of alert is not repeated for 5 minutes. Telegram needs internet on the laptop; without it, alerts still appear on the website and the Alerts page shows "not sent".

## Temperature calibration

A fingertip reads cooler than the body, so VITAL adds an offset (default +2.4 °C). To calibrate:

1. While a member is measuring, take their temperature with a normal thermometer.
2. On **Users → Edit**, enter the thermometer reading and click **Calibrate**.

---

## How the machine learning works

| Model | Library | What it does |
|---|---|---|
| **Anomaly detection** | `IsolationForest` (200 trees), one per user | Learns each person's normal from 10-second windows (mean HR, HR variability, HR range, SpO₂, temperature). It produces an anomaly score from 0 (normal) to 1 (very unusual for *this* person). Before a user has 30 windows (5 minutes), VITAL uses population limits instead. It retrains automatically every 60 new windows, or on demand from the Users page. |
| **Trend prediction** | `numpy.polyfit` | Fits a straight line to the last 10 minutes of each vital (10-second averages) and projects it 15 minutes ahead. If the line crosses a danger limit (38 °C, 120 bpm, SpO₂ 92 %), it gives the estimated time left. |
| **Health state** | `DecisionTreeClassifier` | Labels each window *Resting*, *Elevated*, *Possible fever* or *Low oxygen*. It is pre-trained on generated examples, because four people can't safely record real fever or low-oxygen data. |
| **Signal quality** | `LogisticRegression` | Uses perfusion index, waveform roughness and heart-rate jumps to score 0–100. Readings under 40 are ignored. |

VITAL is a wellness and early-warning tool, **not a medical device**.

---

## Connecting the real ESP32

Step-by-step instructions are in **[firmware/README.md](firmware/README.md)**: board setup, libraries, the wiring test sketch, and what to put in `config.h`. Start the server first, copy the `SERVER_URL` it prints into `config.h`, upload, then log in and press **Start measurement**.

For reference, the device sends one JSON message per second:

```
POST http://<laptop-ip>:5000/api/reading
Header:  X-Device-Key: vital-device-key        (DEVICE_KEY in config.py)
{
  "device": "vital-01", "fw": "1.0", "rate": 100, "rssi": -58,
  "finger": true, "bpm": 74.2, "spo2": 98, "temp": 34.3, "ambient": 29.4,
  "ir": 112840, "red": 98215,
  "wave": [25 IR samples], "red_wave": [25 red samples]
}
```

`temp` is the raw MLX90614 object (skin) temperature; the server adds the calibration offset. The reply tells the device what to show on the OLED, for example `{"user": "Member 1", "alert": true, "temp": 36.7, "msg": "ALERT LOW SPO2"}`.

> The ESP32 only connects to **2.4 GHz** Wi-Fi. On a phone hotspot, turn on "Maximise compatibility" / 2.4 GHz.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `python` is not recognized | Reinstall Python and tick **Add python.exe to PATH**, or use `py` instead. |
| Port 5000 is busy | Change `PORT` in `server\config.py` (e.g. 5050), and use that port in the simulator: `start_simulator.bat --server http://localhost:5050`. |
| Phone can't open the site | Phone and laptop must be on the same Wi-Fi; allow Python through Windows Firewall. |
| Simulator says "bad device key" | `DEVICE_KEY` in `config.py` and `--key` in the simulator must match. |
| Start shows "No VITAL device has connected yet" | Start the simulator (or the ESP32) first. |
| Want a fresh demo database | Stop the server, delete `server\data`, run `setup.bat` again. |

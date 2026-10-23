# VITAL firmware (ESP32 DevKit V1, Arduino IDE)

There are two sketches:

| Sketch | What it does | When to use it |
|---|---|---|
| `sensor_test/` | Scans the I²C bus, lists the modules it finds, and prints live readings (IR, heart rate, temperatures). No Wi-Fi. | **First.** It checks the wiring. |
| `vital_firmware/` | The real device: reads the sensors, draws the OLED and sends data to the VITAL server every second. | Once the test sketch shows all three modules. |

## 1. One-time Arduino IDE setup

1. **Add the ESP32 boards.** Go to **File → Preferences → Additional boards manager URLs** and paste:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   Then go to **Tools → Board → Boards Manager**, search **esp32**, and install **esp32 by Espressif Systems**.
2. **Install the libraries.** Go to **Tools → Manage Libraries…** and install:
   - **SparkFun MAX3010x Pulse and Proximity Sensor Library**
   - **Adafruit MLX90614 Library**
   - **Adafruit SSD1306**
   - If asked, click **Install all**. This also installs Adafruit GFX and Adafruit BusIO.
3. **Choose the board.** Set **Tools → Board → esp32 → DOIT ESP32 DEVKIT V1**, and **Tools → Port** to the COM port that appears when you plug in the board.
   - If no COM port appears, install the **CP210x USB driver** from Silicon Labs.

## 2. Test the wiring

| ESP32 | MAX30102 · GY-906 · OLED |
|---|---|
| 3V3 | VIN / VCC |
| GND | GND |
| GPIO 21 | SDA |
| GPIO 22 | SCL |

1. Open `sensor_test/sensor_test.ino` and click **Upload**.
2. Open **Tools → Serial Monitor** and set it to **115200 baud**. You should see:

```
  found 0x3C  OLED display (SSD1306)
  found 0x57  MAX30102 pulse oximeter
  found 0x5A  MLX90614 thermometer (GY-906)
```

3. Rest a fingertip on the MAX30102. `finger=YES` should appear, and after a few seconds a heart rate.

## 3. Upload the real firmware

1. Open `vital_firmware/vital_firmware.ino`. Arduino opens `config.h` in a second tab.
2. In `config.h`, fill in:
   - `WIFI_SSID` and `WIFI_PASSWORD`. The ESP32 only works on **2.4 GHz** Wi-Fi.
   - `SERVER_URL`. Copy this from the line `start_server.bat` prints: *"Put this in the firmware as SERVER_URL: http://192.168.x.x:5000"*.
   - `DEVICE_KEY`. It must match `DEVICE_KEY` in `server/config.py`. Both default to `vital-device-key`.
3. Upload, and keep the Serial Monitor open.

What the OLED shows:

| Screen | Meaning |
|---|---|
| `Joining Wi-Fi...` | Connecting. Check the SSID and password, and use 2.4 GHz. |
| `Server not found` | Wi-Fi works but the laptop can't be reached. Check `SERVER_URL`, that the server is running, and allow Python through Windows Firewall. |
| `Wrong DEVICE_KEY` | `config.h` and `server/config.py` don't match. |
| `Log in + Start` | Everything works. Log in on the website and press **Start measurement**. |
| Big number + `bpm`, SpO₂, temperature, pulse trace | Measuring. The top line shows whose session it is. |
| Blinking `ALERT …` bar | The server raised a critical alert. |

## How the firmware works

- **Two cores.**
  - **Core 1** (`loop`) reads the sensors 25 times a second: the LEDs sample at 100 Hz and are averaged 4×. It detects beats, computes SpO₂ and draws the OLED.
  - **Core 0** (`networkTask`) handles Wi-Fi and the HTTP requests.
  - A FreeRTOS queue passes one packet per second between them, so a slow network never makes the sensor miss samples.
- **Heart rate.** The SparkFun `checkForBeat()` peak detector finds each beat; BPM = 60 / time between beats, averaged over the last 4 beats.
- **SpO₂.** Maxim's reference algorithm (`maxim_heart_rate_and_oxygen_saturation`) runs on the last 4 seconds (100 samples) of red and IR data, recalculated every second.
- **Temperature.** The MLX90614 object (skin) temperature is sent as is, and the server adds each user's calibrated offset.
- **I²C at 100 kHz**, because the MLX90614 supports at most 100 kHz.
- **The waveform is flipped before sending** (`2 × average − raw`), because the sensor receives *less* light when blood arrives. Flipped, each heartbeat points up on the website.

## Troubleshooting

| Problem | Fix |
|---|---|
| Upload fails with "Failed to connect to ESP32" | Hold the **BOOT** button when "Connecting…" appears, and release once uploading starts. |
| Nothing found on I²C | Check that 3V3 and GND reach the breadboard rails, that SDA is on GPIO 21 and SCL on GPIO 22, and that the header pins are pushed fully in. |
| MAX30102 not found, but the others are | Some cheap MAX30102 boards pull SDA/SCL up to only 1.8 V. Add a 4.7 kΩ resistor from SDA to 3V3 and another from SCL to 3V3. |
| Heart rate jumps around | Rest the finger gently. Pressing hard blocks the blood flow. Keep still; the signal-quality model on the server rejects noisy readings. |
| Temperature reads ~33–35 °C | Normal for a fingertip. Calibrate on the website: **Users → Edit → Calibrate**. |

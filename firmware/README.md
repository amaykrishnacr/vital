# VITAL firmware (ESP32 DevKit V1, Arduino IDE)

The firmware will be added here. Until then, use `simulator/fake_esp32.py`,
which sends exactly the same messages the ESP32 will send.

Wiring (all three modules share the I²C bus):

| ESP32 | MAX30102 / GY-906 / OLED |
|---|---|
| 3V3 | VIN / VCC |
| GND | GND |
| GPIO 21 | SDA |
| GPIO 22 | SCL |

Libraries to install from the Arduino Library Manager:

- SparkFun MAX3010x Pulse and Proximity Sensor Library
- Adafruit MLX90614 Library
- Adafruit SSD1306 and Adafruit GFX Library
- ArduinoJson

The message format the firmware must send is described in the main README,
under "Connecting the real ESP32 later".

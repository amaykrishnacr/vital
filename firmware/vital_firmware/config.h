// =====================================================================
//  VITAL firmware settings - edit these before uploading.
// =====================================================================
#pragma once

// Wi-Fi network (2.4 GHz only! On a phone hotspot turn on
// "Maximise compatibility" / 2.4 GHz band).
#define WIFI_SSID      "YourWiFiName"
#define WIFI_PASSWORD  "YourWiFiPassword"

// Address of the laptop running the VITAL server. When you run
// start_server.bat it prints a line like:
//   Put this in the firmware as SERVER_URL:  http://192.168.1.20:5000
// Copy that address here (no slash at the end).
#define SERVER_URL     "http://192.168.1.20:5000"

// Must match DEVICE_KEY in server/config.py
#define DEVICE_KEY     "vital-device-key"

// Name of this device (shown on the admin page)
#define DEVICE_ID      "vital-01"

// Used only to show a temperature on the OLED before the server replies.
// The server applies each user's own calibrated offset.
#define TEMP_OFFSET_DEFAULT 2.4

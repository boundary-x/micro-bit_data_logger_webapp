# 📊 Boundary X - Bluetooth Data Streamer

**Boundary X Bluetooth Data Streamer** is a web-based application designed to receive sensor data from a **BBC Micro:bit** in real-time via **Web Bluetooth API (BLE)**.

This tool allows users to visualize sensor readings (e.g., temperature, light level, acceleration, analog pin values) through interactive charts and data tables, and export the collected logs to an Excel file for further analysis.

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Platform](https://img.shields.io/badge/Platform-Web-blue)
![Tech](https://img.shields.io/badge/Stack-Chart.js%20%7C%20SheetJS-yellow)

## ✨ Key Features

### 1. 📡 Real-time Data Monitoring
- **Live Chart:** Visualizes incoming sensor data streams using `Chart.js` with auto-updating line graphs.
- **Data Table:** Displays raw timestamped values in a scrollable table format.
- **Dynamic Sensor Discovery:** Automatically detects new data fields (e.g., `temp`, `P0`, `accX`) sent from the Micro:bit and adds them to the UI.

### 2. 🔗 Wireless Connectivity (BLE)
- Connects directly to **BBC Micro:bit** using the **Nordic UART Service**.
- **No Installation Required:** Works entirely within modern web browsers (Chrome, Edge) supporting Web Bluetooth.
- **Connection Status:** Clear visual indicators for connection states (Connected, Disconnected, Error).

### 3. ⚙️ User Controls
- **Toggle Sensors:** Enable or disable specific data streams via checkboxes to declutter the chart.
- **Rename Sensors:** Click on a sensor label to rename it (e.g., change "P0" to "Moisture").
- **Screen Wake Lock:** Prevents the device screen from turning off during long data logging sessions.

### 4. 📂 Data Export
- **Excel Download:** Export the collected dataset to an `.xlsx` file using `SheetJS` for offline analysis in Excel or Google Sheets.

---

## 📡 Communication Protocol

The Micro:bit should send data strings over Bluetooth UART ending with a newline character (`\n`). The format consists of key-value pairs separated by semicolons (`;`).

**Data Format:**
```text
key1=value1;key2=value2;...\n
```
**Examples:**
- **Sending Temperature and Light Level:** `temp=25;light=120\n`
- **Sending Acceleration (X, Y, Z):** `accX=-102;accY=34;accZ=980\n`
- **Sending Analog Pin Value:** `P0=512\n`

**Tech Stack:**
- **Frontend:** HTML5, CSS3
- **Libraries:**
  - Chart.js: For real-time data visualization.
  - SheetJS (xlsx): For exporting data to Excel.
- **Browser APIs:**
  - **Web Bluetooth API:** For communicating with BLE devices.
  - **Screen Wake Lock API:** To keep the display active during logging.

**License:**
- Copyright © 2024 Boundary X Co. All rights reserved.
- All rights to the source code and design of this project belong to BoundaryX.
- Web: boundaryx.io
- Contact: https://boundaryx.io/contact

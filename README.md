# Biofilm Risk Detection System

This project is an IoT-based system designed to monitor water quality parameters and predict the risk of biofilm formation using a Machine Learning model.

## 🏗 System Architecture

The system consists of three main components:
1.  **IoT Node (ESP32)**: Collects sensor data (pH, Temperature, Humidity, Flow, Turbidity, TDS) and hosts a local web server/API.
2.  **Processing Unit (Python Script)**: Fetches data from the ESP32, feeds it into a Random Forest Regressor model to predict biofilm risk, and uploads the results to ThingSpeak.
3.  **Visualization (ThingSpeak)**: Cloud platform for visualizing the data.

## 🔌 Hardware Requirements

- **Microcontroller**: ESP32
- **Sensors**:
    - **DHT11**: Temperature & Humidity (Pin 2)
    - **Flow Sensor**: (Pin 4)
    - **Turbidity Sensor**: (Pin 32)
    - **TDS Sensor**: (Pin 33)
    - **pH Sensor**: Connected via Serial2 (RX: 16, TX: 17)

## 🛠 Software Requirements

- Python 3.x
- Arduino IDE (for flashing the ESP32)

### Arduino Libraries
- `WiFi`
- `WebServer`
- `DHT`

### Python Dependencies
See `requirements.txt`:
- `requests`
- `joblib`
- `numpy`
- `python-dotenv`

## 🚀 Installation & Setup

### 1. Arduino Setup
1.  Navigate to `biofilim_jit_2026/`.
2.  Create a `secrets.h` file based on `secrets_example.h` and enter your WiFi credentials:
    ```cpp
    #define SECRETS_H
    const char* ssid = "YOUR_WIFI_SSID";
    const char* password = "YOUR_WIFI_PASSWORD";
    #endif
    ```
3.  Open `biofilim_jit_2026.ino` in Arduino IDE.
4.  Select your board and port, then upload the code.
5.  Open Serial Monitor to find the **ESP32 IP Address**.

### 2. Python Setup
1.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
2.  Create a `.env` file in the root directory based on `.env.example`:
    ```ini
    ESP32_IP=http://<YOUR_ESP32_IP>/status
    THINGSPEAK_API_KEY=YOUR_THINGSPEAK_API_KEY
    ```
3.  Ensure the following model files are present in the root directory:
    - `biofilm_risk_rf_regressor.pkl`

## ▶️ Usage

Run the main script to start monitoring:

```bash
python test.py
```

The script will:
1.  Connect to the ESP32 Node.
2.  Read sensor values.
3.  Predict biofilm risk percentage.
4.  Print the result to the console.
5.  Upload the data to ThingSpeak.

[Link 🔗](https://biofilim-risk-detection-493o3v8ow-nithish-vs-projects.vercel.app/)


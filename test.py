import requests
import joblib
import numpy as np
import time

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ================= USER CONFIG =================
ESP32_IP = os.getenv("ESP32_IP")
THINGSPEAK_API_KEY = os.getenv("THINGSPEAK_API_KEY")
THINGSPEAK_URL = "https://api.thingspeak.com/update"

MODEL_PATH = "biofilm_risk_rf_regressor.pkl"
INTERVAL_SEC = 5   # ThingSpeak minimum = 15 sec
# ===============================================

# Load model
model = joblib.load(MODEL_PATH)

def risk_label(percent):
    if percent < 30:
        return "LOW", 1
    elif percent < 60:
        return "MEDIUM", 2
    else:
        return "HIGH", 3

while True:
    try:
        # ================= FETCH DATA =================
        response = requests.get(ESP32_IP, timeout=5)
        data = response.json()

        ph = data["ph"]
        temp = data["temperature"]
        hum = data["humidity"]
        flow = data["flow"]
        turb = data["turbidity"]
        tds = data["tds"]

        # ================= PREDICTION =================
        X = np.array([[ph, temp, hum, flow, turb, tds]])
        risk_percent = float(model.predict(X)[0])
        risk_percent = max(0, min(100, risk_percent))

        label, label_code = risk_label(risk_percent)

        print(f"Risk: {risk_percent:.2f}% → {label}")

        # ================= SEND TO THINGSPEAK =================
        payload = {
            "api_key": THINGSPEAK_API_KEY,
            "field1": ph,
            "field2": temp,
            "field3": hum,
            "field4": flow,
            "field5": turb,
            "field6": tds,
            "field7": round(risk_percent, 2),
            "field8": label_code
        }

        ts_response = requests.post(THINGSPEAK_URL, data=payload)
        if ts_response.status_code == 200:
            print("Data sent to ThingSpeak\n")
        else:
            print("ThingSpeak error:", ts_response.text)

    except Exception as e:
        print("Error:", e)

    time.sleep(INTERVAL_SEC)

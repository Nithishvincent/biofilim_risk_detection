import requests
import joblib
import numpy as np
import time
from collections import deque
import os
import random
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ================= USER CONFIG =================
ESP32_IP = os.getenv("ESP32_IP", "http://192.168.137.43") 
THINGSPEAK_API_KEY = os.getenv("THINGSPEAK_API_KEY")
THINGSPEAK_URL = "https://api.thingspeak.com/update"

MODEL_PATH = "biofilm_mlp_model.pkl"
SCALER_PATH = "scaler.pkl"
INTERVAL_SEC = 16   # ThingSpeak limit is 15s. Using 16s for safety.
SEQUENCE_LENGTH = 10 
FEATURES = ["ph", "temperature", "humidity", "flow", "turbidity", "tds"]

# Set to True to generate fake data if ESP32 is offline
SIMULATION_MODE = True 

# ===============================================

# Load model & scaler
print(f"Loading model from {MODEL_PATH}...")
try:
    model = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
except FileNotFoundError:
    print("Error: Model files not found. Run train_timeseries_mlp.py first.")
    exit(1)

# History Buffer
history_buffer = deque(maxlen=SEQUENCE_LENGTH)

def risk_label(percent):
    if percent < 30: return "LOW", 1
    elif percent < 60: return "MEDIUM", 2
    else: return "HIGH", 3

# Simulation State
class Simulator:
    def __init__(self):
        self.ph = 7.0
        self.temp = 30.0
        self.humidity = 60.0
        self.flow = 50.0
        self.turbidity = 500.0
        self.tds = 400.0

    def get_next_reading(self):
        # Drifting logic (Random Walk)
        self.ph += random.uniform(-0.1, 0.1)
        self.temp += random.uniform(-0.5, 0.5)
        self.humidity += random.uniform(-2, 2)
        self.flow += random.uniform(-2, 2)
        self.turbidity += random.uniform(-20, 20)
        self.tds += random.uniform(-10, 10)

        # Clamping
        self.ph = max(4, min(10, self.ph))
        self.temp = max(15, min(45, self.temp))
        self.humidity = max(20, min(100, self.humidity))
        self.flow = max(0, min(100, self.flow))
        self.turbidity = max(0, min(2000, self.turbidity))
        self.tds = max(0, min(1000, self.tds))

        return {
            "ph": round(self.ph, 2),
            "temperature": round(self.temp, 2),
            "humidity": round(self.humidity, 2),
            "flow": round(self.flow, 2),
            "turbidity": round(self.turbidity, 2),
            "tds": round(self.tds, 2)
        }

sim = Simulator()

def get_sensor_data():
    """Fetches data from ESP32 or generates fake data if in simulation mode."""
    try:
        response = requests.get(ESP32_IP, timeout=3)
        return response.json()
    except Exception as e:
        # Use simulation if request fails OR if explicitly enabled
        if SIMULATION_MODE:
            if "Connection failed" not in str(e): # Only print once/occasionally
                 pass 
            print(f"⚠️  Connection failed. Using SMOOTH SIMULATED data.")
            return sim.get_next_reading()
        else:
            raise e

def send_to_thingspeak(data, risk_val, label_code):
    """Sends data to ThingSpeak channel."""
    if not THINGSPEAK_API_KEY:
        return
        
    try:
        payload = {
            "api_key": THINGSPEAK_API_KEY,
            "field1": data.get("ph", 0),
            "field2": data.get("temperature", 0),
            "field3": data.get("humidity", 0),
            "field4": data.get("flow", 0),
            "field5": data.get("turbidity", 0),
            "field6": data.get("tds", 0),
            "field7": round(risk_val, 2),
            "field8": label_code # 0=OFF, 1=LOW, 2=MED, 3=HIGH
        }
        requests.post(THINGSPEAK_URL, data=payload, timeout=3)
        print("☁️  Sent to ThingSpeak")
    except Exception as e:
        print(f"❌ ThingSpeak Error: {e}")

print("Starting monitoring... Waiting for buffer to fill.")
print(f"Simulation Mode: {'ON' if SIMULATION_MODE else 'OFF'}")

try:
    while True:
        try:
            # 1. Fetch Data
            data = get_sensor_data()
            
            # 2. Preprocess
            current_features = [data[f] for f in FEATURES]
            current_scaled = scaler.transform(np.array(current_features).reshape(1, -1))[0]
            history_buffer.append(current_scaled)

            # 3. Predict (only if buffer is full)
            if len(history_buffer) == SEQUENCE_LENGTH:
                # Flatten: (10, 6) -> (60,)
                input_seq = np.array(history_buffer).flatten().reshape(1, -1)
                
                # Predict
                risk_scaled = float(model.predict(input_seq)[0])
                risk_percent = max(0, min(100, risk_scaled * 100.0))
                label, label_code = risk_label(risk_percent)

                print(f"✅ Data: {data} | Risk: {risk_percent:.2f}% ({label})")
                
                # 4. Upload to ThingSpeak
                send_to_thingspeak(data, risk_percent, label_code)
                
            else:
                print(f"⏳ Calibrating... {len(history_buffer)}/{SEQUENCE_LENGTH}")

        except Exception as e:
            print(f"❌ Error: {e}")
            time.sleep(2)

        time.sleep(INTERVAL_SEC)

except KeyboardInterrupt:
    print("\n🛑 Stopping... Sending INACTIVE status to ThingSpeak.")
    # Send field8 = 0 to indicate System Inactive
    # We send the last known data (or zeros) but explicitly set field8 to 0
    send_to_thingspeak({}, 0.0, 0) # 0 = Inactive
    print("Goodbye.")

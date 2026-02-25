import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, r2_score

# Try importing tensorflow/keras
try:
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    from tensorflow.keras.callbacks import EarlyStopping
except ImportError:
    print("Error: TensorFlow is not installed. Please run `pip install tensorflow`.")
    exit(1)

# ===============================
# CONFIG
# ===============================
DATA_FILE = "dataset_timeseries.csv"
MODEL_FILE = "biofilm_lstm_model.h5"
SCALER_FILE = "scaler.pkl"
SEQUENCE_LENGTH = 10  # Look back 10 steps to predict current/next
TARGET_COL = "biofilm_risk_percent"
FEATURES = ["ph", "temperature", "humidity", "flow", "turbidity", "tds"]

# ===============================
# 1. LOAD & PREPROCESS
# ===============================
print("Loading dataset...")
df = pd.read_csv(DATA_FILE)

# Scale Features (Important for LSTM)
scaler = MinMaxScaler(feature_range=(0, 1))
scaled_data = scaler.fit_transform(df[FEATURES])

# Save scaler for inference
joblib.dump(scaler, SCALER_FILE)

# Scale Target (Optional but good for training stability)
target_scaler = MinMaxScaler(feature_range=(0, 1))
df["target_scaled"] = target_scaler.fit_transform(df[[TARGET_COL]])
target_data = df["target_scaled"].values

# Create Sequences
# X: (Sample, TimeSteps, Features)
# y: (Sample, 1)
X = []
y = []

# We want to predict risk at time T using (T-10...T-1)
# Or predictive: using (T-9...T) to predict T+1. 
# Let's do: Input = last 10 readings, Output = Current Risk
for i in range(SEQUENCE_LENGTH, len(scaled_data)):
    X.append(scaled_data[i-SEQUENCE_LENGTH:i]) 
    y.append(target_data[i])

X = np.array(X)
y = np.array(y)

# Train/Test Split (Time Series Split - No Shuffle!)
split_idx = int(len(X) * 0.8)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

print(f"Training shape: {X_train.shape}, Testing shape: {X_test.shape}")

# ===============================
# 2. BUILD LSTM MODEL
# ===============================
model = Sequential()
model.add(LSTM(units=50, return_sequences=True, input_shape=(X_train.shape[1], X_train.shape[2])))
model.add(Dropout(0.2))
model.add(LSTM(units=50, return_sequences=False))
model.add(Dropout(0.2))
model.add(Dense(units=1)) # Regression output

model.compile(optimizer='adam', loss='mean_squared_error')

# ===============================
# 3. TRAIN
# ===============================
print("Training LSTM...")
early_stop = EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True)

history = model.fit(
    X_train, y_train,
    epochs=20, # Low epochs for demo, increase for better accuracy
    batch_size=32,
    validation_data=(X_test, y_test),
    callbacks=[early_stop],
    verbose=1
)

# Save Model
model.save(MODEL_FILE)
print(f"Model saved to {MODEL_FILE}")

# ===============================
# 4. EVALUATE
# ===============================
print("Evaluating...")
predictions_scaled = model.predict(X_test)
# Inverse transform
predictions = target_scaler.inverse_transform(predictions_scaled)
y_test_real = target_scaler.inverse_transform(y_test.reshape(-1, 1))

mae = mean_absolute_error(y_test_real, predictions)
r2 = r2_score(y_test_real, predictions)

print(f"MAE: {mae:.4f}")
print(f"R2 Score: {r2:.4f}")

# ===============================
# 5. VISUALIZE
# ===============================
plt.figure(figsize=(12, 6))
plt.plot(y_test_real, color='blue', label='Actual Risk')
plt.plot(predictions, color='red', label='Predicted Risk (LSTM)')
plt.title('Biofilm Risk Prediction - LSTM Time Series')
plt.xlabel('Time Step')
plt.ylabel('Risk (%)')
plt.legend()
plt.show()

# Show training loss
plt.figure(figsize=(8, 4))
plt.plot(history.history['loss'], label='Train Loss')
plt.plot(history.history['val_loss'], label='Val Loss')
plt.title('Model Loss')
plt.xlabel('Epoch')
plt.ylabel('Loss')
plt.legend()
plt.show()

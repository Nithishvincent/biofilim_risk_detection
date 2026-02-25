import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt
from sklearn.preprocessing import MinMaxScaler
from sklearn.neural_network import MLPRegressor
from sklearn.metrics import mean_absolute_error, r2_score

# ===============================
# CONFIG
# ===============================
DATA_FILE = "dataset_timeseries.csv"
MODEL_FILE = "biofilm_mlp_model.pkl"
SCALER_FILE = "scaler.pkl"
SEQUENCE_LENGTH = 10  # Look back 10 steps
TARGET_COL = "biofilm_risk_percent"
FEATURES = ["ph", "temperature", "humidity", "flow", "turbidity", "tds"]

print(f"Loading {DATA_FILE}...")
try:
    df = pd.read_csv(DATA_FILE)
except FileNotFoundError:
    print("Error: dataset_timeseries.csv not found. Run generate_timeseries.py first.")
    exit(1)

# ===============================
# 1. PREPROCESSING
# ===============================
# Scale Features
scaler = MinMaxScaler(feature_range=(0, 1))
scaled_features = scaler.fit_transform(df[FEATURES])
scaled_target = df[TARGET_COL].values / 100.0 # Normalize 0-100 to 0-1

# Save scaler for real-time inference
joblib.dump(scaler, SCALER_FILE)

# Prepare Sliding Window Data
# We flatten the sequence: [t-9, t-8 ... t] -> Single 1D vector of size (SequenceLength * NumFeatures)
X = []
y = []

print(f"Creating sequences with length {SEQUENCE_LENGTH}...")
for i in range(SEQUENCE_LENGTH, len(df)):
    # Extract sequence of features
    seq = scaled_features[i-SEQUENCE_LENGTH:i]
    # Flatten it: (10, 6) -> (60,)
    X.append(seq.flatten())
    y.append(scaled_target[i])

X = np.array(X)
y = np.array(y)

# Split
split_idx = int(len(X) * 0.8)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

print(f"Training shape: {X_train.shape}") # Should be (Samples, 60)

# ===============================
# 2. TRAIN MLP (Neural Network)
# ===============================
print("Training MLP Regressor (Neural Network)...")
# 2 Hidden Layers: 64 neurons, 32 neurons
mlp = MLPRegressor(
    hidden_layer_sizes=(64, 32),
    activation='relu',
    solver='adam',
    max_iter=500,
    random_state=42,
    early_stopping=True,
    validation_fraction=0.1
)

mlp.fit(X_train, y_train)

# Save
joblib.dump(mlp, MODEL_FILE)
print(f"Model saved to {MODEL_FILE}")

# ===============================
# 3. EVALUATE
# ===============================
y_pred_scaled = mlp.predict(X_test)

# Inverse transform target
y_test_real = y_test * 100.0
y_pred_real = y_pred_scaled * 100.0

mae = mean_absolute_error(y_test_real, y_pred_real)
r2 = r2_score(y_test_real, y_pred_real)

print(f"MAE: {mae:.4f}")
print(f"R2 Score: {r2:.4f}")

# ===============================
# 4. VISUALIZE
# ===============================
plt.figure(figsize=(12, 6))
# Plot subset for clarity
subset = 200
plt.plot(y_test_real[:subset], label='Actual Risk', color='blue')
plt.plot(y_pred_real[:subset], label='Predicted Risk (MLP-Time)', color='red', linestyle='--')
plt.title(f'Time-Series Prediction (MLP)\nR²: {r2:.4f}')
plt.xlabel('Time Step')
plt.ylabel('Risk (%)')
plt.legend()
plt.tight_layout()
plt.show()

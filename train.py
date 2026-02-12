import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score
)

# ===============================
# LOAD DATASET
# ===============================
df = pd.read_csv("dataset.csv")

X = df[["ph", "temperature", "humidity", "flow", "turbidity", "tds"]]
y = df["biofilm_risk_percent"]

# ===============================
# TRAIN TEST SPLIT
# ===============================
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# ===============================
# XGBOOST REGRESSOR
# ===============================
xgb_reg = xgb.XGBRegressor(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.1,
    random_state=42,
    n_jobs=-1
)

xgb_reg.fit(X_train, y_train)

# ===============================
# SAVE MODEL
# ===============================
joblib.dump(xgb_reg, "biofilm_risk_xgboost.pkl")

# ===============================
# PREDICTION
# ===============================
y_pred = xgb_reg.predict(X_test)

# ===============================
# METRICS
# ===============================
mae = mean_absolute_error(y_test, y_pred)
mse = mean_squared_error(y_test, y_pred)
rmse = np.sqrt(mse)
r2 = r2_score(y_test, y_pred)

print("MAE :", mae)
print("MSE :", mse)
print("RMSE:", rmse)
print("R²  :", r2)

# ===============================
# ACTUAL vs PREDICTED
# ===============================
plt.figure(figsize=(6, 5))
plt.scatter(y_test, y_pred, alpha=0.6)
plt.plot([0, 100], [0, 100], linestyle="--")
plt.xlabel("Actual Risk (%)")
plt.ylabel("Predicted Risk (%)")
plt.title("Actual vs Predicted Biofilm Risk")
plt.tight_layout()
plt.show()

# ===============================
# RESIDUAL PLOT
# ===============================
residuals = y_test - y_pred

plt.figure(figsize=(6, 4))
sns.histplot(residuals, bins=30, kde=True)
plt.xlabel("Residual Error")
plt.title("Residual Distribution")
plt.tight_layout()
plt.show()

# ===============================
# FEATURE IMPORTANCE
# ===============================
importance = xgb_reg.feature_importances_

plt.figure(figsize=(7, 4))
sns.barplot(x=importance, y=X.columns)
plt.title("Feature Importance – Biofilm Risk (%)")
plt.xlabel("Importance Score")
plt.ylabel("Sensor Feature")
plt.tight_layout()
plt.show()

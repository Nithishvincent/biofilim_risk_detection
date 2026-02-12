import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor, VotingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
try:
    import xgboost as xgb
except ImportError:
    print("Error: XGBoost is not installed. Please install it using 'pip install xgboost'.")
    exit(1)

# ===============================
# LOAD DATASET
# ===============================
try:
    df = pd.read_csv("dataset.csv")
except FileNotFoundError:
    print("Error: dataset.csv not found.")
    exit(1)

X = df[["ph", "temperature", "humidity", "flow", "turbidity", "tds"]]
y = df["biofilm_risk_percent"]

# ===============================
# TRAIN TEST SPLIT
# ===============================
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# ===============================
# 1. RANDOM FOREST REGRESSOR (Baseline)
# ===============================
print("Training Random Forest...")
rf_reg = RandomForestRegressor(
    n_estimators=300,
    max_depth=14,
    min_samples_split=5,
    min_samples_leaf=2,
    random_state=42,
    n_jobs=-1
)
rf_reg.fit(X_train, y_train)
y_pred_rf = rf_reg.predict(X_test)

# ===============================
# 2. XGBOOST REGRESSOR
# ===============================
print("Training XGBoost...")
xgb_reg = xgb.XGBRegressor(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.1,
    random_state=42,
    n_jobs=-1
)
xgb_reg.fit(X_train, y_train)
y_pred_xgb = xgb_reg.predict(X_test)

# ===============================
# 3. VOTING REGRESSOR (Ensemble)
# ===============================
print("Training Voting Regressor (RF + XGB)...")
voting_reg = VotingRegressor(
    estimators=[('rf', rf_reg), ('xgb', xgb_reg)]
)
voting_reg.fit(X_train, y_train)
y_pred_voting = voting_reg.predict(X_test)

# ===============================
# EVALUATION & METRICS
# ===============================
models = {
    "Random Forest": y_pred_rf,
    "XGBoost": y_pred_xgb,
    "Voting (RF+XGB)": y_pred_voting
}

print("\n" + "="*60)
print("Model Performance Comparison")
print("="*60)
print(f"{'Model':<20} | {'MAE':<10} | {'RMSE':<10} | {'R2 Score':<10}")
print("-" * 60)

best_model_name = ""
best_r2 = -np.inf

for name, y_pred in models.items():
    mae = mean_absolute_error(y_test, y_pred)
    mse = mean_squared_error(y_test, y_pred)
    rmse = np.sqrt(mse)
    r2 = r2_score(y_test, y_pred)
    
    print(f"{name:<20} | {mae:<10.4f} | {rmse:<10.4f} | {r2:<10.4f}")
    
    if r2 > best_r2:
        best_r2 = r2
        best_model_name = name

print("-" * 60)
print(f"Best Model: {best_model_name} with R2: {best_r2:.4f}")

# ===============================
# SAVE BEST MODEL
# ===============================
if best_model_name == "Random Forest":
    best_model = rf_reg
    filename = "biofilm_risk_rf_regressor.pkl"
elif best_model_name == "XGBoost":
    best_model = xgb_reg
    filename = "biofilm_risk_xgboost.pkl"
else:
    best_model = voting_reg
    filename = "biofilm_risk_ensemble.pkl"

print(f"\nSaving best model ({best_model_name}) to {filename}...")
joblib.dump(best_model, filename)

# ===============================
# VISUALIZATION
# ===============================
print("\nGenerating comparison plots...")

# 1. Actual vs Predicted (Subplots)
fig, axes = plt.subplots(1, 3, figsize=(18, 5))
fig.suptitle('Actual vs Predicted Biofilm Risk')

for i, (name, y_pred) in enumerate(models.items()):
    ax = axes[i]
    ax.scatter(y_test, y_pred, alpha=0.6)
    ax.plot([0, 100], [0, 100], linestyle="--", color='red')
    ax.set_xlabel("Actual Risk (%)")
    ax.set_ylabel("Predicted Risk (%)")
    ax.set_title(f"{name} (R²: {r2_score(y_test, y_pred):.4f})")

plt.tight_layout()
plt.show()

# 2. Residual Distribution (Subplots)
fig, axes = plt.subplots(1, 3, figsize=(18, 5))
fig.suptitle('Residual Distribution (Errors)')

for i, (name, y_pred) in enumerate(models.items()):
    ax = axes[i]
    residuals = y_test - y_pred
    sns.histplot(residuals, bins=30, kde=True, ax=ax)
    ax.set_xlabel("Residual Error")
    ax.set_title(f"{name} Residuals")

plt.tight_layout()
plt.show()

# 3. Feature Importance (Side-by-Side for RF and XGBoost)
# Note: Voting Regressor doesn't have a single feature_importances_ attribute
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
fig.suptitle('Feature Importance Comparison')

# Random Forest
importance_rf = rf_reg.feature_importances_
sns.barplot(x=importance_rf, y=X.columns, ax=axes[0])
axes[0].set_title("Random Forest Importance")
axes[0].set_xlabel("Score")

# XGBoost
importance_xgb = xgb_reg.feature_importances_
sns.barplot(x=importance_xgb, y=X.columns, ax=axes[1])
axes[1].set_title("XGBoost Importance")
axes[1].set_xlabel("Score")

plt.tight_layout()
plt.show()

print("Comparisons complete.")

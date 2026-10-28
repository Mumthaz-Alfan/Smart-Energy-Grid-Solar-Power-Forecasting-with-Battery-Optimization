"""
Extreme-Weather Stress-Testing Module (Week 4 Deliverable)
Simulates and evaluates solar forecasting and battery resilience under:
1. Normal Operating Conditions
2. Heavy Cloud Cover
3. Monsoon / Prolonged Low-Irradiance
4. Sudden Irradiance Reduction (Convective Storm Transient)
5. Multi-Day Low-Solar Generation
6. Rapid Post-Storm Irradiance Recovery

Includes:
- Weather scenario generator preserving physical night zero-inflation
- Out-of-sample forecast stress evaluation (Ridge & LightGBM)
- PuLP Battery LP resilience stress testing (grid dependence, autonomy, throughput)
- Automated report and publication figure generation
"""

import os
import sys
import tempfile
from pathlib import Path

# Ensure project root is available in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd

# Headless matplotlib configuration
os.environ.setdefault("MPLCONFIGDIR", tempfile.gettempdir())
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.data.loader import load_processed_handoff, get_project_root
from src.features.engineering import apply_nighttime_zero_inflation
from src.models.baseline import temporal_train_test_split, LinearBaselinePipeline
from src.models.forecasting import LightGBMForecaster
from src.models.metrics import evaluate_forecast
from src.optimization.battery_lp import BatterySpecs, TOUTariff, BatteryOptimizerLP

ROOT_DIR = get_project_root()


# Scenario Definitions
SCENARIOS = {
    "normal": {
        "label": "Normal Baseline Conditions",
        "description": "Historical measured clear/partly-cloudy diurnal irradiance profile.",
        "irradiance_factor": 1.0,
        "cloud_offset": 0.0,
        "temp_delta_c": 0.0,
        "is_synthetic": False
    },
    "heavy_cloud": {
        "label": "Heavy Cloud Cover Overcast",
        "description": "Persistent overcast stratocumulus layer reducing GHI by 50% with cloud cover index at 0.90.",
        "irradiance_factor": 0.50,
        "cloud_offset": 0.50,
        "temp_delta_c": -2.0,
        "is_synthetic": True
    },
    "monsoon_prolonged": {
        "label": "Monsoon Prolonged Low-Irradiance",
        "description": "Severe tropical monsoon depression causing 75% irradiance attenuation and 4°C temperature drop.",
        "irradiance_factor": 0.25,
        "cloud_offset": 0.70,
        "temp_delta_c": -4.0,
        "is_synthetic": True
    },
    "sudden_drop": {
        "label": "Sudden Midday Irradiance Drop",
        "description": "Localized severe convective thundercloud passing directly over solar array between 11:00 and 14:00 (75% drop).",
        "irradiance_factor": 0.25,
        "cloud_offset": 0.75,
        "temp_delta_c": -3.0,
        "is_synthetic": True
    },
    "multi_day_low": {
        "label": "Multi-Day Continuous Solar Deficit",
        "description": "Extended 3-day atmospheric haze and low-pressure trough sustaining 60% irradiance suppression.",
        "irradiance_factor": 0.40,
        "cloud_offset": 0.45,
        "temp_delta_c": -2.5,
        "is_synthetic": True
    },
    "recovery": {
        "label": "Post-Storm Rapid Solar Recovery",
        "description": "Severe morning monsoon squall (80% drop until 11:00) followed by steep afternoon clear-sky ramp.",
        "irradiance_factor": 0.20,
        "cloud_offset": 0.60,
        "temp_delta_c": -1.5,
        "is_synthetic": True
    }
}


def apply_weather_stress_scenario(
    df: pd.DataFrame,
    scenario_name: str,
    custom_factor: Optional[float] = None,
) -> pd.DataFrame:
    """
    Applies calibrated meteorological stress factors to a dataset slice.
    
    Preserves physical night zero-inflation: when solar elevation <= 0 or GHI <= 1.0,
    solar power is strictly 0.0 kW.
    """
    if scenario_name not in SCENARIOS:
        raise ValueError(f"Unknown scenario: '{scenario_name}'. Valid options: {list(SCENARIOS.keys())}")

    config = SCENARIOS[scenario_name]
    factor = custom_factor if custom_factor is not None else config["irradiance_factor"]

    df_stressed = df.copy()
    if "time" in df_stressed.columns:
        df_stressed["time"] = pd.to_datetime(df_stressed["time"])

    # Extract hour array if available
    if "time" in df_stressed.columns:
        hours = df_stressed["time"].dt.hour.values
    else:
        hours = np.arange(len(df_stressed)) % 24

    attenuation = np.full(len(df_stressed), factor, dtype=float)

    if scenario_name == "normal":
        attenuation[:] = 1.0

    elif scenario_name == "sudden_drop":
        # Sudden drop applies only during peak daylight hours (11:00 - 14:00)
        storm_mask = (hours >= 11) & (hours <= 14)
        attenuation[:] = 1.0
        attenuation[storm_mask] = factor

    elif scenario_name == "recovery":
        # Heavy suppression in morning (<= 11:00), recovering to clear-sky in afternoon
        morning_mask = hours <= 11
        attenuation[:] = 1.0
        attenuation[morning_mask] = factor

    # Apply attenuation to solar generation & irradiance features
    if "ac_power" in df_stressed.columns:
        df_stressed["ac_power_stressed"] = df_stressed["ac_power"] * attenuation
    else:
        df_stressed["ac_power_stressed"] = 0.0

    if "ghi" in df_stressed.columns:
        df_stressed["ghi_stressed"] = df_stressed["ghi"] * attenuation
    else:
        df_stressed["ghi_stressed"] = 0.0

    if "openmeteo_temperature" in df_stressed.columns:
        df_stressed["temp_stressed"] = df_stressed["openmeteo_temperature"] + config["temp_delta_c"]
    elif "sensor_temperature" in df_stressed.columns:
        df_stressed["temp_stressed"] = df_stressed["sensor_temperature"] + config["temp_delta_c"]
    else:
        df_stressed["temp_stressed"] = 25.0

    # Physical nighttime zero-inflation enforcement
    if "solar_elevation_deg" in df_stressed.columns:
        night_mask = (df_stressed["solar_elevation_deg"] <= 0.0) | (df_stressed["ghi_stressed"] <= 1.0)
        df_stressed.loc[night_mask, "ac_power_stressed"] = 0.0
        df_stressed.loc[night_mask, "ghi_stressed"] = 0.0
    else:
        night_mask = (hours < 6) | (hours > 18)
        df_stressed.loc[night_mask, "ac_power_stressed"] = 0.0
        df_stressed.loc[night_mask, "ghi_stressed"] = 0.0

    # Ensure non-negative bounds
    df_stressed["ac_power_stressed"] = np.maximum(0.0, df_stressed["ac_power_stressed"])
    df_stressed["ghi_stressed"] = np.maximum(0.0, df_stressed["ghi_stressed"])

    df_stressed["scenario_name"] = scenario_name
    df_stressed["scenario_label"] = config["label"]
    df_stressed["is_synthetic_scenario"] = config["is_synthetic"]
    df_stressed["attenuation_factor"] = attenuation

    return df_stressed


def evaluate_forecasting_under_stress(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    scenario_name: str,
) -> Dict[str, Any]:
    """
    Evaluates LightGBM and Ridge Regression forecasters against a stressed weather scenario.
    """
    # 1. Apply stress scenario to test horizon
    test_stressed = apply_weather_stress_scenario(test_df, scenario_name=scenario_name)

    # 2. Fit Ridge Baseline on training data
    ridge_features = [c for c in ["ghi", "openmeteo_temperature", "cos_zenith", "hour_sin", "hour_cos", "solar_elevation_deg"] if c in train_df.columns]
    ridge_pipeline = LinearBaselinePipeline(feature_cols=ridge_features, model_type="ridge", alpha=1.0)
    ridge_pipeline.fit(train_df)

    # 3. Fit LightGBM on training data
    lgb_model = LightGBMForecaster(n_estimators=100, max_depth=5, learning_rate=0.05)
    lgb_model.fit(train_df)

    # In stressed test set, features mirror stressed weather
    test_features = test_stressed.copy()
    if "ghi_stressed" in test_features.columns:
        test_features["ghi"] = test_features["ghi_stressed"]
    if "temp_stressed" in test_features.columns and "openmeteo_temperature" in test_features.columns:
        test_features["openmeteo_temperature"] = test_features["temp_stressed"]

    # Generate predictions
    y_true = test_stressed["ac_power_stressed"].values
    y_pred_ridge = ridge_pipeline.predict(test_features, enforce_night_zero=True)
    y_pred_lgb = lgb_model.predict(test_features, enforce_night_zero=True)

    # Calculate metrics (daytime threshold > 10 kW)
    is_day = y_true > 10.0
    metrics_ridge = evaluate_forecast(y_true, y_pred_ridge, is_daylight=is_day, daylight_mape_min_actual=50.0)
    metrics_lgb = evaluate_forecast(y_true, y_pred_lgb, is_daylight=is_day, daylight_mape_min_actual=50.0)

    return {
        "scenario_name": scenario_name,
        "scenario_label": SCENARIOS[scenario_name]["label"],
        "is_synthetic": SCENARIOS[scenario_name]["is_synthetic"],
        "mean_actual_generation_kw": round(float(np.mean(y_true)), 2),
        "peak_actual_generation_kw": round(float(np.max(y_true)), 2),
        "ridge_daylight_rmse_kw": round(float(metrics_ridge["daylight_rmse"]), 2),
        "ridge_daylight_mae_kw": round(float(metrics_ridge["daylight_mae"]), 2),
        "ridge_daylight_r2": round(float(metrics_ridge["daylight_r2"]), 4),
        "lgb_daylight_rmse_kw": round(float(metrics_lgb["daylight_rmse"]), 2),
        "lgb_daylight_mae_kw": round(float(metrics_lgb["daylight_mae"]), 2),
        "lgb_daylight_r2": round(float(metrics_lgb["daylight_r2"]), 4),
    }


def evaluate_battery_resilience_under_stress(
    df_day: pd.DataFrame,
    scenario_name: str,
    specs: Optional[BatterySpecs] = None,
    tariff: Optional[TOUTariff] = None,
) -> Dict[str, Any]:
    """
    Evaluates PuLP LP BESS storage dispatch resilience during stressed weather conditions.
    """
    if specs is None:
        specs = BatterySpecs(
            capacity_kwh=10000.0,
            max_charge_kw=5000.0,
            max_discharge_kw=5000.0,
            soc_initial=0.20,
            soc_min=0.10,
            soc_max=0.90,
            degradation_cost_per_kwh=0.005,
        )
    if tariff is None:
        tariff = TOUTariff(off_peak_rate=0.05, normal_rate=0.10, peak_rate=0.25, export_feedin_rate=0.04)

    # Apply stress
    stressed_day = apply_weather_stress_scenario(df_day, scenario_name=scenario_name)
    solar_kw = stressed_day["ac_power_stressed"].values
    timestamps = pd.to_datetime(stressed_day["time"]) if "time" in stressed_day.columns else None

    # Solve PuLP optimization
    optimizer = BatteryOptimizerLP(specs=specs, tariff=tariff)
    opt_res = optimizer.optimize_dispatch(
        solar_kw=solar_kw,
        timestamps=timestamps,
        dt_hours=1.0,
        enforce_terminal_soc=True,
    )

    kpis = opt_res["kpi_summary"]
    sched_df = opt_res["schedule_df"]

    # Calculate resilience indicators
    total_solar_kwh = float(np.sum(solar_kw))
    total_load_kwh = float(np.sum(sched_df["load_demand_kw"])) if "load_demand_kw" in sched_df else 0.0
    grid_import_bess_kwh = float(np.sum(sched_df["grid_import_with_bess_kw"]))
    grid_import_baseline_kwh = float(np.sum(sched_df["grid_import_unmanaged_kw"]))

    grid_dependency_pct = (grid_import_bess_kwh / total_load_kwh * 100.0) if total_load_kwh > 0 else 0.0
    storage_autonomy_pct = (100.0 - grid_dependency_pct)

    # Peak grid import surge compared to baseline clear sky
    peak_grid_import_kw = float(np.max(sched_df["grid_import_with_bess_kw"]))

    return {
        "scenario_name": scenario_name,
        "scenario_label": SCENARIOS[scenario_name]["label"],
        "is_synthetic": SCENARIOS[scenario_name]["is_synthetic"],
        "total_solar_generation_mwh": round(total_solar_kwh / 1000.0, 2),
        "total_load_demand_mwh": round(total_load_kwh / 1000.0, 2),
        "grid_import_with_bess_mwh": round(grid_import_bess_kwh / 1000.0, 2),
        "grid_import_without_bess_mwh": round(grid_import_baseline_kwh / 1000.0, 2),
        "grid_dependency_pct": round(grid_dependency_pct, 1),
        "storage_autonomy_pct": round(storage_autonomy_pct, 1),
        "peak_grid_import_mw": round(peak_grid_import_kw / 1000.0, 2),
        "cost_without_bess": round(float(kpis["cost_without_bess"]), 2),
        "cost_with_bess": round(float(kpis["cost_with_bess"]), 2),
        "net_arbitrage_savings": round(float(kpis["net_arbitrage_savings"]), 2),
        "solar_self_consumption_pct": round(float(kpis["solar_self_consumption_with_bess_pct"]), 1),
        "battery_throughput_mwh": round(float(kpis["battery_total_throughput_kwh"]) / 1000.0, 2),
        "min_soc_pct": round(float(sched_df["battery_soc_pct"].min()), 1),
        "max_soc_pct": round(float(sched_df["battery_soc_pct"].max()), 1),
        "schedule_df": sched_df,
    }


def run_full_weather_stress_suite(plant_id: int = 1, save_artifacts: bool = True) -> Dict[str, Any]:
    """
    Executes the full Week 4 Extreme Weather Stress Test suite across all scenarios:
    1. Generates forecast stress metrics
    2. Runs BESS battery resilience LP dispatch
    3. Exports reports/week4_weather_stress_summary.csv and publication figures
    """
    df_hourly = load_processed_handoff(plant_id=plant_id, freq="hourly")
    train_df, test_df = temporal_train_test_split(df_hourly, test_days=7)
    test_24h = test_df.tail(24).copy().reset_index(drop=True)

    forecast_results = []
    resilience_results = []

    for sc_name in SCENARIOS.keys():
        # 1. Forecasting stress
        f_res = evaluate_forecasting_under_stress(train_df, test_df, sc_name)
        forecast_results.append(f_res)

        # 2. Battery resilience stress
        b_res = evaluate_battery_resilience_under_stress(test_24h, sc_name)
        # Store clean dictionary without DataFrame for tabular serialization
        b_dict = {k: v for k, v in b_res.items() if k != "schedule_df"}
        resilience_results.append(b_dict)

    df_forecast = pd.DataFrame(forecast_results)
    df_resilience = pd.DataFrame(resilience_results)

    # Combined summary table
    df_summary = pd.merge(df_forecast, df_resilience, on=["scenario_name", "scenario_label", "is_synthetic"])

    if save_artifacts:
        reports_dir = ROOT_DIR / "reports"
        figures_dir = reports_dir / "figures"
        reports_dir.mkdir(parents=True, exist_ok=True)
        figures_dir.mkdir(parents=True, exist_ok=True)

        df_summary.to_csv(reports_dir / "week4_weather_stress_summary.csv", index=False)
        df_forecast.to_csv(reports_dir / "week4_forecast_stress_metrics.csv", index=False)
        df_resilience.to_csv(reports_dir / "week4_battery_resilience.csv", index=False)

        # 1. Plot Weather Stress Forecasting Comparison
        fig, ax = plt.subplots(figsize=(10, 5), dpi=300)
        x = np.arange(len(df_forecast))
        width = 0.35
        ax.bar(x - width/2, df_forecast["ridge_daylight_rmse_kw"] / 1000.0, width, label="Ridge Baseline", color="#3b82f6")
        ax.bar(x + width/2, df_forecast["lgb_daylight_rmse_kw"] / 1000.0, width, label="LightGBM (GBDT)", color="#10b981")
        ax.set_ylabel("Daylight RMSE (MW)", fontsize=11, fontweight="bold")
        ax.set_title(f"Plant {plant_id}: Solar Forecasting Accuracy Under Extreme Weather Stress", fontsize=12, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels([s.replace("_", " ").title() for s in df_forecast["scenario_name"]], rotation=25, ha="right", fontsize=9)
        ax.grid(axis="y", linestyle="--", alpha=0.5)
        ax.legend()
        plt.tight_layout()
        plt.savefig(figures_dir / "week4_weather_stress_comparison.png")
        plt.close(fig)

        # 2. Plot Battery Resilience & Grid Dependence
        fig2, ax2 = plt.subplots(figsize=(10, 5), dpi=300)
        ax2.plot(df_resilience["scenario_label"], df_resilience["grid_dependency_pct"], marker="o", color="#ef4444", linewidth=2.5, label="Grid Dependency (%)")
        ax2.plot(df_resilience["scenario_label"], df_resilience["storage_autonomy_pct"], marker="s", color="#10b981", linewidth=2.5, label="Storage Autonomy (%)")
        ax2.set_ylabel("Percentage (%)", fontsize=11, fontweight="bold")
        ax2.set_title(f"Plant {plant_id}: BESS Energy Autonomy & Grid Stress Under Weather Scenarios", fontsize=12, fontweight="bold")
        ax2.set_xticks(range(len(df_resilience)))
        ax2.set_xticklabels(df_resilience["scenario_label"], rotation=25, ha="right", fontsize=8.5)
        ax2.grid(linestyle="--", alpha=0.5)
        ax2.legend()
        plt.tight_layout()
        plt.savefig(figures_dir / "week4_battery_resilience.png")
        plt.close(fig2)

    return {
        "plant_id": plant_id,
        "summary_df": df_summary,
        "forecast_df": df_forecast,
        "resilience_df": df_resilience,
    }


if __name__ == "__main__":
    print("Executing Week 4 Weather Stress-Testing Suite...")
    res = run_full_weather_stress_suite(plant_id=1, save_artifacts=True)
    print("[OK] Weather stress-testing suite executed successfully.")
    print("Summary:")
    print(res["summary_df"][["scenario_name", "ridge_daylight_rmse_kw", "lgb_daylight_rmse_kw", "grid_dependency_pct", "net_arbitrage_savings"]])

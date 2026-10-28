import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import PageHeader from './ui/PageHeader';
import ChartCard from './ui/ChartCard';
import FilterBar from './ui/FilterBar';
import LoadingState from './ui/LoadingState';
import EmptyState from './ui/EmptyState';
import InfoTooltip from './ui/InfoTooltip';
import StatusBadge from './ui/StatusBadge';
import { COLORS, tooltipStyle, axisProps } from './ui/chartTheme';

export default function ForecastView({ data, loading }) {
  const [visibleModels, setVisibleModels] = useState({
    actual: true,
    lightgbm: true,
    prophet: true,
    ridge: false,
    persistence: false,
    bounds: true,
  });
  const [horizonLength, setHorizonLength] = useState(48);

  if (loading && !data) {
    return <LoadingState label="Loading forecast results…" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Forecast data is unavailable"
        description="The forecasting service did not return predictions for this plant."
      />
    );
  }

  const { metrics = [], predictions = [], feature_importance = [], bounds_info } = data;
  const filteredPredictions = predictions.slice(-horizonLength);
  const hasActual = filteredPredictions.some((row) => row.actual != null && Number(row.actual) !== 0);

  const toggleModel = (key) => {
    setVisibleModels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const layers = [
    { key: 'actual', label: 'Measured generation', color: COLORS.actual },
    { key: 'lightgbm', label: 'LightGBM forecast', color: COLORS.lightgbm },
    { key: 'prophet', label: 'Prophet', color: COLORS.prophet },
    { key: 'ridge', label: 'Ridge', color: COLORS.ridge },
    { key: 'persistence', label: 'Persistence (24h lag)', color: COLORS.persistence },
    { key: 'bounds', label: '90% interval', color: COLORS.bounds },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Solar generation forecast"
        description="The chart shows predicted plant output in kW. Compare it with measured generation when observations exist for the selected window."
        actions={
          <FilterBar
            label="Show"
            value={horizonLength}
            onChange={setHorizonLength}
            options={[
              { id: 24, label: '24 hours' },
              { id: 48, label: '48 hours' },
              { id: 96, label: '4 days' },
            ]}
          />
        }
      />

      <div className="flex flex-wrap gap-2">
        {layers.map((layer) => (
          <button
            key={layer.key}
            type="button"
            onClick={() => toggleModel(layer.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              visibleModels[layer.key]
                ? 'bg-white text-slate-800 border-slate-300'
                : 'bg-slate-100 text-slate-400 border-transparent'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: layer.color }} />
            {layer.label}
          </button>
        ))}
      </div>

      {!hasActual && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
          Measured generation is missing or zero for much of this window, so actual-versus-predicted comparison is limited.
        </p>
      )}

      <ChartCard
        title="Forecast chart"
        description={bounds_info?.methodology || 'Prediction interval with night-time output truncated at zero.'}
      >
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredPredictions} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="time" {...axisProps} />
              <YAxis
                {...axisProps}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                label={{ value: 'kW', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              {visibleModels.bounds && (
                <Area type="monotone" dataKey="upper_bound" stroke="none" fill={COLORS.bounds} fillOpacity={0.55} name="Upper bound (90%)" />
              )}
              {visibleModels.bounds && (
                <Area type="monotone" dataKey="lower_bound" stroke="none" fill="#ffffff" fillOpacity={1} name="Lower bound" />
              )}
              {visibleModels.actual && (
                <Line type="monotone" dataKey="actual" name="Measured (kW)" stroke={COLORS.actual} strokeWidth={2.4} dot={false} />
              )}
              {visibleModels.lightgbm && (
                <Line type="monotone" dataKey="lightgbm" name="LightGBM (kW)" stroke={COLORS.lightgbm} strokeWidth={2} dot={false} />
              )}
              {visibleModels.prophet && (
                <Line type="monotone" dataKey="prophet" name="Prophet (kW)" stroke={COLORS.prophet} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              )}
              {visibleModels.ridge && (
                <Line type="monotone" dataKey="ridge" name="Ridge (kW)" stroke={COLORS.ridge} strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
              )}
              {visibleModels.persistence && (
                <Line type="monotone" dataKey="persistence" name="Persistence (kW)" stroke={COLORS.persistence} strokeWidth={1.2} strokeDasharray="2 2" dot={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <section className="surface-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Forecast error</h3>
            <p className="text-xs text-slate-500">Metrics are computed on daytime hours only (GHI &gt; 0).</p>
          </div>
          <StatusBadge tone="measured">Validation set</StatusBadge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 pr-4 font-medium">Model</th>
                <th className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    RMSE
                    <InfoTooltip label="Explain RMSE">Root mean square error in kW. Lower is better.</InfoTooltip>
                  </span>
                </th>
                <th className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    MAPE
                    <InfoTooltip label="Explain MAPE">Mean absolute percentage error. Lower is better.</InfoTooltip>
                  </span>
                </th>
                <th className="py-2.5 pr-4 font-medium">MAE (kW)</th>
                <th className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    R²
                    <InfoTooltip label="Explain R2">Share of variance explained. Closer to 1 is better.</InfoTooltip>
                  </span>
                </th>
                <th className="py-2.5 pr-4 font-medium">nRMSE (%)</th>
                <th className="py-2.5 font-medium">Overall RMSE (kW)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((m, idx) => {
                const isHero = String(m.model).toLowerCase().includes('lightgbm');
                return (
                  <tr key={idx} className={isHero ? 'bg-emerald-50/50' : ''}>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {m.model}
                      {isHero && (
                        <StatusBadge tone="success" className="ml-2">
                          Selected
                        </StatusBadge>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{m.daylight_rmse_kw?.toLocaleString()}</td>
                    <td className="py-3 pr-4 tabular-nums">{m.daylight_mape_pct?.toFixed(2)}%</td>
                    <td className="py-3 pr-4 tabular-nums">{m.daylight_mae_kw?.toLocaleString()}</td>
                    <td className="py-3 pr-4 tabular-nums font-semibold text-emerald-700">{m.daylight_r2?.toFixed(4)}</td>
                    <td className="py-3 pr-4 tabular-nums">{m.daylight_nrmse_pct?.toFixed(2)}%</td>
                    <td className="py-3 tabular-nums">{m.overall_rmse_kw?.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ChartCard
        title="What the selected model uses"
        description="Relative importance of weather and lagged generation features in LightGBM."
      >
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={feature_importance} layout="vertical" margin={{ top: 5, right: 24, left: 88, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="feature" {...axisProps} axisLine={false} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="importance" fill={COLORS.solar} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import PageHeader from './ui/PageHeader';
import MetricCard from './ui/MetricCard';
import ChartCard from './ui/ChartCard';
import LoadingState from './ui/LoadingState';
import ErrorState from './ui/ErrorState';
import PrimaryButton from './ui/PrimaryButton';
import LegendItem from './ui/LegendItem';
import StatusBadge from './ui/StatusBadge';
import { COLORS, tooltipStyle, axisProps, formatNumber, formatMoney } from './ui/chartTheme';

export default function BatteryScheduleView({
  optData,
  params,
  setParams,
  onRunOptimization,
  loading,
}) {
  const handleSliderChange = (key, value) => {
    setParams((prev) => ({ ...prev, [key]: Number(value) }));
  };

  const schedule = optData?.schedule || [];
  const kpis = optData?.kpis || {};
  const socGauge = optData?.soc_gauge || {};
  const failed = !loading && optData && !schedule.length;

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const currentSoc = socGauge.final_soc_pct ?? params.initial_soc_pct ?? 0;
  const strokeDashoffset = circumference - (currentSoc / 100) * circumference;

  const nextAction = schedule.find((row) => row.charge_mw > 0.01 || row.discharge_mw > 0.01);

  if (loading && !optData) {
    return <LoadingState label="Solving battery schedule…" />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Battery schedule"
        description="The optimizer charges when power is cheap or solar is surplus, then discharges during peak tariff hours. Green is charging, blue is discharging, gray is idle."
        actions={
          <PrimaryButton onClick={onRunOptimization} disabled={loading}>
            {loading ? 'Solving…' : 'Run optimization'}
          </PrimaryButton>
        }
      />

      {failed && (
        <ErrorState
          title="Optimization did not return a schedule"
          message="The solver may be infeasible with the current constraints. Adjust capacity, power, or initial state of charge and run again."
          onRetry={onRunOptimization}
        />
      )}

      <section className="surface-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Battery settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-sm">
          {[
            {
              key: 'battery_capacity_mwh',
              label: 'Capacity',
              value: `${params.battery_capacity_mwh} MWh`,
              min: 1,
              max: 30,
              step: 1,
              hint: 'Usable energy storage',
            },
            {
              key: 'max_inverter_power_mw',
              label: 'Charge / discharge power',
              value: `${params.max_inverter_power_mw} MW`,
              min: 0.5,
              max: 15,
              step: 0.5,
              hint: 'Peak inverter limit',
            },
            {
              key: 'round_trip_efficiency_pct',
              label: 'Round-trip efficiency',
              value: `${params.round_trip_efficiency_pct}%`,
              min: 75,
              max: 98,
              step: 0.5,
              hint: 'AC-to-AC efficiency',
            },
            {
              key: 'initial_soc_pct',
              label: 'Starting state of charge',
              value: `${params.initial_soc_pct}%`,
              min: 10,
              max: 80,
              step: 5,
              hint: 'Ending SoC must remain at or above this',
            },
          ].map((item) => (
            <div key={item.key} className="space-y-1.5">
              <div className="flex justify-between font-medium">
                <span className="text-slate-600">{item.label}</span>
                <span className="text-slate-900">{item.value}</span>
              </div>
              <input
                type="range"
                min={item.min}
                max={item.max}
                step={item.step}
                value={params[item.key]}
                onChange={(e) => handleSliderChange(item.key, e.target.value)}
                className="range-control"
                aria-label={item.label}
              />
              <p className="text-[11px] text-slate-400">{item.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-5 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-700 mb-3">Tariff rates ($/kWh)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            {[
              { key: 'off_peak_rate', label: 'Off-peak' },
              { key: 'normal_rate', label: 'Shoulder' },
              { key: 'peak_rate', label: 'Peak (17:00–21:00)' },
              { key: 'export_feedin_rate', label: 'Export feed-in' },
            ].map((item) => (
              <label key={item.key} className="block">
                <span className="block text-xs text-slate-500 mb-1">{item.label}</span>
                <input
                  type="number"
                  step="0.01"
                  value={params[item.key]}
                  onChange={(e) => handleSliderChange(item.key, e.target.value)}
                  className="input-control font-mono"
                />
              </label>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="State of charge"
          value={socGauge.final_soc_pct != null ? formatNumber(socGauge.final_soc_pct, 1) : '—'}
          unit="%"
          subtitle="End of the 24-hour schedule"
          tone="blue"
        />
        <MetricCard
          label="Capacity"
          value={params.battery_capacity_mwh}
          unit="MWh"
          subtitle={`Power limit ${params.max_inverter_power_mw} MW`}
          tone="emerald"
        />
        <MetricCard
          label="Throughput"
          value={kpis.battery_total_throughput_kwh != null ? formatNumber(kpis.battery_total_throughput_kwh / 1000, 2) : '—'}
          unit="MWh"
          subtitle={`${formatNumber(kpis.equivalent_full_cycles, 2)} equivalent cycles`}
          tone="navy"
        />
        <MetricCard
          label="Estimated savings"
          value={kpis.net_arbitrage_savings != null ? `$${formatMoney(kpis.net_arbitrage_savings)}` : '—'}
          subtitle={`Degradation $${formatMoney(kpis.degradation_wear_cost)}`}
          tone="emerald"
          badge={{ label: 'Estimated', tone: 'estimated' }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="surface-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">State of charge</h3>
            <StatusBadge tone="info">10%–90% operating band</StatusBadge>
          </div>
          <div className="flex items-center justify-center my-4">
            <div className="relative w-44 h-44 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" aria-hidden="true">
                <circle cx="88" cy="88" r={radius} stroke="#e2e8f0" strokeWidth="12" fill="transparent" />
                <circle
                  cx="88"
                  cy="88"
                  r={radius}
                  stroke={COLORS.charge}
                  strokeWidth="12"
                  strokeLinecap="round"
                  fill="transparent"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                />
              </svg>
              <div className="absolute text-center">
                <p className="text-3xl font-semibold text-slate-900">{Number(currentSoc).toFixed(1)}%</p>
                <p className="text-[11px] text-slate-500">End SoC</p>
              </div>
            </div>
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Terminal SoC constraint</span>
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                {socGauge.terminal_condition_met !== false ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Met
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Check result
                  </>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Next action</span>
              <span className="font-medium text-slate-800">
                {nextAction
                  ? `${nextAction.charge_mw > 0.01 ? 'Charge' : 'Discharge'} at ${nextAction.hour}`
                  : 'Idle'}
              </span>
            </div>
          </div>
        </section>

        <section className="lg:col-span-2 surface-card p-5">
          <h3 className="text-sm font-semibold text-slate-900">Operating assumptions</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            These limits come from the current run. They are not live field telemetry.
          </p>
          <div className="relative w-full h-8 bg-slate-100 rounded-lg overflow-hidden flex text-[10px] font-medium">
            <div className="w-[10%] bg-red-100 text-red-700 flex items-center justify-center">Lockout</div>
            <div className="w-[80%] bg-emerald-50 text-slate-600 flex items-center justify-center relative">
              Safe band 10%–90%
              {socGauge.min_soc_pct != null && socGauge.max_soc_pct != null && (
                <div
                  className="absolute h-full bg-emerald-400/50"
                  style={{
                    left: `${Math.max(0, (socGauge.min_soc_pct - 10) / 0.8)}%`,
                    width: `${Math.min(100, (socGauge.max_soc_pct - socGauge.min_soc_pct) / 0.8)}%`,
                  }}
                />
              )}
            </div>
            <div className="w-[10%] bg-red-100 text-red-700 flex items-center justify-center">Ceiling</div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Minimum SoC</p>
              <p className="text-lg font-semibold">{socGauge.min_soc_pct != null ? `${socGauge.min_soc_pct.toFixed(1)}%` : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Maximum SoC</p>
              <p className="text-lg font-semibold">{socGauge.max_soc_pct != null ? `${socGauge.max_soc_pct.toFixed(1)}%` : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-slate-500">Grid peak shaved</p>
              <p className="text-lg font-semibold">{kpis.peak_shaving_percentage != null ? `${kpis.peak_shaving_percentage.toFixed(1)}%` : '—'}</p>
            </div>
          </div>
        </section>
      </div>

      <ChartCard
        title="24-hour charge, discharge, and SoC"
        description="Positive green bars charge the battery. Negative blue bars discharge it. Idle hours have no bars."
        legend={
          <div className="flex flex-wrap gap-4">
            <LegendItem color={COLORS.charge} label="Charging (MW)" />
            <LegendItem color={COLORS.discharge} label="Discharging (MW)" />
            <LegendItem color="#7c3aed" label="SoC (%)" />
          </div>
        }
      >
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={schedule} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="hour" {...axisProps} />
              <YAxis yAxisId="left" {...axisProps} axisLine={false} unit=" MW" />
              <YAxis yAxisId="right" orientation="right" {...axisProps} axisLine={false} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar yAxisId="left" dataKey="charge_mw" name="Charging (MW)" fill={COLORS.charge} />
              <Bar yAxisId="left" dataKey={(d) => -d.discharge_mw} name="Discharging (MW)" fill={COLORS.discharge} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="battery_soc_pct"
                name="State of charge (%)"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title="Grid import with and without the battery"
        description={`Peak import ${formatNumber((kpis.peak_grid_import_without_bess_kw || 0) / 1000, 2)} MW without storage versus ${formatNumber((kpis.peak_grid_import_with_bess_kw || 0) / 1000, 2)} MW with storage.`}
        legend={
          <div className="flex flex-wrap gap-4">
            <LegendItem color={COLORS.solar} label="Solar (MW)" />
            <LegendItem color={COLORS.gridImport} label="Import without battery" />
            <LegendItem color={COLORS.managed} label="Import with battery" />
          </div>
        }
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={schedule} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="hour" {...axisProps} />
              <YAxis {...axisProps} axisLine={false} unit=" MW" />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="solar_mw" name="Solar (MW)" fill={COLORS.solarFill} stroke={COLORS.solar} />
              <Line type="monotone" dataKey="unmanaged_import_mw" name="Import without battery (MW)" stroke={COLORS.gridImport} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="managed_import_mw" name="Import with battery (MW)" stroke={COLORS.managed} strokeWidth={2.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

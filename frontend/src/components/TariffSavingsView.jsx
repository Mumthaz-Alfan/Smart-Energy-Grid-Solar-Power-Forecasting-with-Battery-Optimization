import React from 'react';
import { Download, AlertTriangle, Info } from 'lucide-react';
import PageHeader from './ui/PageHeader';
import MetricCard from './ui/MetricCard';
import LoadingState from './ui/LoadingState';
import PrimaryButton from './ui/PrimaryButton';
import SecondaryButton from './ui/SecondaryButton';
import StatusBadge from './ui/StatusBadge';
import { formatMoney } from './ui/chartTheme';

export default function TariffSavingsView({
  optData,
  params,
  setParams,
  onRunOptimization,
  loading,
}) {
  const kpis = optData?.kpis || {};
  const financials = optData?.financials || {};
  const schedule = optData?.schedule || [];

  const handleInputChange = (key, value) => {
    if (setParams) setParams((prev) => ({ ...prev, [key]: Number(value) }));
  };

  const netSavings =
    kpis.net_arbitrage_savings !== undefined ? kpis.net_arbitrage_savings : financials.daily_savings;
  const isNegativeSavings = netSavings != null && netSavings < 0;

  const handleDownloadCsv = () => {
    if (!schedule.length) return;
    const headers = [
      'Hour',
      'Step',
      'Tariff_Rate_USD_kWh',
      'Tariff_Tier',
      'Solar_Generation_MW',
      'Load_Demand_MW',
      'Unmanaged_Import_MW',
      'Managed_Import_MW',
      'BESS_Charge_MW',
      'BESS_Discharge_MW',
      'BESS_Energy_MWh',
      'BESS_SoC_Pct',
    ];
    const rows = schedule.map((r) => [
      r.hour,
      r.step,
      r.tariff_rate,
      r.tariff_tier,
      r.solar_mw,
      r.demand_mw,
      r.unmanaged_import_mw,
      r.managed_import_mw,
      r.charge_mw,
      r.discharge_mw,
      r.battery_energy_mwh,
      r.battery_soc_pct,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'bess_24h_optimal_dispatch_schedule.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !optData) {
    return <LoadingState label="Calculating tariff savings…" />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Tariff savings calculator"
        description="Compare estimated 24-hour electricity cost without a battery to the optimized schedule. Rates are assumed time-of-use prices in $/kWh, not a utility invoice."
        actions={
          <SecondaryButton onClick={handleDownloadCsv} disabled={!schedule.length}>
            <Download className="w-4 h-4" />
            Export schedule CSV
          </SecondaryButton>
        }
      />

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        Off-peak, shoulder, and peak (17:00–21:00) rates are scenario assumptions used by the existing optimizer.
      </div>

      {setParams && (
        <section className="surface-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Inputs</h3>
            {onRunOptimization && (
              <PrimaryButton onClick={onRunOptimization} disabled={loading}>
                {loading ? 'Calculating…' : 'Recalculate savings'}
              </PrimaryButton>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-sm">
            {[
              { key: 'peak_rate', label: 'Peak tariff', format: (v) => `$${Number(v).toFixed(2)}/kWh`, min: 0.1, max: 0.8, step: 0.01 },
              { key: 'normal_rate', label: 'Shoulder tariff', format: (v) => `$${Number(v).toFixed(2)}/kWh`, min: 0.05, max: 0.4, step: 0.01 },
              { key: 'off_peak_rate', label: 'Off-peak tariff', format: (v) => `$${Number(v).toFixed(2)}/kWh`, min: 0.01, max: 0.25, step: 0.01 },
              { key: 'battery_capacity_mwh', label: 'Battery capacity', format: (v) => `${v} MWh`, min: 1, max: 30, step: 1 },
            ].map((item) => (
              <label key={item.key} className="block space-y-1">
                <span className="flex justify-between font-medium text-slate-700">
                  {item.label}
                  <span className="text-slate-900">{item.format(params[item.key])}</span>
                </span>
                <input
                  type="range"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={params[item.key]}
                  onChange={(e) => handleInputChange(item.key, e.target.value)}
                  className="range-control"
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {isNegativeSavings && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <p>
            Estimated net savings are negative (${formatMoney(netSavings)}). The peak-to-off-peak spread does not cover efficiency losses and degradation (${formatMoney(kpis.degradation_wear_cost)}).
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Cost without battery"
          value={kpis.cost_without_bess != null ? `$${formatMoney(kpis.cost_without_bess)}` : '—'}
          subtitle="Estimated 24-hour grid cost"
          tone="orange"
          badge={{ label: 'Estimated', tone: 'estimated' }}
        />
        <MetricCard
          label="Cost with battery"
          value={kpis.cost_with_bess != null ? `$${formatMoney(kpis.cost_with_bess)}` : '—'}
          subtitle={`Includes $${formatMoney(kpis.degradation_wear_cost)} degradation`}
          tone="navy"
        />
        <MetricCard
          label="Net estimated savings"
          value={netSavings != null ? `$${formatMoney(netSavings)}` : '—'}
          subtitle={kpis.savings_percentage != null ? `${kpis.savings_percentage.toFixed(1)}% cost change` : 'After degradation'}
          tone={isNegativeSavings ? 'red' : 'emerald'}
        />
        <MetricCard
          label="Self-consumption"
          value={kpis.solar_self_consumption_with_bess_pct != null ? `${kpis.solar_self_consumption_with_bess_pct.toFixed(1)}%` : '—'}
          subtitle={`From ${kpis.solar_self_consumption_without_bess_pct?.toFixed(1) ?? '—'}% without storage`}
          tone="amber"
        />
      </div>

      <section className="surface-card p-5">
        <h3 className="text-sm font-semibold text-slate-900">Payback (if the optimizer returned it)</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Annual savings assume 365 similar days. This is a scenario, not a validated utility bill.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Projected annual savings</p>
            <p className="text-xl font-semibold mt-1">
              {financials.annual_savings_projected != null
                ? `$${Number(financials.annual_savings_projected).toLocaleString()}`
                : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Estimated installed cost</p>
            <p className="text-xl font-semibold mt-1">
              {financials.estimated_capex != null ? `$${Number(financials.estimated_capex).toLocaleString()}` : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-xs text-emerald-800">Simple payback</p>
            <p className="text-xl font-semibold text-emerald-900 mt-1">
              {netSavings > 0 && financials.simple_payback_years != null
                ? `${Number(financials.simple_payback_years).toFixed(1)} years`
                : 'Not applicable'}
            </p>
          </div>
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Hourly schedule</h3>
            <p className="text-xs text-slate-500">Charge in green, discharge in blue, grid import in orange.</p>
          </div>
          <StatusBadge tone="slate">{schedule.length} hours</StatusBadge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Hour</th>
                <th className="py-2.5 px-3">Tier</th>
                <th className="py-2.5 px-3">Rate</th>
                <th className="py-2.5 px-3">Solar (MW)</th>
                <th className="py-2.5 px-3">Load (MW)</th>
                <th className="py-2.5 px-3">Charge</th>
                <th className="py-2.5 px-3">Discharge</th>
                <th className="py-2.5 px-3">Import without</th>
                <th className="py-2.5 px-3">Import with</th>
                <th className="py-2.5 px-3">SoC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {schedule.map((row, idx) => {
                const isPeak = row.tariff_tier === 'Peak';
                return (
                  <tr key={idx} className={isPeak ? 'bg-orange-50/40' : ''}>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{row.hour}</td>
                    <td className="py-2.5 px-3">
                      <StatusBadge tone={isPeak ? 'error' : row.tariff_tier === 'Off-Peak' ? 'info' : 'slate'}>
                        {row.tariff_tier}
                      </StatusBadge>
                    </td>
                    <td className="py-2.5 px-3">${row.tariff_rate?.toFixed(3)}</td>
                    <td className="py-2.5 px-3 text-amber-700">{row.solar_mw?.toFixed(2)}</td>
                    <td className="py-2.5 px-3">{row.demand_mw?.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-emerald-700">{row.charge_mw > 0.01 ? `+${row.charge_mw.toFixed(2)}` : '—'}</td>
                    <td className="py-2.5 px-3 text-blue-700">{row.discharge_mw > 0.01 ? `-${row.discharge_mw.toFixed(2)}` : '—'}</td>
                    <td className="py-2.5 px-3 text-orange-700">{row.unmanaged_import_mw?.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-teal-700">{row.managed_import_mw?.toFixed(2)}</td>
                    <td className="py-2.5 px-3">{row.battery_soc_pct?.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { PageHeader } from '../AppLayout';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { devices, type Device } from './demoData';
import { DemoBanner, InertNote, StateDot, StateLabel } from './shared';

export default function PreviewDevicesPage() {
  const [selectedId, setSelectedId] = useState(devices[0].id);
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];
  const zones = useMemo(() => [...new Set(devices.map((d) => d.zone))], []);

  return (
    <>
      <PageHeader
        kicker="Preview · demo data"
        title="Home devices"
        description="What the device grid looks like once the engine behind it exists. Every row below is fixture data."
      />

      <DemoBanner what="This device list" />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-ink/8">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">All devices</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40 tabular-nums">
              {devices.length} · {zones.length} zones
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Demo device list — fixture data, not a live reading of any hardware.
              </caption>
              <thead className="bg-paper-warm/40">
                <tr>
                  {['Device', 'Kind', 'Zone', 'Reading'].map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        'px-5 sm:px-6 py-3 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-normal',
                        i === 3 ? 'text-right' : 'text-left',
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const active = d.id === selected.id;
                  return (
                    <tr
                      key={d.id}
                      className={cn(
                        'border-t border-ink/8 cursor-pointer transition-colors',
                        active ? 'bg-paper-warm/70' : 'hover:bg-paper-warm/40',
                        d.state === 'off' && 'text-ink/50',
                      )}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <td className="px-5 sm:px-6 py-3.5">
                        <button
                          type="button"
                          onClick={() => setSelectedId(d.id)}
                          aria-pressed={active}
                          className="inline-flex items-center gap-2.5 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                        >
                          <StateDot state={d.state} />
                          <span className={cn(active && 'font-medium')}>{d.name}</span>
                        </button>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-[11px] uppercase tracking-[0.16em] text-ink/50">
                        {d.kind}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-[11px] uppercase tracking-[0.16em] text-ink/50">
                        {d.zone}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right font-mono text-xs text-ink/70">
                        {d.read}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="lg:col-span-5">
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-ink/8">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Device</span>
              <StateLabel state={selected.state} />
            </div>

            <div className="p-6">
              {/*
                The pre-fold Svelte screen rendered a fake camera viewport here —
                a blinking red REC dot, a "LIVE" caption and animated scanlines
                over an empty box. That reads as a working stream to anyone
                glancing at it, and there is no camera pipeline (ONVIF/RTSP is
                ROADMAP Phase 5). Replaced with a placeholder that says so.
              */}
              {selected.kind === 'Camera' ? (
                <div className="h-40 rounded-2xl border border-dashed border-ink/15 bg-paper-warm/40 grid place-items-center px-6 text-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45">No stream</p>
                    <p className="mt-2 text-sm text-ink/60 leading-relaxed">
                      Camera live-view is ROADMAP Phase 5 — there is no video pipeline behind this
                      panel.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-40 rounded-2xl border border-ink/8 bg-paper-warm/40 grid place-items-center px-6">
                  <span className="font-display numeral text-4xl text-ink text-center leading-none">
                    {selected.read}
                  </span>
                </div>
              )}

              <h2 className="font-display text-2xl mt-5">{selected.name}</h2>
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink/50">
                {selected.kind} · {selected.zone}
              </p>

              <dl className="mt-5 rounded-2xl border border-ink/8 divide-y divide-ink/8 overflow-hidden">
                {[
                  { k: 'Status', v: selected.detail, mono: false },
                  { k: 'Last seen', v: selected.seen, mono: true },
                  { k: 'Device ID', v: selected.id, mono: true },
                ].map((row) => (
                  <div key={row.k} className="flex items-center justify-between gap-4 px-4 py-3">
                    <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/50 shrink-0">
                      {row.k}
                    </dt>
                    <dd
                      className={cn(
                        'text-sm text-ink/70 text-right min-w-0 truncate',
                        row.mono && 'font-mono text-xs',
                      )}
                    >
                      {row.v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap gap-2">
                {['Open', 'Automate', 'Logs'].map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    title="No device engine yet — this control is inert."
                    className="h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/40 cursor-not-allowed"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InertNote>
                Controls are disabled on purpose. Sending a command needs a driver adapter
                (Matter / MQTT / Zigbee / ONVIF / Modbus), and none exist yet.
              </InertNote>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

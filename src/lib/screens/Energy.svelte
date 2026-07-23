<script lang="ts">
  import { circuits, path, series } from '../data';
  const day = series(48, 7, 0.4, 0.5);
  const solarDay = series(48, 3, 0.5, 0.42);
  const sources = [
    { name: 'Solar', kw: 3.10, pct: 56, cls: 'solar' },
    { name: 'Grid',  kw: 1.80, pct: 33, cls: 'grid' },
    { name: 'Battery', kw: 0.61, pct: 11, cls: 'batt' },
  ];
</script>

<div class="screen">
  <section class="stats">
    <div class="cell panel"><div class="kicker">Now drawing</div><div class="big display mono-num">2.41<span class="u">kW</span></div></div>
    <div class="cell panel"><div class="kicker">Solar output</div><div class="big display mono-num">3.10<span class="u">kW</span></div></div>
    <div class="cell panel"><div class="kicker">Today</div><div class="big display mono-num">18.4<span class="u">kWh</span></div></div>
    <div class="cell panel"><div class="kicker">Est. cost</div><div class="big display mono-num">R42<span class="u">today</span></div></div>
  </section>

  <section class="grid">
    <div class="chart panel">
      <div class="phead"><span class="kicker">Power · last 24h</span>
        <span class="legend"><i class="sw draw"></i>draw <i class="sw sol"></i>solar</span></div>
      <svg class="area" viewBox="0 0 640 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--signal)" stop-opacity="0.22"/><stop offset="1" stop-color="var(--signal)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="{path(day, 640, 200)} L640 200 L0 200 Z" fill="url(#ag)"/>
        <path d={path(day, 640, 200)} fill="none" stroke="var(--signal)" stroke-width="1.6"/>
        <path d={path(solarDay, 640, 200)} fill="none" stroke="var(--online)" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.9"/>
      </svg>
    </div>

    <div class="sources panel">
      <div class="phead"><span class="kicker">Source mix</span></div>
      <div class="sbody">
        {#each sources as s}
          <div class="srow">
            <div class="sh"><span class="sn">{s.name}</span><span class="sk mono-num">{s.kw.toFixed(2)} kW</span></div>
            <div class="bar"><div class="fill {s.cls}" style="width:{s.pct}%"></div></div>
          </div>
        {/each}
        <div class="net"><span class="kicker">Net export</span><span class="mono-num pos">+0.69 kW</span></div>
      </div>
    </div>
  </section>

  <section class="circuits panel">
    <div class="phead"><span class="kicker">Circuits</span><span class="kicker dim">{circuits.length} monitored</span></div>
    <div class=" crows">
      {#each circuits as c}
        <div class="crow">
          <span class="cn">{c.name}</span>
          <div class="cbar"><div class="cfill" class:idle={c.kw === 0} style="width:{Math.max(2, (c.kw / c.max) * 100)}%"></div></div>
          <span class="ckw mono-num">{c.kw.toFixed(2)} kW</span>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .screen { display: flex; flex-direction: column; gap: 14px; }
  .phead { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
  .phead .dim { color: var(--bone-faint); }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .cell { padding: 16px 18px; }
  .big { font-size: 34px; margin-top: 10px; }
  .u { font-size: 13px; color: var(--bone-faint); margin-left: 5px; }

  .grid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 14px; }
  .area { width: 100%; height: 200px; padding: 8px 0 0; display: block; }
  .legend { display: flex; align-items: center; gap: 10px; font-size: 10px; color: var(--bone-faint); text-transform: uppercase; letter-spacing: 0.1em; }
  .sw { width: 10px; height: 2px; display: inline-block; margin-right: 4px; vertical-align: middle; }
  .sw.draw { background: var(--signal); } .sw.sol { background: var(--online); }

  .sbody { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  .sh { display: flex; justify-content: space-between; margin-bottom: 7px; font-size: 12px; }
  .sn { color: var(--bone); } .sk { color: var(--bone-dim); }
  .bar { height: 6px; background: var(--ink-750); overflow: hidden; }
  .fill { height: 100%; }
  .fill.solar { background: var(--online); } .fill.grid { background: var(--signal); } .fill.batt { background: var(--cool); }
  .net { display: flex; justify-content: space-between; align-items: center; padding-top: 14px; border-top: 1px solid var(--line); }
  .pos { color: var(--online); font-size: 13px; }

  .crows { padding: 8px 16px 14px; }
  .crow { display: grid; grid-template-columns: 120px 1fr 80px; gap: 14px; align-items: center; padding: 9px 0; }
  .cn { font-size: 12px; color: var(--bone-dim); }
  .cbar { height: 5px; background: var(--ink-750); overflow: hidden; }
  .cfill { height: 100%; background: var(--signal); }
  .cfill.idle { background: var(--bone-faint); opacity: 0.4; }
  .ckw { font-size: 11px; text-align: right; color: var(--bone-dim); }
  @media (max-width: 1080px) { .stats { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } }
</style>

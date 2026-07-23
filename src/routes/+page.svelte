<script lang="ts">
  import { onMount } from 'svelte';

  const nav = [
    { id: 'overview',    label: 'Overview' },
    { id: 'devices',     label: 'Devices' },
    { id: 'automations', label: 'Automations' },
    { id: 'energy',      label: 'Energy' },
    { id: 'security',    label: 'Security' },
    { id: 'bots',        label: 'Bots' },
    { id: 'settings',    label: 'Settings' },
  ];
  let view = $state('overview');

  let host = $state<{ os: string; arch: string; cores: number } | null>(null);
  const node = { name: 'atlas-01', site: 'HOME · JOHANNESBURG' };

  let now = $state(new Date());

  const devices = [
    { name: 'Front Gate Camera', kind: 'Camera',   zone: 'Perimeter', state: 'live',  read: '1080p · 24fps' },
    { name: 'Garden Lights',     kind: 'Lighting',  zone: 'Exterior',  state: 'live',  read: '62% · warm' },
    { name: 'Mower — Zana M1',   kind: 'Robot',     zone: 'Lawn',      state: 'warn',  read: 'charging · 81%' },
    { name: 'Thermostat',        kind: 'Climate',   zone: 'Interior',  state: 'live',  read: '21.5°C' },
    { name: 'Security Bot',      kind: 'Robot',     zone: 'Sector 3',  state: 'live',  read: 'patrol' },
    { name: 'Cleaning Bot',      kind: 'Robot',     zone: 'Interior',  state: 'off',   read: 'docked' },
    { name: 'Solar Array',       kind: 'Energy',    zone: 'Roof',      state: 'live',  read: '3.10 kW', spark: true },
    { name: 'Water Tank',        kind: 'Sensor',    zone: 'Utility',   state: 'alert', read: 'level 12%' },
  ];

  let events = $state([
    { t: '14:22:07', tag: 'MOTION', msg: 'Front Gate Camera · person detected', sev: 'warn' },
    { t: '14:21:52', tag: 'ENERGY', msg: 'Solar Array crossed 3.0 kW', sev: 'ok' },
    { t: '14:20:31', tag: 'ROBOT',  msg: 'Mower returned to dock · battery 81%', sev: 'ok' },
    { t: '14:18:04', tag: 'ALERT',  msg: 'Water Tank level below threshold', sev: 'alert' },
    { t: '14:15:40', tag: 'AUTO',   msg: 'Rule "Dusk lights" armed', sev: 'ok' },
  ]);

  const N = 64;
  let wave = $state<number[]>(Array.from({ length: N }, (_, i) => 0.5 + 0.28 * Math.sin(i / 3)));
  let power = $state(2.41);
  let solar = $state<number[]>(Array.from({ length: 20 }, () => 0.4 + Math.random() * 0.5));

  function tick() {
    now = new Date();
    const last = wave[wave.length - 1];
    let next = last + (Math.random() - 0.5) * 0.35;
    next = Math.max(0.08, Math.min(0.92, next));
    wave = [...wave.slice(1), next];
    power = +(2.1 + Math.random() * 0.7).toFixed(2);
    solar = [...solar.slice(1), 0.3 + Math.random() * 0.6];
  }

  function path(series: number[], w: number, h: number) {
    const step = w / (series.length - 1);
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${((1 - v) * h).toFixed(1)}`)
      .join(' ');
  }

  const clock = $derived(now.toTimeString().slice(0, 8));
  const online = $derived(devices.filter((d) => d.state !== 'off').length);
  const alerts = $derived(devices.filter((d) => d.state === 'alert').length);
  const activeLabel = $derived(nav.find((n) => n.id === view)?.label ?? '');

  onMount(() => {
    const iv = setInterval(tick, 1000);
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        host = await invoke('system_pulse');
      } catch {
        host = { os: 'web', arch: (navigator as any).platform || 'browser', cores: navigator.hardwareConcurrency || 0 };
      }
    })();
    return () => clearInterval(iv);
  });
</script>

<div class="app">
  <aside class="rail">
    <div class="brand" data-tauri-drag-region>
      <div class="mark"><span class="glyph">◈</span><span class="word display">AQL</span></div>
      <div class="kicker tagline">Command · Physical</div>
    </div>

    <nav class="nav">
      {#each nav as item, i}
        <button class="navitem" class:active={view === item.id} onclick={() => (view = item.id)}>
          <span class="idx mono-num">{String(i + 1).padStart(2, '0')}</span>
          <span class="lbl">{item.label}</span>
          {#if view === item.id}<span class="cursor"></span>{/if}
        </button>
      {/each}
    </nav>

    <div class="rail-foot panel">
      <div class="pulseline"><span class="ping"></span></div>
      <div class="node">
        <div class="node-name display">{node.name}</div>
        <div class="kicker">{node.site}</div>
        <div class="node-host mono-num">
          {#if host}{host.os} · {host.arch} · {host.cores} cores{:else}linking…{/if}
        </div>
      </div>
    </div>
  </aside>

  <header class="status" data-tauri-drag-region>
    <div class="sect"><span class="dot live"></span><span class="sect-name display">{activeLabel}</span></div>
    <div class="ticker"><span class="kicker">SIGNAL</span><span class="tick-msg">{events[0].msg}</span></div>
    <div class="clock">
      <span class="conn"><span class="dot live"></span> RELAY OK</span>
      <span class="time mono-num">{clock}</span>
    </div>
  </header>

  <main class="body">
    {#if view === 'overview'}
      <section class="readouts">
        <div class="cell panel">
          <div class="kicker">Devices online</div>
          <div class="big display mono-num">{online}<span class="of">/ {devices.length}</span></div>
        </div>
        <div class="cell panel">
          <div class="kicker">Power draw</div>
          <div class="big display mono-num">{power}<span class="unit">kW</span></div>
        </div>
        <div class="cell panel">
          <div class="kicker">Automations</div>
          <div class="big display mono-num">7<span class="unit">active</span></div>
        </div>
        <div class="cell panel" class:has-alert={alerts > 0}>
          <div class="kicker">Alerts</div>
          <div class="big display mono-num">{alerts}<span class="unit">open</span></div>
        </div>
      </section>

      <section class="grid">
        <div class="fleet panel">
          <div class="panel-head">
            <span class="kicker">Fleet</span>
            <span class="kicker dim">{devices.length} devices · 4 zones</span>
          </div>
          <div class="tiles">
            {#each devices as d}
              <div class="tile" class:offline={d.state === 'off'}>
                <div class="tile-top">
                  <span class="dot {d.state === 'live' ? 'live' : d.state}"></span>
                  <span class="tile-kind kicker">{d.kind}</span>
                </div>
                <div class="tile-name">{d.name}</div>
                <div class="tile-foot">
                  <span class="tile-read mono-num">{d.read}</span>
                  {#if d.spark}
                    <svg class="spark" viewBox="0 0 60 16" preserveAspectRatio="none">
                      <path d={path(solar, 60, 16)} fill="none" stroke="var(--signal)" stroke-width="1.2" />
                    </svg>
                  {:else}
                    <span class="tile-zone kicker">{d.zone}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="signal">
          <div class="wavepanel panel">
            <div class="panel-head">
              <span class="kicker">Live signal</span>
              <span class="wave-read mono-num">{(wave[N - 1] * 100).toFixed(0)}<span class="pct">%</span></span>
            </div>
            <svg class="wave" viewBox="0 0 320 96" preserveAspectRatio="none">
              <defs>
                <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="var(--signal)" stop-opacity="0.25" />
                  <stop offset="1" stop-color="var(--signal)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="{path(wave, 320, 96)} L320 96 L0 96 Z" fill="url(#wg)" />
              <path d={path(wave, 320, 96)} fill="none" stroke="var(--signal)" stroke-width="1.4" />
            </svg>
          </div>

          <div class="log panel">
            <div class="panel-head"><span class="kicker">Event log</span></div>
            <div class="log-rows">
              {#each events as e}
                <div class="row">
                  <span class="row-t mono-num">{e.t}</span>
                  <span class="row-tag {e.sev}">{e.tag}</span>
                  <span class="row-msg">{e.msg}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {:else}
      <section class="placeholder panel">
        <span class="ph-glyph display">◈</span>
        <div class="ph-title display">{activeLabel} module</div>
        <div class="kicker">Coming online — wiring to the device engine</div>
      </section>
    {/if}
  </main>
</div>

<style>
  .app { display: grid; grid-template-columns: var(--rail-w) 1fr; grid-template-rows: var(--status-h) 1fr; height: 100vh; position: relative; z-index: 1; }

  .rail { grid-row: 1 / 3; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: linear-gradient(180deg, var(--ink-900), var(--ink-950)); padding: 0 0 14px; }
  .brand { padding: 34px 20px 22px; }
  .mark { display: flex; align-items: center; gap: 10px; }
  .glyph { color: var(--signal); font-size: 16px; filter: drop-shadow(0 0 6px var(--signal-glow)); }
  .word { font-size: 22px; letter-spacing: 0.14em; }
  .tagline { margin-top: 7px; }

  .nav { display: flex; flex-direction: column; padding: 6px 12px; gap: 2px; }
  .navitem { position: relative; display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 5px; color: var(--bone-dim); text-align: left; transition: background 0.15s, color 0.15s; }
  .navitem:hover { background: rgba(255,255,255,0.03); color: var(--bone); }
  .navitem.active { background: rgba(242,167,44,0.08); color: var(--bone); }
  .navitem .idx { font-size: 10px; color: var(--bone-faint); }
  .navitem.active .idx { color: var(--signal); }
  .navitem .lbl { font-size: 13px; }
  .navitem .cursor { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 16px; background: var(--signal); box-shadow: 0 0 8px var(--signal-glow); }

  .rail-foot { margin: auto 14px 0; padding: 14px; display: flex; gap: 12px; }
  .pulseline { position: relative; width: 2px; background: var(--line-strong); border-radius: 2px; }
  .ping { position: absolute; left: -1px; width: 4px; height: 22px; border-radius: 3px; background: var(--signal); box-shadow: 0 0 10px var(--signal-glow); animation: travel 3.2s cubic-bezier(0.5,0,0.5,1) infinite; }
  @keyframes travel { 0% { top: 0 } 50% { top: calc(100% - 22px) } 100% { top: 0 } }
  .node-name { font-size: 15px; }
  .node-host { margin-top: 6px; font-size: 10px; color: var(--bone-faint); }

  .status { grid-column: 2; display: flex; align-items: center; gap: 24px; padding: 0 22px; border-bottom: 1px solid var(--line); background: rgba(11,12,14,0.7); backdrop-filter: blur(8px); }
  .sect { display: flex; align-items: center; gap: 10px; }
  .sect-name { font-size: 14px; letter-spacing: 0.02em; }
  .ticker { flex: 1; display: flex; align-items: center; gap: 12px; overflow: hidden; }
  .tick-msg { color: var(--bone-dim); white-space: nowrap; font-size: 12px; }
  .clock { display: flex; align-items: center; gap: 18px; }
  .conn { display: flex; align-items: center; gap: 7px; font-size: 10px; letter-spacing: 0.12em; color: var(--bone-dim); }
  .time { font-size: 14px; font-weight: 500; letter-spacing: 0.04em; }

  .body { grid-column: 2; overflow: auto; padding: 24px; }

  .readouts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
  .cell { padding: 16px 18px 18px; }
  .cell .big { font-size: 40px; line-height: 1; margin-top: 12px; color: var(--bone); }
  .cell .of, .cell .unit { font-size: 14px; color: var(--bone-faint); margin-left: 6px; letter-spacing: 0; }
  .cell.has-alert .big { color: var(--alert); }
  .cell.has-alert::before { border-color: var(--alert); }

  .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; }

  .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
  .panel-head .dim { color: var(--bone-faint); }

  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--line); }
  .tile { background: var(--ink-850); padding: 15px 16px 14px; display: flex; flex-direction: column; gap: 9px; transition: background 0.15s; }
  .tile:hover { background: var(--ink-800); }
  .tile.offline { opacity: 0.55; }
  .tile-top { display: flex; align-items: center; gap: 8px; }
  .tile-kind { color: var(--bone-faint); }
  .tile-name { font-size: 13.5px; color: var(--bone); }
  .tile-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
  .tile-read { font-size: 11px; color: var(--signal); letter-spacing: 0; }
  .tile.offline .tile-read { color: var(--bone-faint); }
  .tile-zone { color: var(--bone-faint); }
  .spark { width: 60px; height: 16px; }

  .signal { display: flex; flex-direction: column; gap: 14px; }
  .wavepanel { flex: none; }
  .wave { display: block; width: 100%; height: 96px; padding: 8px 0 0; }
  .wave-read { font-size: 15px; color: var(--signal); }
  .wave-read .pct { font-size: 11px; }

  .log { flex: 1; display: flex; flex-direction: column; }
  .log-rows { display: flex; flex-direction: column; }
  .row { display: grid; grid-template-columns: 66px 62px 1fr; gap: 10px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); font-size: 11.5px; }
  .row:last-child { border-bottom: none; }
  .row-t { color: var(--bone-faint); }
  .row-tag { font-size: 9px; letter-spacing: 0.12em; font-weight: 600; color: var(--bone-dim); }
  .row-tag.ok { color: var(--online); }
  .row-tag.warn { color: var(--signal); }
  .row-tag.alert { color: var(--alert); }
  .row-msg { color: var(--bone-dim); }

  .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 70vh; }
  .ph-glyph { font-size: 40px; color: var(--signal); opacity: 0.5; filter: drop-shadow(0 0 12px var(--signal-glow)); }
  .ph-title { font-size: 20px; }

  @media (max-width: 1080px) {
    .readouts { grid-template-columns: repeat(2, 1fr); }
    .grid { grid-template-columns: 1fr; }
  }
</style>

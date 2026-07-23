<script lang="ts">
  import { devices, type Device } from '../data';
  let selected = $state<Device>(devices[0]);
  const zones = $derived([...new Set(devices.map((d) => d.zone))]);
</script>

<div class="screen">
  <div class="list panel">
    <div class="phead">
      <span class="kicker">All devices</span>
      <span class="kicker dim">{devices.length} · {zones.length} zones</span>
    </div>
    <div class="rows">
      {#each devices as d}
        <button class="drow" class:sel={selected.id === d.id} class:off={d.state === 'off'} onclick={() => (selected = d)}>
          <span class="dot {d.state === 'live' ? 'live' : d.state}"></span>
          <span class="dn">{d.name}</span>
          <span class="dk kicker">{d.kind}</span>
          <span class="dz kicker">{d.zone}</span>
          <span class="dr mono-num">{d.read}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="detail panel">
    <div class="phead"><span class="kicker">Device</span><span class="dot {selected.state === 'live' ? 'live' : selected.state}"></span></div>
    <div class="dbody">
      <div class="preview">
        {#if selected.kind === 'Camera'}
          <div class="feed"><span class="rec"></span><span class="kicker">LIVE · {selected.name}</span><div class="scan"></div></div>
        {:else}
          <div class="bigread display mono-num">{selected.read}</div>
        {/if}
      </div>
      <div class="dname display">{selected.name}</div>
      <div class="kicker">{selected.kind} · {selected.zone}</div>
      <div class="meta">
        <div class="mrow"><span class="kicker">Status</span><span class="mv">{selected.detail}</span></div>
        <div class="mrow"><span class="kicker">Last seen</span><span class="mv mono-num">{selected.seen}</span></div>
        <div class="mrow"><span class="kicker">Device ID</span><span class="mv mono-num">{selected.id}</span></div>
      </div>
      <div class="controls">
        <button class="ctl primary">Open</button>
        <button class="ctl">Automate</button>
        <button class="ctl">Logs</button>
      </div>
    </div>
  </div>
</div>

<style>
  .screen { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; }
  .phead { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
  .phead .dim { color: var(--bone-faint); }
  .rows { display: flex; flex-direction: column; }
  .drow { display: grid; grid-template-columns: 14px 1.4fr 0.7fr 0.7fr 1fr; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); text-align: left; transition: background 0.12s; }
  .drow:last-child { border-bottom: none; }
  .drow:hover { background: rgba(255,255,255,0.03); }
  .drow.sel { background: rgba(242,167,44,0.09); }
  .drow.sel::before { content: ''; position: absolute; }
  .drow.off { opacity: 0.5; }
  .dn { font-size: 13px; color: var(--bone); }
  .dk, .dz { color: var(--bone-faint); }
  .dr { font-size: 11px; color: var(--signal); text-align: right; }
  .drow.off .dr { color: var(--bone-faint); }

  .dbody { padding: 16px; }
  .preview { height: 168px; border: 1px solid var(--line); margin-bottom: 16px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; background: radial-gradient(120% 100% at 50% 0%, rgba(242,167,44,0.05), transparent 60%), var(--ink-900); }
  .feed { display: flex; align-items: center; gap: 8px; color: var(--bone-dim); }
  .rec { width: 8px; height: 8px; border-radius: 50%; background: var(--alert); animation: blink 1.4s steps(2) infinite; }
  @keyframes blink { 0%,50% { opacity: 1 } 51%,100% { opacity: 0.3 } }
  .scan { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,0.02) 3px 4px); pointer-events: none; }
  .bigread { font-size: 34px; color: var(--signal); }
  .dname { font-size: 18px; margin-bottom: 4px; }
  .meta { margin: 18px 0; display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); }
  .mrow { display: flex; justify-content: space-between; align-items: center; padding: 11px 13px; background: var(--ink-850); }
  .mv { font-size: 12px; color: var(--bone-dim); }
  .controls { display: flex; gap: 8px; }
  .ctl { flex: 1; padding: 10px; border: 1px solid var(--line-strong); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--bone-dim); transition: all 0.12s; }
  .ctl:hover { border-color: var(--bone-faint); color: var(--bone); }
  .ctl.primary { background: var(--signal); color: #1a1204; border-color: var(--signal); font-weight: 600; }
  .ctl.primary:hover { background: var(--signal-hi); }
  @media (max-width: 1080px) { .screen { grid-template-columns: 1fr; } }
</style>

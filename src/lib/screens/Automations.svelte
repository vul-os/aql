<script lang="ts">
  import { automations } from '../data';
  let rules = $state(automations.map((a) => ({ ...a })));
  const active = $derived(rules.filter((r) => r.enabled).length);
  function toggle(i: number) { rules[i].enabled = !rules[i].enabled; }
</script>

<div class="screen">
  <section class="stats">
    <div class="cell panel"><div class="kicker">Rules</div><div class="big display mono-num">{rules.length}</div></div>
    <div class="cell panel"><div class="kicker">Active</div><div class="big display mono-num">{active}</div></div>
    <div class="cell panel"><div class="kicker">Runs today</div><div class="big display mono-num">37</div></div>
    <div class="cell panel"><div class="kicker">Last trigger</div><div class="big display mono-num">2<span class="u">min ago</span></div></div>
  </section>

  <section class="list panel">
    <div class="phead"><span class="kicker">Automation rules</span><button class="new">+ New rule</button></div>
    <div class="rows">
      {#each rules as r, i}
        <div class="rule" class:disabled={!r.enabled}>
          <button class="tg" class:on={r.enabled} onclick={() => toggle(i)} aria-label="toggle"><span class="knob"></span></button>
          <div class="flow">
            <span class="rname">{r.name}</span>
            <div class="chain">
              <span class="when"><span class="lbl kicker">when</span> {r.when}</span>
              <span class="arrow">→</span>
              <span class="then"><span class="lbl kicker">do</span> {r.then}</span>
            </div>
          </div>
          <div class="stat">
            <span class="runs mono-num">{r.runs}</span><span class="kicker">runs</span>
            <span class="last kicker">{r.last}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .screen { display: flex; flex-direction: column; gap: 14px; }
  .phead { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .cell { padding: 16px 18px; } .big { font-size: 34px; margin-top: 10px; } .u { font-size: 12px; color: var(--bone-faint); margin-left: 5px; }
  .new { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--signal); border: 1px solid var(--line-strong); padding: 6px 12px; transition: all 0.12s; }
  .new:hover { border-color: var(--signal); }

  .rows { display: flex; flex-direction: column; }
  .rule { display: grid; grid-template-columns: 42px 1fr 120px; gap: 14px; align-items: center; padding: 15px 16px; border-bottom: 1px solid var(--line); }
  .rule:last-child { border-bottom: none; }
  .rule.disabled { opacity: 0.5; }
  .tg { width: 36px; height: 20px; border-radius: 11px; background: var(--ink-700); position: relative; transition: background 0.18s; }
  .tg.on { background: var(--signal); }
  .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--bone); transition: left 0.18s; }
  .tg.on .knob { left: 18px; background: #1a1204; }
  .rname { font-size: 14px; color: var(--bone); }
  .chain { display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
  .when, .then { font-size: 12px; color: var(--bone-dim); }
  .lbl { margin-right: 5px; }
  .then .lbl { color: var(--signal); }
  .arrow { color: var(--signal); font-size: 13px; }
  .stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .runs { font-size: 16px; color: var(--bone); }
  .stat .kicker { color: var(--bone-faint); }
  .last { margin-top: 4px; }
  @media (max-width: 1080px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>

// The in-app landing — what a browser gets at `/` from a self-hosted hub
// binary.
//
// DELIBERATELY NOT A MARKETING PAGE. The public product page lives at
// vulos.org/products/aql/ (this repo's `site/index.html`) and is the one
// place that argument gets made. This page is served by a hub someone
// already installed and is pointing a browser at, so its whole job is:
//   1. say what this thing is, in one breath and without overclaiming,
//   2. get the reader into the console — sign in, sign up, or connect to a
//      different hub,
//   3. point outward for anything longer (docs, security, source, site).
// Keeping two full marketing pages in sync is how the copy on one of them
// goes stale and starts lying; there is now only one.

import { Link } from 'react-router-dom';
import { TopNav } from '@/components/nav/TopNav';
import { Footer } from '@/components/landing/Footer';
import { LinkButton, Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { getApiBaseUrl, openGatewayPicker } from '@/lib/hub';
import { DEVICE_KINDS, REAL_KIND } from '@/lib/deviceKinds';

export default function Landing() {
  return (
    <div className="bg-paper">
      <TopNav />
      <Entry />
      <DeviceKinds />
      <Notes />
      <Elsewhere />
      <Footer />
    </div>
  );
}

// ── 1. what this is, and the way in ─────────────────────────────────────────

function Entry() {
  const { signedIn } = useAuth();

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-6 lg:px-10 pt-12 pb-16 sm:pt-16 sm:pb-20 lg:pt-24 lg:pb-24">
        <div className="grid grid-cols-12 gap-y-10 sm:gap-x-10">
          <div className="col-span-12 lg:col-span-7 min-w-0">
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-ink/55">
              <span className="h-1 w-1 rounded-full bg-terracotta" aria-hidden />
              The hub on this box
            </span>

            <h1
              className="font-display-tight mt-4 leading-[0.96] tracking-[-0.02em] text-ink"
              style={{ fontSize: 'clamp(2.25rem, 6vw, 4.25rem)' }}
            >
              Everything on{' '}
              <em className="italic text-terracotta" style={{ fontVariationSettings: '"SOFT" 100' }}>
                one hub
              </em>{' '}
              you own.
            </h1>

            <p className="mt-6 max-w-xl text-[16px] sm:text-[17px] leading-relaxed text-ink/70">
              <strong className="font-normal text-ink">Aql</strong> (Arabic عقل &mdash;{' '}
              <em className="italic">the mind</em>) is the software brain for your physical space:
              cameras, lighting, robots, climate, energy, sensors and access control under one hub.
              The reach of a smart-home hub, pushed wider &mdash; autonomous robots and business
              fleets included.
            </p>

            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/60">
              This page is served by that hub: the binary running on this box. You own it. No cloud
              broker sits in the path, there is no account with us, and nothing in the binary phones
              home.
            </p>
          </div>

          {/* The way in. On a hub someone has already installed, this is the
              actual point of the page — not a conversion funnel. */}
          <div className="col-span-12 lg:col-span-5 min-w-0 lg:pl-6">
            <div className="rounded-2xl border border-ink/10 bg-paper-cool p-6 sm:p-8">
              <p className="text-[10px] uppercase tracking-[0.22em] text-ink/50">
                {signedIn ? 'Signed in' : 'Get in'}
              </p>

              <h2 className="mt-3 font-display text-2xl sm:text-[28px] leading-tight">
                {signedIn ? 'Back to the console.' : 'Sign in to this hub.'}
              </h2>

              <p className="mt-3 text-[15px] leading-relaxed text-ink/65">
                {signedIn
                  ? 'Devices, automations, energy and access control — all of it lives in the console.'
                  : 'Accounts live on this hub, not on anyone else’s cloud. If someone invited you, open the link they sent and your account gets created there.'}
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {signedIn ? (
                  <>
                    <LinkButton to="/app" variant="ink" size="lg" className="w-full">
                      Open the console
                    </LinkButton>
                    <LinkButton to="/docs" variant="outline" size="lg" className="w-full">
                      Read the docs
                    </LinkButton>
                  </>
                ) : (
                  <>
                    <LinkButton to="/login" variant="ink" size="lg" className="w-full">
                      Sign in
                    </LinkButton>
                    <LinkButton to="/signup" variant="outline" size="lg" className="w-full">
                      Create an account
                    </LinkButton>
                  </>
                )}
              </div>

              {/* The connect affordance. Keeps the hub picker reachable from
                  `/` on desktop builds and anywhere a reader has landed on the
                  wrong instance — same picker Login and Settings open. */}
              <div className="mt-6 pt-5 border-t border-ink/10">
                <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45">Connected to</p>
                <p className="mt-1.5 font-mono text-[12.5px] text-ink/70 break-all">
                  {getApiBaseUrl()}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 -ml-4"
                  onClick={openGatewayPicker}
                >
                  Connect to a different hub
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 2. the seven device kinds, and which one is real ────────────────────────

// Aql's device model has seven kinds. Six are served by the device engine —
// which is built, ships off by default, and does not have a driver for every
// one of them; access control is the kind that runs from the intent to the
// relay today and does not go through the engine at all. The list comes from
// src/lib/deviceKinds.ts, which a test pins to the engine's own catalogue.
const BLURBS: Record<string, string> = {
  Camera: 'Live view, recording and event-driven alerting.',
  Lighting: 'On, off, dim, scene and groups, behind one device model.',
  Robot: 'Mowers, patrol and cleaning bots as fleet members with tasking and run history.',
  Climate: 'Thermostats, valves, humidity and ventilation on your rules, not four vendor apps.',
  Energy: 'Meter and inverter ingestion, rollups, and a measured source mix.',
  Sensor: 'Motion, contact, temperature, humidity, water level and tamper.',
  Access: 'Gates, doors and barriers — a paired controller pulses the relay on an Ed25519-signed command it verifies against a key it pinned itself.',
};

const KINDS = DEVICE_KINDS;

function DeviceKinds() {
  return (
    <section className="relative bg-paper-warm border-y border-ink/10">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10 py-16 sm:py-20">
        <div className="grid grid-cols-12 gap-y-5 sm:gap-x-10 items-end mb-10">
          <div className="col-span-12 lg:col-span-6">
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-ink/55">
              <span className="h-1 w-1 rounded-full bg-terracotta" aria-hidden />
              One hub, seven device kinds
            </span>
            <h2 className="mt-4 font-display-tight text-3xl sm:text-4xl lg:text-[44px] leading-[0.98] tracking-[-0.02em]">
              One of the seven <em className="italic text-terracotta">is finished.</em>
            </h2>
          </div>
          <p className="col-span-12 lg:col-span-6 text-ink/70 leading-relaxed text-[15px]">
            The hub is built to own all seven kinds through one device model, one audit log and one
            place to look. Access control is the kind that runs end to end today; the engine behind
            the other six is designed and not written. Nothing on this page is called real unless it
            says so here.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {KINDS.map((kind) => {
            const real = kind === REAL_KIND;
            return (
              <li
                key={kind}
                className={`rounded-2xl border p-5 sm:p-6 ${
                  real ? 'border-moss/40 bg-moss/5 sm:col-span-2 lg:col-span-3' : 'border-ink/10 bg-paper'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h3 className="font-display text-xl">{kind}</h3>
                  {real ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-moss border border-moss/45 rounded px-1.5 py-0.5">
                      runs end to end
                    </span>
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-gold border border-gold/60 rounded px-1.5 py-0.5">
                      planned
                    </span>
                  )}
                </div>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink/65 max-w-2xl">
                  {BLURBS[kind]}
                </p>
                {real && (
                  <p className="mt-4">
                    <Link
                      to="/docs/pairing-device"
                      className="text-sm underline underline-offset-4 decoration-terracotta text-ink/85 hover:text-ink"
                    >
                      Pair a controller &rarr;
                    </Link>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ── 3. the two things worth saying up front ─────────────────────────────────

function Notes() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10 py-16 sm:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
          <article className="rounded-2xl border border-ink/10 bg-paper-cool p-7 sm:p-9">
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink/50">You own the box</span>
            <h3 className="mt-3 font-display text-2xl sm:text-[26px] leading-tight">
              No broker. No account. No telemetry.
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-ink/70">
              One Go binary and one SQLite file, on hardware you can point at. There is no Aql
              service to sign up for, nothing phones home, and there is no billing code in the
              binary. The binary ships no TLS either &mdash; it refuses to bind a public address
              unless you tell it a reverse proxy or tunnel terminates TLS in front of it.
            </p>
            <p className="mt-4">
              <Link
                to="/security"
                className="text-sm underline underline-offset-4 decoration-terracotta text-ink/85 hover:text-ink"
              >
                What we do and don&rsquo;t claim &rarr;
              </Link>
            </p>
          </article>

          <article className="rounded-2xl border border-ink/10 bg-paper-cool p-7 sm:p-9">
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink/50">
              Chat as an input surface
            </span>
            <h3 className="mt-3 font-display text-2xl sm:text-[26px] leading-tight">
              Text a channel, act on a device.
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-ink/70">
              Chat isn&rsquo;t the product &mdash; it&rsquo;s the input surface onto the hub with
              the least friction, because nobody installs anything. A message resolves to a member,
              passes your rules, and becomes a signed command. Opening a gate is the verb that works
              today, because access is the module that&rsquo;s real.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink/70">
              The channel rails themselves are moving out of Aql and into{' '}
              <a
                href="https://github.com/vul-os/ephor"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 decoration-terracotta text-ink/85 hover:text-ink"
              >
                Ephor
              </a>
              , a separate component you run or point at. That move is in progress. Whichever side
              carries the rail, the hub is the only authority: it checks the rules, signs the
              command, and writes the audit entry.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

// ── 4. everything longer lives somewhere else ───────────────────────────────

const OUTWARD: { label: string; note: string; to?: string; href?: string }[] = [
  { label: 'Documentation', note: 'Getting started, pairing, permissions, API.', to: '/docs' },
  { label: 'Security', note: 'The model, and what it deliberately doesn’t claim.', to: '/security' },
  {
    label: 'The product page',
    note: 'The long version, including the full built-vs-unbuilt ledger.',
    href: 'https://vulos.org/products/aql/#status',
  },
  {
    label: 'Source — vul-os/aql',
    note: 'MIT or Apache-2.0. Every line of the hub, the controller and this console.',
    href: 'https://github.com/vul-os/aql',
  },
  {
    label: 'Zana — open hardware',
    note: 'The body to Aql’s brain: mowers, sensor nodes, security and cleaning bots.',
    href: 'https://github.com/vul-os/zana',
  },
  {
    label: 'Ephor — the coordinator',
    note: 'Where the chat rails are moving. Separate, swappable, yours to run.',
    href: 'https://github.com/vul-os/ephor',
  },
];

function Elsewhere() {
  return (
    // Sits directly above the footer, which shares this surface — so the
    // bottom padding is the footer's, not doubled up here.
    <section className="relative bg-ink text-paper">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10 pt-16 sm:pt-20 pb-2">
        <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-paper/55">
          <span className="h-1 w-1 rounded-full bg-terracotta" aria-hidden />
          Further in
        </span>
        <h2 className="mt-4 font-display-tight text-3xl sm:text-4xl lg:text-[44px] leading-[0.98] tracking-[-0.02em] max-w-2xl">
          The rest of it is <em className="italic text-terracotta-soft">written down.</em>
        </h2>

        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-paper/10 border border-paper/10 rounded-2xl overflow-hidden">
          {OUTWARD.map((o) => {
            const inner = (
              <>
                <span className="font-display text-xl text-paper flex items-center gap-2">
                  {o.label}
                  <span aria-hidden className="text-terracotta-soft text-base">
                    &rarr;
                  </span>
                </span>
                <span className="mt-2 block text-[14px] leading-relaxed text-paper/65">{o.note}</span>
              </>
            );
            return (
              <li key={o.label} className="bg-ink">
                {o.to ? (
                  <Link to={o.to} className="block p-6 sm:p-7 h-full hover:bg-paper/5 transition-colors">
                    {inner}
                  </Link>
                ) : (
                  <a
                    href={o.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-6 sm:p-7 h-full hover:bg-paper/5 transition-colors"
                  >
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { api, friendlyApiError, type RailDisclosure } from '@/lib/api';
import { Card } from '@/components/ui/Card';

/**
 * The KOTVA §26.3 disclosure for every chat rail, shown where someone chooses
 * one.
 *
 * The hub has computed and served these four fields for a while — initiation
 * class, inbound transport, price shape, and who sees plaintext — and no
 * screen rendered them. For an ordinary feature that is a gap. For an honesty
 * feature it is worse than not having built it: the repo could point at a
 * tested disclosure endpoint while every actual user picked a rail knowing
 * none of it.
 *
 * Two rules this component follows, both from api.ts's own doc comments:
 *
 *   - The `note` is rendered VERBATIM and unconditionally. The four fields
 *     cannot carry the thing most likely to be misread — self-hosting removes
 *     the middleman operator, not the platform. A table without that sentence
 *     lets "you host it yourself" read as "nobody else sees your messages",
 *     which is false on every rail here.
 *   - `runs_behind_cgnat` is taken from the hub, never re-derived from
 *     `inbound_transport` locally. Re-deriving it is how a console ends up
 *     contradicting the declaration it is rendering.
 */
export function RailDisclosureSection() {
  const [rails, setRails] = useState<RailDisclosure[] | null>(null);
  const [note, setNote] = useState('');
  const [spec, setSpec] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .railDisclosures()
      .then((r) => {
        if (!live) return;
        setRails(r.rails);
        setNote(r.note);
        setSpec(r.spec);
      })
      .catch((err) => {
        if (live) setError(friendlyApiError(err, 'Could not load the rail disclosures.'));
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card>
      <h2 className="font-display text-2xl">What each chat rail exposes</h2>
      <p className="text-sm text-ink/65 mt-1">
        Before you link one: who can start a conversation, what it costs, and who reads the
        messages. {spec && <span className="text-ink/45">Declared per {spec}.</span>}
      </p>

      {error && (
        <p className="mt-4 text-sm text-terracotta-deep" role="alert">
          {error}
        </p>
      )}

      {!rails && !error && <p className="mt-6 text-sm text-ink/55">Loading…</p>}

      {/* The hub's own sentence, not a paraphrase. It is the one claim the
          table cannot make for itself, and paraphrasing is how it would get
          softened. */}
      {note && (
        <div className="mt-5 rounded-xl border border-gold/40 bg-gold/[0.07] px-4 py-3">
          <p className="text-sm text-ink/85">{note}</p>
        </div>
      )}

      {rails && rails.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink/50">
                <th className="py-2 pr-4 font-normal">Rail</th>
                <th className="py-2 pr-4 font-normal">Who can start</th>
                <th className="py-2 pr-4 font-normal">Cost</th>
                <th className="py-2 pr-4 font-normal">Who reads it</th>
                <th className="py-2 font-normal">Reachability</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {rails.map((r) => (
                <tr key={r.rail} className="border-t border-ink/10">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-ink capitalize">{r.rail}</div>
                    <div className="text-xs text-ink/50">{r.platform}</div>
                  </td>
                  <td className="py-3 pr-4 text-ink/80">
                    {r.can_initiate ? 'Either side' : 'Only after you message it first'}
                    <div className="text-xs text-ink/50 mt-0.5">
                      in: {r.inbound.initiation} · out: {r.outbound.initiation}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-ink/80">
                    in: {r.inbound.price}
                    <div className="text-xs text-ink/50 mt-0.5">out: {r.outbound.price}</div>
                  </td>
                  {/* Never "nobody" on any of these rails — that is the point
                      of showing it rather than summarising it as a badge. */}
                  <td className="py-3 pr-4 text-ink/80">
                    {r.outbound.exposure}
                    {r.inbound.exposure !== r.outbound.exposure && (
                      <div className="text-xs text-ink/50 mt-0.5">inbound: {r.inbound.exposure}</div>
                    )}
                  </td>
                  <td className="py-3 text-ink/80">
                    {r.inbound_transport}
                    <div className="text-xs text-ink/50 mt-0.5">
                      {/* Straight from the hub. Re-deriving this from the
                          transport locally is how the console would end up
                          disagreeing with the declaration it is rendering. */}
                      {r.runs_behind_cgnat
                        ? 'works behind CGNAT / no port forwarding'
                        : 'needs a reachable HTTPS endpoint'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rails && rails.some((r) => r.self_host_note) && (
        <ul className="mt-4 space-y-1.5">
          {rails
            .filter((r) => r.self_host_note)
            .map((r) => (
              <li key={r.rail} className="text-xs text-ink/55">
                <span className="capitalize text-ink/70">{r.rail}</span>: {r.self_host_note}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

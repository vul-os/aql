import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * The three answers a list screen can give, kept apart.
 *
 * Members, Grants and Access Points each held their rows as `T[] | null` and
 * rendered `null` as "Loading…". A failed fetch also leaves them `null`, so all
 * three showed a spinner FOREVER — with an error banner sitting above it in two
 * cases, and nothing at all in the third.
 *
 * That is the worst version of this bug: a permanent "Loading…" is a screen
 * that will never resolve, and the operator has no way to tell it from a slow
 * hub. They wait.
 *
 * The distinctions the old shape could not express:
 *
 *   loading  the request is in flight. Transient by definition.
 *   failed   the request finished and did not work. The rows are UNKNOWN, not
 *            absent — a retry is the action, and saying so is the point.
 *   empty    the request worked and there is genuinely nothing. Only this one
 *            may say "no members yet".
 *
 * Three copies of this narrowing is how they drifted apart in the first place,
 * so there is one.
 */
export type ListState<T> =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; items: T[] };

/** The state a screen starts in, before its first fetch resolves. */
export const listLoading: ListState<never> = { status: 'loading' };

/**
 * Narrow a fetch into a ListState.
 *
 * `fn` is awaited; anything it throws becomes `failed` with a human sentence
 * rather than a null the caller has to interpret. The point is that a screen
 * cannot accidentally represent a failure as an absence, because there is no
 * shared value between the two.
 */
export async function loadList<T>(
  fn: () => Promise<T[]>,
  fallbackMessage: string,
  describe: (err: unknown, fallback: string) => string,
): Promise<ListState<T>> {
  try {
    return { status: 'ready', items: await fn() };
  } catch (err) {
    return { status: 'failed', message: describe(err, fallbackMessage) };
  }
}

/**
 * Render whichever of the three non-row states applies, or null when there are
 * rows to draw.
 *
 * `emptyMessage` is used ONLY for a confirmed-empty list, which is the whole
 * reason this component exists.
 */
export function ListStateCard<T>({
  state,
  emptyMessage,
  loadingMessage = 'Loading…',
  onRetry,
}: {
  state: ListState<T>;
  emptyMessage: string;
  loadingMessage?: string;
  onRetry?: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <Card>
        <p className="text-ink/55 text-sm">{loadingMessage}</p>
      </Card>
    );
  }

  if (state.status === 'failed') {
    return (
      <Card className="border-terracotta/40">
        <p className="text-sm text-terracotta-deep">{state.message}</p>
        {/* Said explicitly, because a blank list reads as "there is nothing
            here" and that is the one thing this state does NOT know. */}
        <p className="mt-2 text-sm text-ink/70">
          This is a failed request, not an empty list — nothing has been deleted.
        </p>
        {onRetry && (
          <div className="mt-4">
            <Button variant="ink" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </Card>
    );
  }

  if (state.items.length === 0) {
    return (
      <Card>
        <p className="text-ink/65 text-sm">{emptyMessage}</p>
      </Card>
    );
  }

  return null;
}

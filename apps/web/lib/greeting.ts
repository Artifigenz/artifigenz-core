import type { ActivationContext } from '@/hooks/useActivatedAgents';

export interface DashboardSignals {
  unreadMustSee: { title: string; detail: string }[];
  totalUnread: number;
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items[0]}, ${items[1]}, and ${items.length - 2} more`;
}

export function buildGreeting(
  activation: ActivationContext | null,
  signals: DashboardSignals
): string {
  const time = timeOfDayGreeting();

  // Not activated (user navigated to dashboard directly)
  if (!activation) {
    return `${time}. I haven't been activated yet — get me going and I'll start working.`;
  }

  const minutesSince =
    activation.activatedAt > 0
      ? (Date.now() - activation.activatedAt) / 60000
      : Infinity;
  const isFresh = minutesSince < 60;
  const hasAccounts = activation.accounts.length > 0;
  const hasGoals = activation.goals.length > 0;

  // Just-activated states
  if (isFresh) {
    if (!hasAccounts && !hasGoals) {
      return `${time}. You're in. When you get a sec, connect an account or add a goal — I'll start the moment you do.`;
    }
    if (!hasAccounts) {
      return `${time}. Locked in on "${activation.goals[0]}". Connect an account when you can — I'll pull data the moment you do.`;
    }
    if (!hasGoals) {
      return `${time}. Scanning ${formatList(activation.accounts)} now. First insights should land within a few hours.`;
    }
    return `${time}. I'm on it — watching for "${activation.goals[0]}" across ${formatList(activation.accounts)}. Scanning now.`;
  }

  // Returning user — surface the most urgent thing
  if (signals.unreadMustSee.length > 0) {
    const first = signals.unreadMustSee[0];
    const more = signals.unreadMustSee.length - 1;
    const suffix =
      more > 0 ? ` Plus ${more} more ${more === 1 ? 'thing' : 'things'} worth a look.` : '';
    return `${time}. ${first.title} — ${first.detail}${suffix}`;
  }

  if (signals.totalUnread > 0) {
    return `${time}. ${signals.totalUnread} new ${
      signals.totalUnread === 1 ? 'insight' : 'insights'
    } waiting for you. Nothing urgent.`;
  }

  return `${time}. Everything's tracking normally. I'll surface things the moment they matter.`;
}

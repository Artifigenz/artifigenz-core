import type { Agent, Founder } from './types';

export const AGENTS: Agent[] = [
  // ── Active ──
  {
    name: 'Finance',
    pitch: 'Finds money you didn\'t know you were losing.',
    skills: ['Budget tracking', 'Subscription audit', 'Savings goals', 'Expense categorization', 'Bill reminders'],
    active: true,
    insights: [
      'You spent 22% more on dining out this month compared to last.',
      '3 subscriptions haven\'t been used in 60+ days.',
      'Your savings rate improved to 18% this quarter.',
    ],
    lastActive: '2 min ago',
  },
  {
    name: 'Travel',
    pitch: 'Plans trips you\'d never have time to research.',
    skills: ['Flight deals', 'Itinerary builder', 'Hotel comparison', 'Visa requirements', 'Local recommendations'],
    active: true,
    insights: [
      'Flights to Tokyo dropped 34% for April 12–19.',
      'Your usual hotel in Bali just opened March availability.',
      'Passport expires in 4 months — some countries require 6.',
    ],
    lastActive: '18 min ago',
  },
  {
    name: 'Health',
    pitch: 'Notices patterns in your habits before you do.',
    skills: ['Sleep analysis', 'Fitness tracking', 'Habit streaks', 'Nutrition logging', 'Mood tracking'],
    active: true,
    insights: [
      'Sleep dropped below 6h three nights this week.',
      'Your step count is up 12% since last month.',
      'You\'ve hit your water intake goal 5 days in a row.',
    ],
    lastActive: '1 hr ago',
  },
  {
    name: 'Research',
    pitch: 'Goes deep so you get the short version.',
    skills: ['Topic deep-dives', 'Competitor analysis', 'Summarization', 'Source verification', 'Trend spotting'],
    active: true,
    insights: [
      'Competitive analysis on 5 players in your space is ready.',
      'Found 3 new papers on the topic you flagged last week.',
      'Market trend report for Q1 2026 has been summarized.',
    ],
    lastActive: '3 hr ago',
  },

  {
    name: 'Job Search',
    pitch: 'Finds opportunities that match your skills and ambitions.',
    skills: ['Job matching', 'Application tracking', 'Interview prep', 'Salary benchmarking', 'Network alerts'],
    active: true,
    insights: [
      '3 new roles matching your profile posted today.',
      'A company you follow just opened a senior position.',
      'Your application to Stripe moved to interview stage.',
    ],
    lastActive: '30 min ago',
  },

  // ── Explore ──
  {
    name: 'Learning',
    pitch: 'Turns your curiosity into structured progress.',
    skills: ['Course discovery', 'Study plans', 'Skill mapping', 'Quiz generation', 'Progress tracking'],
    active: false,
  },
  {
    name: 'Shopping',
    pitch: 'Hunts the best deals so you never overpay.',
    skills: ['Price tracking', 'Deal alerts', 'Wishlist manager', 'Coupon finder', 'Price history'],
    active: false,
  },
  {
    name: 'Parenting',
    pitch: 'A second brain for the hardest job.',
    skills: ['Activity ideas', 'Milestone tracking', 'School research', 'Meal planning', 'Schedule coordination'],
    active: false,
  },
  {
    name: 'Events',
    pitch: 'Plans the party. You just show up.',
    skills: ['Venue search', 'Guest management', 'Budget tracking', 'Vendor coordination', 'Timeline planning'],
    active: false,
  },
  {
    name: 'Pulse',
    pitch: 'Curates news and social into one clean feed — no doom scrolling.',
    skills: ['Topic curation', 'Social monitoring', 'News aggregation', 'Daily briefings', 'Trend alerts'],
    active: false,
  },
];

export const FOUNDERS: readonly Founder[] = [
  { name: 'Cooper', url: 'https://x.com/CooperAIWorks' },
  { name: 'Rajan RK', url: 'https://x.com/rajanbuilds' },
];

export const SOCIAL = {
  x: {
    url: 'https://x.com/FigenzAI',
    handle: '@FigenzAI',
  },
} as const;

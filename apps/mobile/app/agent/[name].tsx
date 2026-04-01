import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Switch, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import Svg, { Line, Polyline, Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { AGENTS } from '@artifigenz/shared';
import { type ColorTheme } from '../../constants/theme';
import { useTheme } from '../../components/ThemeContext';
import { ICON_MAP } from '../../components/AgentIcons';

const AGENT_DATA: Record<string, any> = {
  finance: {
    since: 'March 15', lastAnalyzed: '2 hours ago',
    greeting: "Good news — you're ahead of your savings target this month. But Netflix quietly raised its price and your DoorDash habit is creeping up again. Worth a look.",
    accounts: [{ name: 'Chase ••••4521' }, { name: 'Amex ••••8832' }],
    goals: [{ id: '1', text: 'Save $500 per month' }, { id: '2', text: 'Understand where my money goes' }, { id: '3', text: 'Stop wasting on unused subscriptions' }],
    skills: [{ name: 'Recurring Charges', active: true }, { name: 'Spending Breakdown', active: true }, { name: 'Bill Change Detection', active: true }, { name: 'New Charge Detection', active: true }, { name: 'Cash Flow Forecast', active: false }, { name: 'Income vs. Spending', active: false }],
    statsTitle: 'Financial Health',
    stats: [{ value: '$5,200', label: 'Income this month' }, { value: '$3,680', label: 'Spent so far' }, { value: '$387', label: 'Recurring charges' }, { value: '$1,133', label: 'Projected surplus' }],
    unread: 3,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Bill Change', title: 'Netflix increased by 48%', detail: '$15.49/mo → $22.99/mo. This adds $90/year to your subscriptions.', mustSee: true },
        { category: 'Spending', title: 'Food & Dining is $200 above your average', detail: '$640 this month vs. $440 average. Most of the increase is DoorDash ($280 vs. usual $120).' },
      ]},
      { date: 'Fri, Mar 28', insights: [{ category: 'New Charge', title: 'Hulu — $12.99/month', detail: 'First charge on Amex ••8832. Your total subscriptions are now $400/mo across 15 services.', mustSee: true }]},
      { date: 'Thu, Mar 20', insights: [
        { category: 'Recurring Charges', title: '14 subscriptions — $387/month total', detail: 'Full list of all recurring charges across both accounts.', read: true },
        { category: 'Cash Flow', title: 'Projected surplus: ~$340 by month end', detail: 'Income: $5,200. Spent: $3,680. Remaining recurring: $1,180.', read: true },
      ]},
      { date: 'Sat, Mar 1', insights: [{ category: 'Monthly Report', title: 'February: $5,200 in, $4,800 out, $400 surplus', detail: 'Full spending breakdown by category with month-over-month changes.', read: true }]},
    ],
  },
  travel: {
    since: 'March 10', lastAnalyzed: '18 minutes ago',
    greeting: "That Tokyo window I've been watching just opened — fares dropped to $287. Also, your passport is getting close to the 6-month cutoff. Let's not forget that.",
    accounts: [{ name: 'Google Flights' }, { name: 'Kayak alerts' }],
    goals: [{ id: '1', text: 'Find deals to Tokyo, Bali, or Florida' }, { id: '2', text: 'Stay under $2,000 per trip' }],
    skills: [{ name: 'Price Tracking', active: true }, { name: 'Deal Alerts', active: true }, { name: 'Itinerary Builder', active: true }, { name: 'Visa Requirements', active: false }, { name: 'Hotel Comparison', active: false }],
    statsTitle: 'Travel Dashboard',
    stats: [{ value: '3', label: 'Destinations tracked' }, { value: '$287', label: 'Best flight found' }, { value: '34%', label: 'Below avg price' }, { value: '2', label: 'Alerts pending' }],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [{ category: 'Price Drop', title: 'Tokyo flights dropped 34% for April 12–19', detail: 'Round-trip from JFK now $287. Lowest in 90 days.', mustSee: true }]},
      { date: 'Sat, Mar 29', insights: [{ category: 'Availability', title: 'Your usual hotel in Bali opened March availability', detail: 'The Mulia Resort · $189/night · 4 rooms left.', read: true }]},
      { date: 'Wed, Mar 26', insights: [{ category: 'Document', title: 'Passport expires in 4 months', detail: 'Some countries require 6 months validity. Consider renewing before booking.', mustSee: true }]},
    ],
  },
  health: {
    since: 'March 8', lastAnalyzed: '1 hour ago',
    greeting: "Your steps are solid — best month in a while. But your sleep took a hit this week. Three nights under 6 hours. I'd keep an eye on that before it becomes a pattern.",
    accounts: [{ name: 'Apple Health' }, { name: 'Fitbit sync' }],
    goals: [{ id: '1', text: 'Get sleep back above 7 hours' }, { id: '2', text: 'Maintain step count above 8,000/day' }, { id: '3', text: 'Drink 8 glasses of water daily' }],
    skills: [{ name: 'Sleep Analysis', active: true }, { name: 'Step Tracking', active: true }, { name: 'Hydration', active: true }, { name: 'Nutrition Logging', active: false }, { name: 'Mood Tracking', active: false }],
    statsTitle: 'Health Overview',
    stats: [{ value: '5.2h', label: 'Avg sleep (14d)' }, { value: '8,420', label: 'Steps /day' }, { value: '5', label: 'Day streak (water)' }, { value: '27%', label: 'Below baseline' }],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [
        { category: 'Sleep', title: 'Sleep dropped below 6h three nights this week', detail: '14-day average: 5.2 hrs. Your baseline is 7.1 hrs.', mustSee: true },
        { category: 'Activity', title: 'Step count is up 12% since last month', detail: '8,420 avg daily steps vs. 7,520 last month.' },
      ]},
      { date: 'Mon, Mar 24', insights: [{ category: 'Hydration', title: 'Water intake goal hit 5 days in a row', detail: 'Longest streak this month. Previous best was 3 days.', read: true }]},
    ],
  },
  research: {
    since: 'March 12', lastAnalyzed: '3 hours ago',
    greeting: "Your competitive report is done — 12 pages, two gaps nobody's filling yet. I also pulled three fresh papers that landed this week. You'll want to see those.",
    accounts: [{ name: 'Google Scholar' }, { name: 'ArXiv' }],
    goals: [{ id: '1', text: 'Track AI agent adoption research' }, { id: '2', text: 'Monitor competitors in my space' }],
    skills: [{ name: 'Topic Deep-dives', active: true }, { name: 'Competitor Analysis', active: true }, { name: 'Summarization', active: true }, { name: 'Trend Spotting', active: true }, { name: 'Source Verification', active: false }],
    statsTitle: 'Research Activity',
    stats: [{ value: '12', label: 'Pages in report' }, { value: '5', label: 'Competitors analyzed' }, { value: '3', label: 'New papers found' }, { value: '1', label: 'Report ready' }],
    unread: 2,
    timeline: [
      { date: 'Today', insights: [{ category: 'Report', title: 'Competitive analysis ready — 12 pages', detail: '5 competitors analyzed: positioning, pricing, feature gaps.', mustSee: true }]},
      { date: 'Fri, Mar 28', insights: [{ category: 'Papers', title: '3 new papers on AI agent adoption', detail: 'Published in the last 14 days. Consumer trust, onboarding, retention.' }]},
      { date: 'Tue, Mar 25', insights: [{ category: 'Trend', title: 'Q1 2026 market trend summarized', detail: 'Enterprise adoption slowing, consumer interest accelerating.', read: true }]},
    ],
  },
};

export default function AgentDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { c, isAura, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState<'accounts' | 'instructions' | 'skills'>('accounts');
  const [goals, setGoals] = useState<any[] | null>(null);
  const [newGoal, setNewGoal] = useState('');
  const s = createStyles(c);

  const agentName = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  const agent = AGENTS.find((a) => a.name.toLowerCase() === name?.toLowerCase());
  const data = name ? AGENT_DATA[name.toLowerCase()] : null;
  const IconComponent = ICON_MAP[agentName];
  const currentGoals = goals ?? data?.goals ?? [];
  const activeSkills = data?.skills.filter((sk: any) => sk.active).length ?? 0;

  if (!agent || !data) {
    return (
      <View style={[s.flex, { backgroundColor: c.bg, paddingTop: insets.top + 20 }]}>
        <TouchableOpacity style={s.backRow} onPress={() => router.back()}><Text style={s.backText}>← Back</Text></TouchableOpacity>
        <Text style={[s.backText, { padding: 20 }]}>Agent not found.</Text>
      </View>
    );
  }

  const bgColors = isAura
    ? isDark ? ['#0a0a0a', '#0f0a14', '#0a0f14', '#0a0a0a'] as const : ['#ffffff', '#f4eeff', '#eef6ff', '#fff0eb'] as const
    : [c.bg, c.bg] as const;

  return (
    <LinearGradient colors={bgColors} style={s.flex} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <ScrollView style={[s.flex, { paddingTop: insets.top + 8 }]} contentContainerStyle={s.scroll}>
          <TouchableOpacity style={s.backRow} onPress={() => router.back()} hitSlop={12}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>

          {/* Agent header */}
          <View style={s.nameRow}>
            {IconComponent && <IconComponent color={c.text} />}
            <Text style={s.agentName}>{agent.name}</Text>
          </View>
          <Text style={s.since}>Running since {data.since} — last analyzed {data.lastAnalyzed}</Text>

          {/* Badges row: Configure, Stop agent, Active */}
          <View style={s.badges}>
            <TouchableOpacity style={s.headerBtn} onPress={() => setConfigOpen(true)}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="3" stroke={c.textDim} strokeWidth={1.5} />
                <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={s.headerBtnText}>Configure</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.headerBtn}><Text style={s.headerBtnText}>Stop agent</Text></TouchableOpacity>
            <View style={s.activeBadge}><View style={s.dot} /><Text style={s.activeBadgeText}>Active</Text></View>
          </View>

          {/* Greeting summary */}
          <Text style={s.greeting}>{data.greeting}</Text>

          {/* Stats */}
          <View style={s.statsSection}>
            <Text style={s.statsTitle}>{data.statsTitle}</Text>
            <View style={s.statsGrid}>
              {data.stats.map((st: any) => (
                <View key={st.label} style={s.statItem}>
                  <Text style={s.statValue}>{st.value}</Text>
                  <Text style={s.statLabel}>{st.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Insights timeline */}
          <Text style={s.insightsHeader}>Insights — {data.unread} unread</Text>
          {data.timeline.map((group: any) => (
            <View key={group.date} style={s.timelineGroup}>
              <Text style={[s.timelineDate, group.insights.every((i: any) => i.read) && s.timelineDateRead]}>{group.date}</Text>
              {group.insights.map((insight: any) => (
                <View key={insight.title} style={[s.insightCard, insight.read && s.insightRead]}>
                  <View style={s.insightTop}>
                    <View style={s.insightCatRow}>
                      {!insight.read && <View style={s.insightDot} />}
                      <Text style={s.insightCategory}>{insight.category}</Text>
                    </View>
                    {insight.mustSee && <Text style={s.mustSee}>Must see ⚠</Text>}
                  </View>
                  <Text style={[s.insightTitle, insight.read && { fontWeight: '500' }]}>{insight.title}</Text>
                  <Text style={s.insightDetail}>{insight.detail}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        {/* Compact chat input */}
        <View style={[s.compactBar, { paddingBottom: Math.max(insets.bottom - 12, 8) }]}>
          <View style={s.compactBox}>
            <TouchableOpacity style={s.compactAdd}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Line x1="12" y1="5" x2="12" y2="19" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
                <Line x1="5" y1="12" x2="19" y2="12" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
            <TextInput style={s.compactInput} placeholder={`Ask ${agentName}...`} placeholderTextColor={c.textDim} />
            <TouchableOpacity style={s.compactSend}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Line x1="5" y1="12" x2="19" y2="12" stroke={c.accentText} strokeWidth={2} strokeLinecap="round" />
                <Polyline points="12,5 19,12 12,19" stroke={c.accentText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Configure modal */}
      <Modal visible={configOpen} transparent animationType="slide">
        <Pressable style={s.modalOverlay} onPress={() => setConfigOpen(false)}>
          <Pressable style={[s.modalSheet, { backgroundColor: c.bg, paddingBottom: insets.bottom || 16 }]} onPress={(e) => e.stopPropagation()}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Configure {agent.name}</Text>
              <TouchableOpacity onPress={() => setConfigOpen(false)}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Line x1="18" y1="6" x2="6" y2="18" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
                  <Line x1="6" y1="6" x2="18" y2="18" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            {/* Config tabs */}
            <View style={s.configTabs}>
              {([
                { key: 'accounts' as const, label: 'Accounts', count: data.accounts.length },
                { key: 'instructions' as const, label: 'Instructions', count: currentGoals.length },
                { key: 'skills' as const, label: 'Skills', count: `${activeSkills}/${data.skills.length}` },
              ]).map((tab) => (
                <TouchableOpacity key={tab.key} style={[s.configTab, configTab === tab.key && s.configTabActive]} onPress={() => setConfigTab(tab.key)}>
                  <Text style={[s.configTabText, configTab === tab.key && s.configTabTextActive]}>{tab.label}</Text>
                  <Text style={s.configTabCount}>{tab.count}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {configTab === 'accounts' && data.accounts.map((a: any) => (
                <View key={a.name} style={s.configItem}><Text style={s.configItemText}>{a.name}</Text><Text style={s.removeLink}>Remove</Text></View>
              ))}
              {configTab === 'accounts' && <TouchableOpacity style={s.addItem}><Text style={s.addItemText}>+ Add account</Text></TouchableOpacity>}

              {configTab === 'instructions' && currentGoals.map((g: any) => (
                <View key={g.id} style={s.configItem}>
                  <Text style={[s.configItemText, { flex: 1 }]}>{g.text}</Text>
                  <TouchableOpacity onPress={() => setGoals(currentGoals.filter((x: any) => x.id !== g.id))}><Text style={s.removeLink}>Remove</Text></TouchableOpacity>
                </View>
              ))}
              {configTab === 'instructions' && (
                <View style={s.addGoalRow}>
                  <TextInput style={s.addGoalInput} placeholder="Add an instruction..." placeholderTextColor={c.textDim} value={newGoal} onChangeText={setNewGoal}
                    onSubmitEditing={() => { if (newGoal.trim()) { setGoals([...currentGoals, { id: Date.now().toString(), text: newGoal.trim() }]); setNewGoal(''); } }} />
                  <TouchableOpacity style={s.addGoalBtn} onPress={() => { if (newGoal.trim()) { setGoals([...currentGoals, { id: Date.now().toString(), text: newGoal.trim() }]); setNewGoal(''); } }}>
                    <Text style={s.addGoalBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              )}

              {configTab === 'skills' && data.skills.map((skill: any) => (
                <View key={skill.name} style={s.configItem}>
                  <Text style={[s.configItemText, !skill.active && { color: c.textDim }]}>{skill.name}</Text>
                  <Switch value={skill.active} disabled trackColor={{ false: c.borderLight, true: c.accent }} thumbColor="#fff" />
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const createStyles = (c: ColorTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 20, paddingBottom: 20 },
    backRow: { paddingVertical: 12 },
    backText: { fontSize: 13, fontWeight: '500', color: c.textDim },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    agentName: { fontSize: 19, fontWeight: '600', color: c.text },
    since: { fontSize: 12, color: c.textDim, marginBottom: 12 },
    badges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
    headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.borderLight, borderRadius: 9999, paddingHorizontal: 14, paddingVertical: 5 },
    headerBtnText: { fontSize: 12, fontWeight: '500', color: c.textDim },
    activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, borderRadius: 9999, paddingHorizontal: 14, paddingVertical: 5 },
    activeBadgeText: { fontSize: 12, fontWeight: '500', color: c.accentText },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
    greeting: { fontSize: 18, fontWeight: '400', color: c.text, lineHeight: 26, marginBottom: 24 },
    // Stats
    statsSection: { borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radius || 0, padding: 18, marginBottom: 24, backgroundColor: c.cardHover },
    statsTitle: { fontSize: 11, fontWeight: '500', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    statItem: { width: '46%' },
    statValue: { fontSize: 24, fontWeight: '500', color: c.text, letterSpacing: -0.3, marginBottom: 2 },
    statLabel: { fontSize: 12, color: c.textDim },
    // Insights
    insightsHeader: { fontSize: 11, fontWeight: '500', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 20 },
    timelineGroup: { marginBottom: 20 },
    timelineDate: { fontSize: 12, fontWeight: '600', color: c.text, textTransform: 'uppercase', letterSpacing: 0.2, marginBottom: 8 },
    timelineDateRead: { color: c.textDim },
    insightCard: { borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radius || 10, padding: 14, backgroundColor: c.cardBg, marginBottom: 8, ...(c.shadow ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 } : {}) },
    insightRead: {},
    insightTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    insightCatRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    insightDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.text },
    insightCategory: { fontSize: 11, fontWeight: '500', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 },
    mustSee: { fontSize: 10, fontWeight: '500', color: c.text },
    insightTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 4 },
    insightDetail: { fontSize: 13, color: c.textMid, lineHeight: 19 },
    // Compact chat
    compactBar: { paddingHorizontal: 16, paddingTop: 4 },
    compactBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.borderLight, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.menuBg },
    compactAdd: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center', justifyContent: 'center' },
    compactInput: { flex: 1, fontSize: 14, color: c.text },
    compactSend: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    // Configure modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    modalTitle: { fontSize: 17, fontWeight: '600', color: c.text },
    configTabs: { flexDirection: 'row', gap: 0, borderBottomWidth: 1, borderBottomColor: c.borderLight, marginBottom: 16 },
    configTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
    configTabActive: { borderBottomColor: c.text },
    configTabText: { fontSize: 13, fontWeight: '500', color: c.textDim },
    configTabTextActive: { color: c.text },
    configTabCount: { fontSize: 11, color: c.textDim },
    configItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radius || 10, backgroundColor: c.cardBg, marginBottom: 6 },
    configItemText: { fontSize: 14, color: c.text },
    removeLink: { fontSize: 11, fontWeight: '500', color: c.textDim },
    addItem: { alignItems: 'center', padding: 14, borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radius || 10, borderStyle: 'dashed', marginTop: 8 },
    addItemText: { fontSize: 13, color: c.textDim },
    addGoalRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    addGoalInput: { flex: 1, fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radius || 10, paddingHorizontal: 14, paddingVertical: 12 },
    addGoalBtn: { backgroundColor: c.accent, borderRadius: c.radius || 10, paddingHorizontal: 18, paddingVertical: 12, justifyContent: 'center' },
    addGoalBtnText: { fontSize: 13, fontWeight: '600', color: c.accentText },
  });

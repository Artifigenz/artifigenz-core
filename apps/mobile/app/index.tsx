import { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { AGENTS } from '@artifigenz/shared';
import { type ColorTheme } from '../constants/theme';
import { useTheme } from '../components/ThemeContext';
import { ICON_MAP } from '../components/AgentIcons';
import Header from '../components/Header';
import { useActivatedAgents, agentSlug } from '../hooks/useActivatedAgents';

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function buildHeroGreeting(count: number, name: string): string {
  const time = timeOfDayGreeting();
  if (count === 0) return `${time}, ${name} — let's pick your first agent and get you set up.`;
  if (count === 1) return `${time}, ${name} — here's what your agent has been up to.`;
  return `${time}, ${name} — your ${count} agents found a few things while you were away.`;
}

// Scrolling single-line insight
function ScrollingInsight({ text, color }: { text: string; color: string }) {
  const scrollRef = useRef<ScrollView>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const overflows = contentWidth > containerWidth + 4;

  useEffect(() => {
    if (!overflows || !scrollRef.current) return;
    let mounted = true;
    const animate = async () => {
      await new Promise(r => setTimeout(r, 800));
      if (!mounted) return;
      scrollRef.current?.scrollTo({ x: contentWidth - containerWidth, animated: true });
      await new Promise(r => setTimeout(r, 2000));
      if (!mounted) return;
      scrollRef.current?.scrollTo({ x: 0, animated: true });
    };
    animate();
    return () => { mounted = false; };
  }, [overflows, contentWidth, containerWidth, text]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={false}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      <Text
        style={{ fontSize: 13, fontWeight: '400', color, lineHeight: 18 }}
        numberOfLines={1}
        onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)}
      >
        {text}
      </Text>
    </ScrollView>
  );
}

export default function HomeScreen() {
  const { c, isAura, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const { activations, hydrated } = useActivatedAgents();

  // Map activated slugs to agent metadata from shared constants
  const activeAgents = AGENTS.filter((a) =>
    activations.some((act) => act.slug === agentSlug(a.name)),
  );

  const userName =
    user?.firstName ??
    user?.username ??
    user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ??
    'there';

  const [greeting] = useState(() => '');
  const heroText = hydrated
    ? buildHeroGreeting(activeAgents.length, userName)
    : '';

  const [ticks, setTicks] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentPicker, setAgentPicker] = useState(false);
  const s = createStyles(c);

  // Reset ticks when active agents change
  useEffect(() => {
    setTicks(activeAgents.map(() => 0));
  }, [activeAgents.length]);

  useEffect(() => {
    if (activeAgents.length === 0) return;
    let cur = 0;
    const iv = setInterval(() => {
      setTicks((p) => { const n = [...p]; n[cur] = (p[cur] ?? 0) + 1; return n; });
      cur = (cur + 1) % activeAgents.length;
    }, 4000);
    return () => clearInterval(iv);
  }, [activeAgents.length]);

  const bgColors = isAura
    ? isDark
      ? ['#0a0a0a', '#0f0a14', '#0a0f14', '#0a0a0a'] as const
      : ['#ffffff', '#f4eeff', '#eef6ff', '#fff0eb'] as const
    : [c.bg, c.bg] as const;

  return (
    <LinearGradient colors={bgColors} style={s.flex} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        <Header />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <View style={s.flex}>
          <ScrollView style={s.flex} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <View style={s.hero}>
              <Text style={s.heroTitle}>{heroText}</Text>
            </View>

            {activeAgents.map((agent, index) => {
              const insight = agent.insights?.[
                (ticks[index] ?? 0) % (agent.insights?.length || 1)
              ];
              const Icon = ICON_MAP[agent.name];
              return (
                <TouchableOpacity
                  key={agent.name}
                  style={s.card}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/agent/${agent.name.toLowerCase()}`)}
                >
                  <View style={s.cardInner}>
                    {Icon && (
                      <View style={s.cardIcon}>
                        <Icon color={c.textDim} />
                      </View>
                    )}
                    <View style={s.cardInfo}>
                      <View style={s.nameRow}>
                        <Text style={s.name}>{agent.name}</Text>
                        <View style={s.dot} />
                        <Text style={s.time}>{agent.lastActive}</Text>
                      </View>
                      {insight && <ScrollingInsight text={insight} color={c.textMid} />}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Add agent CTA */}
            <TouchableOpacity style={s.addAgentBtn} activeOpacity={0.7} onPress={() => router.push('/explore')}>
              <Text style={s.addAgentText}>+ Add an agent</Text>
            </TouchableOpacity>

            {/* Extra space so content can scroll above chat input */}
            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Fade sits over scroll, above chat bar */}
          <LinearGradient
            colors={['transparent', 'transparent']}
            style={s.fade}
            pointerEvents="none"
          />

          {/* Chat input */}
          <View style={[s.chatBar, { paddingBottom: Math.max(insets.bottom - 12, 8) }]}>
            <View style={s.chatBox}>
              <TextInput
                style={s.chatInput}
                placeholder={selectedAgent ? `Ask ${selectedAgent}...` : 'Ask anything or give a task...'}
                placeholderTextColor={c.textDim}
                multiline
              />
              <View style={s.toolbar}>
                <View style={s.toolbarLeft}>
                  <TouchableOpacity style={s.addBtn} onPress={() => setMenuOpen(true)}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Line x1="12" y1="5" x2="12" y2="19" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
                      <Line x1="5" y1="12" x2="19" y2="12" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
                    </Svg>
                  </TouchableOpacity>
                  {selectedAgent && (
                    <View style={s.selectedChip}>
                      <View style={s.dot} />
                      <Text style={s.selectedText}>{selectedAgent}</Text>
                      <TouchableOpacity onPress={() => setSelectedAgent(null)} hitSlop={8}>
                        <Text style={s.selectedRemove}>×</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <TouchableOpacity style={s.sendBtn}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Line x1="5" y1="12" x2="19" y2="12" stroke={c.accentText} strokeWidth={2} strokeLinecap="round" />
                    <Polyline points="12,5 19,12 12,19" stroke={c.accentText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* + Menu */}
      <Modal visible={menuOpen} transparent animationType="slide">
        <Pressable style={s.overlay} onPress={() => { setMenuOpen(false); setAgentPicker(false); }}>
          <Pressable style={[s.sheet, { backgroundColor: c.menuBg, paddingBottom: insets.bottom || 16 }]} onPress={(e) => e.stopPropagation()}>
            {!agentPicker ? (<>
              <TouchableOpacity style={s.sheetRow} onPress={() => setMenuOpen(false)}>
                <Text style={s.sheetIcon}>📎</Text>
                <Text style={s.sheetLabel}>Add files or images</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.sheetRow} onPress={() => setAgentPicker(true)}>
                <Text style={s.sheetIcon}>👥</Text>
                <Text style={s.sheetLabel}>Agents</Text>
                <Text style={s.sheetChevron}>›</Text>
              </TouchableOpacity>
            </>) : (<>
              <TouchableOpacity style={s.sheetBack} onPress={() => setAgentPicker(false)}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: c.textDim }}>‹ Back</Text>
              </TouchableOpacity>
              {activeAgents.map((a) => (
                <TouchableOpacity key={a.name} style={s.sheetRow} onPress={() => { setSelectedAgent(a.name); setAgentPicker(false); setMenuOpen(false); }}>
                  <View style={s.dot} />
                  <Text style={s.sheetLabel}>{a.name}</Text>
                </TouchableOpacity>
              ))}
              <View style={s.sheetDiv} />
              <TouchableOpacity style={s.sheetRow} onPress={() => { setAgentPicker(false); setMenuOpen(false); router.push('/explore'); }}>
                <Text style={[s.sheetLabel, { color: c.textDim }]}>Add agents →</Text>
              </TouchableOpacity>
            </>)}
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const createStyles = (c: ColorTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 20 },
    hero: { paddingTop: 32, paddingBottom: 24 },
    heroTitle: {
      fontSize: 22, fontWeight: '400', letterSpacing: -0.3, lineHeight: 28, color: c.text,
    },
    card: {
      paddingVertical: c.radius > 0 ? 14 : 14,
      paddingHorizontal: c.radius > 0 ? 14 : 0,
      borderRadius: c.radiusMd,
      borderWidth: c.radius > 0 ? 1 : 0,
      borderColor: c.borderLight,
      borderBottomWidth: c.radius > 0 ? 1 : 1,
      borderBottomColor: c.borderLight,
      backgroundColor: c.cardBg,
      marginBottom: c.radius > 0 ? 8 : 0,
      ...(c.shadow ? {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      } : {}),
    },
    cardInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardIcon: {},
    cardInfo: { flex: 1, minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    name: { fontSize: 14, fontWeight: '600', color: c.text },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
    time: { fontSize: 11, fontWeight: '400', color: c.textDim },
    fade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, zIndex: 1 },
    chatBar: { paddingHorizontal: 16, paddingTop: 0, zIndex: 2 },
    chatBox: {
      borderWidth: 1,
      borderColor: c.radius > 0 ? c.menuBorder : c.borderLight,
      borderRadius: c.radius > 0 ? 24 : 0,
      paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10,
      backgroundColor: c.menuBg,
    },
    chatInput: { fontSize: 15, fontWeight: '400', color: c.text, lineHeight: 23, minHeight: 24, maxHeight: 120, marginBottom: 12 },
    toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    toolbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center', justifyContent: 'center' },
    selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.borderLight, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 4 },
    selectedText: { fontSize: 12, fontWeight: '500', color: c.text },
    selectedRemove: { fontSize: 14, fontWeight: '400', color: c.textDim, marginLeft: 2 },
    addAgentBtn: {
      alignSelf: 'flex-start', marginTop: 12, borderWidth: 1, borderColor: c.borderLight,
      borderRadius: c.radiusMd, paddingVertical: 12, paddingHorizontal: 24,
    },
    addAgentText: { fontSize: 12, fontWeight: '500', color: c.textDim },
    sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: c.radiusLg || 12, borderTopRightRadius: c.radiusLg || 12, paddingTop: 12, paddingHorizontal: 4 },
    sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8 },
    sheetIcon: { fontSize: 16 },
    sheetLabel: { fontSize: 13, fontWeight: '500', color: c.text, flex: 1 },
    sheetChevron: { fontSize: 20, color: c.textDim },
    sheetBack: { paddingVertical: 10, paddingHorizontal: 12 },
    sheetDiv: { height: 1, backgroundColor: c.borderLight, marginVertical: 3, marginHorizontal: 12 },
  });

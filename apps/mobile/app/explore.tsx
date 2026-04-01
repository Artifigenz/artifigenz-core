import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AGENTS } from '@artifigenz/shared';
import { type ColorTheme } from '../constants/theme';
import { useTheme } from '../components/ThemeContext';

export default function ExploreScreen() {
  const { c, isAura, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const explore = AGENTS.filter((a) => !a.active);
  const s = createStyles(c);

  const bgColors = isAura
    ? isDark
      ? ['#0a0a0a', '#0f0a14', '#0a0f14', '#0a0a0a'] as const
      : ['#ffffff', '#f4eeff', '#eef6ff', '#fff0eb'] as const
    : [c.bg, c.bg] as const;

  return (
    <LinearGradient colors={bgColors} style={s.flex} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={s.dismiss}>← Back</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Explore Agents</Text>
        <Text style={s.sub}>Specialists ready to work for you. Activate any agent and it starts immediately.</Text>
        {explore.map((agent) => (
          <View key={agent.name} style={s.card}>
            <Text style={s.cardName}>{agent.name}</Text>
            <Text style={s.cardPitch}>{agent.pitch}</Text>
            <TouchableOpacity style={s.activateBtn} activeOpacity={0.7}>
              <Text style={s.activateText}>Activate →</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </LinearGradient>
  );
}

const createStyles = (c: ColorTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { paddingHorizontal: 20, paddingBottom: 4 },
    dismiss: { fontSize: 15, fontWeight: '500', color: c.textDim },
    scroll: { paddingHorizontal: 20, paddingBottom: 48 },
    // web 640px: 1.4rem=22px, margin-bottom 8px
    title: { fontSize: 22, fontWeight: '400', color: c.text, letterSpacing: -0.3, paddingTop: 24, marginBottom: 8 },
    // web 640px: 0.82rem=13px
    sub: { fontSize: 13, fontWeight: '400', color: c.textDim, lineHeight: 19, marginBottom: 20 },
    card: {
      borderWidth: 1,
      borderColor: c.borderLight,
      borderRadius: c.radiusMd || 0,
      padding: 14,
      marginBottom: 8,
      backgroundColor: c.cardBg,
      ...(c.shadow ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 } : {}),
    },
    // web 640px: 0.92rem=14.7px
    cardName: { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 4 },
    // web 640px: 0.78rem=12.5px, line 1.45
    cardPitch: { fontSize: 12, fontWeight: '400', color: c.textMid, lineHeight: 18, marginBottom: 10 },
    // web 640px: 0.68rem=10.9px, padding 5px 12px
    activateBtn: { borderWidth: 1, borderColor: c.borderLight, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
    activateText: { fontSize: 11, fontWeight: '500', color: c.textDim },
  });

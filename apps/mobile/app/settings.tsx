import {
  View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../components/ThemeContext';
import { type ColorTheme } from '../constants/theme';

const MODES = [
  { key: 'auto' as const, label: 'Auto' },
  { key: 'light' as const, label: 'Light' },
  { key: 'dark' as const, label: 'Dark' },
];

const THEMES = [
  { key: 'terminal' as const, name: 'Terminal', desc: 'Monospace. Black and white. Raw.' },
  { key: 'aura' as const, name: 'Aura', desc: 'Gradients. Glass. Warm and luminous.' },
];

export default function SettingsScreen() {
  const { mode, setMode, visualTheme, setVisualTheme, c, isAura, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
        <Text style={s.title}>Settings</Text>

        <Text style={s.sectionLabel}>PROFILE</Text>
        <View style={s.card}>
          <View style={s.row}><Text style={s.rowLabel}>Name</Text><Text style={s.rowValue}>Cooper</Text></View>
          <View style={s.rowSep} />
          <View style={s.row}><Text style={s.rowLabel}>Email</Text><Text style={s.rowValue}>suba@artifigenz.com</Text></View>
        </View>

        <Text style={s.sectionLabel}>MODE</Text>
        <View style={s.card}>
          {MODES.map((m, i) => (
            <View key={m.key}>
              <TouchableOpacity style={s.row} onPress={() => setMode(m.key)} activeOpacity={0.6}>
                <Text style={s.rowLabel}>{m.label}</Text>
                {mode === m.key && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
              {i < MODES.length - 1 && <View style={s.rowSep} />}
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>THEME</Text>
        <View style={s.card}>
          {THEMES.map((t, i) => (
            <View key={t.key}>
              <TouchableOpacity style={s.row} onPress={() => setVisualTheme(t.key)} activeOpacity={0.6}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{t.name}</Text>
                  <Text style={s.rowDesc}>{t.desc}</Text>
                </View>
                {visualTheme === t.key && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
              {i < THEMES.length - 1 && <View style={s.rowSep} />}
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>NOTIFICATIONS</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Agent insights</Text>
            <Switch value={false} disabled trackColor={{ false: c.borderLight, true: c.accent }} thumbColor="#fff" />
          </View>
          <View style={s.rowSep} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Proactive messages</Text>
            <Switch value={false} disabled trackColor={{ false: c.borderLight, true: c.accent }} thumbColor="#fff" />
          </View>
        </View>
        <Text style={s.hint}>Push notifications coming soon.</Text>
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
    title: { fontSize: 22, fontWeight: '400', color: c.text, letterSpacing: -0.3, paddingTop: 24, marginBottom: 24 },
    sectionLabel: { fontSize: 13, fontWeight: '500', color: c.textDim, letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
    card: {
      backgroundColor: c.cardBg, borderRadius: c.radiusMd || 0, borderWidth: 1, borderColor: c.borderLight,
      marginBottom: 20, overflow: 'hidden',
      ...(c.shadow ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8 } : {}),
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, minHeight: 46 },
    rowSep: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderLight, marginLeft: 16 },
    rowLabel: { fontSize: 15, color: c.text },
    rowValue: { fontSize: 15, color: c.textDim },
    rowDesc: { fontSize: 12, color: c.textDim, marginTop: 2 },
    check: { fontSize: 16, fontWeight: '600', color: c.accent },
    hint: { fontSize: 12, color: c.textDim, marginTop: -8, marginLeft: 4 },
  });

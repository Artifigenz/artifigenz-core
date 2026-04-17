import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Pressable, Animated,
  StyleSheet, Dimensions, useColorScheme,
} from 'react-native';
import Svg, { Line, Path, Circle, Polyline, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useTheme } from './ThemeContext';
import { type ColorTheme } from '../constants/theme';

// ── Context ──
type MenuContextType = { open: () => void };
const MenuContext = createContext<MenuContextType>({ open: () => {} });
export const useMenu = () => useContext(MenuContext);

// ── Provider ──
export function MenuProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return (
    <MenuContext.Provider value={{ open }}>
      {children}
      <DrawerMenu visible={visible} onClose={close} />
    </MenuContext.Provider>
  );
}

// ── Drawer (matches web MobileMenu exactly) ──
const DRAWER_W = 280;

function DrawerMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuth();
  const { user } = useUser();
  const slideAnim = useRef(new Animated.Value(DRAWER_W)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const s = createStyles(c);

  const displayName = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? '';
  const displayEmail = user?.primaryEmailAddress?.emailAddress ?? '';
  const initial = displayName ? displayName[0].toUpperCase() : 'U';

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 25, stiffness: 250 }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: DRAWER_W, duration: 200, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const nav = (route: string) => {
    onClose();
    if (route !== '#') setTimeout(() => router.push(route as never), 200);
  };

  if (!visible) return null;

  const isActive = (r: string) => pathname === r;
  const linkColor = (r: string) => isActive(r) ? c.text : c.textDim;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Overlay — web: rgba(0,0,0,0.3) */}
      <Animated.View style={[s.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Drawer — web: 280px, right, border-left 1px */}
      <Animated.View style={[s.drawer, { transform: [{ translateX: slideAnim }], paddingTop: insets.top }]}>
        {/* Header — web: padding 24px 20px 16px */}
        <View style={s.drawerHeader}>
          <View style={s.profile}>
            {/* web: 36px avatar, 0.78rem initial */}
            <View style={s.avatar}><Text style={s.avatarInitial}>{initial}</Text></View>
            <View>
              <Text style={s.profileName}>{displayName}</Text>
              <Text style={s.profileEmail}>{displayEmail}</Text>
            </View>
          </View>
          {/* Close — web: 32x32, X icon 18x18 */}
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Line x1="18" y1="6" x2="6" y2="18" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
              <Line x1="6" y1="6" x2="18" y2="18" stroke={c.textDim} strokeWidth={1.5} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        {/* Nav — web: padding 8px 12px, gap 2px */}
        <View style={s.nav}>
          {/* Home — web: 18x18 icon, 0.88rem text, gap 12, padding 12, radius 10 */}
          <TouchableOpacity style={s.navLink} onPress={() => nav('/')}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={linkColor('/')} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              <Polyline points="9,22 9,12 15,12 15,22" stroke={linkColor('/')} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={[s.navText, { color: linkColor('/') }]}>Home</Text>
          </TouchableOpacity>

          {/* Explore — compass icon */}
          <TouchableOpacity style={s.navLink} onPress={() => nav('/explore')}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="12" r="10" stroke={linkColor('/explore')} strokeWidth={1.5} />
              <Path d="M16.24 7.76L14.12 14.12L7.76 16.24L9.88 9.88L16.24 7.76Z" stroke={linkColor('/explore')} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={[s.navText, { color: linkColor('/explore') }]}>Explore</Text>
          </TouchableOpacity>

          {/* web: divider 1px, margin 6px 12px */}
          <View style={s.divider} />

          <TouchableOpacity style={s.navLink} onPress={() => nav('#')}>
            <Text style={[s.navText, { color: c.textDim }]}>Plan</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.navLink} onPress={() => nav('/settings')}>
            <Text style={[s.navText, { color: linkColor('/settings') }]}>Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.navLink} onPress={() => { onClose(); signOut(); }}>
            <Text style={[s.navText, { color: c.textDim }]}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {/* Footer — web: padding 16px 20px 28px, border-top */}
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 28) }]}>
          <View style={s.modeToggle}>
            {/* System icon — monitor */}
            <TouchableOpacity style={s.modeBtn} onPress={() => setMode('auto')}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Rect x="2" y="3" width="20" height="14" rx="2" stroke={mode === 'auto' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <Line x1="8" y1="21" x2="16" y2="21" stroke={mode === 'auto' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="12" y1="17" x2="12" y2="21" stroke={mode === 'auto' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
            {/* Light icon — sun */}
            <TouchableOpacity style={s.modeBtn} onPress={() => setMode('light')}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="5" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} />
                <Line x1="12" y1="1" x2="12" y2="3" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="12" y1="21" x2="12" y2="23" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="1" y1="12" x2="3" y2="12" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="21" y1="12" x2="23" y2="12" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
                <Line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke={mode === 'light' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
            {/* Dark icon — moon */}
            <TouchableOpacity style={s.modeBtn} onPress={() => setMode('dark')}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke={mode === 'dark' ? c.text : c.textDim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const createStyles = (c: ColorTheme) =>
  StyleSheet.create({
    // web: rgba(0,0,0,0.3)
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 300 },
    // web: 280px, right 0, bg var(--bg), border-left 1px
    drawer: {
      position: 'absolute', top: 0, right: 0, bottom: 0, width: DRAWER_W,
      backgroundColor: c.bg, borderLeftWidth: 1, borderLeftColor: c.borderLight,
      zIndex: 301, flexDirection: 'column',
    },
    // web: padding 24px 20px 16px
    drawerHeader: {
      flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
      paddingTop: 24, paddingHorizontal: 20, paddingBottom: 16,
    },
    profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    // web: 36px, border 1px, radius 50%, 0.78rem=12.5px
    avatar: {
      width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.borderLight,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarInitial: { fontSize: 13, fontWeight: '600', color: c.text },
    // web: 0.88rem=14px, weight 600
    profileName: { fontSize: 14, fontWeight: '600', color: c.text },
    // web: 0.65rem=10.4px
    profileEmail: { fontSize: 10, color: c.textDim },
    // web: 32x32
    closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    // web: padding 8px 12px, gap 2px
    nav: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
    // web: gap 12, padding 12, radius 10, 0.88rem=14px, weight 500
    navLink: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10 },
    navText: { fontSize: 14, fontWeight: '500' },
    // web: 1px, margin 6px 12px
    divider: { height: 1, backgroundColor: c.borderLight, marginVertical: 6, marginHorizontal: 12 },
    // web: padding 16px 20px 28px, border-top
    footer: { paddingTop: 16, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: c.borderLight },
    // web: flex, gap 0
    modeToggle: { flexDirection: 'row' },
    // web: flex 1, padding 10px 0
    modeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  });

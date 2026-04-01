import { View, TouchableOpacity, Text, Image, StyleSheet } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useMenu } from './MenuSheet';
import { useTheme } from './ThemeContext';

export default function Header() {
  const { c, isDark } = useTheme();
  const { open } = useMenu();

  return (
    // web mobile: padding 20px
    <View style={s.header}>
      <View style={s.logoMark}>
        <Image
          source={require('../assets/icon.png')}
          style={[s.logoIcon, isDark && { tintColor: '#ffffff' }]}
        />
        {/* web mobile: 0.82rem=13px, weight 700, spacing 0.1em, uppercase */}
        <Text style={[s.logoText, { color: c.text }]}>ARTIFIGENZ</Text>
      </View>
      {/* web: 36x36 button, 20x20 SVG, 3 lines */}
      <TouchableOpacity style={s.hamburger} onPress={open} hitSlop={8}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Line x1="3" y1="6" x2="21" y2="6" stroke={c.text} strokeWidth={1.5} strokeLinecap="round" />
          <Line x1="3" y1="12" x2="21" y2="12" stroke={c.text} strokeWidth={1.5} strokeLinecap="round" />
          <Line x1="3" y1="18" x2="21" y2="18" stroke={c.text} strokeWidth={1.5} strokeLinecap="round" />
        </Svg>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  // web mobile: padding 20px
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  logoMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // web mobile: 22x22
  logoIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
  },
  // web mobile: 0.82rem=13px, weight 700, spacing 0.1em
  logoText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  // web: 36x36
  hamburger: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

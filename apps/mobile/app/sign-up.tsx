import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../components/ThemeContext';
import { type ColorTheme } from '../constants/theme';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, isAura, isDark } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const s = createStyles(c);

  const bgColors = isAura
    ? isDark
      ? ['#0a0a0a', '#0f0a14', '#0a0f14', '#0a0a0a'] as const
      : ['#ffffff', '#f4eeff', '#eef6ff', '#fff0eb'] as const
    : [c.bg, c.bg] as const;

  const handleSignUp = async () => {
    if (!isLoaded || !signUp) return;
    setError('');
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? 'Sign up failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!isLoaded || !signUp) return;
    setError('');
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? 'Verification failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={bgColors} style={s.flex} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.flex, { paddingTop: insets.top }]}
      >
        <View style={s.container}>
          <Text style={s.logo}>ARTIFIGENZ</Text>

          {!pendingVerification ? (
            <>
              <Text style={s.title}>Create account</Text>
              <Text style={s.subtitle}>Get started with your personal AI agents.</Text>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <Text style={s.label}>Email</Text>
              <TextInput
                style={s.input}
                placeholder="you@example.com"
                placeholderTextColor={c.textDim}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
              />

              <Text style={s.label}>Password</Text>
              <TextInput
                style={s.input}
                placeholder="Password"
                placeholderTextColor={c.textDim}
                secureTextEntry
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
              />

              <TouchableOpacity
                style={[s.button, loading && s.buttonDisabled]}
                onPress={handleSignUp}
                activeOpacity={0.7}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={c.accentText} size="small" />
                ) : (
                  <Text style={s.buttonText}>Continue</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.title}>Verify email</Text>
              <Text style={s.subtitle}>We sent a code to {email}.</Text>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <Text style={s.label}>Verification code</Text>
              <TextInput
                style={s.input}
                placeholder="123456"
                placeholderTextColor={c.textDim}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
              />

              <TouchableOpacity
                style={[s.button, loading && s.buttonDisabled]}
                onPress={handleVerify}
                activeOpacity={0.7}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={c.accentText} size="small" />
                ) : (
                  <Text style={s.buttonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <View style={s.footer}>
            <Text style={s.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.push('/sign-in')}>
              <Text style={s.footerLink}> Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const createStyles = (c: ColorTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
    logo: {
      fontSize: 13, fontWeight: '700', letterSpacing: 1.3, color: c.text,
      marginBottom: 32,
    },
    title: {
      fontSize: 24, fontWeight: '600', color: c.text, marginBottom: 6,
    },
    subtitle: {
      fontSize: 14, color: c.textDim, marginBottom: 28, lineHeight: 20,
    },
    label: {
      fontSize: 13, fontWeight: '500', color: c.text, marginBottom: 6,
    },
    input: {
      borderWidth: 1, borderColor: c.borderLight, borderRadius: c.radiusMd || 8,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text,
      backgroundColor: c.cardBg, marginBottom: 16,
    },
    button: {
      backgroundColor: c.accent, borderRadius: c.radiusMd || 8,
      paddingVertical: 14, alignItems: 'center', marginTop: 8,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      fontSize: 15, fontWeight: '600', color: c.accentText,
    },
    error: {
      fontSize: 13, color: '#ef4444', marginBottom: 16, lineHeight: 18,
    },
    footer: {
      flexDirection: 'row', justifyContent: 'center', marginTop: 24,
    },
    footerText: { fontSize: 13, color: c.textDim },
    footerLink: { fontSize: 13, fontWeight: '600', color: c.text },
  });

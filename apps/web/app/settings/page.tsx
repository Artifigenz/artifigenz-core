'use client';

import Header from '@/components/layout/Header';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import {
  IdentitySection,
  ChannelsSection,
  ChatSection,
  SharedChatsSection,
  MemoriesSection,
  AppearanceSection,
  PrivacySection,
} from './sections';
import styles from './page.module.css';

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  );
}

function SettingsContent() {
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Settings</h1>
        </div>

        <div className={styles.sections}>
          <IdentitySection />
          <ChannelsSection />
          <ChatSection />
          <SharedChatsSection />
          <MemoriesSection />
          <AppearanceSection />
          <PrivacySection />
        </div>

      </main>
    </div>
  );
}

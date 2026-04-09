import Header from '@/components/layout/Header';
import Hero from '@/components/sections/Hero';
import AgentGrid from '@/components/sections/AgentGrid';
import ChatInput from '@/components/sections/ChatInput';
import styles from './page.module.css';

export default function AppHome() {
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Hero />
        <AgentGrid />
        <ChatInput />
      </main>
    </div>
  );
}

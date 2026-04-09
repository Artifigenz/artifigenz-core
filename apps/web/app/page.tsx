import LandingHeader from '@/components/landing/LandingHeader';
import LandingHero from '@/components/landing/LandingHero';
import HowItWorks from '@/components/landing/HowItWorks';
import Consultants from '@/components/landing/Consultants';
import SocialProof from '@/components/landing/SocialProof';
import FinalCta from '@/components/landing/FinalCta';
import LandingFooter from '@/components/landing/LandingFooter';
import styles from './page.module.css';

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main className={styles.main}>
        <LandingHero />
        <HowItWorks />
        <Consultants />
        <SocialProof />
        <FinalCta />
        <LandingFooter />
      </main>
    </div>
  );
}

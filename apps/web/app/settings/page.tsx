import { redirect } from 'next/navigation';

// The standalone /settings page is gone — settings is now an in-place
// modal launched from the avatar on any HavenTopBar page. Hitting this
// route forwards to the home with ?settings=1, which page.tsx detects
// and auto-opens the modal.
export default function SettingsRedirect() {
  redirect('/?settings=1');
}

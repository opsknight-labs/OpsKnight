import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function ClearPreference() {
  // Clear the prefer-desktop cookie
  const cookieStore = await cookies();
  cookieStore.delete('prefer-desktop');

  // Redirect to mobile home
  redirect('/m');
}

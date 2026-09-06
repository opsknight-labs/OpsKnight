import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center space-y-4 text-center">
      <h2 className="text-4xl font-bold tracking-tight">404 - Page Not Found</h2>
      <p className="text-muted-foreground">The page you are looking for does not exist.</p>
      <Link href="/">
        <Button>Return Home</Button>
      </Link>
    </div>
  );
}

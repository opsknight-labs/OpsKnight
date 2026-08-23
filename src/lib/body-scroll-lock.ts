export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  const body = document.body;
  if (!body) return () => {};

  const currentCount = Number(body.dataset.scrollLockCount || '0');
  const mobileContent = document.querySelector<HTMLElement>('.mobile-content');
  if (currentCount === 0) {
    body.dataset.scrollLockOverflow = body.style.overflow || '';
    body.style.overflow = 'hidden';
    if (mobileContent) {
      mobileContent.dataset.scrollLockOverflow = mobileContent.style.overflow || '';
      mobileContent.style.overflow = 'hidden';
    }
  }
  body.dataset.scrollLockCount = String(currentCount + 1);

  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    const nextCount = Math.max(0, Number(body.dataset.scrollLockCount || '1') - 1);
    body.dataset.scrollLockCount = String(nextCount);
    if (nextCount === 0) {
      const previousOverflow = body.dataset.scrollLockOverflow ?? '';
      body.style.overflow = previousOverflow;
      delete body.dataset.scrollLockOverflow;
      if (mobileContent) {
        mobileContent.style.overflow = mobileContent.dataset.scrollLockOverflow || '';
        delete mobileContent.dataset.scrollLockOverflow;
      }
    }
  };
}

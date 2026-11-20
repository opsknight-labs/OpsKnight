'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './shadcn/dialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Compatibility wrapper over the canonical shadcn `Dialog`
 * (`@/components/ui/shadcn/dialog`): a centred dialog on tablet/desktop and a
 * bottom sheet on phones.
 */
const Modal = ({ isOpen, onClose, title, description, children, className }: ModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className={className}
        {...(title && description ? {} : { 'aria-describedby': undefined })}
      >
        {title ? (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        ) : (
          <DialogTitle className="sr-only">Dialog</DialogTitle>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
};

export default Modal;

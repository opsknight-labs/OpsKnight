'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

type OpenOptions = {
  serviceId?: string;
  templateId?: string;
};

type IncidentCreationModalContextType = {
  isOpen: boolean;
  openOptions: OpenOptions | null;
  openCreateIncident: (options?: OpenOptions) => void;
  closeCreateIncident: () => void;
};

const defaultContextValue: IncidentCreationModalContextType = {
  isOpen: false,
  openOptions: null,
  openCreateIncident: () => {},
  closeCreateIncident: () => {},
};

const IncidentCreationModalContext =
  createContext<IncidentCreationModalContextType>(defaultContextValue);

export function IncidentCreationModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [openOptions, setOpenOptions] = useState<OpenOptions | null>(null);

  const openCreateIncident = useCallback((options?: OpenOptions) => {
    setOpenOptions(options || null);
    setIsOpen(true);
  }, []);

  const closeCreateIncident = useCallback(() => {
    setIsOpen(false);
    setOpenOptions(null);
  }, []);

  return (
    <IncidentCreationModalContext.Provider
      value={{ isOpen, openOptions, openCreateIncident, closeCreateIncident }}
    >
      {children}
    </IncidentCreationModalContext.Provider>
  );
}

export function useCreateIncidentModal() {
  return useContext(IncidentCreationModalContext);
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

type LibrarySearchContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const LibrarySearchContext = createContext<LibrarySearchContextValue | null>(
  null
);

export function LibrarySearchProvider(props: {
  children: ReactNode;
}): ReactElement {
  const { children } = props;
  const { pathname } = useLocation();
  const [isOpen, setOpen] = useState(false);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (pathname !== "/library") setOpen(false);
  }, [pathname]);

  const value = useMemo(
    () => ({ isOpen, open, close }),
    [isOpen, open, close]
  );

  return (
    <LibrarySearchContext.Provider value={value}>
      {children}
    </LibrarySearchContext.Provider>
  );
}

export function useLibrarySearch(): LibrarySearchContextValue {
  const ctx = useContext(LibrarySearchContext);
  if (!ctx) {
    throw new Error("useLibrarySearch must be used within LibrarySearchProvider");
  }
  return ctx;
}

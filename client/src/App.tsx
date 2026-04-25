import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LibraryPage } from "./pages/LibraryPage";
import { AlbumPage } from "./pages/AlbumPage";
import { ArtistPage } from "./pages/ArtistPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { PlaylistPage } from "./pages/PlaylistPage";
import { NowPage } from "./pages/NowPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AudioCdPage } from "./pages/AudioCdPage";
import { ToastProvider } from "./context/ToastContext";
import { musicApi } from "./api/client";
import { useToast } from "./context/ToastContext";

function VersionWatcher(): null {
  const toast = useToast();
  const initialCommitRef = useRef<string | null>(null);
  const hasReloadedRef = useRef(false);
  const versionQ = useQuery({
    queryKey: ["app-version"],
    queryFn: () => musicApi.appVersion(),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const commit = versionQ.data?.commit ?? null;
    if (!commit) return;
    if (!initialCommitRef.current) {
      initialCommitRef.current = commit;
      return;
    }
    if (initialCommitRef.current !== commit && !hasReloadedRef.current) {
      hasReloadedRef.current = true;
      toast("New app version detected. Refreshing now...", "info");
      setTimeout(() => {
        window.location.reload();
      }, 250);
    }
  }, [versionQ.data?.commit, toast]);
  return null;
}

export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <ToastProvider>
        <VersionWatcher />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/album/:id" element={<AlbumPage />} />
            <Route path="/library/artist/:id" element={<ArtistPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/:id" element={<PlaylistPage />} />
            <Route path="/cd" element={<AudioCdPage />} />
            <Route path="/now" element={<NowPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

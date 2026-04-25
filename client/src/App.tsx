import type { ReactElement } from "react";
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

export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <ToastProvider>
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

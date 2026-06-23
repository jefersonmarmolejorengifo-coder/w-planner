import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";

// Presencia en tiempo real: quién está activo en el proyecto, expulsión cuando
// otra sesión toma tu mismo usuario, y conflicto de doble sesión. Extraído del
// orquestador App (H-002, núcleo fase D). Recibe activeUser/setActiveUser/
// setCurrentUserId (que App posee porque el spine los puebla) y projectId.
// Lógica verbatim: comportamiento idéntico.
export function usePresence({ projectId, activeUser, setActiveUser, setCurrentUserId }) {
  const [activeUsers, setActiveUsers] = useState([]);
  const [kickedMsg, setKickedMsg] = useState(null);
  const [conflictUser, setConflictUser] = useState(null);

  const sessionIdRef = useRef(crypto.randomUUID());
  const presenceChannelRef = useRef(null);
  const activeUserRef = useRef(null);

  useEffect(() => { activeUserRef.current = activeUser; }, [activeUser]);

  // Single channel per session — key is our unique sessionId
  useEffect(() => {
    if (!projectId) return undefined;
    const channel = supabase.channel(`productivity-plus-presence-${projectId}`, {
      config: { presence: { key: sessionIdRef.current } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Flatten all presences into a list, dedupe by userId (newest wins)
        const byUser = {};
        Object.values(state).forEach(presences => {
          presences.forEach(p => {
            if (!p.userId) return; // observer with no track data
            const existing = byUser[p.userId];
            if (!existing || (p.onlineAt || '') > (existing.onlineAt || '')) {
              byUser[p.userId] = p;
            }
          });
        });
        const users = Object.values(byUser).map(p => ({
          userId: p.userId, name: p.name, sessionId: p.sessionId,
        }));
        setActiveUsers(users);

        // Check if someone newer took our userId
        const currentActive = activeUserRef.current;
        if (!currentActive) return;
        const newestForMyUser = byUser[currentActive.id];
        if (newestForMyUser && newestForMyUser.sessionId !== sessionIdRef.current) {
          // Someone newer has our userId — we get kicked
          setKickedMsg(`Alguien acaba de ingresar como "${currentActive.name}". Tu sesión ha sido cerrada.`);
          setActiveUser(null);
          channel.untrack();
        }
      })
      .subscribe();

    presenceChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); presenceChannelRef.current = null; };
    // El canal solo debe re-suscribirse al cambiar de proyecto. setActiveUser es
    // un setter estable de useState (no cambia de identidad), así que omitirlo es seguro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Track/untrack our presence when activeUser changes
  useEffect(() => {
    const channel = presenceChannelRef.current;
    if (!channel) return;

    if (!activeUser) {
      channel.untrack();
      return;
    }

    const doTrack = () => {
      channel.track({
        name: activeUser.name,
        sessionId: sessionIdRef.current,
        userId: activeUser.id,
        onlineAt: new Date().toISOString(),
      });
    };

    // Small delay to ensure channel is SUBSCRIBED
    const timer = setTimeout(doTrack, 150);
    return () => clearTimeout(timer);
  }, [activeUser]);

  const handleForceEntry = () => {
    if (!conflictUser) return;
    setKickedMsg(null);
    const p = conflictUser;
    setConflictUser(null);
    // Force enter — our newer onlineAt will kick the old session via sync
    setActiveUser(p);
    setCurrentUserId(p.id);
  };

  const handleChangeUser = () => {
    if (presenceChannelRef.current) {
      presenceChannelRef.current.untrack();
    }
    setActiveUser(null);
  };

  return {
    activeUsers,
    kickedMsg, setKickedMsg,
    conflictUser, setConflictUser,
    handleForceEntry, handleChangeUser,
  };
}

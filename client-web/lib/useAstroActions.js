import { useKundliGate } from './kundliGate';

// Service actions go through the Kundli gate: login (if needed) → choose or
// add the kundli to share → then chat/call/video (blueprint requirement).
export function useAstroActions() {
  const { requestSession } = useKundliGate();
  return { go: (type, a) => requestSession(type, a) };
}

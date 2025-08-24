import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase/firebase";

export default function useUserEntitlements() {
  const [state, setState] = useState({
    loading: true,
    uid: null,
    ent: {},
    whitelist: [],
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setState({ loading: false, uid: null, ent: {}, whitelist: [] });
        return;
      }
      const ref = doc(db, "users", user.uid);
      const unsubDoc = onSnapshot(
        ref,
        (snap) => {
          const d = snap.data() || {};
          setState({
            loading: false,
            uid: user.uid,
            ent: d.entitlements || {},
            whitelist: d.caseWhitelist || [],
          });
        },
        () => setState((s) => ({ ...s, loading: false }))
      );
      return unsubDoc;
    });
    return unsubAuth;
  }, []);

  return state; // { loading, uid, ent, whitelist }
}


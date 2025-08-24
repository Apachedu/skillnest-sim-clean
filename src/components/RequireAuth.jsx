import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();

  if (!ready) return null; // or a spinner

  if (!user) {
    return <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
  }
  return children;
}

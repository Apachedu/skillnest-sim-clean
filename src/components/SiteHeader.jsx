// src/components/SiteHeader.jsx
import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider"; // <-- add this
<NavLink to="/signin" className={({isActive})=>isActive?"nav-link nav-link--active":"nav-link"}>
  Sign in
</NavLink>

export default function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (e) {
      console.error("Sign out failed:", e);
      alert("Couldn’t sign out. Try again.");
    }
  };

  return (
    <header className="site-header" role="banner">
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand" aria-label="SkillNestEdu home">
          <img src="/skillnestlogo.png" alt="" />
          <span>SkillNestEdu</span>
        </Link>

        <nav aria-label="Primary" className="site-header__nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/unlock"
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
          >
            Unlock
          </NavLink>
        </nav>

        {/* <-- ADD THIS BLOCK: right-side auth actions */}
        <div className="site-header__auth" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading ? null : user ? (
            <>
              <span className="meta" title={user.email || user.uid}>
                {user.email || "Account"}
              </span>
              <button className="btn--outline" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <Link className="btn" to="/signin">Sign in</Link>
          )}
        </div>
        {/* ------------------------ */}
      </div>
    </header>
  );
}
